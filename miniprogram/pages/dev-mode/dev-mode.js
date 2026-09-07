// pages/dev-mode/dev-mode.js
// 开发模式只承载模型测试入口，不改变正式拍猫和猫卡收录流程。
Page({
  data: {
    showException: false,
    exceptionEyebrow: '开发模式',
    exceptionTitle: '',
    exceptionMessage: '',
    exceptionPrimaryText: '知道了',
  },

  goTextImage() {
    wx.navigateTo({
      url: '/pages/text-image/text-image',
      fail: () => this._showException('文字生图没打开', '测试页面暂时没有准备好，请稍后再试'),
    });
  },

  goImageImage() {
    wx.navigateTo({
      url: '/pages/image-image/image-image',
      fail: () => this._showException('猫咪图生图没打开', '猫咪主体测试页面暂时没有准备好，请稍后再试'),
    });
  },

  _showException(title, message) {
    this.setData({
      showException: true,
      exceptionTitle: title,
      exceptionMessage: message,
    });
  },

  closeException() {
    this.setData({ showException: false });
  },
});
