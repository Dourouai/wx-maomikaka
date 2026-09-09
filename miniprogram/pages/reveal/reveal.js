// pages/reveal/reveal.js
// 拍摄后的轻量收录结果页：先做内容安全校验，再并行识别猫咪和整理主体。
const identify = require('../../utils/identify');
const storage = require('../../utils/storage');
const contentSafety = require('../../utils/contentSafety');
const catTransform = require('../../utils/catTransform');
const catScoring = require('../../utils/catScoring');
const catVision = require('../../utils/catVision');
const userData = require('../../utils/userData');
const deviceLayout = require('../../utils/deviceLayout');
const catKnowledge = require('../../utils/catKnowledge');
const archiveIds = require('../../utils/archiveCode');

const KNOWLEDGE_ROTATION_MS = 3000;

Page({
  data: {
    showLoading: true,
    showCard: false,
    showException: false,
    showErrorPage: false,
    exceptionEyebrow: '小小插曲',
    exceptionTitle: '',
    exceptionMessage: '',
    exceptionDetail: '',
    exceptionPrimaryText: '重新拍照',
    exceptionSecondaryText: '回到相遇',
    exceptionShowSecondary: true,
    errorTitle: '这次没拍清楚',
    errorTitleEm: '猫猫',
    errorLeadLineOne: '猫猫没有完整进入画面',
    errorLeadLineTwo: '换个角度，再试一次吧。',
    errorNote: '本次不扣罐罐 · 可以重新拍照',
    pageHeaderTop: 48,
    headerRightInset: 0,
    loadingTop: 96,
    catData: {
      id: '',
      name: '',
      breed: '',
      trait: [],
      story: '',
      color: '#ef745e',
    },
    levelCode: 'C',
    levelLabel: '街角',
    levelShortLabel: '街角常客',
    overallScore: 0,
    scoreItems: [],
    charmScore: 0,
    clevernessScore: 0,
    auraScore: 0,
    pawReward: 0,
    pointReward: 0,
    scorePending: true,
    scoreNote: '',
    archiveCode: '',
    resultQuote: '',
    isNew: false,
    recordId: null,
    photo: '',
    originalPhoto: '',
    cutoutPhoto: '',
    breedLabel: '',
    detectedTraits: [],
    posterCopy: '',
    imageChecked: false,
    capturedAtText: '',
    loadingTitle: 'AI 正在识别中',
    loadingSubtitle: '正在为这次相遇整理档案',
    loadingKnowledge: catKnowledge.getFallbackKnowledge(),
    loadingKnowledgeSource: 'FIELD NOTE',
    fallbackIcon: '/assets/cat-placeholder.svg',
  },

  onLoad(options) {
    this._syncDeviceLayout();
    // 仅用于开发验收：预览异常结果页时不调用模型、不扣罐罐、不写入记录。
    if (String(options && (options.preview || options.state) || '').toLowerCase() === 'error') {
      this._openErrorPage({
        title: '这次没拍清楚',
        titleEm: '猫猫',
        message: '猫猫没有完整进入画面',
        messageDetail: '换个角度，再试一次吧。',
      });
      return;
    }
    const captureId = options && options.captureId ? decodeURIComponent(options.captureId) : '';
    this._captureId = captureId;
    this._captureContext = captureId ? storage.getPendingCapture(captureId) : null;
    const photo = options && options.photo
      ? decodeURIComponent(options.photo)
      : (this._captureContext && this._captureContext.photoPath) || '';
    this.setData({ photo, originalPhoto: photo });
    // 两条线在进入处理页时立即并行启动：科普短句不读取 photo，也不等待 GLM 识别或主体图处理。
    // 先显示本地内容，Hy3 返回后再无感替换；知识线失败不会影响图片线。
    this._startKnowledgeRotation();
    this._loadCatKnowledge();
    this._processPhoto(photo);
  },

  onUnload() {
    this._stopKnowledgeRotation();
  },

  async _loadCatKnowledge() {
    try {
      const result = await catKnowledge.getCatKnowledge();
      if (!result || !result.text || !this.data.showLoading) return;
      const knowledgeItem = {
        text: String(result.text).trim(),
        source: result.source === 'hy3' ? 'HY3' : 'FIELD NOTE',
      };
      const items = this._knowledgeItems || [];
      const existingIndex = items.findIndex(item => item.text === knowledgeItem.text);
      if (existingIndex >= 0) {
        items[existingIndex] = knowledgeItem;
        this._knowledgeIndex = existingIndex;
      } else {
        items.push(knowledgeItem);
        this._knowledgeIndex = items.length - 1;
      }
      this.setData({
        loadingKnowledge: knowledgeItem.text,
        loadingKnowledgeSource: knowledgeItem.source,
      });
    } catch (error) {
      console.warn('[Reveal] 猫咪科普短句加载失败:', error);
    }
  },

  _startKnowledgeRotation() {
    this._stopKnowledgeRotation();
    this._knowledgeItems = catKnowledge.getFallbackKnowledgeList().map(text => ({
      text,
      source: 'FIELD NOTE',
    }));
    const currentIndex = this._knowledgeItems.findIndex(item => item.text === this.data.loadingKnowledge);
    this._knowledgeIndex = currentIndex >= 0 ? currentIndex : 0;
    this._knowledgeTimer = setInterval(() => this._showNextKnowledge(), KNOWLEDGE_ROTATION_MS);
  },

  _stopKnowledgeRotation() {
    if (this._knowledgeTimer) clearInterval(this._knowledgeTimer);
    this._knowledgeTimer = null;
  },

  _showNextKnowledge() {
    if (!this.data.showLoading) {
      this._stopKnowledgeRotation();
      return;
    }
    const items = this._knowledgeItems || [];
    if (items.length < 2) return;
    this._knowledgeIndex = (this._knowledgeIndex + 1) % items.length;
    const item = items[this._knowledgeIndex];
    this.setData({
      loadingKnowledge: item.text,
      loadingKnowledgeSource: item.source,
    });
  },

  onResize() {
    this._syncDeviceLayout();
  },

  _syncDeviceLayout() {
    const layout = deviceLayout.getDeviceLayout();
    this.setData({
      pageHeaderTop: layout.pageHeaderTop,
      headerRightInset: layout.headerRightInset,
      loadingTop: layout.pageHeaderTop + 48,
    });
  },

  async _processPhoto(photo) {
    let safePhoto;
    let sourceFileID = '';
    let sourceContentType = 'image/jpeg';

    try {
      // 图片必须先通过内容安全检测，之后才允许进入识别、保存和分享链路。
      const safetyResult = await contentSafety.checkImage(photo);
      safePhoto = safetyResult.photoPath || photo;
      sourceFileID = safetyResult.fileID || '';
      sourceContentType = safetyResult.contentType || 'image/jpeg';
      this.setData({
        photo: safePhoto,
        originalPhoto: safePhoto,
        imageChecked: true,
        loadingTitle: 'AI 正在识别中',
        loadingSubtitle: '正在识别猫咪 · 整理透明主体',
      });
    } catch (err) {
      console.error('[Reveal] 内容安全检测失败:', err);
      this._showSafetyError(err);
      return;
    }

    const parallelStartedAt = Date.now();
    // 两条链路共享已经通过安全检测的 fileID，避免再次上传同一张图片。
    const visionPromise = identify.identifyCat(safePhoto, {
      fileID: sourceFileID,
      contentType: sourceContentType,
    });
    const transformPromise = catTransform.cutoutCat(safePhoto, {
      fileID: sourceFileID,
      contentType: sourceContentType,
    });
    // 等两条并行链路都结束后再一次性揭晓，避免用户看到半成品。
    const visionStatePromise = visionPromise.then(
      value => {
        console.log(`[Reveal] GLM 识别完成: ${Date.now() - parallelStartedAt}ms`);
        return { status: 'fulfilled', value };
      },
      error => ({ status: 'rejected', error }),
    );
    const transformStatePromise = transformPromise.then(
      value => {
        console.log(`[Reveal] HY 主体图完成: ${Date.now() - parallelStartedAt}ms`);
        return { status: 'fulfilled', value };
      },
      error => ({ status: 'rejected', error }),
    );
    const visionState = await visionStatePromise;

    if (visionState.status !== 'fulfilled') {
      console.error('[Reveal] 猫咪识别失败:', visionState.error);
      // 非猫/多猫等识别失败不必再等 HY，主体任务结束后在后台清理即可。
      transformStatePromise
        .then(state => this._cleanupRejectedProcessing(sourceFileID, state))
        .catch(error => console.warn('[Reveal] 后台清理失败:', error));
      this._showIdentifyError(visionState.error);
      return;
    }

    const transformState = await transformStatePromise;
    if (transformState.status !== 'fulfilled') {
      console.error('[Reveal] 猫咪主体抠图失败:', transformState.error);
      this._cleanupRejectedProcessing(sourceFileID, transformState);
      this._showMattingError(transformState.error);
      return;
    }

    const result = visionState.value;
    const cutout = transformState.value;
    if (!cutout || !cutout.cutoutFileID) {
      const error = new Error('猫咪主体抠图结果为空');
      error.code = 'MATTING_OUTPUT_INVALID';
      console.error('[Reveal] 猫咪主体抠图结果为空');
      this._cleanupRejectedProcessing(sourceFileID, transformState);
      this._showMattingError(error);
      return;
    }

    const catData = result.catData || result;
    const breedLabel = result.breedLabel || catData.breed || '未知品种';
    // 传入完整识别结果，保留 scoreEvidence / scoreCoverage，避免部分证据被误当成正式评分。
    let encounterScore = catScoring.scoreEncounter(result);
    if (encounterScore.scorePending && sourceFileID) {
      // GLM 首轮偶尔只返回识别结果或不完整证据；用同一张安全检测后的原图
      // 独立补评分，避免相册上传记录落成 U·偶见 / -- 占位状态。
      try {
        console.warn('[Reveal] 识别结果待评分，启动独立补评分');
        const repairedResult = await catVision.scoreCat('', {
          fileID: sourceFileID,
          contentType: sourceContentType,
        });
        const repairedScore = catScoring.scoreEncounter(repairedResult);
        if (!repairedScore.scorePending) {
          encounterScore = repairedScore;
          console.log('[Reveal] 独立补评分完成');
        } else {
          console.warn('[Reveal] 独立补评分仍不完整');
        }
      } catch (error) {
        // 补评分失败不阻断识别结果展示，详情页仍可按原图再次补评分。
        console.warn('[Reveal] 独立补评分失败，保留待评分状态:', error);
      }
    }

    let cutoutPhoto = cutout.cutoutPhotoPath || '';
    if (!cutoutPhoto) {
      try {
        cutoutPhoto = await catTransform.getTempFileURL(cutout.cutoutFileID);
      } catch (error) {
        console.warn('[Reveal] 主体图临时地址获取失败:', error);
      }
    }
    if (!cutoutPhoto) {
      const error = new Error('主体图片地址暂时不可用');
      error.code = 'CUTOUT_IMAGE_UNAVAILABLE';
      this._cleanupRejectedProcessing(sourceFileID, transformState);
      this._showMattingError(error);
      return;
    }

    let saved;
    try {
      // 两条链路都完成后再入档，保证用户看到的卡片就是最终主体图。
      const capturedAt = this._captureContext && this._captureContext.capturedAt;
      saved = storage.saveRecord({
        ...result,
        captureId: this._captureId || null,
        catId: result.catId || catData.id,
        photoPath: safePhoto,
        originalPhotoPath: safePhoto,
        originalFileID: sourceFileID || cutout.originalFileID || '',
        originalContentType: sourceContentType,
        cutoutFileID: cutout.cutoutFileID,
        cutoutPhotoPath: cutoutPhoto,
        cutoutContentType: cutout.cutoutContentType || 'image/png',
        cutoutProvider: cutout.cutoutProvider || 'hunyuan-image',
        cutoutOperation: cutout.cutoutOperation || 'image-to-image-subject-only',
        cutoutRequestId: cutout.cutoutRequestId || '',
        cutoutCheckerboardRemoved: cutout.checkerboardRemoved === true,
        sourceType: this._captureContext && this._captureContext.sourceType,
        location: this._captureContext && this._captureContext.location,
        locationStatus: this._captureContext && this._captureContext.locationStatus,
        createdAt: capturedAt || undefined,
        ...encounterScore,
      });
      if (this._captureId) storage.clearPendingCapture(this._captureId);

      this._stopKnowledgeRotation();
      this.setData({
        showLoading: false,
        showCard: true,
        showErrorPage: false,
        catData,
        breedLabel,
        detectedTraits: result.detectedTraits || [],
        posterCopy: result.posterCopy || '',
        photo: cutoutPhoto,
        originalPhoto: safePhoto,
        cutoutPhoto,
        levelCode: encounterScore.levelCode,
        levelLabel: encounterScore.levelLabel,
        levelShortLabel: encounterScore.levelShortLabel,
        overallScore: encounterScore.overallScore,
        scoreItems: encounterScore.scoreItems,
        charmScore: encounterScore.charmScore,
        clevernessScore: encounterScore.clevernessScore,
        auraScore: encounterScore.auraScore,
        pawReward: encounterScore.pawReward,
        pointReward: encounterScore.pointReward,
        scorePending: encounterScore.scorePending,
        scoreNote: encounterScore.scorePending ? '当前按基础相遇记录暂存' : '',
        archiveCode: saved.record.archiveCode || archiveIds.getOrCreateArchiveCode(
          `record:${result.catId || catData.id}:${saved.recordId}`,
          capturedAt || Date.now(),
        ),
        // 结果页只使用产品固定短句，不把视觉模型返回的描述渲染成页面文案。
        resultQuote: '在街角，它刚好回头看了你一眼。',
        isNew: saved.isNew,
        recordId: saved.recordId,
        capturedAtText: this._formatDate(capturedAt || Date.now()),
      });

      // 已绑定用户的拍摄记录后台同步；未绑定时只保存在本机，等待用户在“我的”里确认导入。
      if (userData.isUserBound()) {
        userData.syncLocalData({ source: 'capture' }).catch(error => {
          console.warn('[Reveal] 已绑定记录后台同步失败，保留本地待同步状态:', error);
        });
      } else {
        userData.stageLocalData({ source: 'capture' }).catch(error => {
          // 匿名临时入库失败不阻断结果页，本机记录仍保留，绑定账号时会再次补写。
          console.warn('[Reveal] 匿名记录临时入库失败，保留本地待同步状态:', error);
        });
      }
    } catch (err) {
      console.error('[Reveal] 抠图或保存失败:', err);
      this._cleanupRejectedProcessing(sourceFileID, transformState);
      this._openException({
        eyebrow: '收录卡片',
        title: '这次没收好',
        message: '猫咪主体没有保存成功，请再试一次',
      });
      return;
    }
  },

  async _cleanupRejectedProcessing(sourceFileID, transformState) {
    const cutout = transformState && transformState.status === 'fulfilled'
      ? transformState.value
      : null;
    const fileIDs = [
      sourceFileID,
      cutout && cutout.originalFileID,
      cutout && cutout.cutoutFileID,
    ].filter(Boolean);

    await Promise.all([...new Set(fileIDs)].map(fileID => (
      contentSafety.releaseImage(fileID).catch(error => {
        console.warn('[Reveal] 清理临时图片失败:', error);
      })
    )));
  },

  _showMattingError(error) {
    const code = error && error.code;
    let title = '猫咪轮廓没收好';
    let content = '只保留猫咪的处理暂时没完成，请稍后再试';
    let contentDetail = '换一张清楚的照片，再试一次吧。';

    if (code === 'MATTING_NOT_CONFIGURED') {
      title = '猫咪主体还差一步';
      content = '图像处理服务暂时没有准备好，请稍后再试';
      contentDetail = '完成配置后，再回来遇见猫猫。';
    } else if (code === 'RISKY_CONTENT') {
      title = '无法保存这张图';
      content = '你发布的内容含违规信息';
      contentDetail = '换一张照片，再试一次吧。';
    } else if (code === 'MATTING_OUTPUT_INVALID') {
      title = '轮廓没有抠干净';
      content = '这次没有拿到有效的猫咪主体，请换一张清楚的照片';
      contentDetail = '让猫猫完整进入画面，再试一次吧。';
    } else if (code === 'CUTOUT_IMAGE_UNAVAILABLE') {
      title = '主体图没有回来';
      content = '图像模型没有返回可用的主体图片，请确认模型已启用后再试';
      contentDetail = '确认服务正常后，再试一次吧。';
    } else if (code === 'CUTOUT_IMAGE_TIMEOUT') {
      title = '主体图走丢了';
      content = '图像处理等待超时，请稍后再试一张';
      contentDetail = '等服务缓一缓，再试一次吧。';
    } else if (code === 'CUTOUT_IMAGE_FORMAT_UNSUPPORTED') {
      title = '主体图格式不对';
      content = '图像模型返回的图片暂时无法使用，请稍后再试';
      contentDetail = '换一张照片，再试一次吧。';
    } else if (code === 'CLOUDBASE_IMAGE_NOT_CONFIGURED') {
      title = '主体服务还差一步';
      content = 'CloudBase 图生图服务暂时没有准备好，请稍后再试';
      contentDetail = '完成配置后，再回来遇见猫猫。';
    } else if (code === 'CLOUDBASE_IMAGE_API_ERROR') {
      title = '主体服务没接通';
      content = 'CloudBase 图生图暂时不可用，请检查模型配置后再试';
      contentDetail = '确认模型配置后，再试一次吧。';
    } else if (code === 'CLOUDBASE_IMAGE_TIMEOUT') {
      title = '主体图走丢了';
      content = 'CloudBase 图生图等待超时，请稍后再试一张';
      contentDetail = '等服务缓一缓，再试一次吧。';
    }

    this._openErrorPage({
      title,
      message: content,
      messageDetail: contentDetail,
    });
  },

  _openErrorPage({
    title,
    titleEm = '',
    message,
    messageDetail = '',
    note = '本次不扣罐罐 · 可以重新拍照',
  }) {
    this._stopKnowledgeRotation();
    this.setData({
      showLoading: false,
      showCard: false,
      showException: false,
      showErrorPage: true,
      errorTitle: title,
      errorTitleEm: titleEm,
      errorLeadLineOne: message,
      errorLeadLineTwo: messageDetail,
      errorNote: note,
    });
  },

  _openException({
    eyebrow,
    title,
    message,
    detail = '',
    primaryText = '重新拍照',
    secondaryText = '回到相遇',
    showSecondary = true,
  }) {
    this._stopKnowledgeRotation();
    this.setData({
      showLoading: false,
      showCard: false,
      showException: true,
      showErrorPage: false,
      exceptionEyebrow: eyebrow,
      exceptionTitle: title,
      exceptionMessage: message,
      exceptionDetail: detail,
      exceptionPrimaryText: primaryText,
      exceptionSecondaryText: secondaryText,
      exceptionShowSecondary: showSecondary,
    });
  },

  _showIdentifyError(error) {
    const code = error && error.code;
    let title = '这次没拍清楚';
    let titleEm = '猫猫';
    let content = '猫猫没有完整进入画面';
    let contentDetail = '换个角度，再试一次吧。';

    if (code === 'MULTIPLE_CATS') {
      title = '猫猫有点多';
      titleEm = '';
      content = '先让一只猫成为主角';
      contentDetail = '再试一次，咔咔才能给它贴标签。';
    } else if (code === 'CAT_UNCERTAIN') {
      title = '猫猫有点害羞';
      titleEm = '';
      content = '靠近一点、光线亮一点';
      contentDetail = '再拍一张清楚的猫猫试试。';
    } else if (code === 'VISION_NOT_CONFIGURED') {
      title = '识别接口未就绪';
      titleEm = '';
      content = '猫咪识别接口暂时没有正常配置';
      contentDetail = '请前往「我的」→「功能建议及问题反馈」联系我们，也可以稍后再试。';
    } else if (code === 'VISION_AUTH_FAILED') {
      title = '识别接口授权异常';
      titleEm = '';
      content = '猫咪识别接口暂时无法完成授权';
      contentDetail = '请前往「我的」→「功能建议及问题反馈」联系我们，也可以稍后再试。';
    } else if (code === 'VISION_INVALID_RESPONSE') {
      title = '识别接口异常';
      titleEm = '';
      content = '猫咪识别接口没有正常返回结果';
      contentDetail = '请前往「我的」→「功能建议及问题反馈」联系我们，也可以稍后再试。';
    } else if (code === 'VISION_UNAVAILABLE') {
      title = '识别接口暂时不可用';
      titleEm = '';
      content = '猫咪识别接口暂时没有响应';
      contentDetail = '请前往「我的」→「功能建议及问题反馈」联系我们，也可以稍后再试。';
    }

    this._openErrorPage({
      title,
      titleEm,
      message: content,
      messageDetail: contentDetail,
    });
  },

  _showSafetyError(error) {
    const code = error && error.code;
    let title = '暂时无法发布';
    let content = '图片安全检测暂时不可用，请稍后重试';
    let contentDetail = '等检查服务恢复，再试一次吧。';

    if (code === 'RISKY_CONTENT') {
      title = '无法发布图片';
      content = '你发布的内容含违规信息';
      contentDetail = '换一张照片，再试一次吧。';
    } else if (code === 'IMAGE_TOO_LARGE') {
      title = '图片太大';
      content = '图片太大，请重新拍摄';
      contentDetail = '换一张清楚的照片，再试一次吧。';
    } else if (code === 'INVALID_IMAGE') {
      title = '图片不可用';
      content = '请重新拍摄后再试';
      contentDetail = '让猫猫完整进入画面，再试一次吧。';
    }

    this._openErrorPage({
      title,
      message: content,
      messageDetail: contentDetail,
    });
  },

  onExceptionPrimary() {
    this.setData({ showException: false, showErrorPage: false });
    wx.navigateBack({
      delta: 1,
      fail: () => wx.switchTab({ url: '/pages/index/index' }),
    });
  },

  onExceptionSecondary() {
    this.setData({ showException: false, showErrorPage: false });
    wx.switchTab({ url: '/pages/index/index' });
  },

  _formatDate(timestamp) {
    const date = new Date(timestamp);
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
  },

  goCamera() {
    this.setData({ showErrorPage: false });
    wx.navigateBack({
      delta: 1,
      fail: () => wx.switchTab({ url: '/pages/index/index' }),
    });
  },

  goHome() {
    this.setData({ showErrorPage: false });
    wx.switchTab({ url: '/pages/index/index' });
  },

  goCollection() {
    wx.switchTab({ url: '/pages/collection/collection' });
  },

  onShareAppMessage() {
    const { catData, levelLabel, photo, imageChecked } = this.data;
    if (!imageChecked) {
      return {
        title: '猫咪咔咔',
        path: '/pages/index/index',
      };
    }
    return {
      title: `我遇见了${levelLabel}的「${catData.name}」`,
      path: '/pages/camera/camera',
      imageUrl: photo || '',
    };
  },
});
