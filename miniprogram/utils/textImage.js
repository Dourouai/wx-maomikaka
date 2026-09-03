// 文字生图测试：只负责调用服务端云函数，不在小程序端保存模型凭证。

const CLOUD_FUNCTION_NAME = 'text-to-image';

function createError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function callGenerate(prompt) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: CLOUD_FUNCTION_NAME,
      data: { action: 'generate', prompt },
      success: resolve,
      fail: reject,
    });
  });
}

function getTempFileURL(fileID) {
  return new Promise((resolve, reject) => {
    wx.cloud.getTempFileURL({
      fileList: [fileID],
      success(response) {
        const item = response && response.fileList && response.fileList[0];
        const url = item && (item.tempFileURL || item.tempFileUrl);
        if (!url) {
          reject(createError('IMAGE_URL_UNAVAILABLE', '生成图片地址暂时不可用'));
          return;
        }
        resolve(url);
      },
      fail: reject,
    });
  });
}

async function generateTextImage(prompt) {
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    throw createError('TEXT_IMAGE_NOT_CONFIGURED', '文字生图服务未配置');
  }

  const response = await callGenerate(prompt);
  const result = response && response.result ? response.result : response;
  if (!result || result.ok !== true || !result.imageFileID) {
    throw createError(
      result && result.code ? String(result.code) : 'TEXT_IMAGE_UNAVAILABLE',
      result && result.message ? String(result.message) : '图片生成服务暂时不可用',
    );
  }

  const imagePath = await getTempFileURL(result.imageFileID);
  return {
    imagePath,
    imageFileID: result.imageFileID,
    modelLabel: result.modelLabel || 'HY-Image-3.0-Plus',
    requestId: result.requestId || '',
  };
}

module.exports = { generateTextImage };
