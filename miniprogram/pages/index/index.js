// pages/index/index.js
const storage = require('../../utils/storage');
const { getCatById } = require('../../utils/catData');
const memberLevel = require('../../utils/memberLevel');
const deviceLayout = require('../../utils/deviceLayout');
const cloudFiles = require('../../utils/cloudFiles');

Page({
  data: {
    todayCount: 0,
    dailyCanLimit: 3,
    remainingCans: 3,
    canSlots: [1, 1, 1],
    memberLevel: 1,
    unlockedCount: 0,
    totalCount: 60,
    latestPhoto: '',
    latestName: '',
    isOpeningCamera: false,
    showException: false,
    exceptionEyebrow: '相遇入口',
    exceptionTitle: '',
    exceptionMessage: '',
    exceptionPrimaryText: '再试一次',
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

  _refreshData() {
    const records = storage.getAllRecords();
    const collection = storage.getCollection();
    const membership = memberLevel.getMemberLevel(storage.getUserStats().pawGrowth);
    const today = this._getDateKey(Date.now());
    const todayCount = records.filter(record =>
      this._getDateKey(record.createdAt) === today
    ).length;
    const unlockedCount = Object.keys(collection).filter(catId =>
      collection[catId] && collection[catId].unlocked
    ).length;
    const latestRecord = records[0];
    const latestCat = latestRecord ? getCatById(latestRecord.catId) : null;

    this.setData({
      todayCount,
      remainingCans: Math.max(0, 3 - todayCount),
      canSlots: [0, 1, 2].map(index => index < Math.max(0, 3 - todayCount) ? 1 : 0),
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

    for (const fileID of [record.cutoutFileID, record.originalFileID].filter(Boolean)) {
      try {
        const latestPhoto = await cloudFiles.getTempFileURL(fileID);
        if (latestPhoto) {
          this.setData({ latestPhoto });
          return;
        }
      } catch (error) {
        // 主体图地址失效时继续尝试原图。
      }
    }
  },

  _getDateKey(timestamp) {
    const date = new Date(timestamp || Date.now());
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  goCamera() {
    if (this.data.isOpeningCamera) return;
    if (this.data.remainingCans <= 0) {
      this.setData({
        showException: true,
        exceptionEyebrow: '今日相遇已满',
        exceptionTitle: '罐罐用完啦',
        exceptionMessage: '今天已经遇见 3 只猫，明天再来继续收集吧。',
        exceptionPrimaryText: '知道了',
      });
      return;
    }
    this.setData({ isOpeningCamera: true });

    wx.navigateTo({
      url: '/pages/camera/camera',
      fail: () => {
        this.setData({
          showException: true,
          exceptionTitle: '相机没有打开',
          exceptionMessage: '这次相遇还在门外，再试一次就好',
        });
      },
      complete: () => {
        this.setData({ isOpeningCamera: false });
      },
    });
  },

  onExceptionPrimary() {
    this.setData({ showException: false });
    if (this.data.remainingCans > 0) this.goCamera();
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
    };
  },

  onShareTimeline() {
    return {
      title: '去遇见一只猫｜把一场偶遇，变成一张相遇卡',
      query: 'from=timeline',
    };
  },
});
