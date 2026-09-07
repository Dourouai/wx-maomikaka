const posterData = require('../../utils/posterData');
const posterCanvas = require('../../utils/posterCanvas');
const posterShare = require('../../utils/posterShare');
const posterCover = require('../../utils/posterCover');
const storage = require('../../utils/storage');
const userData = require('../../utils/userData');

const STAGES = {
  snapshotting: {
    title: '正在整理猫咪档案',
    copy: '保留这次相遇的名字和分数',
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
    this.options = {
      catId: decodeOption(options.catId),
      recordId: decodeOption(options.recordId || options.sourceRecordId),
      shareId: decodeOption(options.shareId),
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
    return userData.savePosterResult({ ...payload, posterPath: result.posterPath }).then(response => {
      if (response && response.posterResult) {
        result.posterImage = response.posterResult.posterImage;
        posterData.savePosterResult(this.posterJobId, result);
      }
      if (!response || response.saved !== true) {
        console.info('[PosterLoading] 海报结果暂未写入云端:', response && response.reason);
      }
    }).catch(error => {
      // 本地缓存已可用于当前预览；云端写入失败时，后续再次打开海报会重试。
      console.warn('[PosterLoading] 海报结果写入云端失败:', {
        code: error && (error.code || error.errCode) ? String(error.code || error.errCode) : '',
        message: error && (error.message || error.errMsg) ? String(error.message || error.errMsg) : '',
      });
    });
  },

  async _generate() {
    if (this._busy) return;
    this._busy = true;
    this._setStage('snapshotting');

    try {
      // 云端成品优先；读取失败只提示重试，不能触发隐式重新生成。
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
        posterData.savePosterResult(this.posterJobId, saved);
        this._redirectToPreview();
        return;
      }
      const cachedResult = await this._getCachedPosterResult();
      if (this._cancelled) return;
      if (cachedResult) {
        // 同一条记录已经有固定海报时，直接复用，不重新构建或调用 AI。
        this.posterData = cachedResult;
        posterData.savePosterResult(this.posterJobId, cachedResult);
        this._persistPosterResult(cachedResult);
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
      if (!data.isShared && data.sourceImage.kind !== 'cover') {
        try {
          const cover = await posterCover.generatePosterCover(data.sourceImage);
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
