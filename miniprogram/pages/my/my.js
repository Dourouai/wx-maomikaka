// pages/my/my.js
const storage = require('../../utils/storage');
const userData = require('../../utils/userData');
const cloudFiles = require('../../utils/cloudFiles');
const virtualPayment = require('../../utils/virtualPayment');
const { ALL_CATS } = require('../../utils/catData');
const memberLevel = require('../../utils/memberLevel');
const deviceLayout = require('../../utils/deviceLayout');

const DAILY_CAN_LIMIT = 3;
const APP_SHARE_IMAGE = '/assets/maomi-kaka-logo-square-144.png';
const TEST_RECHARGE_PLAN_ID = 'can_001';
const PRODUCTION_RECHARGE_PLANS = [
  {
    id: 'can_1',
    canAmount: 1,
    priceYuan: '1',
    priceText: '¥1',
    note: '1 个罐罐',
    tag: '',
  },
  {
    id: 'can_10',
    canAmount: 10,
    priceYuan: '9',
    priceText: '¥9',
    note: '10 个罐罐',
    tag: '更划算',
  },
  {
    id: 'can_30',
    canAmount: 30,
    priceYuan: '29',
    priceText: '¥29',
    note: '30 个罐罐',
    tag: '最划算',
  },
];
const TEST_RECHARGE_PLAN = {
  id: TEST_RECHARGE_PLAN_ID,
  canAmount: 1,
  priceYuan: '0.01',
  priceText: '¥0.01',
  note: '1 个罐罐',
  tag: '内测',
};

const PLACEHOLDER_NICKNAMES = new Set(['微信用户']);

function normalizeProfileNickname(value) {
  const normalized = String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!normalized || PLACEHOLDER_NICKNAMES.has(normalized.toLowerCase())) return '';
  return Array.from(normalized).slice(0, 40).join('');
}

function getRechargePlans(testPlanEnabled) {
  return testPlanEnabled
    ? [TEST_RECHARGE_PLAN].concat(PRODUCTION_RECHARGE_PLANS)
    : PRODUCTION_RECHARGE_PLANS;
}

function normalizeTestPlanEnabled(value) {
  if (value === true || value === 1) return true;
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function getAvatarPath(value) {
  const path = String(value || '').trim();
  // 先允许微信头像外链参与展示；若微信侧网络域名未配置，image error 会回退到 Logo。
  return path;
}

Page({
  data: {
    isLoggedIn: false,
    unlockedCount: 0,
    totalCount: ALL_CATS.length,
    todayCount: 0,
    dailyCanLimit: DAILY_CAN_LIMIT,
    dailyRemainingCans: DAILY_CAN_LIMIT,
    purchasedCanBalance: 0,
    remainingCans: 3,
    canUsageTotal: 0,
    pointBalance: 0,
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
    showProfileAuth: false,
    profileAuthBusy: false,
    profileAuthTitle: '设置资料',
    profileAuthSubtitle: '选择头像和昵称，审核后保存到你的猫咪档案',
    profileAuthConfirmText: '保存资料',
    profileAuthAvatarUrl: '',
    profileAuthAvatarFileID: '',
    profileAuthAvatarChanged: false,
    profileAuthNickname: '',
    syncBusy: false,
    syncKicker: 'ACCOUNT / ARCHIVE',
    syncTitle: '绑定当前微信账号',
    syncSubtitle: '把本机的相遇记录安全同步到云端',
    syncActionText: '开始同步',
    syncPendingCount: 0,
    showSyncEntry: false,
    isOpeningCamera: false,
    showException: false,
    exceptionEyebrow: '相遇入口',
    exceptionTitle: '',
    exceptionMessage: '',
    exceptionPrimaryText: '再试一次',
    showFeedbackContact: false,
    showCanRecharge: false,
    testPlanEnabled: false,
    paymentEnvironment: null,
    rechargePlans: getRechargePlans(false),
    selectedRechargePlanId: 'can_30',
    selectedRechargePrice: '29',
    selectedRechargeCanAmount: 30,
    rechargeBusy: false,
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
    this._refreshRemoteCanBalance();
    this._refreshSyncState();

    const app = typeof getApp === 'function' ? getApp() : null;
    if (app && app.globalData && app.globalData.openCanRecharge) {
      app.globalData.openCanRecharge = false;
      this.setData({ showCanRecharge: true });
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
    if (tabBar) {
      tabBar.setData({
        selected: 2,
        hidden: false,
      });
    }
  },

  onAvatarError() {
    // 微信头像外链或云端临时地址失效时，交给 WXML 展示品牌 Logo。
    if (this.data.profileAvatar) this.setData({ profileAvatar: '' });
  },

  _refreshProfile() {
    const profile = storage.getUserProfile();
    this.setData({
      profileAvatar: profile.avatarFileID ? '' : getAvatarPath(profile.avatarUrl),
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

  _buildProfileForBinding(profileOverride) {
    const storedProfile = storage.getUserProfile();
    const profile = profileOverride && typeof profileOverride === 'object'
      ? { ...storedProfile, ...profileOverride }
      : { ...storedProfile };
    return profile;
  },

  _uploadAvatar(filePath) {
    if (!filePath || !wx.cloud || typeof wx.cloud.uploadFile !== 'function') {
      return Promise.resolve('');
    }

    const uploadLocalFile = localFilePath => {
      const cloudPath = `user-profile/avatar/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`;
      return new Promise((resolve, reject) => {
        wx.cloud.uploadFile({
          cloudPath,
          filePath: localFilePath,
          success: response => resolve(response && response.fileID ? response.fileID : ''),
          fail: reject,
        });
      });
    };

    const normalizedPath = String(filePath).trim();
    if (!/^https?:\/\//i.test(normalizedPath)) return uploadLocalFile(normalizedPath);
    if (typeof wx.downloadFile !== 'function') return Promise.resolve('');

    // 微信头像填写能力返回临时文件路径；若是旧版本返回网络地址，先下载再上传云存储。
    return new Promise((resolve, reject) => {
      wx.downloadFile({
        url: normalizedPath,
        success: response => {
          const tempFilePath = response && response.tempFilePath;
          if (!tempFilePath) {
            reject(new Error('微信头像下载失败'));
            return;
          }
          uploadLocalFile(tempFilePath).then(resolve, reject);
        },
        fail: reject,
      });
    });
  },

  _openProfileAuthSheet() {
    const profile = storage.getUserProfile();
    const avatarPreview = this.data.profileAvatar || (
      profile.avatarFileID ? '' : getAvatarPath(profile.avatarUrl)
    );
    this.setData({
      showProfileAuth: true,
      profileAuthBusy: false,
      profileAuthTitle: '设置资料',
      profileAuthSubtitle: '选择头像和昵称，审核后保存到你的猫咪档案',
      profileAuthConfirmText: '保存资料',
      profileAuthAvatarUrl: avatarPreview,
      profileAuthAvatarFileID: profile.avatarFileID || '',
      profileAuthAvatarChanged: false,
      profileAuthNickname: profile.nickName || '',
    });
  },

  onLoginTap() {
    if (this.data.syncBusy || this.data.profileAuthBusy || this.data.showProfileAuth) return;
    // 登录只建立微信账号身份，不读取微信头像和昵称；资料由资料卡上的设置按钮主动保存。
    this.onBindAccount(null, { loginOnly: true });
  },

  onProfileSettingsTap() {
    if (!this.data.isLoggedIn || this.data.syncBusy || this.data.profileAuthBusy || this.data.showProfileAuth) return;
    this._openProfileAuthSheet();
  },

  onChooseAvatar(event) {
    const avatarUrl = String(event && event.detail && event.detail.avatarUrl || '').trim();
    if (this.data.showProfileAuth) {
      if (!avatarUrl) {
        wx.showToast({ title: '没有拿到头像，请重新选择', icon: 'none', duration: 1600 });
        return;
      }
      this.setData({
        profileAuthAvatarUrl: avatarUrl,
        profileAuthAvatarFileID: '',
        profileAuthAvatarChanged: true,
      });
      return;
    }
  },

  onNicknameInput(event) {
    const value = normalizeProfileNickname(event && event.detail && event.detail.value);
    if (this.data.showProfileAuth) this.setData({ profileAuthNickname: value });
  },

  stopProfileAuthPropagation() {},

  onProfileAuthCancel() {
    if (this.data.profileAuthBusy) return;
    this.setData({
      showProfileAuth: false,
      profileAuthAvatarUrl: '',
      profileAuthAvatarFileID: '',
      profileAuthAvatarChanged: false,
      profileAuthNickname: '',
    });
  },

  async onProfileAuthConfirm() {
    if (this.data.profileAuthBusy || this.data.syncBusy) return;

    const nickName = normalizeProfileNickname(this.data.profileAuthNickname);
    const avatarUrl = String(this.data.profileAuthAvatarUrl || '').trim();
    const avatarFileID = String(this.data.profileAuthAvatarFileID || '').trim();
    if (!nickName) {
      wx.showToast({ title: '请填写昵称', icon: 'none', duration: 1800 });
      return;
    }
    if (!avatarUrl && !avatarFileID) {
      wx.showToast({ title: '请先选择头像', icon: 'none', duration: 1800 });
      return;
    }

    this.setData({ profileAuthBusy: true });
    try {
      let savedAvatarFileID = avatarFileID;
      if (this.data.profileAuthAvatarChanged) {
        savedAvatarFileID = await this._uploadAvatar(avatarUrl);
        if (!savedAvatarFileID) {
          const error = new Error('头像暂时无法保存');
          error.code = 'WECHAT_AVATAR_UNAVAILABLE';
          throw error;
        }
      }

      const profile = this._buildProfileForBinding({
        nickName,
        avatarUrl,
        avatarFileID: savedAvatarFileID,
      });
      // 资料设置走独立的同步链路：云函数先审核昵称和头像，再写入用户档案。
      await userData.syncWechatProfile(profile);
      const savedProfile = storage.setUserProfile(profile, { replaceAvatar: true });
      this.setData({
        profileAvatar: savedProfile.avatarFileID ? '' : getAvatarPath(savedProfile.avatarUrl),
        profileName: savedProfile.nickName || '猫咪观察员',
        showProfileAuth: false,
      });
      this._refreshProfile();
      wx.showToast({ title: '资料已保存', icon: 'success', duration: 1600 });
    } catch (error) {
      console.error('[My] 微信资料保存失败:', error);
      wx.showToast({
        title: this._getProfileSaveErrorMessage(error),
        icon: 'none',
        duration: 2200,
      });
    } finally {
      this.setData({ profileAuthBusy: false });
    }
  },

  onSyncTap() {
    if (this.data.syncBusy || this.data.profileAuthBusy || this.data.showProfileAuth) return;
    // 记录同步不再触发微信资料采集；资料设置由资料卡上的按钮单独进入。
    this.onBindAccount();
  },

  _refreshData() {
    const records = storage.getAllRecords();
    const collection = storage.getCollection();
    const stats = storage.getUserStats();
    const quota = storage.getCanQuota();
    const membership = memberLevel.getMemberLevel(stats.pawGrowth);

    const unlockedCount = Object.keys(collection).filter(catId =>
        collection[catId] && collection[catId].unlocked
      ).length;
    const totalCount = this.data.totalCount;
    this.setData({
      unlockedCount,
      todayCount: quota.todayCount,
      dailyRemainingCans: quota.dailyRemainingCans,
      purchasedCanBalance: quota.purchasedCanBalance,
      remainingCans: quota.remainingCans,
      canUsageTotal: records.length,
      pointBalance: Math.max(0, Math.floor(Number(stats.pointBalance) || 0)),
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

  async _refreshRemoteCanBalance() {
    try {
      const result = await virtualPayment.getBalance();
      const purchasedCanBalance = Number(result && result.purchasedCanBalance);
      const paymentEnvironment = Number(result && result.paymentEnv);
      // 测试套餐只由云函数返回的显式开关控制；沙箱环境本身不应自动展示 ¥0.01。
      const testPlanEnabled = normalizeTestPlanEnabled(result && result.testPlanEnabled);
      const nextPlans = getRechargePlans(testPlanEnabled);
      const shouldSelectTestPlan = testPlanEnabled && !this.data.testPlanEnabled;
      const selectedPlanId = shouldSelectTestPlan
        ? TEST_RECHARGE_PLAN_ID
        : this.data.selectedRechargePlanId;
      const selectedPlan = nextPlans.find(plan => plan.id === selectedPlanId) || nextPlans[0];
      this.setData({
        testPlanEnabled,
        paymentEnvironment: Number.isFinite(paymentEnvironment) ? paymentEnvironment : null,
        rechargePlans: nextPlans,
        selectedRechargePlanId: selectedPlan.id,
        selectedRechargePrice: selectedPlan.priceYuan,
        selectedRechargeCanAmount: selectedPlan.canAmount,
      });
      console.info('[My] 罐罐套餐配置:', {
        testPlanEnabled,
        paymentEnv: Number.isFinite(paymentEnvironment) ? paymentEnvironment : null,
      });
      if (!Number.isFinite(purchasedCanBalance)) return;
      storage.mergeRemoteStats({ purchasedCanBalance });
      this._refreshData();
    } catch (error) {
      // 支付云函数尚未部署或暂时不可用时，继续展示本地缓存，不打断“我的”页面。
      // 测试套餐默认关闭，读取开关失败时保持关闭，避免误展示测试价格。
      if (this.data.testPlanEnabled) {
        this.setData({ testPlanEnabled: false, rechargePlans: getRechargePlans(false) });
      }
      if (error && error.code !== 'FUNCTION_NOT_FOUND') {
        console.warn('[My] 购买罐罐余额刷新失败，测试套餐未启用:', error);
      }
    }
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
      showSyncEntry: isLoggedIn && summary.pendingRecords > 0,
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

  async onBindAccount(profileOverride, options = {}) {
    if (this.data.syncBusy) return;

    const bindingProfile = options.loginOnly ? null : this._buildProfileForBinding(profileOverride);
    this.setData({ syncBusy: true });
    this._refreshSyncState();
    try {
      const summary = storage.getSyncSummary();
      const accountCheck = await userData.checkAccount();
      const state = storage.getSyncState();
      const accountChanged = accountCheck.accountChanged === true || state.accountChanged === true;

      if (options.loginOnly) {
        await userData.bootstrap({ bindData: true, skipProfile: true });
        let remoteRestoreFailed = false;
        try {
          // 登录不采集微信头像/昵称，但要把清缓存后仍存在云端的猫卡恢复到本机。
          await userData.refreshRemoteData();
        } catch (error) {
          remoteRestoreFailed = true;
          console.warn('[My] 登录后恢复云端档案失败:', {
            code: error && (error.code || error.errCode)
              ? String(error.code || error.errCode)
              : '',
            message: error && (error.message || error.errMsg)
              ? String(error.message || error.errMsg)
              : '',
          });
        }
        this._refreshData();
        this._refreshProfile();
        this._refreshSyncState();
        wx.showToast({
          title: remoteRestoreFailed ? '登录成功，云端档案稍后刷新' : '登录成功',
          icon: 'success',
          duration: 1600,
        });
        return;
      }

      let profile = bindingProfile;
      if (profileOverride && profileOverride.avatarUrl && !profileOverride.avatarFileID) {
        try {
          const avatarFileID = await this._uploadAvatar(profileOverride.avatarUrl);
          if (avatarFileID) {
            profile = storage.setUserProfile({
              avatarUrl: profileOverride.avatarUrl,
              avatarFileID,
              nickName: profile.nickName,
            }, { replaceAvatar: true });
          }
        } catch (error) {
          // 云头像上传失败时仍允许账号登录，页面使用默认头像兜底。
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
        nicknameSource: options.nicknameSource,
      });
      this._refreshData();
      this._refreshProfile();
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
    if (code === 'WECHAT_PROFILE_REQUIRED') return '同步时请填写微信昵称和头像';
    if (code === 'NICKNAME_RISKY') return '昵称包含不适宜内容，请更换后重试';
    if (code === 'NICKNAME_CHECK_UNAVAILABLE') return '昵称审核暂时不可用，请稍后重试';
    if (code === 'ACCOUNT_CHANGED_REQUIRES_CONFIRMATION') return '请确认当前设备记录的绑定关系';
    if (code === 'DATABASE_PERMISSION_DENIED') return '云端档案权限不足';
    return '同步没有完成，请稍后重试';
  },

  _getProfileSaveErrorMessage(error) {
    const code = error && error.code;
    if (code === 'NICKNAME_RISKY' || code === 'AVATAR_RISKY') return '资料包含不适宜内容，请更换后重试';
    if (code === 'NICKNAME_CHECK_UNAVAILABLE' || code === 'AVATAR_CHECK_UNAVAILABLE') return '内容审核暂时不可用，请稍后重试';
    if (code === 'AVATAR_INVALID' || code === 'AVATAR_TOO_LARGE') return '头像格式不可用，请重新选择';
    if (code === 'WECHAT_AVATAR_UNAVAILABLE') return '头像保存失败，请重新选择';
    if (code === 'USER_NOT_BOUND') return '请先登录当前微信账号';
    if (code === 'CLOUD_NOT_READY') return '云端服务暂时不可用';
    return '资料保存失败，请稍后重试';
  },

  onShareAppMessage() {
    return {
      title: '我的猫咪相遇记录｜猫咪咔咔',
      path: '/pages/my/my?from=share',
      imageUrl: APP_SHARE_IMAGE,
    };
  },

  onShareTimeline() {
    return {
      title: '我的猫咪相遇记录｜留下每一次遇见',
      query: 'from=timeline',
      imageUrl: APP_SHARE_IMAGE,
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

  goCatFriends() {
    wx.navigateTo({
      url: '/pages/cat-friends/cat-friends',
      fail: () => wx.showToast({ title: '猫友图鉴暂时打不开', icon: 'none' }),
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

  openCanHistoryPage() {
    wx.navigateTo({
      url: '/pages/can-history/can-history',
      fail: () => wx.showToast({ title: '记录页面暂时打不开', icon: 'none' }),
    });
  },

  async openCanRecharge() {
    // 充值面板打开前再取一次开关，避免 onShow 的异步请求尚未完成时只展示正式套餐。
    await this._refreshRemoteCanBalance();
    this.setData({ showCanRecharge: true });
  },

  closeCanRecharge() {
    if (this.data.rechargeBusy) return;
    this.setData({ showCanRecharge: false });
  },

  selectRechargePlan(event) {
    if (this.data.rechargeBusy) return;
    const planId = String(event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.planId || '');
    const plan = this.data.rechargePlans.find(item => item.id === planId);
    if (!plan) return;
    this.setData({
      selectedRechargePlanId: plan.id,
      selectedRechargePrice: plan.priceYuan,
      selectedRechargeCanAmount: plan.canAmount,
    });
  },

  _getPaymentPlatform() {
    if (typeof wx === 'undefined' || typeof wx.getDeviceInfo !== 'function') return '';
    const deviceInfo = wx.getDeviceInfo();
    const platform = String(deviceInfo && deviceInfo.platform || '').toLowerCase();
    return ['android', 'ios'].includes(platform) ? platform : '';
  },

  _showPaymentNotice(title, content) {
    wx.showModal({
      title: title || '充值暂不可用',
      content: content || '充值服务暂时不可用，请稍后再试',
      confirmText: '知道了',
      showCancel: false,
    });
  },

  _getPaymentErrorMessage(error) {
    const code = error && error.code;
    const errCode = Number(error && error.errCode);
    const rawMessage = String(error && (error.errMsg || error.message) || '');
    if (code === 'PAYMENT_NOT_CONFIGURED') {
      return '充值入口已预留，完成微信虚拟支付商品和发货通知配置后即可使用。';
    }
    if (
      code === 'FUNCTION_NOT_FOUND' ||
      /functionname.*(?:could not be found|not found)|function.*not found|云函数.*不存在/i.test(rawMessage)
    ) {
      return '充值服务还没有部署完成，请先部署虚拟支付云函数。';
    }
    if (code === 'PAYMENT_PLATFORM_UNSUPPORTED') {
      return '当前设备暂不支持虚拟支付，请在微信客户端重试。';
    }
    if (code === 'PAYMENT_TEST_PLAN_DISABLED') {
      return '这个测试套餐当前已关闭，请重新打开充值面板。';
    }
    if (/request(?:virtualpayment|payment):fail[^\n]*(?:no permission|access denied)/i.test(rawMessage)) {
      return '开发者工具无法完成虚拟支付，请点击“真机调试”并在手机微信中测试；真机仍失败时，请检查小程序是否已开通虚拟支付权限。';
    }
    if (errCode === -15011 || /PAYMENT_ILLEGAL_IN_SANDBOX/i.test(rawMessage)) {
      return '沙箱支付参数或商品状态不匹配，请确认小程序已开通虚拟支付，并已在沙箱环境发布对应商品；同时核对沙箱 AppKey、OfferId、商品 ID 和价格。';
    }
    if (code === 'CLOUD_NOT_READY') return '云端服务暂时不可用，请稍后再试。';
    if (code === 'LOGIN_SESSION_FAILED' || code === 'IDENTITY_UNAVAILABLE') {
      return '当前微信登录状态不可用，请稍后重试。';
    }
    return '充值没有完成，请稍后重试。';
  },

  async confirmRecharge() {
    if (this.data.rechargeBusy) return;
    const planId = this.data.selectedRechargePlanId;
    const plan = this.data.rechargePlans.find(item => item.id === planId);
    if (!plan) return;

    if (typeof wx.requestVirtualPayment !== 'function') {
      this._showPaymentNotice('当前环境暂不支持', '请使用支持微信虚拟支付的微信客户端进行充值。');
      return;
    }

    this.setData({ rechargeBusy: true });
    try {
      const order = await virtualPayment.createOrder(plan.id, this._getPaymentPlatform());
      await new Promise((resolve, reject) => {
        wx.requestVirtualPayment({
          mode: order.mode || 'short_series_goods',
          signData: order.signData,
          paySig: order.paySig,
          signature: order.signature,
          success: resolve,
          fail: reject,
        });
      });

      this.setData({ showCanRecharge: false });
      wx.showToast({
        title: '支付已提交，到账后自动更新',
        icon: 'none',
        duration: 2200,
      });
      this._waitForRechargeDelivery(order.orderId);
    } catch (error) {
      const errCode = Number(error && error.errCode);
      const rawErrorMessage = String(error && (error.errMsg || error.message) || '');
      if (errCode === -2 || /cancel/i.test(rawErrorMessage)) {
        return;
      }
      const isPaymentConfigGap = Boolean(
        (error && error.code === 'PAYMENT_NOT_CONFIGURED') ||
        /functionname.*(?:could not be found|not found)|function.*not found|云函数.*不存在/i.test(rawErrorMessage)
      );
      if (isPaymentConfigGap) {
        console.warn('[My] 罐罐充值尚未部署或配置:', error);
      } else {
        console.error('[My] 罐罐充值失败:', error);
      }
      this._showPaymentNotice('充值未完成', this._getPaymentErrorMessage(error));
    } finally {
      this.setData({ rechargeBusy: false });
    }
  },

  _waitForRechargeDelivery(orderId) {
    const normalizedOrderId = String(orderId || '').trim();
    if (!normalizedOrderId) return;
    if (this._rechargePollTimer) clearTimeout(this._rechargePollTimer);

    let attempts = 0;
    const poll = async () => {
      attempts += 1;
      try {
        const result = await virtualPayment.getBalance();
        const purchasedCanBalance = Number(result && result.purchasedCanBalance);
        const deliveredOrderIds = Array.isArray(result && result.deliveredOrderIds)
          ? result.deliveredOrderIds.map(item => String(item))
          : [];
        if (Number.isFinite(purchasedCanBalance)) {
          storage.mergeRemoteStats({ purchasedCanBalance });
          this._refreshData();
        }
        if (deliveredOrderIds.includes(normalizedOrderId)) {
          wx.showToast({ title: '罐罐已到账', icon: 'success', duration: 1600 });
          return;
        }
      } catch (error) {
        if (attempts >= 6) return;
      }

      if (attempts < 6) {
        this._rechargePollTimer = setTimeout(poll, 1800);
      }
    };

    this._rechargePollTimer = setTimeout(poll, 1200);
  },

  stopRechargePropagation() {},

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
