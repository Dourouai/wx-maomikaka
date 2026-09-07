const posterData = require('../../utils/posterData');
const posterShare = require('../../utils/posterShare');
const userData = require('../../utils/userData');

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
    loaded: false,
    posterPath: '',
    name: '',
    levelCode: '',
    ratio: '9:16',
    shareReady: false,
    shareBusy: false,
    shareError: '',
    saveBusy: false,
    saveMessage: '',
  },

  onLoad(options = {}) {
    this.jobId = decodeOption(options.jobId);
    const result = posterData.getPosterResult(this.jobId);
    if (!result || !result.posterPath) {
      this.setData({
        loaded: true,
        shareError: '海报结果已过期，请返回档案重新生成。',
      });
      return;
    }

    this.poster = result;
    this.setData({
      loaded: true,
      posterPath: result.posterPath,
      name: result.name || '一只猫',
      levelCode: result.levelCode || 'C',
      ratio: result.ratio || '9:16',
      shareReady: result.shareReady === true,
      shareError: result.shareError || '',
    });
    if (!result.shareReady) this.prepareShare();
  },

  async prepareShare() {
    if (!this.poster || this.data.shareBusy || this.data.shareReady) return;
    this.setData({ shareBusy: true, shareError: '' });
    try {
      const share = await posterShare.prepareShare(this.poster);
      this.poster.shareId = share.shareId;
      this.poster.shareReady = true;
      this.poster.shareError = '';
      posterData.savePosterResult(this.jobId, this.poster);
      const persisted = posterData.buildPosterPersistencePayload(this.poster);
      if (persisted) {
        userData.savePosterResult({ ...persisted, posterPath: this.poster.posterPath }).catch(error => {
          console.warn('[PosterPreview] 海报结果写入云端失败:', error);
        });
      }
      this.setData({ shareReady: true, shareBusy: false, shareError: '' });
    } catch (error) {
      this.setData({
        shareBusy: false,
        shareError: '公开分享暂未准备好，请稍后重试。',
      });
      console.warn('[PosterPreview] 公开分享准备失败:', error);
    }
  },

  async savePoster() {
    if (!this.poster || !this.data.posterPath || this.data.saveBusy) return;
    this.setData({ saveBusy: true, saveMessage: '' });
    try {
      await posterShare.saveToAlbum(this.data.posterPath);
      this.setData({ saveBusy: false, saveMessage: '海报已保存到相册' });
      wx.showToast({ title: '已保存到相册', icon: 'success', duration: 1400 });
    } catch (error) {
      const privacyNotDeclared = error && error.code === 'POSTER_PRIVACY_NOT_DECLARED';
      const saveDenied = error && error.code === 'POSTER_SAVE_DENIED';
      const message = privacyNotDeclared
        ? '请管理员先在微信后台声明相册权限'
        : (saveDenied ? '请前往微信设置开启保存到相册权限后再试' : '保存失败，请稍后重试');
      this.setData({ saveBusy: false, saveMessage: message });
      if (saveDenied) {
        wx.showModal({
          title: '需要相册权限',
          content: '保存海报需要写入相册权限，请前往微信设置开启后再试。',
          confirmText: '去设置',
          cancelText: '暂不',
          success: result => {
            if (result && result.confirm && typeof wx.openSetting === 'function') {
              wx.openSetting({});
            }
          },
        });
      } else {
        wx.showToast({ title: privacyNotDeclared ? '请先配置隐私指引' : '保存失败', icon: 'none', duration: 1800 });
      }
      console.warn('[PosterPreview] 海报保存失败:', error);
    }
  },

  goBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => wx.switchTab({ url: '/pages/collection/collection' }),
    });
  },

  onShareAppMessage() {
    if (this.poster && !this.data.shareReady) this.prepareShare();
    return posterShare.buildShareConfig(
      this.poster || {},
      this.data.posterPath,
      this.poster && this.poster.shareId,
    );
  },

  onShareTimeline() {
    if (this.poster && !this.data.shareReady) this.prepareShare();
    const config = posterShare.buildShareConfig(
      this.poster || {},
      this.data.posterPath,
      this.poster && this.poster.shareId,
    );
    return {
      title: config.title,
      query: config.path.split('?')[1] || '',
      imageUrl: config.imageUrl,
    };
  },
});
