const posterData = require('../../utils/posterData');
const posterCanvas = require('../../utils/posterCanvas');
const posterShare = require('../../utils/posterShare');
const posterCover = require('../../utils/posterCover');
const storage = require('../../utils/storage');
const userData = require('../../utils/userData');
const cloudFiles = require('../../utils/cloudFiles');

const STAGES = {
  snapshotting: {
    title: '正在查找已生成海报',
    copy: '已有海报会直接打开，不重复生成',
  },
  'preparing-image': {
    title: '正在生成猫咪封面',
    copy: '保留原样猫咪，配一幅专属场景',
  },
  'rendering-canvas': {
    title: '正在排版海报',
    copy: '把档案信息放回这次相遇里',
  },
  validating: {
    title: '正在做最后检查',
    copy: '检查图片、文字和分数',
  },
};

function decodeOption(value) {
  if (!value) return '';
  try {
    return decodeURIComponent(String(value));
  } catch (error) {
    return String(value);
  }
}

Page({
  data: {
    state: 'snapshotting',
    stageTitle: STAGES.snapshotting.title,
    stageCopy: STAGES.snapshotting.copy,
    errorTitle: '',
    errorCopy: '',
    errorCode: '',
  },

  onLoad(options = {}) {
    const catId = decodeOption(options.catId);
    const shareId = decodeOption(options.shareId);
    const requestedRecordId = decodeOption(options.recordId || options.sourceRecordId);
    const currentRecordId = !shareId && catId && typeof posterData.getCurrentRecordId === 'function'
      ? posterData.getCurrentRecordId(catId)
      : '';
    this.options = {
      catId,
      // 兼容旧链接，但本地档案始终以最新记录为海报来源。
      recordId: currentRecordId || requestedRecordId,
      shareId,
    };
    this.posterJobId = decodeOption(options.jobId)
      || posterData.getStablePosterJobId(this.options.catId, this.options.recordId)
      || posterData.createPosterJobId();
    this._cancelled = false;
    this._generate();
  },

  onUnload() {
    this._cancelled = true;
  },

  _setStage(stage) {
    const copy = STAGES[stage] || STAGES.snapshotting;
    this.setData({
      state: stage,
      stageTitle: copy.title,
      stageCopy: copy.copy,
      errorTitle: '',
      errorCopy: '',
      errorCode: '',
    });
  },

  _isImageAvailable(path) {
    if (!path) return Promise.resolve(false);
    if (typeof wx.getImageInfo !== 'function') return Promise.resolve(true);
    return new Promise(resolve => {
      wx.getImageInfo({
        src: path,
        success: () => resolve(true),
        fail: () => resolve(false),
      });
    });
  },

  async _getCachedPosterResult() {
    if (this.options.shareId || !this.options.catId || !this.options.recordId) return null;
    const cached = posterData.getCachedPosterResult(
      this.options.catId,
      this.options.recordId,
    );
    if (!cached) return null;
    if (await this._isImageAvailable(cached.posterPath)) return cached;

    // 本地临时 PNG 过期后，直接用已经上传的 posterImage fileID 换新地址；
    // 不能因为本地临时路径失效就重新走猫生图。
    if (cached.posterImage && cached.posterImage.fileID) {
      try {
        const posterPath = await cloudFiles.getTempFileURL(cached.posterImage.fileID);
        if (posterPath && await this._isImageAvailable(posterPath)) {
          return { ...cached, posterPath };
        }
      } catch (error) {
        // 云端成品暂时不可读时继续尝试恢复封面引用，不触发生图。
      }
    }

    // 最终 PNG 是本地临时文件，过期后恢复已固定的封面元数据，后面只重绘 Canvas。
    if (cached.coverImage && cached.sourceRecordId) {
      storage.updateRecordCover(cached.sourceRecordId, cached.coverImage);
    }
    return null;
  },

  _redirectToPreview() {
    wx.redirectTo({
      url: `/pages/poster-preview/poster-preview?jobId=${encodeURIComponent(this.posterJobId)}`,
    });
  },

  _persistPosterResult(result) {
    const payload = posterData.buildPosterPersistencePayload(result);
    if (!payload) return;
    return (async () => {
      let lastError = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await userData.savePosterResult({
            ...payload,
            posterPath: result.posterPath,
          });
          if (response && response.posterResult) {
            result.posterImage = response.posterResult.posterImage;
            posterData.savePosterResult(this.posterJobId, result);
          }
          if (!response || response.saved !== true) {
            console.info('[PosterLoading] 海报结果暂未写入云端:', response && response.reason);
          }
          return response;
        } catch (error) {
          lastError = error;
          if (attempt < 2) {
            await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
          }
        }
      }

      // 本地缓存已可用于当前预览；云端写入失败时保留待同步状态，后续打开/回到前台会重试。
      console.warn('[PosterLoading] 海报结果写入云端失败:', {
        code: lastError && (lastError.code || lastError.errCode)
          ? String(lastError.code || lastError.errCode)
          : '',
        message: lastError && (lastError.message || lastError.errMsg)
          ? String(lastError.message || lastError.errMsg)
          : '',
      });
      return null;
    })();
  },

  async _generate() {
    if (this._busy) return;
    this._busy = true;
    this._setStage('snapshotting');

    try {
      // 等待规则升级触发的一次性清理完成，避免旧快照清理与新海报生成并发发生。
      const app = typeof getApp === 'function' ? getApp() : null;
      if (app && app.posterResetPromise) await app.posterResetPromise;

      // 先复用本地固定成品；只有本地没有可用图片时，才查询云端成品。
      // 命中任一成品都直接打开，不能触发隐式重新生成。
      const cachedResult = await this._getCachedPosterResult();
      if (this._cancelled) return;
      if (cachedResult) {
        console.info('[PosterLoading] 命中本地海报缓存，跳过生成接口');
        this.posterData = cachedResult;
        posterData.savePosterResult(this.posterJobId, cachedResult);
        this._persistPosterResult(cachedResult);
        this._setStage('validating');
        this._redirectToPreview();
        return;
      }

      // 本地没有成品时查询云端；读取失败只提示重试，不能触发隐式重新生成。
      let saved = null;
      try {
        saved = await posterData.getSavedPosterResult(this.options);
      } catch (error) {
        // 云端海报读取失败时继续查本地固定缓存和 coverFileID，避免把已有图片误判成未生成。
        console.warn('[PosterLoading] 云端海报读取失败，继续复用本地图片:', {
          code: error && (error.code || error.errCode) ? String(error.code || error.errCode) : '',
          message: error && (error.message || error.errMsg) ? String(error.message || error.errMsg) : '',
        });
      }
      if (this._cancelled) return;
      if (saved) {
        console.info('[PosterLoading] 命中云端海报结果，跳过生成接口');
        posterData.savePosterResult(this.posterJobId, saved);
        this._setStage('validating');
        this._redirectToPreview();
        return;
      }

      const data = await posterData.buildPosterData({
        ...this.options,
        posterJobId: this.posterJobId,
      });
      if (this._cancelled) return;
      if (data.eligible !== true) {
        const error = new Error(data.unavailableReason || '海报暂不可用');
        error.code = 'POSTER_SCORE_PENDING';
        throw error;
      }

      this._setStage('preparing-image');
      let renderData = data;
      // 已经验收的封面直接复用；分享档案只读取分享者已经生成的封面，
      // 不在接收者设备上悄悄消耗一次图生图额度。
      if (!data.isShared
        && data.sourceImage.kind !== 'cover'
        && data.coverGenerationAllowed !== false) {
        try {
          const cover = await posterCover.generatePosterCover(data.sourceImage, {
            sourceRecordId: data.sourceRecordId,
            catalogCatId: data.sourceArchiveId,
            sceneSeed: data.sourceImage.sceneSeed,
            deviceId: storage.getDeviceId(),
          });
          if (this._cancelled) return;
          renderData = posterData.applyPosterCover(data, cover);
          storage.updateRecordCover(data.sourceRecordId, cover);
        } catch (error) {
          if (this._cancelled) return;
          // 封面是增强项，生成失败时保留原图/主体图继续完成海报。
          renderData = {
            ...data,
            coverStatus: 'rejected',
            coverRejectReason: error && error.code ? String(error.code) : 'COVER_GENERATION_FAILED',
          };
          storage.updateRecordCover(data.sourceRecordId, {
            status: 'rejected',
            rejectReason: renderData.coverRejectReason,
          });
          console.warn('[PosterLoading] 猫咪封面生成失败，回退海报原图:', {
            code: error && (error.code || error.errCode) ? String(error.code || error.errCode) : '',
            message: error && error.message ? String(error.message) : '',
            providerMessage: error && error.providerMessage ? String(error.providerMessage) : '',
            errMsg: error && error.errMsg ? String(error.errMsg) : '',
          });
        }
      } else if (!data.isShared && data.sourceImage.kind !== 'cover') {
        console.info('[PosterLoading] 已有猫生图封面引用但当前地址不可用，跳过再次生成:', {
          sourceRecordId: data.sourceRecordId,
        });
      }
      this.posterData = renderData;
      if (this._cancelled) return;

      this._setStage('rendering-canvas');
      const renderResult = await posterCanvas.renderPoster(renderData);
      if (this._cancelled) return;

      this._setStage('validating');
      const result = {
        ...renderData,
        posterPath: renderResult.tempFilePath,
        width: renderResult.width,
        height: renderResult.height,
        ratio: renderResult.ratio,
        generatedAt: Date.now(),
        shareReady: false,
        shareError: '',
      };

      // 先尝试把同一份快照写入公开分享链路；云端暂不可用时不阻断本地保存。
      try {
        const share = await posterShare.prepareShare(renderData);
        result.shareId = share.shareId;
        result.shareReady = Boolean(share.shareId);
      } catch (error) {
        result.shareError = '公开分享暂未准备好，可在预览页重试';
        console.warn('[PosterLoading] 公开分享快照准备失败:', error);
      }

      posterData.savePosterResult(this.posterJobId, result);
      await this._persistPosterResult(result);
      this._redirectToPreview();
    } catch (error) {
      if (this._cancelled) return;
      const code = error && error.code ? error.code : 'POSTER_GENERATE_FAILED';
      let title = '海报暂时生成不了';
      let copy = '请稍后重试，猫咪档案不会受到影响。';
      if (code === 'POSTER_SCORE_PENDING') {
        title = '评分还没有完成';
        copy = error.message || '完成评分后，才能生成正式海报。';
      } else if (code === 'POSTER_IMAGE_UNAVAILABLE') {
        title = '还没有可用的猫咪照片';
        copy = '请先完成一次有效的猫咪相遇记录。';
      } else if (code === 'POSTER_CANVAS_UNSUPPORTED') {
        title = '当前版本暂不支持海报绘制';
        copy = '请更新微信或稍后再试。';
      }
      this.setData({
        state: 'failed',
        errorTitle: title,
        errorCopy: copy,
        errorCode: code,
      });
      console.error('[PosterLoading] 海报生成失败:', error);
    } finally {
      this._busy = false;
    }
  },

  retry() {
    if (this.data.state !== 'failed') return;
    this._cancelled = false;
    this._generate();
  },

  goBack() {
    this._cancelled = true;
    wx.navigateBack({
      delta: 1,
      fail: () => {
        const url = this.options && this.options.shareId
          ? `/pages/card-detail/card-detail?shareId=${encodeURIComponent(this.options.shareId)}`
          : `/pages/card-detail/card-detail?catId=${encodeURIComponent((this.options && this.options.catId) || '')}`;
        wx.redirectTo({ url });
      },
    });
  },
});
