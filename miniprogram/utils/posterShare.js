// 猫咪咔咔｜海报保存和公开分享
const storage = require('./storage');
const catShare = require('./catShare');

function createError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

async function prepareShare(poster) {
  if (!poster || !poster.sourceArchiveId || !poster.shareArchive) {
    throw createError('POSTER_SHARE_DATA_EMPTY', '没有可分享的猫咪档案快照');
  }

  if (poster.isShared && poster.shareId) {
    return { shareId: poster.shareId, archive: poster.shareArchive };
  }

  const shareId = poster.shareId
    || storage.getShareId(poster.sourceArchiveId)
    || storage.getOrCreateShareId(poster.sourceArchiveId);
  const result = await catShare.create(shareId, poster.shareArchive);
  const returnedShareId = result && result.shareId ? result.shareId : shareId;
  storage.setShareId(poster.sourceArchiveId, returnedShareId);
  return {
    shareId: returnedShareId,
    archive: result && result.archive ? result.archive : poster.shareArchive,
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

function saveToAlbum(filePath) {
  if (!filePath || typeof wx.saveImageToPhotosAlbum !== 'function') {
    return Promise.reject(createError('POSTER_SAVE_UNSUPPORTED', '当前设备不支持保存海报'));
  }

  const getAlbumAuthorization = () => new Promise(resolve => {
    if (typeof wx.getSetting !== 'function') {
      resolve('unknown');
      return;
    }
    wx.getSetting({
      success: result => {
        const authSetting = result && result.authSetting ? result.authSetting : {};
        if (authSetting['scope.writePhotosAlbum'] === true) {
          resolve('authorized');
          return;
        }
        if (authSetting['scope.writePhotosAlbum'] === false) {
          resolve('denied');
          return;
        }
        resolve('undetermined');
      },
      fail: error => {
        console.warn('[PosterShare] 读取相册授权状态失败:', error);
        resolve('unknown');
      },
    });
  });

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

  return getAlbumAuthorization().then(status => {
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
  saveToAlbum,
};
