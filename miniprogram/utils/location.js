// 猫咪咔咔 - 可选的模糊位置能力
//
// 相机是拍摄的必要能力，由微信的 <camera> 组件负责申请；位置则只在
// 用户明确选择“记录大概位置”后调用，不参与猫咪识别，也不上传给 AI 服务。
const permissions = require('./permissions');
const LOCATION_SCOPE = permissions.SCOPES.FUZZY_LOCATION;

function getAuthorizationStatus() {
  return permissions.getFuzzyLocationStatus().then(status => (
    status === 'unknown' ? 'unavailable' : status
  ));
}

function getFuzzyLocation() {
  if (typeof wx === 'undefined' || typeof wx.getFuzzyLocation !== 'function') {
    const error = new Error('当前微信版本不支持模糊位置');
    error.code = 'LOCATION_UNAVAILABLE';
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    wx.getFuzzyLocation({
      type: 'wgs84',
      success: result => {
        const latitude = Number(result && result.latitude);
        const longitude = Number(result && result.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          const error = new Error('微信没有返回有效位置');
          error.code = 'LOCATION_INVALID';
          reject(error);
          return;
        }

        resolve({
          source: 'wx.getFuzzyLocation',
          coordinateSystem: 'wgs84',
          // 只保留约百米级的坐标，避免把不必要的精度写入猫卡记录。
          latitude: Number(latitude.toFixed(3)),
          longitude: Number(longitude.toFixed(3)),
          capturedAt: new Date().toISOString(),
        });
      },
      fail: error => {
        const normalized = error instanceof Error ? error : new Error(
          String(error && (error.errMsg || error.message) || '位置读取失败')
        );
        normalized.code = normalized.code || 'LOCATION_REQUEST_FAILED';
        reject(normalized);
      },
    });
  });
}

module.exports = {
  LOCATION_SCOPE,
  getAuthorizationStatus,
  getFuzzyLocation,
};
