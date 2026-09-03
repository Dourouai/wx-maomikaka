// 拍照页 camera.js
Page({
  data: {
    isTakingPhoto: false,
    cameraError: false,
    cameraIssueKind: 'permission',
    cameraIssueEyebrow: '相机权限',
    cameraIssueTitle: '需要使用相机',
    cameraIssueSubtitle: '请在权限设置中允许相机访问',
    cameraIssueAction: '打开设置',
  },

  onReady() {
    // camera 组件已挂载后再创建上下文；真正拍摄时由微信处理相机权限。
    this.cameraContext = wx.createCameraContext();
  },

  _showPrivacyConfigIssue(detail) {
    console.warn('[Camera] 隐私指引未声明相机能力:', detail);
    this.setData({
      cameraError: true,
      cameraIssueKind: 'privacy',
      cameraIssueEyebrow: '相机隐私设置',
      cameraIssueTitle: '相机暂时无法打开',
      cameraIssueSubtitle: '请在小程序后台补充相机隐私指引，完成后重新进入拍摄页。',
      cameraIssueAction: '重新检查',
    });
  },

  // 拍摄页面内的当前画面，不再跳转到微信原生相机页。
  takePhoto() {
    if (this.data.isTakingPhoto) return;

    if (this.data.cameraError) {
      this.handleCameraIssue();
      return;
    }

    if (!this.cameraContext) {
      this.cameraContext = wx.createCameraContext();
    }

    this.setData({ isTakingPhoto: true });
    this.cameraContext.takePhoto({
      quality: 'high',
      success: (res) => {
        const tempImagePath = res && res.tempImagePath;
        if (!tempImagePath) {
          this._showPhotoError();
          return;
        }

        wx.navigateTo({
          url: `/pages/reveal/reveal?photo=${encodeURIComponent(tempImagePath)}`,
          fail: () => this._showPhotoError(),
        });
      },
      fail: (err) => {
        console.error('[Camera] 拍照失败:', err);
        this._showPhotoError();
      },
      complete: () => {
        this.setData({ isTakingPhoto: false });
      },
    });
  },

  onCameraError(event) {
    console.error('[Camera] 相机不可用:', event && event.detail);

    const detail = event && event.detail;
    const detailText = typeof detail === 'string' ? detail : JSON.stringify(detail || '');
    if (/api scope is not declared|privacy agreement|errno.?112/i.test(detailText)) {
      this._showPrivacyConfigIssue(detail);
      return;
    }

    this.setData({
      cameraError: true,
      cameraIssueKind: 'permission',
      cameraIssueEyebrow: '相机权限',
      cameraIssueTitle: '需要使用相机',
      cameraIssueSubtitle: '请在权限设置中允许相机访问',
      cameraIssueAction: '打开设置',
    });
  },

  openCameraSettings() {
    wx.openSetting({
      success: () => {
        this.setData({ cameraError: false });
      },
    });
  },

  _showPhotoError() {
    this.setData({
      cameraError: true,
      cameraIssueKind: 'photo',
      cameraIssueEyebrow: '快门小插曲',
      cameraIssueTitle: '这次没拍稳',
      cameraIssueSubtitle: '没有收到清楚的画面，再按一次快门试试',
      cameraIssueAction: '再拍一次',
    });
  },

  handleCameraIssue() {
    if (this.data.cameraIssueKind === 'privacy') {
      this.setData({ cameraError: false }, () => {
        this.cameraContext = wx.createCameraContext();
      });
      return;
    }

    if (this.data.cameraIssueKind === 'photo') {
      this.setData({ cameraError: false });
      return;
    }
    this.openCameraSettings();
  },

  // 返回上一页
  goBack() {
    wx.navigateBack();
  },
});
