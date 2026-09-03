// pages/collection/collection.js
const storage = require('../../utils/storage');
const { ALL_CATS } = require('../../utils/catData');
const cloudFiles = require('../../utils/cloudFiles');
const catScoring = require('../../utils/catScoring');

const FILTER_OPTIONS = [
  { value: 'all', label: '全部' },
  ...catScoring.LEVELS.map(level => ({ value: level.code, label: level.label })),
];

Page({
  data: {
    catList: [],
    filteredList: [],
    unlockedCount: 0,
    activeFilter: 'all',
    filterOptions: [],
    showException: false,
    exceptionEyebrow: '图鉴提醒',
    exceptionTitle: '',
    exceptionMessage: '',
    exceptionPrimaryText: '去遇见猫',
  },

  onShow() {
    this._syncTabBar();
    this._refreshData();
  },

  _syncTabBar() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 1 });
  },

  _refreshData() {
    const collection = storage.getCollection();
    const records = storage.getAllRecords();
    const recordsByCat = records.reduce((map, record) => {
      if (!map[record.catId]) map[record.catId] = [];
      map[record.catId].push(record);
      return map;
    }, {});

    const catList = ALL_CATS.map(cat => {
      const entry = collection[cat.id] || {};
      const catRecords = recordsByCat[cat.id] || [];
      const featured = entry.featuredRecordId
        ? catRecords.find(record => record.recordId === entry.featuredRecordId)
        : null;
      const latest = catRecords[0];
      // 只有真正有相遇记录的猫才进入图鉴，避免空的解锁状态渲染成空卡片。
      const unlocked = catRecords.length > 0;

      const displayRecord = featured || latest;
      const bestEncounter = catScoring.getBestEncounter(catRecords);
      const levelCode = bestEncounter ? bestEncounter.levelCode : 'C';
      const level = catScoring.getLevelMeta(levelCode);

      return {
        ...cat,
        unlocked,
        count: entry.photoCount || catRecords.length,
        photoPath: storage.getRecordDisplayPath(displayRecord),
        originalPhotoPath: displayRecord
          ? (displayRecord.photoPath || displayRecord.photo || '')
          : '',
        photoFileID: displayRecord && (displayRecord.cutoutFileID || displayRecord.originalFileID)
          ? (displayRecord.cutoutFileID || displayRecord.originalFileID)
          : '',
        originalFileID: displayRecord && displayRecord.originalFileID
          ? displayRecord.originalFileID
          : '',
        isNew: false,
        levelCode,
        levelLabel: level.label,
        levelShortLabel: level.shortLabel,
        overallScore: bestEncounter ? bestEncounter.overallScore : 0,
        scorePending: bestEncounter ? bestEncounter.scorePending : true,
        displayName: cat.name,
        metaText: `遇见 ${entry.photoCount || catRecords.length} 次`,
      };
    });

    const visibleCats = catList.filter(cat => cat.unlocked);

    const unlockedCount = visibleCats.length;
    const filterOptions = FILTER_OPTIONS.map(option => ({
      ...option,
      count: option.value === 'all'
        ? unlockedCount
        : visibleCats.filter(cat => cat.levelCode === option.value).length,
    }));

    this.setData({
      catList: visibleCats,
      unlockedCount,
      filterOptions,
    });
    this._applyFilter(this.data.activeFilter, visibleCats);
    this._refreshPhotoURLs(visibleCats);
  },

  async _refreshPhotoURLs(catList) {
    await Promise.all(catList.map(async cat => {
      if (!cat.photoFileID) return;

      try {
        const fileIDs = [cat.photoFileID, cat.originalFileID].filter(Boolean);
        let photoPath = '';
        for (const fileID of fileIDs) {
          try {
            photoPath = await cloudFiles.getTempFileURL(fileID);
            if (photoPath) break;
          } catch (error) {
            // 主体图失效时继续尝试安全校验后的原图 fileID。
          }
        }
        if (!photoPath) throw new Error('云存储文件地址不可用');
        const catIndex = this.data.catList.findIndex(item => item.id === cat.id);
        if (catIndex < 0) return;

        const patch = {};
        patch[`catList[${catIndex}].photoPath`] = photoPath;
        const filteredIndex = this.data.filteredList.findIndex(item => item.id === cat.id);
        if (filteredIndex >= 0) patch[`filteredList[${filteredIndex}].photoPath`] = photoPath;
        this.setData(patch);
      } catch (error) {
        const catIndex = this.data.catList.findIndex(item => item.id === cat.id);
        if (catIndex >= 0) {
          const patch = {};
          patch[`catList[${catIndex}].photoPath`] = cat.originalPhotoPath || '';
          const filteredIndex = this.data.filteredList.findIndex(item => item.id === cat.id);
          if (filteredIndex >= 0) {
            patch[`filteredList[${filteredIndex}].photoPath`] = cat.originalPhotoPath || '';
          }
          this.setData(patch);
        }
        // 临时地址失效时回退到安全校验后的原图。
        console.warn('[Collection] 获取图像地址失败:', error);
      }
    }));
  },

  _applyFilter(filter, list) {
    const source = list || this.data.catList;
    const filteredList = filter === 'all'
      ? source
      : source.filter(cat => cat.levelCode === filter);
    this.setData({ filteredList, activeFilter: filter });
  },

  switchFilter(event) {
    const filter = event.currentTarget.dataset.value;
    if (filter !== this.data.activeFilter) this._applyFilter(filter);
  },

  goDetail(event) {
    const { catId, unlocked } = event.currentTarget.dataset;
    if (unlocked !== true && unlocked !== 'true') {
      this.setData({
        showException: true,
        exceptionTitle: '这张卡还在等你',
        exceptionMessage: '先去遇见它，再把它收进图鉴',
      });
      return;
    }
    wx.navigateTo({ url: `/pages/card-detail/card-detail?catId=${catId}` });
  },

  onExceptionPrimary() {
    this.setData({ showException: false });
    wx.switchTab({ url: '/pages/index/index' });
  },
});
