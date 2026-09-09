// 猫友图鉴：只读取公开且已生成猫生图的猫卡。
const deviceLayout = require('../../utils/deviceLayout');
const PAGE_SIZE = 12;

function trimString(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function getResult(response) {
  return response && response.result ? response.result : response;
}

function callCatFriends(page = 1) {
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    return Promise.reject(new Error('云端服务暂时不可用'));
  }

  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: 'cat-friends',
      data: {
        action: 'list',
        page,
        pageSize: PAGE_SIZE,
      },
      success(response) {
        const result = getResult(response);
        if (!result || result.ok !== true) {
          const error = new Error(result && result.message || '猫友图鉴暂时打不开');
          error.code = result && result.code || 'CAT_FRIENDS_FAILED';
          reject(error);
          return;
        }
        resolve(result);
      },
      fail: reject,
    });
  });
}

function normalizeCat(item) {
  const source = item && typeof item === 'object' ? item : {};
  const sourceType = trimString(source.sourceType, 20).toLowerCase() === 'live'
    ? 'live'
    : 'photo';
  const score = Number(source.overallScore);
  return {
    ...source,
    publicCatId: trimString(source.publicCatId, 128),
    displayName: trimString(source.displayName || '未命名猫卡', 40),
    description: trimString(source.description, 120),
    posterCopy: trimString(source.posterCopy, 52),
    levelCode: trimString(source.levelCode || 'C', 4),
    levelLabel: trimString(source.levelLabel || '街角', 12),
    overallScore: Number.isFinite(score) ? Math.round(score) : null,
    scoreText: Number.isFinite(score) ? String(Math.round(score)) : '--',
    recordCount: Math.max(1, Number(source.recordCount) || 1),
    sourceType,
    sourceLabel: sourceType === 'live' ? '拍摄记录' : '相册记录',
    coverTempURL: trimString(source.coverTempURL, 2048),
    createdText: source.coverCreatedAt
      ? String(source.coverCreatedAt).slice(0, 10).replace(/-/g, '.')
      : '',
  };
}

Page({
  data: {
    cats: [],
    total: 0,
    pageSize: PAGE_SIZE,
    currentPage: 1,
    totalPages: 1,
    isRefreshing: false,
    loading: false,
    hasLoaded: false,
    error: '',
    pageError: '',
    scrollTop: 0,
    pageHeaderTop: 48,
    headerRightInset: 0,
    showException: false,
    exceptionEyebrow: '猫友图鉴',
    exceptionTitle: '猫咪们挤在门口',
    exceptionMessage: '先歇一会儿，等它们排好队再来看看。',
    exceptionPrimaryText: '重新加载',
  },

  onLoad() {
    this._syncDeviceLayout();
    // 首次进入页面直接拉取第一页，避免只依赖 onShow 导致首屏停留在 0 / 0。
    this._loadCats(1);
  },

  onShow() {
    this._syncDeviceLayout();
    this._syncTabBar();
    if (!this.data.hasLoaded && !this._loading) this._loadCats(1);
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
    // 猫友图鉴先作为“我的”页里的次级入口，不占用底部主导航。
    if (tabBar) tabBar.setData({ hidden: true });
  },

  async onPullDownRefresh() {
    if (this._refreshing) return;

    this._refreshing = true;
    this._scrollToTop();
    this.setData({ isRefreshing: true });
    try {
      await this._loadCats(1);
    } finally {
      this._refreshing = false;
      this.setData({ isRefreshing: false });
    }
  },

  async onScrollToLower() {
    if (
      this._loading
      || !this.data.hasLoaded
      || this.data.currentPage >= this.data.totalPages
    ) return;
    await this._loadCats(this.data.currentPage + 1);
  },

  async _loadCats(page = 1) {
    if (this._loading) return;
    const requestedPage = Math.max(1, Math.floor(Number(page)) || 1);
    this._loading = true;
    this.setData({
      loading: true,
      error: '',
      pageError: '',
      showException: false,
    });
    try {
      const result = await callCatFriends(requestedPage);
      const resultPage = Number(result.page);
      const cats = Array.isArray(result.cats)
        ? result.cats.map(normalizeCat).filter(cat => cat.coverTempURL && cat.publicCatId)
        : [];
      const total = Number(result.total);
      const safeTotal = Number.isFinite(total) && total >= 0 ? total : cats.length;
      const totalPages = Math.max(Math.ceil(safeTotal / PAGE_SIZE), 1);
      const currentPage = Math.min(
        Math.max(
          Math.floor(Number.isFinite(resultPage) ? resultPage : requestedPage) || 1,
          1,
        ),
        totalPages,
      );
      this.setData({
        cats,
        total: safeTotal,
        currentPage,
        totalPages,
        hasLoaded: true,
        loading: false,
        error: '',
        pageError: '',
      });
    } catch (error) {
      console.error('[CatFriends] 公共猫友图鉴加载失败:', error);
      this.setData({
        hasLoaded: true,
        loading: false,
        error: this.data.cats.length ? '' : '猫咪们暂时挤在门口，请稍后再来。',
        pageError: this.data.cats.length
          ? `第 ${requestedPage} 页暂时打不开，请再试一次。`
          : '',
        exceptionMessage: error && error.message
          ? String(error.message).slice(0, 100)
          : '猫友图鉴正在整理中，请稍后再试。',
      });
    } finally {
      this._loading = false;
    }
  },

  retryLoad() {
    this._loadCats(this.data.currentPage || 1);
  },

  _scrollToTop() {
    this.setData({ scrollTop: 1 }, () => {
      this.setData({ scrollTop: 0 });
    });
  },

  changePage(event) {
    if (this._loading) return;
    const targetPage = Number(event && event.currentTarget && event.currentTarget.dataset.page);
    if (!Number.isFinite(targetPage)
      || targetPage < 1
      || targetPage > this.data.totalPages
      || targetPage === this.data.currentPage) {
      return;
    }

    // 翻页后回到列表顶部，避免新一页从上一页的滚动位置开始展示。
    this._scrollToTop();
    this._loadCats(targetPage);
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/my/my' }),
    });
  },

  openCatArchive(event) {
    const publicCatId = trimString(
      event && event.currentTarget && event.currentTarget.dataset.publicCatId,
      128,
    );
    if (!publicCatId) {
      wx.showToast({ title: '猫咪档案暂不可用', icon: 'none', duration: 1600 });
      return;
    }

    wx.navigateTo({
      url: `/pages/card-detail/card-detail?publicCatId=${encodeURIComponent(publicCatId)}&from=friends`,
    });
  },

  onExceptionPrimary() {
    this.setData({ showException: false });
    this._loadCats(this.data.currentPage || 1);
  },

  onShareAppMessage() {
    return {
      title: '来猫友图鉴，看看街角遇见的猫',
      path: '/pages/cat-friends/cat-friends',
    };
  },
});
