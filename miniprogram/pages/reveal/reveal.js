// pages/reveal/reveal.js
// 拍摄后的轻量收录结果页：先做内容安全校验，再识别猫咪、抠出主体并计算相遇评分。
const identify = require('../../utils/identify');
const storage = require('../../utils/storage');
const contentSafety = require('../../utils/contentSafety');
const catTransform = require('../../utils/catTransform');
const catScoring = require('../../utils/catScoring');

Page({
  data: {
    showLoading: true,
    showCard: false,
    showException: false,
    exceptionEyebrow: '小小插曲',
    exceptionTitle: '',
    exceptionMessage: '',
    exceptionDetail: '',
    exceptionPrimaryText: '回去重拍',
    exceptionSecondaryText: '',
    exceptionShowSecondary: false,
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
    const photo = options.photo ? decodeURIComponent(options.photo) : '';
    this.setData({ photo, originalPhoto: photo });
    this._processPhoto(photo);
  },

  async _processPhoto(photo) {
    let safePhoto;

    try {
      // 图片必须先通过内容安全检测，之后才允许进入识别、保存和分享链路。
      const safetyResult = await contentSafety.checkImage(photo);
      safePhoto = safetyResult.photoPath || photo;
      this.setData({
        photo: safePhoto,
        originalPhoto: safePhoto,
        imageChecked: true,
        loadingTitle: '正在识别猫咪',
        loadingSubtitle: '先确认猫猫，再给这次相遇打分',
      });
    } catch (err) {
      console.error('[Reveal] 内容安全检测失败:', err);
      this._showSafetyError(err);
      return;
    }

    let result;
    try {
      result = await identify.identifyCat(safePhoto);
    } catch (err) {
      console.error('[Reveal] 猫咪识别失败:', err);
      this._showIdentifyError(err);
      return;
    }

    const catData = result.catData || result;
    const breedLabel = result.breedLabel || catData.breed || '未知品种';
    // 传入完整识别结果，保留 scoreEvidence / scoreCoverage，避免部分证据被误当成正式评分。
    const encounterScore = catScoring.scoreEncounter(result);

    try {
      this.setData({
        breedLabel,
        detectedTraits: result.detectedTraits || [],
        loadingTitle: '正在提取猫咪轮廓',
        loadingSubtitle: '只保留这只猫，不改颜色和姿势',
      });

      let cutout;
      try {
        cutout = await catTransform.cutoutCat(safePhoto);
      } catch (error) {
        console.error('[Reveal] 猫咪主体抠图失败:', error);
        this._showMattingError(error);
        return;
      }

      const cutoutPhoto = cutout.cutoutPhotoPath || '';
      if (!cutoutPhoto || !cutout.cutoutFileID) {
        throw new Error('猫咪主体抠图结果为空');
      }
      const saved = storage.saveRecord({
        ...result,
        catId: result.catId || catData.id,
        photoPath: safePhoto,
        originalFileID: cutout.originalFileID || '',
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
        isNew: saved.isNew,
        recordId: saved.recordId,
        capturedAtText: this._formatDate(Date.now()),
      });
    } catch (err) {
      console.error('[Reveal] 抠图或保存失败:', err);
      this._openException({
        eyebrow: '收录卡片',
        title: '这次没收好',
        message: '猫咪主体没有保存成功，请再试一次',
      });
    }
  },

  _showMattingError(error) {
    const code = error && error.code;
    let title = '猫咪轮廓没收好';
    let content = '只保留猫咪的处理暂时没完成，请稍后再试';

    if (code === 'MATTING_NOT_CONFIGURED') {
      title = '猫咪主体还差一步';
      content = '图像处理服务暂时没有准备好，请稍后再试';
    } else if (code === 'RISKY_CONTENT') {
      title = '无法保存这张图';
      content = '你发布的内容含违规信息';
    } else if (code === 'MATTING_OUTPUT_INVALID') {
      title = '轮廓没有抠干净';
      content = '这次没有拿到有效的猫咪主体，请换一张清楚的照片';
    } else if (code === 'CUTOUT_IMAGE_UNAVAILABLE') {
      title = '主体图没有回来';
      content = '图像模型没有返回可用的主体图片，请确认模型已启用后再试';
    } else if (code === 'CUTOUT_IMAGE_TIMEOUT') {
      title = '主体图走丢了';
      content = '图像处理等待超时，请稍后再试一张';
    } else if (code === 'CUTOUT_IMAGE_FORMAT_UNSUPPORTED') {
      title = '主体图格式不对';
      content = '图像模型返回的图片暂时无法使用，请稍后再试';
    } else if (code === 'CLOUDBASE_IMAGE_NOT_CONFIGURED') {
      title = '主体服务还差一步';
      content = 'CloudBase 图生图服务暂时没有准备好，请稍后再试';
    } else if (code === 'CLOUDBASE_IMAGE_API_ERROR') {
      title = '主体服务没接通';
      content = 'CloudBase 图生图暂时不可用，请检查模型配置后再试';
    } else if (code === 'CLOUDBASE_IMAGE_TIMEOUT') {
      title = '主体图走丢了';
      content = 'CloudBase 图生图等待超时，请稍后再试一张';
    }

    this._openException({
      eyebrow: '猫咪轮廓',
      title,
      message: content,
      detail: code ? `处理码：${code}` : '',
    });
  },

  _openException({ eyebrow, title, message, detail = '', primaryText = '回去重拍' }) {
    this.setData({
      showLoading: false,
      showCard: false,
      showException: true,
      exceptionEyebrow: eyebrow,
      exceptionTitle: title,
      exceptionMessage: message,
      exceptionDetail: detail,
      exceptionPrimaryText: primaryText,
    });
  },

  _showIdentifyError(error) {
    const code = error && error.code;
    let title = '咔咔没拍到猫';
    let content = '没有找到清楚的猫咪，再对准猫猫拍一张吧';

    if (code === 'MULTIPLE_CATS') {
      title = '猫猫有点多';
      content = '先让一只猫当主角，咔咔才能给它贴标签';
    } else if (code === 'CAT_UNCERTAIN') {
      title = '猫猫有点害羞';
      content = '靠近一点、光线亮一点，再拍一张试试';
    } else if (code === 'VISION_NOT_CONFIGURED') {
      title = '识别服务还差一步';
      content = '请先配置猫咪识别服务，再回来拍一张吧';
    } else if (code === 'VISION_AUTH_FAILED') {
      title = '识别服务需要检查';
      content = '猫咪识别服务授权暂时不可用，请稍后再试';
    } else if (code === 'VISION_UNAVAILABLE') {
      title = '猫咪识别休息中';
      content = '识别服务暂时不可用，请稍后再试';
    }

    this._openException({
      eyebrow: '猫咪观察',
      title,
      message: content,
    });
  },

  _showSafetyError(error) {
    const code = error && error.code;
    let title = '暂时无法发布';
    let content = '图片安全检测暂时不可用，请稍后重试';

    if (code === 'RISKY_CONTENT') {
      title = '无法发布图片';
      content = '你发布的内容含违规信息';
    } else if (code === 'IMAGE_TOO_LARGE') {
      title = '图片太大';
      content = '图片太大，请重新拍摄';
    } else if (code === 'INVALID_IMAGE') {
      title = '图片不可用';
      content = '请重新拍摄后再试';
    }

    this._openException({
      eyebrow: '发布检查',
      title,
      message: content,
    });
  },

  onExceptionPrimary() {
    this.setData({ showException: false });
    wx.navigateBack({ delta: 1 });
  },

  onExceptionSecondary() {
    this.setData({ showException: false });
  },

  _formatDate(timestamp) {
    const date = new Date(timestamp);
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
  },

  goCamera() {
    wx.navigateBack({ delta: 1 });
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
