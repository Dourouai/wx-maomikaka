// 图片处理页：支持从相册选择照片生成透明主体，不识别、不评分、不写入猫卡。
const storage = require('../../utils/storage');
const catTransform = require('../../utils/catTransform');
const photoPicker = require('../../utils/photoPicker');

Page({
  data: {
    sourcePath: '',
    sourceLabel: '还没有测试图片',
    sourceLoading: false,
    resultPath: '',
    resultFileID: '',
    isTransforming: false,
    resultStatus: '等待一张猫咪照片',
    modelLabel: 'CloudBase 主体处理',
    showException: false,
    exceptionEyebrow: '猫咪图生图',
    exceptionTitle: '',
    exceptionMessage: '',
    exceptionDetail: '',
    exceptionPrimaryText: '知道了',
  },

  onLoad() {
    this._loadLatestSource();
  },

  async _loadLatestSource() {
    const latest = storage.getAllRecords()[0];
    if (!latest) {
      this.setData({ resultStatus: '先选择一张猫咪照片' });
      return;
    }

    const localPath = storage.getRecordOriginalPath(latest);
    if (!latest.originalFileID) {
      if (localPath) {
        this.setData({
          sourcePath: localPath,
          sourceLabel: '最近一次猫猫',
          resultStatus: '可以开始主体处理',
        });
        return;
      }
      this.setData({ resultStatus: '先选择一张猫咪照片' });
      return;
    }

    this.setData({
      sourceLoading: true,
      sourceLabel: '正在找回最近一次猫猫',
      resultStatus: '正在找回最近一次猫猫',
    });

    try {
      const response = await this._downloadFile(latest.originalFileID);
      const sourcePath = response && response.tempFilePath;
      if (!sourcePath) throw new Error('最近一次猫猫图片为空');
      this.setData({
        sourcePath,
        sourceLabel: '最近一次猫猫',
        resultStatus: '可以开始主体处理',
      });
    } catch (error) {
      console.warn('[ImageImage] 最近一次猫猫找回失败:', error);
      // 云端原图临时地址失效时，仍允许用户重新从相册选择，不把历史记录当作失败。
      this.setData({
        sourcePath: localPath,
        sourceLabel: localPath ? '最近一次猫猫' : '还没有测试图片',
        resultStatus: localPath ? '可以开始主体处理' : '请重新选择猫咪照片',
      });
    } finally {
      this.setData({ sourceLoading: false });
    }
  },

  _downloadFile(fileID) {
    if (!wx.cloud || typeof wx.cloud.downloadFile !== 'function') {
      return Promise.reject(this._createError('MATTING_NOT_CONFIGURED', '图片服务还没有准备好'));
    }
    return new Promise((resolve, reject) => {
      wx.cloud.downloadFile({ fileID, success: resolve, fail: reject });
    });
  },

  chooseImage() {
    if (this.data.sourceLoading || this.data.isTransforming) return;

    this._chooseMedia()
      .then(filePath => {
        this.setData({
          sourcePath: filePath,
          sourceLabel: '刚选的猫猫',
          resultPath: '',
          resultFileID: '',
          resultStatus: '可以开始主体处理',
        });
      })
      .catch(error => {
        if (error && error.code === 'USER_CANCELLED') return;
        console.error('[ImageImage] 选择猫咪图片失败:', error);
        const privacyError = `${error && error.message ? error.message : ''} ${error && error.errMsg ? error.errMsg : ''}`;
        if (error && error.code === 'PHOTO_PRIVACY_DENIED') {
          this._showException('先同意照片使用说明', '选择图片前，需要先同意照片使用说明');
          return;
        }
        if (error && error.code === 'PHOTO_PRIVACY_UNAVAILABLE') {
          this._showException('暂时无法确认照片权限', '照片隐私状态暂时无法确认，请稍后重试');
          return;
        }
        if (/api scope is not declared|privacy agreement|errno.?112/i.test(privacyError)) {
          this._showException('照片选择还差一条说明', '请先在小程序后台声明“选中的照片或视频”，再使用照片选择');
          return;
        }
        this._showException('图片没有选好', '请从相册或相机重新选择一张清楚的猫咪照片');
      });
  },

  _chooseMedia() {
    return photoPicker.chooseMedia({ sourceType: ['album', 'camera'] });
  },

  async transformImage() {
    if (this.data.isTransforming) return;
    if (!this.data.sourcePath) {
      this._showException('还没有猫猫照片', '先选一张猫咪照片，再开始主体处理');
      return;
    }

    this.setData({
      isTransforming: true,
      resultPath: '',
      resultFileID: '',
      resultStatus: '正在提取猫咪主体',
    });

    try {
      const result = await catTransform.cutoutCat(this.data.sourcePath);
      let resultPath = result.cutoutPhotoPath || '';
      if (!resultPath && result.cutoutFileID) {
        resultPath = await catTransform.getTempFileURL(result.cutoutFileID);
      }
      if (!resultPath) throw this._createError('CUTOUT_IMAGE_UNAVAILABLE', '没有拿到主体 PNG');

      this.setData({
        resultPath,
        resultFileID: result.cutoutFileID || '',
        modelLabel: result.cutoutProvider === 'hunyuan-image' ? 'CloudBase 混元图像模型' : 'CloudBase 主体处理',
        resultStatus: '主体 PNG 已生成',
      });
    } catch (error) {
      console.error('[ImageImage] 猫咪图生图失败:', error);
      this.setData({ resultStatus: '主体处理失败' });
      const friendly = this._getFriendlyError(error);
      this._showException(friendly.title, friendly.message, friendly.detail);
    } finally {
      this.setData({ isTransforming: false });
    }
  },

  clearResult() {
    if (this.data.isTransforming) return;
    this.setData({ resultPath: '', resultFileID: '', resultStatus: '可以重新开始主体处理' });
  },

  _getFriendlyError(error) {
    const code = error && error.code;
    if (code === 'MATTING_NOT_CONFIGURED' || code === 'CLOUDBASE_IMAGE_NOT_CONFIGURED') {
      return { title: '主体服务还差一步', message: '图像处理服务暂时没有准备好，请先检查云函数配置' };
    }
    if (code === 'CLOUDBASE_IMAGE_TIMEOUT') {
      return { title: '主体图还在路上', message: '模型等待超时了，请稍后再试一次' };
    }
    if (code === 'SOURCE_IMAGE_UNAVAILABLE' || code === 'SOURCE_UPLOAD_FAILED') {
      return { title: '原图没有送到', message: '这张照片暂时不可用，请重新选择一张清楚的猫咪照片' };
    }
    if (code === 'CUTOUT_IMAGE_INVALID' || code === 'CUTOUT_IMAGE_UNAVAILABLE' || code === 'MATTING_OUTPUT_INVALID') {
      return { title: '主体图没有回来', message: '这次没有拿到有效的猫咪主体，请换一张清楚的照片' };
    }
    if (code === 'CLOUDBASE_IMAGE_API_ERROR' || code === 'NATIVE_IMAGE_API_ERROR') {
        return { title: '主体服务暂时不可用', message: '模型接口没有接通，请稍后再试', detail: '本次只处理图片，不会影响正式猫卡。' };
    }
    return { title: '猫咪主体没抠好', message: '只保留猫咪的处理暂时没完成，请换一张照片再试' };
  },

  _createError(code, message) {
    const error = new Error(message || code);
    error.code = code;
    return error;
  },

  _showException(title, message, detail = '') {
    this.setData({
      showException: true,
      exceptionTitle: title,
      exceptionMessage: message,
      exceptionDetail: detail,
    });
  },

  closeException() {
    this.setData({ showException: false });
  },
});
