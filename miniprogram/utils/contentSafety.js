// 用户图片/文本内容安全校验。
// access_token 和 appsecret 只在云函数中使用，小程序端不保存任何凭证。

const CLOUD_FUNCTION_NAME = 'content-security';
const MAX_CHECK_IMAGE_BYTES = 900 * 1024;
const IMAGE_QUALITY_STEPS = [82, 64, 48, 32];

function createError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function assertCloudAvailable() {
  if (
    !wx.cloud ||
    typeof wx.cloud.callFunction !== 'function' ||
    typeof wx.cloud.uploadFile !== 'function'
  ) {
    throw createError('CONTENT_SAFETY_NOT_CONFIGURED', '内容安全服务未配置');
  }
}

function getFileInfo(filePath) {
  return new Promise((resolve, reject) => {
    const fileSystemManager =
      typeof wx.getFileSystemManager === 'function' ? wx.getFileSystemManager() : null;
    if (!fileSystemManager || typeof fileSystemManager.getFileInfo !== 'function') {
      reject(createError('IMAGE_INFO_UNAVAILABLE', '无法读取图片信息'));
      return;
    }

    fileSystemManager.getFileInfo({
      filePath,
      success: resolve,
      fail: reject,
    });
  });
}

function compressImage(filePath, quality) {
  return new Promise((resolve, reject) => {
    if (typeof wx.compressImage !== 'function') {
      reject(createError('IMAGE_COMPRESS_UNAVAILABLE', '图片压缩能力不可用'));
      return;
    }

    wx.compressImage({
      src: filePath,
      quality,
      compressedWidth: 750,
      compressedHeight: 1334,
      success: resolve,
      fail: reject,
    });
  });
}

async function prepareImage(filePath) {
  let originalInfo;
  try {
    originalInfo = await getFileInfo(filePath);
  } catch (error) {
    throw createError('INVALID_IMAGE', '图片不可用');
  }

  if (!originalInfo || !originalInfo.size) {
    throw createError('INVALID_IMAGE', '图片不可用');
  }

  // 统一压到微信图片安全接口支持的尺寸范围，并把实际保存的文件也设为校验后的版本。
  for (const quality of IMAGE_QUALITY_STEPS) {
    try {
      const compressed = await compressImage(filePath, quality);
      const compressedPath = compressed && compressed.tempFilePath;
      if (!compressedPath) continue;

      const compressedInfo = await getFileInfo(compressedPath);
      if (compressedInfo && compressedInfo.size <= MAX_CHECK_IMAGE_BYTES) {
        return compressedPath;
      }
    } catch (error) {
      // 压缩失败时，如果原图本身在限制内，仍可用原图继续做安全校验。
      if (originalInfo.size <= MAX_CHECK_IMAGE_BYTES) return filePath;
    }
  }

  if (originalInfo.size <= MAX_CHECK_IMAGE_BYTES) return filePath;
  throw createError('IMAGE_TOO_LARGE', '图片过大');
}

function getContentType(filePath) {
  const extension = String(filePath || '')
    .split('?')[0]
    .split('.')
    .pop()
    .toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'gif') return 'image/gif';
  return 'image/jpeg';
}

function uploadForCheck(filePath) {
  const suffix = getContentType(filePath).split('/')[1].replace('jpeg', 'jpg');
  const cloudPath = `content-security/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${suffix}`;

  return new Promise((resolve, reject) => {
    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: resolve,
      fail: reject,
    });
  });
}

function callCheckFunction(data) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: CLOUD_FUNCTION_NAME,
      data,
      success: resolve,
      fail: reject,
    });
  });
}

function deleteCheckFile(fileID) {
  if (!fileID || !wx.cloud || typeof wx.cloud.deleteFile !== 'function') {
    return Promise.resolve();
  }

  return new Promise(resolve => {
    wx.cloud.deleteFile({
      fileList: [fileID],
      complete: resolve,
    });
  });
}

function getCheckResult(response) {
  return response && response.result ? response.result : response;
}

function toCheckError(result) {
  const code = result && result.code;
  if (code === 'RISKY_CONTENT') return createError('RISKY_CONTENT', '内容含违规信息');
  if (code === 'INVALID_CONTENT') return createError('INVALID_CONTENT', '内容不可用');
  return createError('CHECK_UNAVAILABLE', '内容安全检测暂时不可用');
}

async function checkImage(filePath) {
  assertCloudAvailable();
  const checkedPath = await prepareImage(filePath);
  let uploadedFile;
  let keepUploadedFile = false;

  try {
    uploadedFile = await uploadForCheck(checkedPath);
    const fileID = uploadedFile && uploadedFile.fileID;
    if (!fileID) throw createError('CHECK_UPLOAD_FAILED', '安全检测图片上传失败');

    const contentType = getContentType(checkedPath);
    const response = await callCheckFunction({
      action: 'image',
      fileID,
      contentType,
    });
    const result = getCheckResult(response);

    if (!result || result.ok !== true) throw toCheckError(result);
    // 识别和主体处理会复用这份已经通过安全检测的图片，交给调用方在流程结束后决定是否删除。
    keepUploadedFile = true;
    return {
      safe: true,
      photoPath: checkedPath,
      fileID,
      contentType,
      traceId: result.traceId || '',
    };
  } catch (error) {
    if (error && error.code) throw error;
    throw createError('CHECK_UNAVAILABLE', '内容安全检测暂时不可用');
  } finally {
    if (!keepUploadedFile) await deleteCheckFile(uploadedFile && uploadedFile.fileID);
  }
}

function releaseImage(fileID) {
  return deleteCheckFile(fileID);
}

async function checkText(content, scene) {
  assertCloudAvailable();
  const response = await callCheckFunction({
    action: 'text',
    content: String(content || '').trim(),
    scene: Number(scene) || 4,
  });
  const result = getCheckResult(response);
  if (!result || result.ok !== true) throw toCheckError(result);
  return { safe: true, traceId: result.traceId || '' };
}

module.exports = {
  checkImage,
  releaseImage,
  checkText,
};
