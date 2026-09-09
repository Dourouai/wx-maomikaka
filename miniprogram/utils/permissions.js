// 猫咪咔咔｜微信系统权限状态
//
// 这里只读取当前状态，不主动唤起授权弹窗。
// 业务入口应在用户真正点击功能后再调用具体微信能力；已授权时直接执行，
// 被拒绝时由页面提供“去设置”，避免把权限申请混进页面初始化流程。
const SCOPES = {
  CAMERA: 'scope.camera',
  FUZZY_LOCATION: 'scope.userFuzzyLocation',
  WRITE_PHOTOS_ALBUM: 'scope.writePhotosAlbum',
};

function getScopeStatus(scope) {
  const normalizedScope = String(scope || '').trim();
  if (!normalizedScope) return Promise.resolve('unknown');
  if (typeof wx === 'undefined' || typeof wx.getSetting !== 'function') {
    return Promise.resolve('unknown');
  }

  return new Promise(resolve => {
    wx.getSetting({
      success: result => {
        const authSetting = result && result.authSetting ? result.authSetting : {};
        if (authSetting[normalizedScope] === true) {
          resolve('authorized');
          return;
        }
        if (authSetting[normalizedScope] === false) {
          resolve('denied');
          return;
        }
        resolve('undetermined');
      },
      fail: error => {
        console.warn('[Permissions] 读取微信权限状态失败:', normalizedScope, error);
        resolve('unknown');
      },
    });
  });
}

function openSetting() {
  if (typeof wx === 'undefined' || typeof wx.openSetting !== 'function') {
    const error = new Error('当前微信版本不支持打开权限设置');
    error.code = 'PERMISSION_SETTINGS_UNSUPPORTED';
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    wx.openSetting({
      success: resolve,
      fail: reject,
    });
  });
}

module.exports = {
  SCOPES,
  getScopeStatus,
  getCameraStatus: () => getScopeStatus(SCOPES.CAMERA),
  getFuzzyLocationStatus: () => getScopeStatus(SCOPES.FUZZY_LOCATION),
  getWritePhotosAlbumStatus: () => getScopeStatus(SCOPES.WRITE_PHOTOS_ALBUM),
  openSetting,
};
