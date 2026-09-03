// pages/index/index.js
const storage = require('../../utils/storage');
const { getCatById } = require('../../utils/catData');

Page({
  data: {
    todayCount: 0,
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
  },

  onShow() {
    this._syncTabBar();
    this._refreshData();
  },

  _syncTabBar() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 0 });
  },

  _refreshData() {
    const records = storage.getAllRecords();
    const collection = storage.getCollection();
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
      unlockedCount,
      latestPhoto: latestRecord
        ? storage.getRecordDisplayPath(latestRecord)
        : '',
      latestName: latestCat ? latestCat.name : '',
    });
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
});
