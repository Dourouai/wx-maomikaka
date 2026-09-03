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
    this.cameraContext = wx.createCameraContext();
  },

  // 拍摄页面内的当前画面，不再跳转到微信原生相机页。
  takePhoto() {
    if (this.data.isTakingPhoto) return;

    if (this.data.cameraError) {
      this.openCameraSettings();
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
