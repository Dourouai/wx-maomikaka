// pages/index/index.js
const storage = require('../../utils/storage');
const { getCatById } = require('../../utils/catData');
const memberLevel = require('../../utils/memberLevel');
const deviceLayout = require('../../utils/deviceLayout');
const cloudFiles = require('../../utils/cloudFiles');
const encounterFlow = require('../../utils/encounterFlow');
const photoPicker = require('../../utils/photoPicker');
const permissions = require('../../utils/permissions');
const APP_SHARE_IMAGE = '/assets/maomi-kaka-logo-square-144.png';

Page({
  data: {
    todayCount: 0,
    dailyCanLimit: 3,
    dailyRemainingCans: 3,
    purchasedCanBalance: 0,
    // 首页仍只展示每日 3 个罐罐；availableCans 用于判断是否还能继续相遇。
    remainingCans: 3,
    availableCans: 3,
    canSlots: [1, 1, 1],
    memberLevel: 1,
    unlockedCount: 0,
    totalCount: 60,
    latestPhoto: '',
    latestName: '',
    isOpeningCamera: false,
    isOpeningImageUpload: false,
    showException: false,
    exceptionEyebrow: '相遇入口',
    exceptionTitle: '',
    exceptionMessage: '',
    exceptionPrimaryText: '再试一次',
    exceptionPrimaryAction: 'camera',
    exceptionSecondaryText: '知道了',
    showExceptionSecondary: false,
    pageHeaderTop: 48,
    headerRightInset: 0,
  },

  onLoad() {
    this._syncDeviceLayout();
  },

  onShow() {
    this._syncDeviceLayout();
    this._syncTabBar();
    this._refreshData();
    // 从微信设置返回后只复核照片隐私状态，不自动打开相册或开始识别。
    if (this._imageSettingsPending) {
      this._imageSettingsPending = false;
      this._refreshImagePermissionAfterSettings();
    }
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

  _syncTabBar() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 0, hidden: false });
  },

  async _refreshImagePermissionAfterSettings() {
    if (this._imagePermissionRefreshing) return;
    this._imagePermissionRefreshing = true;
    try {
      const status = await photoPicker.getPhotoSelectionAuthorizationStatus();
      const canRetry = status === 'authorized' || status === 'unknown';
      this.setData({
        showException: true,
        showExceptionSecondary: false,
        exceptionEyebrow: '照片权限',
        exceptionTitle: canRetry ? '可以重新选择照片' : '还需要同意照片说明',
        exceptionMessage: canRetry
          ? '权限状态已更新，点击“重新选择”继续。'
          : '照片使用说明还没有完成，请同意后再选择图片。',
        exceptionPrimaryText: '重新选择',
        exceptionPrimaryAction: 'image-upload',
      });
    } catch (error) {
      console.warn('[Index] 设置返回后复核照片权限失败:', error);
    } finally {
      this._imagePermissionRefreshing = false;
    }
  },

  _openImageSettings() {
    if (this._imageSettingsPending || this._imagePermissionRefreshing) return;
    this._imageSettingsPending = true;
    permissions.openSetting()
      .then(() => {
        // 某些开发者工具版本不会稳定触发 onShow，用回调做复核兜底。
        if (!this._imageSettingsPending) return;
        this._imageSettingsPending = false;
        return this._refreshImagePermissionAfterSettings();
      })
      .catch(error => {
        this._imageSettingsPending = false;
        console.warn('[Index] 打开照片权限设置失败:', error);
      });
  },

  _refreshData() {
    const records = storage.getAllRecords();
    const collection = storage.getCollection();
    const membership = memberLevel.getMemberLevel(storage.getUserStats().pawGrowth);
    const quota = storage.getCanQuota();
    const todayCount = quota.todayCount;
    const unlockedCount = Object.keys(collection).filter(catId =>
      collection[catId] && collection[catId].unlocked
    ).length;
    const latestRecord = records[0];
    const latestCat = latestRecord ? getCatById(latestRecord.catId) : null;

    this.setData({
      todayCount,
      dailyRemainingCans: quota.dailyRemainingCans,
      purchasedCanBalance: quota.purchasedCanBalance,
      remainingCans: quota.dailyRemainingCans,
      availableCans: quota.remainingCans,
      canSlots: [0, 1, 2].map(index => index < quota.dailyRemainingCans ? 1 : 0),
      memberLevel: membership.level,
      unlockedCount,
      latestPhoto: latestRecord
        ? storage.getRecordDisplayPath(latestRecord)
        : '',
      latestName: latestRecord
        ? (latestRecord.catName || (latestCat && latestCat.name) || '')
        : '',
    });
    this._refreshLatestPhotoURL(latestRecord);
  },

  async _refreshLatestPhotoURL(record) {
    if (!record || storage.getRecordDisplayPath(record)) return;

    for (const fileID of [
      storage.getRecordSubjectFileID(record),
      record.originalFileID,
      storage.getRecordPosterSourceFileID(record),
    ].filter(Boolean)) {
      try {
        const latestPhoto = await cloudFiles.getTempFileURL(fileID);
        if (latestPhoto) {
          this.setData({ latestPhoto });
          return;
        }
      } catch (error) {
        // 主体图地址失效时才尝试拍摄原图，最后兼容封面图。
      }
    }
  },

  goCamera() {
    if (this.data.isOpeningCamera) return;
    if (this.data.availableCans <= 0) {
      this.setData({
        showException: true,
        exceptionEyebrow: '今日相遇已满',
        exceptionTitle: '罐罐用完啦',
        exceptionMessage: '今天的 3 个免费罐罐已经用完，购买罐罐后还可以继续收集。',
        exceptionPrimaryText: '去充值',
        exceptionPrimaryAction: 'recharge',
        exceptionSecondaryText: '知道了',
        showExceptionSecondary: true,
      });
      return;
    }
    this.setData({ isOpeningCamera: true });

    wx.navigateTo({
      url: '/pages/camera/camera',
      fail: () => {
        this.setData({
          showException: true,
          showExceptionSecondary: false,
          exceptionTitle: '相机没有打开',
          exceptionMessage: '这次相遇还在门外，再试一次就好',
          exceptionPrimaryAction: 'camera',
        });
      },
      complete: () => {
        this.setData({ isOpeningCamera: false });
      },
    });
  },

  async goImageUpload() {
    if (this.data.isOpeningImageUpload) return;

    if (this.data.availableCans <= 0) {
      this.setData({
        showException: true,
        exceptionEyebrow: '今日相遇已满',
        exceptionTitle: '罐罐用完啦',
        exceptionMessage: '今天的 3 个免费罐罐已经用完，购买罐罐后还可以继续收集。',
        exceptionPrimaryText: '去充值',
        exceptionPrimaryAction: 'recharge',
        exceptionSecondaryText: '知道了',
        showExceptionSecondary: true,
      });
      return;
    }

    this.setData({ isOpeningImageUpload: true });

    try {
      const photoPath = await encounterFlow.chooseAlbumImage();
      await encounterFlow.openReveal(photoPath, {
        sourceType: 'photo',
        locationStatus: 'unavailable',
      });
    } catch (error) {
      if (error && error.code === 'USER_CANCELLED') return;

      console.error('[Index] 相册选图失败:', error);
      const errorText = `${error && error.message ? error.message : ''} ${error && error.errMsg ? error.errMsg : ''}`;
      const privacyAuthorizationDenied = error && error.code === 'PHOTO_PRIVACY_DENIED';
      const privacyStatusUnavailable = error && error.code === 'PHOTO_PRIVACY_UNAVAILABLE';
      const privacyIssue = privacyAuthorizationDenied
        || privacyStatusUnavailable
        || /api scope is not declared|privacy agreement|errno.?112/i.test(errorText);
      const permissionDenied = /auth deny|permission denied|not authorized|denied/i.test(errorText);
      this.setData({
        showException: true,
        showExceptionSecondary: false,
        exceptionEyebrow: privacyIssue || permissionDenied ? '照片权限' : '图片上传入口',
        exceptionTitle: privacyAuthorizationDenied
          ? '先同意照片使用说明'
          : (privacyStatusUnavailable
            ? '暂时无法确认照片权限'
            : (privacyIssue ? '还不能选择照片' : (permissionDenied ? '需要照片权限' : '图片没有选好'))),
        exceptionMessage: privacyAuthorizationDenied
          ? '选择图片前，需要先同意照片使用说明。'
          : (privacyStatusUnavailable
            ? '照片隐私状态暂时无法确认，请稍后重试。'
          : (privacyIssue
            ? '请先在小程序后台声明“选中的照片或视频”，再从相册上传。'
          : (permissionDenied
            ? '请在微信设置中允许访问照片，再回来上传。'
            : '请从相册重新选择一张清楚的猫咪照片。'))),
        exceptionPrimaryText: permissionDenied ? '去设置' : '重新选择',
        exceptionPrimaryAction: permissionDenied ? 'image-settings' : 'image-upload',
      });
    } finally {
      this.setData({ isOpeningImageUpload: false });
    }
  },

  onExceptionPrimary() {
    this.setData({ showException: false });
    if (this.data.exceptionPrimaryAction === 'recharge') {
      const app = typeof getApp === 'function' ? getApp() : null;
      if (app && app.globalData) app.globalData.openCanRecharge = true;
      wx.switchTab({ url: '/pages/my/my' });
      return;
    }
    if (this.data.exceptionPrimaryAction === 'image-settings') {
      this._openImageSettings();
      return;
    }
    if (this.data.exceptionPrimaryAction === 'image-upload') {
      if (this.data.availableCans > 0) this.goImageUpload();
      return;
    }
    if (this.data.availableCans > 0) this.goCamera();
  },

  onExceptionSecondary() {
    this.setData({ showException: false, showExceptionSecondary: false });
  },

  goCollection() {
    wx.switchTab({ url: '/pages/collection/collection' });
  },

  // 首页分享使用当前页面的默认截图，保留完整的“去遇见一只猫”视觉首屏；
  // 不携带用户数据，也不把本机照片放进分享卡片。
  onShareAppMessage() {
    return {
      title: '去遇见一只猫｜猫咪咔咔',
      path: '/pages/index/index?from=share',
      imageUrl: APP_SHARE_IMAGE,
    };
  },

  onShareTimeline() {
    return {
      title: '去遇见一只猫｜把一场偶遇，变成一张相遇卡',
      query: 'from=timeline',
      imageUrl: APP_SHARE_IMAGE,
    };
  },
});
