// pages/collection/collection.js
const storage = require('../../utils/storage');
const { ALL_CATS } = require('../../utils/catData');
const cloudFiles = require('../../utils/cloudFiles');
const catScoring = require('../../utils/catScoring');
const deviceLayout = require('../../utils/deviceLayout');

const FILTER_OPTIONS = [
  { value: 'all', label: '全部' },
  ...catScoring.LEVELS.map(level => ({ value: level.code, label: level.label })),
];
const PAGE_SIZE = 12;

Page({
  data: {
    catList: [],
    filteredList: [],
    pagedList: [],
    unlockedCount: 0,
    activeFilter: 'all',
    filterOptions: [],
    pageSize: PAGE_SIZE,
    currentPage: 1,
    totalPages: 1,
    showException: false,
    exceptionEyebrow: '猫卡提醒',
    exceptionTitle: '',
    exceptionMessage: '',
    exceptionPrimaryText: '去遇见猫',
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
    if (tabBar) tabBar.setData({ selected: 1, hidden: false });
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
      // 只有真正有相遇记录的猫才进入猫卡，避免空的解锁状态渲染成空卡片。
      const unlocked = catRecords.length > 0;

      const displayRecord = featured || latest;
      const bestEncounter = catScoring.getBestEncounter(catRecords);
      const levelCode = bestEncounter ? bestEncounter.levelCode : 'C';
      const level = catScoring.getLevelMeta(levelCode);
      const posterSourcePhotoPath = storage.getRecordPosterSourcePath(displayRecord);
      const posterSourceFileID = storage.getRecordPosterSourceFileID(displayRecord);
      const subjectPhotoPath = storage.getRecordSubjectPath(displayRecord);
      const subjectFileID = storage.getRecordSubjectFileID(displayRecord);
      const originalPhotoPath = storage.getRecordOriginalPath(displayRecord);
      const originalFileID = displayRecord && displayRecord.originalFileID
        ? displayRecord.originalFileID
        : '';

      return {
        ...cat,
        unlocked,
        // 列表主图展示透明主体；cover 只作为没有主体和原图时的兼容回退。
        photoPath: subjectPhotoPath
          || (subjectFileID ? '' : (originalPhotoPath || (posterSourceFileID ? '' : posterSourcePhotoPath))),
        posterSourcePhotoPath,
        posterSourceFileID,
        subjectPhotoPath,
        subjectFileID,
        originalPhotoPath,
        photoFileID: subjectFileID || originalFileID || posterSourceFileID,
        originalFileID,
        isNew: false,
        levelCode,
        levelLabel: level.label,
        levelShortLabel: level.shortLabel,
        overallScore: bestEncounter ? bestEncounter.overallScore : 0,
        scorePending: bestEncounter ? bestEncounter.scorePending : true,
        // 名字以第一次成功识别生成的档案名为主，避免同一只猫每次相遇都被重新命名。
        displayName: entry.displayName || (latest && latest.catName) || cat.name,
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
    const pagedList = this._applyFilter(this.data.activeFilter, visibleCats);
    this._refreshPhotoURLs(pagedList);
  },

  async _refreshPhotoURLs(catList) {
    await Promise.all(catList.map(async cat => {
      if (!cat.photoFileID || (cat.photoPath && !cat.posterSourceFileID)) return;

      try {
        const fileIDs = [
          cat.subjectFileID,
          cat.originalFileID,
          cat.posterSourceFileID,
        ].filter(Boolean);
        let photoPath = '';
        for (const fileID of fileIDs) {
          try {
            photoPath = await cloudFiles.getTempFileURL(fileID);
            if (photoPath) break;
          } catch (error) {
            // 主体图地址失效时继续尝试拍摄原图，最后才兼容封面图。
          }
        }
        if (!photoPath) throw new Error('云存储文件地址不可用');
        const catIndex = this.data.catList.findIndex(item => item.id === cat.id);
        if (catIndex < 0) return;

        const patch = {};
        patch[`catList[${catIndex}].photoPath`] = photoPath;
        const filteredIndex = this.data.filteredList.findIndex(item => item.id === cat.id);
        if (filteredIndex >= 0) patch[`filteredList[${filteredIndex}].photoPath`] = photoPath;
        const pagedIndex = this.data.pagedList.findIndex(item => item.id === cat.id);
        if (pagedIndex >= 0) patch[`pagedList[${pagedIndex}].photoPath`] = photoPath;
        this.setData(patch);
      } catch (error) {
        const catIndex = this.data.catList.findIndex(item => item.id === cat.id);
        if (catIndex >= 0) {
          const patch = {};
          patch[`catList[${catIndex}].photoPath`] = cat.subjectPhotoPath
            || cat.originalPhotoPath
            || cat.posterSourcePhotoPath
            || '';
          const filteredIndex = this.data.filteredList.findIndex(item => item.id === cat.id);
          if (filteredIndex >= 0) {
            patch[`filteredList[${filteredIndex}].photoPath`] = cat.subjectPhotoPath
              || cat.originalPhotoPath
              || cat.posterSourcePhotoPath
              || '';
          }
          const pagedIndex = this.data.pagedList.findIndex(item => item.id === cat.id);
          if (pagedIndex >= 0) {
            patch[`pagedList[${pagedIndex}].photoPath`] = cat.subjectPhotoPath
              || cat.originalPhotoPath
              || cat.posterSourcePhotoPath
              || '';
          }
          this.setData(patch);
        }
        // 临时地址失效时回退到安全校验后的原图。
        console.warn('[Collection] 获取图像地址失败:', error);
      }
    }));
  },

  _applyFilter(filter, list, page) {
    const source = list || this.data.catList;
    const filteredList = filter === 'all'
      ? source
      : source.filter(cat => cat.levelCode === filter);
    const totalPages = Math.max(Math.ceil(filteredList.length / PAGE_SIZE), 1);
    const pageNumber = Number(page);
    const requestedPage = Number.isFinite(pageNumber)
      ? pageNumber
      : this.data.currentPage;
    const currentPage = Math.min(Math.max(Math.floor(requestedPage) || 1, 1), totalPages);
    const start = (currentPage - 1) * PAGE_SIZE;
    const pagedList = filteredList.slice(start, start + PAGE_SIZE);
    this.setData({
      filteredList,
      pagedList,
      activeFilter: filter,
      currentPage,
      totalPages,
    });
    return pagedList;
  },

  switchFilter(event) {
    const filter = event.currentTarget.dataset.value;
    if (filter !== this.data.activeFilter) {
      const pagedList = this._applyFilter(filter, this.data.catList, 1);
      this._refreshPhotoURLs(pagedList);
    }
  },

  changePage(event) {
    const targetPage = Number(event.currentTarget.dataset.page);
    if (!Number.isFinite(targetPage) || targetPage < 1 || targetPage > this.data.totalPages) return;
    if (targetPage === this.data.currentPage) return;

    const pagedList = this._applyFilter(this.data.activeFilter, this.data.catList, targetPage);
    this._refreshPhotoURLs(pagedList);
  },

  goDetail(event) {
    const { catId, unlocked } = event.currentTarget.dataset;
    if (unlocked !== true && unlocked !== 'true') {
      this.setData({
        showException: true,
        exceptionTitle: '这张卡还在等你',
        exceptionMessage: '先去遇见它，再把它收进猫卡',
      });
      return;
    }
    wx.navigateTo({ url: `/pages/card-detail/card-detail?catId=${catId}` });
  },

  onExceptionPrimary() {
    this.setData({ showException: false });
    wx.switchTab({ url: '/pages/index/index' });
  },

  onShareAppMessage() {
    return {
      title: '我的猫卡｜猫咪咔咔',
      path: '/pages/collection/collection?from=share',
    };
  },

  onShareTimeline() {
    return {
      title: '我的猫卡｜收集城市里的每一只猫',
      query: 'from=timeline',
    };
  },
});
