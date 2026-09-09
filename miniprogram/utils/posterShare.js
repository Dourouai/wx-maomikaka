// 猫咪咔咔｜海报保存和公开分享
const storage = require('./storage');
const catShare = require('./catShare');
const posterData = require('./posterData');
const permissions = require('./permissions');

function createError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

async function prepareShare(poster) {
  if (!poster || !poster.sourceArchiveId) {
    throw createError('POSTER_SHARE_DATA_EMPTY', '没有可分享的猫咪档案快照');
  }

  // 兼容从云端读取的旧海报：posterResult 不持久化完整 shareArchive，
  // 这里按海报绑定的 sourceRecordId 重建公开快照，不让分享依赖临时本地字段。
  const existingArchive = poster.shareArchive
    && Array.isArray(poster.shareArchive.records)
    && poster.shareArchive.records.length
    ? poster.shareArchive
    : null;
  const shareArchive = existingArchive || posterData.buildLocalShareArchive(
    poster.sourceArchiveId,
    storage.getRecordsForCat(poster.sourceArchiveId),
    {},
    poster.sourceRecordId,
  );
  if (!shareArchive) {
    throw createError('POSTER_SHARE_DATA_EMPTY', '没有可分享的猫咪档案快照');
  }

  if (poster.isShared && poster.shareId) {
    return { shareId: poster.shareId, archive: shareArchive };
  }

  const shareId = poster.shareId
    || storage.getShareId(poster.sourceArchiveId)
    || storage.getOrCreateShareId(poster.sourceArchiveId);
  const result = await catShare.create(shareId, shareArchive);
  const returnedShareId = result && result.shareId ? result.shareId : shareId;
  storage.setShareId(poster.sourceArchiveId, returnedShareId);
  return {
    shareId: returnedShareId,
    archive: result && result.archive ? result.archive : shareArchive,
  };
}

function buildSharePath(shareId) {
  return shareId
    ? `/pages/card-detail/card-detail?shareId=${encodeURIComponent(shareId)}`
    : '/pages/collection/collection';
}

function buildShareConfig(poster, posterPath, shareId) {
  const name = poster && poster.name ? poster.name : '一只猫';
  const config = {
    title: `我为「${name}」做了一张猫咪海报｜猫咪咔咔`,
    path: buildSharePath(shareId || (poster && poster.shareId)),
  };
  if (posterPath) config.imageUrl = posterPath;
  return config;
}

function getPhotosAlbumAuthorizationStatus() {
  return permissions.getWritePhotosAlbumStatus();
}

function saveToAlbum(filePath) {
  if (!filePath || typeof wx.saveImageToPhotosAlbum !== 'function') {
    return Promise.reject(createError('POSTER_SAVE_UNSUPPORTED', '当前设备不支持保存海报'));
  }

  const save = () => new Promise((resolve, reject) => {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: resolve,
      fail: reject,
    });
  });

  const deniedError = () => createError(
    'POSTER_SAVE_DENIED',
    '请前往微信设置开启保存到相册权限后再试',
  );

  return getPhotosAlbumAuthorizationStatus().then(status => {
    if (status === 'denied') throw deniedError();
    return save();
  }).catch(error => {
    const message = String(error && (error.errMsg || error.message) || '');
    const detail = `${message} ${String(error && error.errno || '')}`;
    if (/api scope is not declared in the privacy agreement|api not declared in privacypolicy|errno.?112/i.test(detail)) {
      throw createError(
        'POSTER_PRIVACY_NOT_DECLARED',
        '请先在微信后台隐私指引中声明“相册（仅写入）”，再保存海报',
      );
    }
    if (!/auth|authorize|permission|denied/i.test(message)) {
      throw error;
    }
    // 被拒后不自动打开设置页，交给页面用明确弹窗引导用户主动前往设置。
    throw deniedError();
  });
}

module.exports = {
  prepareShare,
  buildSharePath,
  buildShareConfig,
  getPhotosAlbumAuthorizationStatus,
  saveToAlbum,
};
