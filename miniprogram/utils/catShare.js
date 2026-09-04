// 猫咪档案公开分享：分享者写入一次快照，接收者只凭 shareId 读取公开内容。
// shareId 不是账号凭证，也不包含 openid；图片仍通过云存储 fileID 换取临时地址。
const FUNCTION_NAME = 'cat-archive-share';

function createError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function callFunction(data) {
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    return Promise.reject(createError('CLOUD_NOT_READY', '云端服务暂时不可用'));
  }

  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: FUNCTION_NAME,
      data: data || {},
      success(response) {
        const result = response && response.result ? response.result : response;
        if (!result || result.ok !== true) {
          const error = createError(
            (result && result.code) || 'CAT_SHARE_FAILED',
            (result && result.message) || '猫咪档案分享失败'
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

function create(shareId, archive) {
  return callFunction({
    action: 'create',
    shareId,
    archive,
  });
}

function get(shareId) {
  return callFunction({
    action: 'get',
    shareId,
  });
}

module.exports = {
  create,
  get,
};
