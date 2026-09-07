// 拍照页 camera.js
const deviceLayout = require('../../utils/deviceLayout');
const storage = require('../../utils/storage');
const location = require('../../utils/location');

Page({
  data: {
    todayCount: 0,
    remainingCans: 3,
    dailyCanLimit: 3,
    isTakingPhoto: false,
    showLocationPrompt: false,
    locationConsentBusy: false,
    cameraError: false,
    cameraIssueKind: 'permission',
    cameraIssueEyebrow: '相机权限',
    cameraIssueTitle: '需要使用相机',
    cameraIssueSubtitle: '请在权限设置中允许相机访问',
    cameraIssueAction: '打开设置',
    cameraHeaderTop: 48,
    cameraHeaderRightInset: 36,
    cameraFrameTop: 116,
    cameraControlsHeight: 152,
    cameraFrameBottom: 172,
    cameraHintBottom: 182,
    safeBottom: 34,
  },

  onLoad() {
    this._syncDeviceLayout();
    this._refreshDailyQuota();
  },

  _refreshDailyQuota() {
    const today = this._getDateKey(Date.now());
    const todayCount = storage.getAllRecords().filter(record => (
      this._getDateKey(record.createdAt) === today
    )).length;
    const remainingCans = Math.max(0, 3 - todayCount);
    this.setData({ todayCount, remainingCans });
    if (remainingCans <= 0) {
      this.setData({
        cameraError: true,
        cameraIssueKind: 'quota',
        cameraIssueEyebrow: '今日相遇已满',
        cameraIssueTitle: '罐罐用完啦',
        cameraIssueSubtitle: '今天已经遇见 3 只猫，明天再来继续收集吧。',
        cameraIssueAction: '返回首页',
      });
    }
    return remainingCans;
  },

  _getDateKey(timestamp) {
    const date = new Date(timestamp || Date.now());
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  },

  onResize() {
    this._syncDeviceLayout();
  },

  _syncDeviceLayout() {
    const layout = deviceLayout.getDeviceLayout();
    this.setData({
      cameraHeaderTop: layout.pageHeaderTop,
      cameraHeaderRightInset: layout.cameraHeaderRight,
      cameraFrameTop: layout.cameraFrameTop,
      cameraControlsHeight: layout.cameraControlsHeight,
      cameraFrameBottom: layout.cameraFrameBottom,
      cameraHintBottom: layout.cameraHintBottom,
      safeBottom: layout.safeBottom,
    });
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
    if (this.data.isTakingPhoto || this._captureFlowBusy || this.data.showLocationPrompt) return;

    const remainingCans = this._refreshDailyQuota();
    if (remainingCans <= 0) return;

    if (this.data.cameraError) {
      this.handleCameraIssue();
      return;
    }

    if (!this.cameraContext) {
      this.cameraContext = wx.createCameraContext();
    }

    this._captureFlowBusy = true;
    this.setData({ isTakingPhoto: true });
    this.cameraContext.takePhoto({
      quality: 'high',
      success: (res) => {
        const tempImagePath = res && res.tempImagePath;
        if (!tempImagePath) {
          this._captureFlowBusy = false;
          this._showPhotoError();
          return;
        }

        this._prepareCapturedPhoto(tempImagePath).catch(error => {
          console.error('[Camera] 拍摄上下文准备失败:', error);
          this._captureFlowBusy = false;
          this._pendingCapture = null;
          this._showPhotoError();
        });
      },
      fail: (err) => {
        console.error('[Camera] 拍照失败:', err);
        this._captureFlowBusy = false;
        this._showPhotoError();
      },
      complete: () => {
        this.setData({ isTakingPhoto: false });
      },
    });
  },

  async _prepareCapturedPhoto(tempImagePath) {
    const pending = {
      captureId: storage.createPendingCaptureId(),
      photoPath: tempImagePath,
      capturedAt: Date.now(),
    };
    this._pendingCapture = pending;

    let authorizationStatus = 'unavailable';
    try {
      authorizationStatus = await location.getAuthorizationStatus();
    } catch (error) {
      console.warn('[Camera] 位置授权状态不可用，跳过位置记录:', error);
    }

    if (authorizationStatus === 'undetermined' && !storage.getLocationConsent()) {
      // 自定义说明先于微信系统授权弹窗出现，用户拒绝位置不会影响本次识别。
      this.setData({
        showLocationPrompt: true,
        locationConsentBusy: false,
      });
      return;
    }

    if (authorizationStatus === 'authorized') {
      try {
        const capturedLocation = await location.getFuzzyLocation();
        this._finishCapturedPhoto(pending, capturedLocation, 'captured');
      } catch (error) {
        console.warn('[Camera] 已授权但位置读取失败，继续处理照片:', error);
        this._finishCapturedPhoto(pending, null, 'unavailable');
      }
      return;
    }

    this._finishCapturedPhoto(
      pending,
      null,
      authorizationStatus === 'denied'
        ? 'denied'
        : (storage.getLocationConsent() ? 'skipped' : 'unavailable')
    );
  },

  chooseLocationConsent() {
    if (this.data.locationConsentBusy || !this._pendingCapture) return;
    this.setData({ locationConsentBusy: true });
    location.getFuzzyLocation()
      .then(capturedLocation => {
        this._finishCapturedPhoto(this._pendingCapture, capturedLocation, 'captured');
      })
      .catch(error => {
        console.warn('[Camera] 用户同意后位置读取失败，继续处理照片:', error);
        const message = String(error && (error.errMsg || error.message) || '').toLowerCase();
        const status = /deny|denied|auth|authorize|拒绝/.test(message) ? 'denied' : 'unavailable';
        this._finishCapturedPhoto(this._pendingCapture, null, status);
      });
  },

  skipLocationConsent() {
    if (this.data.locationConsentBusy || !this._pendingCapture) return;
    storage.setLocationConsent('skipped');
    this._finishCapturedPhoto(this._pendingCapture, null, 'skipped');
  },

  _finishCapturedPhoto(pending, capturedLocation, locationStatus) {
    if (!pending || this._pendingCapture !== pending) return;

    try {
      const savedPending = storage.savePendingCapture({
        ...pending,
        location: capturedLocation,
        locationStatus,
      });
      this._pendingCapture = null;
      this._captureFlowBusy = false;
      this.setData({
        showLocationPrompt: false,
        locationConsentBusy: false,
      });
      wx.navigateTo({
        url: `/pages/reveal/reveal?captureId=${encodeURIComponent(savedPending.captureId)}&photo=${encodeURIComponent(savedPending.photoPath)}`,
        fail: () => {
          storage.clearPendingCapture(savedPending.captureId);
          this._showPhotoError();
        },
      });
    } catch (error) {
      console.error('[Camera] 拍摄上下文保存失败:', error);
      this._pendingCapture = null;
      this._captureFlowBusy = false;
      this.setData({ showLocationPrompt: false, locationConsentBusy: false });
      this._showPhotoError();
    }
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
    if (this.data.cameraIssueKind === 'quota') {
      wx.switchTab({ url: '/pages/index/index' });
      return;
    }
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

  // 退出拍摄，直接回到相遇首页。
  goBack() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  goCollection() {
    wx.switchTab({ url: '/pages/collection/collection' });
  },
});
