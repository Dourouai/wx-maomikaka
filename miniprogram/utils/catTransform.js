// 猫咪主体抠图：只负责调用云函数，不在小程序端保存任何模型凭证。

const CLOUD_FUNCTION_NAME = 'cat-transform';

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
    throw createError('MATTING_NOT_CONFIGURED', '图片抠图服务未配置');
  }
}

function getContentType(filePath) {
  const extension = String(filePath || '')
    .split('?')[0]
    .split('.')
    .pop()
    .toLowerCase();
  if (extension === 'png') return 'image/png';
  return 'image/jpeg';
}

function uploadSource(filePath) {
  const suffix = getContentType(filePath) === 'image/png' ? 'png' : 'jpg';
  const cloudPath = `cat-album/original/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${suffix}`;

  return new Promise((resolve, reject) => {
    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: resolve,
      fail: reject,
    });
  });
}

function callTransform(fileID, contentType) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: CLOUD_FUNCTION_NAME,
      data: {
        action: 'matting',
        fileID,
        contentType,
      },
      success: resolve,
      fail: reject,
    });
  });
}

function getTempFileURL(fileID) {
  if (!fileID || !wx.cloud || typeof wx.cloud.getTempFileURL !== 'function') {
    return Promise.reject(createError('IMAGE_URL_UNAVAILABLE', '图片地址暂时不可用'));
  }

  return new Promise((resolve, reject) => {
    wx.cloud.getTempFileURL({
      fileList: [fileID],
      success(response) {
        const item = response && response.fileList && response.fileList[0];
        const url = item && (item.tempFileURL || item.tempFileUrl);
        if (!url) {
          reject(createError('IMAGE_URL_UNAVAILABLE', '图片地址暂时不可用'));
          return;
        }
        resolve(url);
      },
      fail: reject,
    });
  });
}

function deleteSourceFile(fileID) {
  if (!fileID || !wx.cloud || typeof wx.cloud.deleteFile !== 'function') {
    return Promise.resolve();
  }
  return new Promise(resolve => {
    wx.cloud.deleteFile({ fileList: [fileID], complete: resolve });
  });
}

function getResult(response) {
  return response && response.result ? response.result : response;
}

async function cutoutCat(filePath) {
  assertCloudAvailable();
  let sourceFileID = '';

  try {
    const uploaded = await uploadSource(filePath);
    sourceFileID = uploaded && uploaded.fileID ? uploaded.fileID : '';
    if (!sourceFileID) throw createError('SOURCE_UPLOAD_FAILED', '原始图片上传失败');

    const response = await callTransform(sourceFileID, getContentType(filePath));
    const result = getResult(response);
    if (!result || result.ok !== true || !result.cutoutFileID) {
      const code = result && result.code ? String(result.code) : 'MATTING_UNAVAILABLE';
      const message = result && result.message
        ? String(result.message)
        : '猫咪主体抠图失败';
      const error = createError(code, message);
      error.providerMessage = message;
      console.error('[CatMatting] 云函数返回失败:', { code, message });
      throw error;
    }

    let cutoutPhotoPath = '';
    try {
      cutoutPhotoPath = await getTempFileURL(result.cutoutFileID);
    } catch (error) {
      // 抠图文件已经落盘，临时地址失败时仍保留 fileID，图鉴页面可稍后重新换取地址。
      console.warn('[CatMatting] 抠图地址获取失败:', error);
    }

    return {
      originalFileID: sourceFileID,
      cutoutFileID: result.cutoutFileID,
      cutoutPhotoPath,
      cutoutContentType: result.cutoutContentType || 'image/png',
      cutoutProvider: result.provider || 'hunyuan-image',
      cutoutOperation: result.operation || 'image-to-image-subject-only',
      cutoutRequestId: result.requestId || '',
    };
  } catch (error) {
    // 抠图失败时不回退到原图，避免图鉴把带背景的照片误当成主体图。
    await deleteSourceFile(sourceFileID);
    if (error && !error.sourceFileID) error.sourceFileID = sourceFileID;
    if (error && error.code) throw error;
    throw createError('MATTING_UNAVAILABLE', '猫咪主体抠图失败');
  }
}

module.exports = {
  cutoutCat,
  getTempFileURL,
};
