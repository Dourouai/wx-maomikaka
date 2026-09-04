// ============================================================
// 猫咪咔咔 - App 全局入口
// ============================================================
const storage = require('./utils/storage');
const userData = require('./utils/userData');

// 固定使用已关联小程序的 CloudBase 环境，避免开发者工具或第三方托管
// 的当前环境路由到其他环境，导致云函数/云存储调用落错位置。
const CLOUD_ENV_ID = 'yangxi-studio-d4g3upcho8753fb42';

App({
  // ── 生命周期 ──────────────────────────────────────────────
  onLaunch() {
    console.log('[App] onLaunch');
    this._initCloud();
    // 初始化存储（首次启动建表，幂等操作）
    storage.initStorage();
    // 将最新统计同步到 globalData
    this.globalData.userStats = storage.getUserStats();
    // 只校验当前微信账号是否变化，不自动导入本地记录；数据绑定仍需用户确认。
    userData.checkAccount().catch(error => {
      console.warn('[App] 当前账号校验暂未完成:', error);
    });
  },

  onShow() {
    // 每次前台显示时刷新统计（以防其他页面修改了数据）
    this.globalData.userStats = storage.getUserStats();
    userData.checkAccount().catch(error => {
      console.warn('[App] 当前账号校验暂未完成:', error);
    });
  },

  // ── 全局数据 ─────────────────────────────────────────────
  globalData: {
    /** 用户统计：{ totalPhotos, unlockedCount, lastPhotoTime, pawGrowth, pointBalance } */
    userStats: null,
    cloudReady: false,
  },

  _initCloud() {
    if (!wx.cloud || typeof wx.cloud.init !== 'function') return;

    try {
      wx.cloud.init({
        env: CLOUD_ENV_ID,
        traceUser: true,
      });
      this.globalData.cloudReady = true;
    } catch (error) {
      console.error('[App] 云开发初始化失败:', error);
    }
  },

  // ── 工具方法 ─────────────────────────────────────────────
  /**
   * 刷新全局统计并通知监听者
   * 各页面可在 onShow 中调用 getApp().refreshStats() 刷新
   */
  refreshStats() {
    this.globalData.userStats = storage.getUserStats();
  },
});
