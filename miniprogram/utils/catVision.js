// 猫咪视觉识别：只负责把安全校验后的照片交给 cat-vision 云函数。
// 视觉模型和 API Key 均在服务端，绝不放入小程序端。

const CLOUD_FUNCTION_NAME = 'cat-vision';

function createError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function assertCloudAvailable() {
  if (
    !wx.cloud ||
    typeof wx.cloud.uploadFile !== 'function' ||
    typeof wx.cloud.callFunction !== 'function'
  ) {
    throw createError('VISION_NOT_CONFIGURED', '猫咪识别服务未配置');
  }
}

function getContentType(filePath) {
  const extension = String(filePath || '')
    .split('?')[0]
    .split('.')
    .pop()
    .toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'webp') return 'image/webp';
  return 'image/jpeg';
}

function uploadForVision(filePath, contentType) {
  const suffix = contentType.split('/')[1] === 'jpeg' ? 'jpg' : contentType.split('/')[1];
  const cloudPath = `cat-vision/input/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${suffix}`;

  return new Promise((resolve, reject) => {
    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: resolve,
      fail: reject,
    });
  });
}

function callVision(fileID, contentType) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: CLOUD_FUNCTION_NAME,
      data: {
        action: 'inspect',
        fileID,
        contentType,
      },
      success: resolve,
      fail: reject,
    });
  });
}

function deleteInput(fileID) {
  if (!fileID || !wx.cloud || typeof wx.cloud.deleteFile !== 'function') return Promise.resolve();
  return new Promise(resolve => {
    wx.cloud.deleteFile({ fileList: [fileID], complete: resolve });
  });
}

async function inspectCat(photoPath) {
  assertCloudAvailable();
  const contentType = getContentType(photoPath);
  let uploaded;

  try {
    uploaded = await uploadForVision(photoPath, contentType);
    const fileID = uploaded && uploaded.fileID;
    if (!fileID) throw createError('VISION_UPLOAD_FAILED', '识别图片上传失败');

    const response = await callVision(fileID, contentType);
    const result = response && response.result ? response.result : response;
    if (!result || result.ok !== true) {
      throw createError((result && result.code) || 'VISION_UNAVAILABLE', '猫咪识别服务暂时不可用');
    }
    return result;
  } catch (error) {
    if (error && error.code) throw error;
    throw createError('VISION_UNAVAILABLE', '猫咪识别服务暂时不可用');
  } finally {
    await deleteInput(uploaded && uploaded.fileID);
  }
}

module.exports = { inspectCat };
