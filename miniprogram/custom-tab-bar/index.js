const TAB_LIST = [
  {
    pagePath: '/pages/index/index',
    iconPath: '/assets/tab-encounter.png',
    selectedIconPath: '/assets/tab-encounter-active.png',
  },
  {
    pagePath: '/pages/collection/collection',
    iconPath: '/assets/tab-album.png',
    selectedIconPath: '/assets/tab-album-active.png',
  },
  {
    pagePath: '/pages/my/my',
    iconPath: '/assets/tab-profile.png',
    selectedIconPath: '/assets/tab-profile-active.png',
  },
];

Component({
  data: {
    selected: 0,
    list: TAB_LIST,
    showException: false,
    exceptionPath: '',
  },

  // 每个 tab 页面都有自己的自定义 tabBar 实例。切换完成后由目标页面
  // 的 onShow 和这里的 pageLifetimes.show 共同校准选中态，避免旧页面
  // 的异步回调覆盖新页面状态。
  pageLifetimes: {
    show() {
      const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
      const currentPage = pages[pages.length - 1];
      const currentPath = currentPage && currentPage.route
        ? `/${currentPage.route}`
        : '';
      const selected = TAB_LIST.findIndex(item => item.pagePath === currentPath);

      if (selected >= 0 && selected !== this.data.selected) {
        this.setData({ selected });
      }
    },
  },

  methods: {
    switchTab(event) {
      const dataset = event && event.currentTarget ? event.currentTarget.dataset : {};
      const index = Number(dataset.index);
      const item = this.data.list[index];
      if (!item || index === this.data.selected) return;

      this._switchToPath(item.pagePath);
    },

    _switchToPath(pagePath) {
      wx.switchTab({
        url: pagePath,
        fail: (error) => {
          console.error('[TabBar] 切换失败:', error);
          this.setData({
            showException: true,
            exceptionPath: pagePath,
          });
        },
      });
    },

    onExceptionPrimary() {
      const path = this.data.exceptionPath;
      this.setData({ showException: false, exceptionPath: '' });
      if (path) this._switchToPath(path);
    },
  },
});
