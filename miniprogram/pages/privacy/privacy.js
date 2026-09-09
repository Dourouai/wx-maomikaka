// pages/privacy/privacy.js
const deviceLayout = require('../../utils/deviceLayout');
const privacyPolicy = require('../../utils/privacy');

Page({
  data: {
    pageHeaderTop: 48,
    headerRightInset: 0,
    privacyPolicyVersion: privacyPolicy.PRIVACY_POLICY_VERSION,
    privacyPolicyUpdatedAt: privacyPolicy.PRIVACY_POLICY_UPDATED_AT,
  },

  onLoad() {
    this._syncDeviceLayout();
  },

  onShow() {
    this._syncDeviceLayout();
  },

  onResize() {
    this._syncDeviceLayout();
  },

  _syncDeviceLayout() {
    const layout = deviceLayout.getDeviceLayout();
    this.setData({
      pageHeaderTop: layout.pageHeaderTop,
      headerRightInset: layout.headerRightInset,
    });
  },

  goBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => wx.switchTab({ url: '/pages/my/my' }),
    });
  },
});
