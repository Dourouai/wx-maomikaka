// 猫咪咔咔｜猫档案海报封面图
// 这是独立于 cat-transform/matting 的封面业务链路。模型凭证只存在云函数端。

const CLOUD_FUNCTION_NAME = 'poster-cover';
const COVER_VERSION = 'cat-cover.v0.3';
const PROMPT_VERSION = 'cat-cover-prompt.v0.3';
const TARGET_RATIO = '359:537';

function createError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function assertCloudAvailable(requireUpload = false) {
  const hasCallFunction = wx.cloud && typeof wx.cloud.callFunction === 'function';
  const hasUpload = wx.cloud && typeof wx.cloud.uploadFile === 'function';
  if (!hasCallFunction || (requireUpload && !hasUpload)) {
    throw createError('COVER_PROVIDER_UNAVAILABLE', '猫咪封面服务未配置');
  }
}

function getContentType(filePath) {
  const extension = String(filePath || '')
    .split('?')[0]
    .split('.')
    .pop()
    .toLowerCase();
  return extension === 'png' ? 'image/png' : 'image/jpeg';
}

function uploadSource(filePath, contentType) {
  const suffix = contentType === 'image/png' ? 'png' : 'jpg';
  const cloudPath = `cat-album/poster-cover-source/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${suffix}`;
  return new Promise((resolve, reject) => {
    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: resolve,
      fail: reject,
    });
  });
}

function callCover(fileID, contentType, options = {}) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: CLOUD_FUNCTION_NAME,
      data: {
        action: 'generate',
        fileID,
        contentType,
        sourceKind: options.sourceKind || 'original',
        sceneSeed: options.sceneSeed || fileID,
        targetRatio: TARGET_RATIO,
      },
      success: resolve,
      fail: reject,
    });
  });
}

function getTempFileURL(fileID) {
  if (!fileID || !wx.cloud || typeof wx.cloud.getTempFileURL !== 'function') {
    return Promise.reject(createError('COVER_IMAGE_UNAVAILABLE', '封面图片地址暂时不可用'));
  }

  return new Promise((resolve, reject) => {
    wx.cloud.getTempFileURL({
      fileList: [fileID],
      success(response) {
        const item = response && response.fileList && response.fileList[0];
        const url = item && (item.tempFileURL || item.tempFileUrl);
        if (!url) {
          reject(createError('COVER_IMAGE_UNAVAILABLE', '封面图片地址暂时不可用'));
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

function getImageInfo(path) {
  if (!path || typeof wx.getImageInfo !== 'function') {
    return Promise.resolve({ path, width: 1, height: 1 });
  }
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src: path,
      success(result) {
        const width = Number(result && result.width);
        const height = Number(result && result.height);
        if (!width || !height) {
          reject(createError('COVER_IMAGE_INVALID', '封面图片尺寸不可用'));
          return;
        }
        resolve({
          path: result.path || path,
          width,
          height,
        });
      },
      fail: reject,
    });
  });
}

function selectSource(source = {}) {
  const value = source && typeof source === 'object' ? source : {};
  // 原图是身份事实来源；只有旧记录没有原图 fileID 时才使用主体图或当前展示图。
  const originalFileID = String(
    value.originalFileID || value.sourceOriginalFileID || value.originalPhotoFileID || ''
  ).trim();
  if (originalFileID) {
    const originalPath = value.originalPath || value.path || '';
    return {
      fileID: originalFileID,
      path: originalPath,
      contentType: value.originalContentType || getContentType(originalPath),
      sourceKind: 'original',
    };
  }

  const fallbackFileID = String(
    value.fileID || value.cutoutFileID || value.subjectFileID || ''
  ).trim();
  const fallbackKind = value.kind === 'cutout' || value.subjectFileID ? 'subject' : 'original';
  return {
    fileID: fallbackFileID,
    path: value.path || '',
    contentType: value.contentType || (fallbackKind === 'subject' ? 'image/png' : 'image/jpeg'),
    sourceKind: fallbackKind,
  };
}

async function generatePosterCover(source = {}, options = {}) {
  const selected = selectSource(source);
  assertCloudAvailable(!selected.fileID);
  if (!selected.fileID && !selected.path) {
    throw createError('SOURCE_IMAGE_UNAVAILABLE', '没有可用于生成封面的猫咪照片');
  }

  const contentType = selected.contentType === 'image/png' ? 'image/png' : 'image/jpeg';
  const sceneSeed = options.sceneSeed
    || source.sceneSeed
    || source.archiveCode
    || source.recordId
    || selected.fileID;
  const ownsSourceFile = !selected.fileID;
  let sourceFileID = selected.fileID;

  try {
    if (!sourceFileID) {
      const uploaded = await uploadSource(selected.path, contentType);
      sourceFileID = uploaded && uploaded.fileID ? uploaded.fileID : '';
    }
    if (!sourceFileID) throw createError('SOURCE_UPLOAD_FAILED', '封面输入图片上传失败');

    const response = await callCover(sourceFileID, contentType, {
      sourceKind: options.sourceKind || selected.sourceKind,
      sceneSeed,
    });
    const result = getResult(response);
    if (!result || result.ok !== true || !result.coverFileID) {
      const code = result && result.code ? String(result.code) : 'COVER_PROVIDER_UNAVAILABLE';
      const message = result && result.message ? String(result.message) : '猫咪封面生成失败';
      const error = createError(code, message);
      error.providerMessage = message;
      throw error;
    }

    let coverPhotoPath = result.coverPhotoPath || '';
    if (!coverPhotoPath) coverPhotoPath = await getTempFileURL(result.coverFileID);
    if (!coverPhotoPath) throw createError('COVER_IMAGE_UNAVAILABLE', '封面图片地址暂时不可用');

    const info = await getImageInfo(coverPhotoPath);
    return {
      path: info.path || coverPhotoPath,
      fileID: result.coverFileID,
      width: info.width,
      height: info.height,
      contentType: result.coverContentType || 'image/jpeg',
      kind: 'cover',
      version: result.coverVersion || COVER_VERSION,
      provider: result.provider || 'hunyuan-image',
      model: result.model || 'HY-Image-v3.0-I2I-ToB-v1.0.1',
      operation: result.operation || 'image-to-image-poster-cover',
      promptVersion: result.promptVersion || PROMPT_VERSION,
      targetRatio: result.targetRatio || TARGET_RATIO,
      status: 'ready',
      requestId: result.requestId || '',
      createdAt: result.createdAt || new Date().toISOString(),
    };
  } catch (error) {
    if (error && error.code) throw error;
    const normalized = createError('COVER_PROVIDER_UNAVAILABLE', '猫咪封面服务暂时不可用');
    normalized.providerMessage = String(error && (error.errMsg || error.message) || '').slice(0, 240);
    throw normalized;
  } finally {
    if (ownsSourceFile) await deleteSourceFile(sourceFileID);
  }
}

module.exports = {
  COVER_VERSION,
  TARGET_RATIO,
  generatePosterCover,
};
