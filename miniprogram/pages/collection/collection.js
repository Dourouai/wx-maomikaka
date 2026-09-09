// pages/collection/collection.js
const storage = require('../../utils/storage');
const userData = require('../../utils/userData');
const { ALL_CATS } = require('../../utils/catData');
const cloudFiles = require('../../utils/cloudFiles');
const catScoring = require('../../utils/catScoring');
const deviceLayout = require('../../utils/deviceLayout');
const APP_SHARE_IMAGE = '/assets/maomi-kaka-logo-square-144.png';

const FILTER_OPTIONS = [
  { value: 'all', label: '全部' },
  ...catScoring.LEVELS.map(level => ({ value: level.code, label: level.label })),
];
const PAGE_SIZE = 12;

function getTimestamp(value) {
  if (value && typeof value === 'object') {
    if (value.$date) return getTimestamp(value.$date);
    if (value.value) return getTimestamp(value.value);
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

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
    scrollTop: 0,
    isRefreshing: false,
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
    // 先按本地记录渲染猫卡，不等待云端同步；云端失败时也不能让刚加入的猫卡消失。
    this._refreshData();
    this._retryPendingSync();
  },

  async onPullDownRefresh() {
    if (this._refreshing) return;

    this._refreshing = true;
    this._scrollToTop();
    this.setData({ isRefreshing: true });
    try {
      // 已绑定账号时主动拉取云端快照；未绑定账号则刷新本地匿名记录。
      if (userData.isUserBound()) {
        await userData.syncLocalData({ source: 'collection-refresh' });
      }
      await this._refreshData(true);
    } catch (error) {
      // 云端暂时不可用时仍保留本地猫卡，并明确告知刷新结果。
      console.warn('[Collection] 下拉刷新云端数据失败，继续展示本地猫卡:', error);
      await this._refreshData(true);
      wx.showToast({ title: '云端刷新失败，已展示本地数据', icon: 'none' });
    } finally {
      this._refreshing = false;
      this.setData({ isRefreshing: false });
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
    if (tabBar) tabBar.setData({ selected: 1, hidden: false });
  },

  _retryPendingSync() {
    if (this._syncRetrying || !userData.isUserBound()) return;
    const summary = storage.getSyncSummary();
    if (!summary.pendingRecords) return;

    this._syncRetrying = true;
    userData.syncLocalData({ source: 'capture' }).then(() => {
      // 同步成功后重新读取本地快照，保留本地临时图片地址并补齐云端映射。
      this._refreshData();
    }).catch(error => {
      // 失败不影响本地猫卡展示；下次进入图鉴或“我的”页面继续重试。
      console.warn('[Collection] 待同步记录重试失败，继续展示本地猫卡:', error);
    }).finally(() => {
      this._syncRetrying = false;
    });
  },

  _refreshData(resetPage = false) {
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
      const recordCreatedAt = catRecords
        .map(record => getTimestamp(record && record.createdAt))
        .filter(timestamp => timestamp > 0);
      const createdAt = getTimestamp(entry.unlockedAt)
        || (recordCreatedAt.length ? Math.min(...recordCreatedAt) : 0);
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
        // 猫卡列表只展示透明主体；主体不可用时保留占位，不误展示生图封面。
        photoPath: subjectPhotoPath || '',
        posterSourcePhotoPath,
        posterSourceFileID,
        subjectPhotoPath,
        subjectFileID,
        originalPhotoPath,
        photoFileID: subjectFileID,
        originalFileID,
        isNew: false,
        levelCode,
        levelLabel: level.label,
        levelShortLabel: level.shortLabel,
        overallScore: bestEncounter ? bestEncounter.overallScore : 0,
        scorePending: bestEncounter ? bestEncounter.scorePending : true,
        createdAt,
        // 名字以第一次成功识别生成的档案名为主，避免同一只猫每次相遇都被重新命名。
        displayName: entry.displayName || (latest && latest.catName) || cat.name,
      };
    });

    const visibleCats = catList
      .filter(cat => cat.unlocked)
      .sort((left, right) => right.createdAt - left.createdAt);

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
    const pagedList = this._applyFilter(
      this.data.activeFilter,
      visibleCats,
      resetPage ? 1 : this.data.currentPage,
    );
    return this._refreshPhotoURLs(pagedList);
  },

  async _refreshPhotoURLs(catList) {
    await Promise.all(catList.map(async cat => {
      if (!cat.subjectFileID || cat.photoPath) return;

      try {
        const fileIDs = [cat.subjectFileID].filter(Boolean);
        let photoPath = '';
        for (const fileID of fileIDs) {
          try {
            photoPath = await cloudFiles.getTempFileURL(fileID);
            if (photoPath) break;
          } catch (error) {
            // 猫卡列表不回退到原图或生图封面。
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
          patch[`catList[${catIndex}].photoPath`] = cat.subjectPhotoPath || '';
          const filteredIndex = this.data.filteredList.findIndex(item => item.id === cat.id);
          if (filteredIndex >= 0) {
            patch[`filteredList[${filteredIndex}].photoPath`] = cat.subjectPhotoPath || '';
          }
          const pagedIndex = this.data.pagedList.findIndex(item => item.id === cat.id);
          if (pagedIndex >= 0) {
            patch[`pagedList[${pagedIndex}].photoPath`] = cat.subjectPhotoPath || '';
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
      this._scrollToTop();
      const pagedList = this._applyFilter(filter, this.data.catList, 1);
      this._refreshPhotoURLs(pagedList);
    }
  },

  async onScrollToLower() {
    if (this._paging || this.data.currentPage >= this.data.totalPages) return;
    await this._goToPage(this.data.currentPage + 1);
  },

  _scrollToTop() {
    this.setData({ scrollTop: 1 }, () => {
      this.setData({ scrollTop: 0 });
    });
  },

  async _goToPage(targetPage) {
    if (
      this._paging
      || !Number.isFinite(targetPage)
      || targetPage < 1
      || targetPage > this.data.totalPages
      || targetPage === this.data.currentPage
    ) return;

    this._paging = true;
    this._scrollToTop();
    try {
      const pagedList = this._applyFilter(this.data.activeFilter, this.data.catList, targetPage);
      await this._refreshPhotoURLs(pagedList);
    } finally {
      this._paging = false;
    }
  },

  changePage(event) {
    const targetPage = Number(event.currentTarget.dataset.page);
    this._goToPage(targetPage);
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
      imageUrl: APP_SHARE_IMAGE,
    };
  },

  onShareTimeline() {
    return {
      title: '我的猫卡｜收集城市里的每一只猫',
      query: 'from=timeline',
      imageUrl: APP_SHARE_IMAGE,
    };
  },
});
