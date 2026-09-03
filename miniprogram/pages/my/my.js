// pages/my/my.js
const storage = require('../../utils/storage');
const { ALL_CATS, getCatById } = require('../../utils/catData');
const memberLevel = require('../../utils/memberLevel');

Page({
  data: {
    unlockedCount: 0,
    totalCount: ALL_CATS.length,
    totalPhotos: 0,
    todayCount: 0,
    journeyPercent: 0,
    journeyRemaining: 0,
    memberLevel: 1,
    memberLevelCode: 'LV1',
    memberName: '街角新客',
    pawGrowth: 0,
    memberProgress: 0,
    nextMemberName: '巷口寻猫人',
    nextGrowth: 300,
    growthToNext: 300,
    memberIsMax: false,
    recentRecords: [],
    isOpeningCamera: false,
    showException: false,
    exceptionEyebrow: '相遇入口',
    exceptionTitle: '',
    exceptionMessage: '',
    exceptionPrimaryText: '再试一次',
  },

  onShow() {
    this._syncTabBar();
    this._refreshData();
  },

  _syncTabBar() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 2 });
  },

  _refreshData() {
    const records = storage.getAllRecords();
    const collection = storage.getCollection();
    const stats = storage.getUserStats();
    const membership = memberLevel.getMemberLevel(stats.pawGrowth);
    const today = this._dateKey(Date.now());
    const recentRecords = records.slice(0, 5).map((record, index) => {
      const cat = getCatById(record.catId);
      return {
        ...record,
        photoPath: storage.getRecordDisplayPath(record),
        catName: record.catName || (cat ? cat.name : '神秘猫'),
        fallbackIcon: '/assets/cat-placeholder.svg',
        timeText: this._formatDate(record.createdAt),
      };
    });

    const unlockedCount = Object.keys(collection).filter(catId =>
        collection[catId] && collection[catId].unlocked
      ).length;
    const totalCount = this.data.totalCount;

    this.setData({
      unlockedCount,
      totalPhotos: records.length,
      todayCount: records.filter(record => this._dateKey(record.createdAt) === today).length,
      journeyPercent: totalCount ? Math.min((unlockedCount / totalCount) * 100, 100) : 0,
      journeyRemaining: Math.max(totalCount - unlockedCount, 0),
      memberLevel: membership.level,
      memberLevelCode: membership.code,
      memberName: membership.name,
      pawGrowth: membership.growthValue,
      memberProgress: membership.progressPercent,
      nextMemberName: membership.nextName || '',
      nextGrowth: membership.nextGrowth || 0,
      growthToNext: membership.growthToNext,
      memberIsMax: membership.isMax,
      recentRecords,
    });
  },

  _dateKey(timestamp) {
    const date = new Date(timestamp || Date.now());
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  },

  _formatDate(timestamp) {
    const date = new Date(timestamp || Date.now());
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
  },

  goCamera() {
    if (this.data.isOpeningCamera) return;
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
    this.goCamera();
  },

  goCollection() {
    wx.switchTab({ url: '/pages/collection/collection' });
  },

  goDevMode() {
    wx.navigateTo({
      url: '/pages/dev-mode/dev-mode',
      fail: () => {
        this.setData({
          showException: true,
          exceptionTitle: '开发模式没打开',
          exceptionMessage: '测试工具暂时没有准备好，请稍后再试',
        });
      },
    });
  },
});
