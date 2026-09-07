// 个人主页分享与关注接口。
// 客户端只携带 profileShareId，不保存或传递 openid。

const FUNCTION_NAME = 'profile-social';
const STORAGE_KEY = 'maomikaka_profile_share_id';

function createError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function callFunction(action, data = {}) {
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    return Promise.reject(createError('CLOUD_NOT_READY', '主页服务暂时不可用'));
  }

  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: FUNCTION_NAME,
      data: { ...data, action },
      success(response) {
        const result = response && response.result ? response.result : response;
        if (!result || result.ok !== true) {
          const error = createError(
            result && result.code ? result.code : 'PROFILE_SOCIAL_FAILED',
            result && result.message ? result.message : '主页服务暂时不可用',
          );
          error.result = result;
          reject(error);
          return;
        }
        resolve(result);
      },
      fail: reject,
    });
  });
}

function getCachedProfileShareId() {
  try {
    return String(wx.getStorageSync(STORAGE_KEY) || '').trim();
  } catch (error) {
    return '';
  }
}

function cacheProfileShareId(value) {
  const shareId = String(value || '').trim();
  if (!shareId) return '';
  try {
    wx.setStorageSync(STORAGE_KEY, shareId);
  } catch (error) {
    // 缓存失败不影响本次分享，下一次仍可从服务端重新获取。
  }
  return shareId;
}

async function create() {
  // 每次由当前账号在服务端创建/复用分享入口，避免账号切换后误用旧账号的主页码。
  const result = await callFunction('create');
  const shareId = cacheProfileShareId(result && result.profileShareId);
  return { ...result, profileShareId: shareId || result.profileShareId };
}

function get(profileShareId) {
  return callFunction('get', { profileShareId });
}

function follow(profileShareId) {
  return callFunction('follow', { profileShareId });
}

function unfollow(profileShareId) {
  return callFunction('unfollow', { profileShareId });
}

module.exports = {
  create,
  get,
  follow,
  unfollow,
  getCachedProfileShareId,
};
