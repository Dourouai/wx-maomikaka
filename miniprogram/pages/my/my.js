// pages/my/my.js
const storage = require('../../utils/storage');
const userData = require('../../utils/userData');
const cloudFiles = require('../../utils/cloudFiles');
const { ALL_CATS } = require('../../utils/catData');
const memberLevel = require('../../utils/memberLevel');
const deviceLayout = require('../../utils/deviceLayout');

Page({
  data: {
    isLoggedIn: false,
    unlockedCount: 0,
    totalCount: ALL_CATS.length,
    todayCount: 0,
    streakDays: 0,
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
    profileAvatar: '',
    profileName: '猫咪观察员',
    syncBusy: false,
    syncKicker: 'ACCOUNT / ARCHIVE',
    syncTitle: '绑定当前微信账号',
    syncSubtitle: '把本机的相遇记录安全同步到云端',
    syncActionText: '开始同步',
    syncPendingCount: 0,
    isOpeningCamera: false,
    showException: false,
    exceptionEyebrow: '相遇入口',
    exceptionTitle: '',
    exceptionMessage: '',
    exceptionPrimaryText: '再试一次',
    showFeedbackContact: false,
    feedbackWechatId: 'CloudCollect',
    pageHeaderTop: 48,
    headerRightInset: 0,
  },

  onLoad(options) {
    this._syncDeviceLayout();
    // 仅用于设计验收：my?preview=guest 强制展示未登录态，不改变本地账号绑定状态。
    this.previewGuest = String((options && (options.preview || options.state)) || '').toLowerCase() === 'guest';
  },

  onShow() {
    this._syncDeviceLayout();
    this._refreshProfile();
    this._refreshData();
    this._refreshSyncState();
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
    if (tabBar) {
      tabBar.setData({
        selected: 2,
        hidden: false,
      });
    }
  },

  _refreshProfile() {
    const profile = storage.getUserProfile();
    this.setData({
      profileAvatar: profile.avatarUrl || '',
      profileName: profile.nickName || '猫咪观察员',
    });

    if (!profile.avatarFileID) return;
    cloudFiles.getTempFileURL(profile.avatarFileID).then(avatarUrl => {
      if (!avatarUrl) return;
      storage.setUserProfile({ avatarUrl });
      this.setData({ profileAvatar: avatarUrl });
    }).catch(() => {
      // 头像临时地址失效时保留本地头像或默认头像，不影响账号登录和记录同步。
    });
  },

  _uploadAvatar(filePath) {
    if (!filePath || !wx.cloud || typeof wx.cloud.uploadFile !== 'function') {
      return Promise.resolve('');
    }

    const cloudPath = `user-profile/avatar/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`;
    return new Promise((resolve, reject) => {
      wx.cloud.uploadFile({
        cloudPath,
        filePath,
        success: response => resolve(response && response.fileID ? response.fileID : ''),
        fail: reject,
      });
    });
  },

  onChooseAvatar(event) {
    const avatarUrl = String(event && event.detail && event.detail.avatarUrl || '').trim();
    if (!avatarUrl) {
      this.onBindAccount();
      return;
    }

    const profile = storage.setUserProfile({ avatarUrl }, { replaceAvatar: true });
    this.setData({ profileAvatar: avatarUrl });
    this.onBindAccount(profile);
  },

  _refreshData() {
    const records = storage.getAllRecords();
    const collection = storage.getCollection();
    const stats = storage.getUserStats();
    const membership = memberLevel.getMemberLevel(stats.pawGrowth);
    const today = this._dateKey(Date.now());

    const unlockedCount = Object.keys(collection).filter(catId =>
        collection[catId] && collection[catId].unlocked
      ).length;
    const totalCount = this.data.totalCount;

    this.setData({
      unlockedCount,
      todayCount: records.filter(record => this._dateKey(record.createdAt) === today).length,
      streakDays: this._getStreakDays(records),
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
    });
  },

  _refreshSyncState() {
    const state = storage.getSyncState();
    const summary = storage.getSyncSummary();
    const pendingText = summary.pendingRecords > 0
      ? `还有 ${summary.pendingRecords} 条相遇记录待同步`
      : '本机相遇记录已同步';
    let syncTitle = '绑定当前微信账号';
    let syncSubtitle = summary.totalRecords > 0
      ? `发现 ${summary.totalRecords} 条本机记录，绑定后可在其他设备查看`
      : '把本机的相遇记录安全同步到云端';
    let syncActionText = '开始同步';

    if (state.status === 'syncing') {
      syncTitle = '正在同步我的相遇';
      syncSubtitle = '请稍等，正在整理猫咪档案和相遇记录';
      syncActionText = '同步中';
    } else if (state.userBound && state.status === 'synced') {
      syncTitle = '已绑定当前微信账号';
      syncSubtitle = pendingText;
      syncActionText = summary.pendingRecords > 0 ? '继续同步' : '刷新云端';
    } else if (state.userBound) {
      syncTitle = '继续同步相遇记录';
      syncSubtitle = state.lastSyncError || pendingText;
      syncActionText = '重试同步';
    }

    const isLoggedIn = !this.previewGuest && state.userBound === true;
    this.setData({
      isLoggedIn,
      syncTitle,
      syncSubtitle,
      syncActionText,
      syncPendingCount: summary.pendingRecords,
    }, () => this._syncTabBar());
  },

  _confirmLocalImport(recordCount, accountChanged) {
    return new Promise(resolve => {
      wx.showModal({
        title: accountChanged ? '切换账号，绑定本机记录' : '绑定我的相遇',
        content: accountChanged
          ? `检测到当前微信账号发生变化。这台设备已有 ${recordCount} 条本地记录，是否将它们绑定到当前账号？`
          : `这台设备已有 ${recordCount} 条相遇记录。绑定后会同步到当前微信账号，是否继续？`,
        confirmText: '同步',
        cancelText: '先不绑定',
        success: response => resolve(response && response.confirm === true),
        fail: () => resolve(false),
      });
    });
  },

  async onBindAccount(profileOverride) {
    if (this.data.syncBusy) return;

    this.setData({ syncBusy: true });
    this._refreshSyncState();
    try {
      const summary = storage.getSyncSummary();
      const accountCheck = await userData.checkAccount();
      const state = storage.getSyncState();
      const accountChanged = accountCheck.accountChanged === true || state.accountChanged === true;
      let profile = profileOverride || storage.getUserProfile();
      if (profileOverride && profileOverride.avatarUrl) {
        try {
          const avatarFileID = await this._uploadAvatar(profileOverride.avatarUrl);
          if (avatarFileID) {
            profile = storage.setUserProfile({
              avatarUrl: profileOverride.avatarUrl,
              avatarFileID,
            }, { replaceAvatar: true });
          }
        } catch (error) {
          // 云头像上传失败时仍允许账号登录，当前设备继续使用临时头像。
        }
      }
      let markConsent = false;
      const needsConsent = summary.totalRecords > 0
        && (!state.userBound || accountChanged || !state.importConsentAt);
      if (needsConsent) {
        const confirmed = await this._confirmLocalImport(summary.totalRecords, accountChanged);
        if (!confirmed) return;
        markConsent = true;
      } else if (!state.importConsentAt) {
        markConsent = true;
      }

      const result = await userData.syncLocalData({
        force: true,
        source: state.userBound && !accountChanged ? 'capture' : 'guest-import',
        markConsent,
        profile,
      });
      this._refreshData();
      this._refreshSyncState();
      const importedCount = Number(result.importedCount) || 0;
      const mergedCount = Number(result.mergedCount) || 0;
      const visibleCount = importedCount || mergedCount;
      const title = visibleCount
        ? `已同步 ${visibleCount} 条记录`
        : (result.rejected && result.rejected.length ? '账号已绑定，部分记录待重试' : '账号已绑定');
      wx.showToast({ title, icon: 'success', duration: 1600 });
    } catch (error) {
      console.error('[My] 用户数据同步失败:', error);
      this._refreshSyncState();
      wx.showToast({
        title: this._getSyncErrorMessage(error),
        icon: 'none',
        duration: 2200,
      });
    } finally {
      this.setData({ syncBusy: false });
      this._refreshSyncState();
    }
  },

  _getSyncErrorMessage(error) {
    const code = error && error.code;
    if (code === 'CLOUD_NOT_READY') return '云端服务暂时不可用';
    if (code === 'IDENTITY_UNAVAILABLE') return '当前微信身份暂时不可用';
    if (code === 'ACCOUNT_CHANGED_REQUIRES_CONFIRMATION') return '请确认当前设备记录的绑定关系';
    if (code === 'DATABASE_PERMISSION_DENIED') return '云端档案权限不足';
    return '同步没有完成，请稍后重试';
  },

  onShareAppMessage() {
    return {
      title: '我的猫咪相遇记录｜猫咪咔咔',
      path: '/pages/my/my?from=share',
    };
  },

  onShareTimeline() {
    return {
      title: '我的猫咪相遇记录｜留下每一次遇见',
      query: 'from=timeline',
    };
  },

  _dateKey(timestamp) {
    const date = new Date(timestamp || Date.now());
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  },

  _getStreakDays(records) {
    const days = Array.from(new Set(records.map(record => this._dateKey(record.createdAt))))
      .sort()
      .reverse();
    if (!days.length) return 0;

    let streak = 1;
    for (let index = 1; index < days.length; index += 1) {
      const previous = days[index - 1].split('-').map(Number);
      const current = days[index].split('-').map(Number);
      const previousTime = Date.UTC(previous[0], previous[1] - 1, previous[2]);
      const currentTime = Date.UTC(current[0], current[1] - 1, current[2]);
      if (previousTime - currentTime !== 86400000) break;
      streak += 1;
    }
    return streak;
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

  goHome() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  goProfile() {
    wx.navigateTo({
      url: '/pages/profile/profile',
      fail: () => wx.showToast({ title: '个人主页暂时打不开', icon: 'none' }),
    });
  },

  goPrivacy() {
    wx.navigateTo({
      url: '/pages/privacy/privacy',
      fail: () => {
        this.setData({
          showException: true,
          exceptionTitle: '隐私条款没打开',
          exceptionMessage: '页面暂时没有准备好，请稍后再试',
        });
      },
    });
  },

  goAbout() {
    wx.navigateTo({
      url: '/pages/about/about',
      fail: () => {
        this.setData({
          showException: true,
          exceptionTitle: '关于页面没打开',
          exceptionMessage: '页面暂时没有准备好，请稍后再试',
        });
      },
    });
  },

  showFeedbackContact() {
    this.setData({
      showFeedbackContact: true,
      feedbackWechatId: 'CloudCollect',
    });
  },

  stopFeedbackPropagation() {},

  closeFeedbackContact() {
    this.setData({ showFeedbackContact: false });
  },

  copyFeedbackContact() {
    const wechatId = this.data.feedbackWechatId || 'CloudCollect';
    this.setData({ showFeedbackContact: false });
    wx.setClipboardData({
      data: wechatId,
      success: () => {
        wx.showToast({ title: '微信号已复制', icon: 'success', duration: 1400 });
      },
      fail: () => {
        wx.showToast({ title: '复制失败，请手动添加', icon: 'none', duration: 1800 });
      },
    });
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
