// pages/reveal/reveal.js
// 拍摄后的轻量收录结果页：先做内容安全校验，再并行识别猫咪和整理主体。
const identify = require('../../utils/identify');
const storage = require('../../utils/storage');
const contentSafety = require('../../utils/contentSafety');
const catTransform = require('../../utils/catTransform');
const catScoring = require('../../utils/catScoring');
const deviceLayout = require('../../utils/deviceLayout');

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
    archiveCode: '0000',
    resultQuote: '',
    isNew: false,
    recordId: null,
    photo: '',
    originalPhoto: '',
    cutoutPhoto: '',
    breedLabel: '',
    detectedTraits: [],
    imageChecked: false,
    capturedAtText: '',
    loadingTitle: '正在收录这次相遇',
    loadingSubtitle: '先把这次相遇收好',
    fallbackIcon: '/assets/cat-placeholder.svg',
  },

  onLoad(options) {
    this._syncDeviceLayout();
    const photo = options.photo ? decodeURIComponent(options.photo) : '';
    this.setData({ photo, originalPhoto: photo });
    this._processPhoto(photo);
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
        loadingTitle: '正在识别猫咪',
        loadingSubtitle: '识别猫猫与整理主体同时进行',
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
    const encounterScore = catScoring.scoreEncounter(result);

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
      saved = storage.saveRecord({
        ...result,
        catId: result.catId || catData.id,
        photoPath: safePhoto,
        originalFileID: sourceFileID || cutout.originalFileID || '',
        cutoutFileID: cutout.cutoutFileID,
        cutoutPhotoPath: cutoutPhoto,
        cutoutContentType: cutout.cutoutContentType || 'image/png',
        cutoutProvider: cutout.cutoutProvider || 'hunyuan-image',
        cutoutOperation: cutout.cutoutOperation || 'image-to-image-subject-only',
        cutoutRequestId: cutout.cutoutRequestId || '',
        cutoutCheckerboardRemoved: cutout.checkerboardRemoved === true,
        ...encounterScore,
      });

      this.setData({
        showLoading: false,
        showCard: true,
        showErrorPage: false,
        catData,
        breedLabel,
        detectedTraits: result.detectedTraits || [],
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
        archiveCode: this._formatArchiveCode(result.catId || catData.id),
        // 结果页只使用产品固定短句，不把视觉模型返回的描述渲染成页面文案。
        resultQuote: '在街角，它刚好回头看了你一眼。',
        isNew: saved.isNew,
        recordId: saved.recordId,
        capturedAtText: this._formatDate(Date.now()),
      });
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
      title = '识别服务还差一步';
      titleEm = '';
      content = '猫咪识别服务还没有准备好';
      contentDetail = '完成配置后，再回来遇见猫猫。';
    } else if (code === 'VISION_AUTH_FAILED') {
      title = '识别服务需要检查';
      titleEm = '';
      content = '猫咪识别服务授权暂时不可用';
      contentDetail = '检查配置后，再试一次吧。';
    } else if (code === 'VISION_UNAVAILABLE') {
      title = '猫咪识别休息中';
      titleEm = '';
      content = '识别服务暂时不可用';
      contentDetail = '等服务缓一缓，再试一次吧。';
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

  _formatArchiveCode(catId) {
    const matched = String(catId || '').match(/\d+/);
    return matched ? String(Number(matched[0])).padStart(4, '0') : '0000';
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
