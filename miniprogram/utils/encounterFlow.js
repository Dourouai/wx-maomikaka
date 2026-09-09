// 猫咪咔咔 - 相遇输入链路
// 拍照和相册选图都必须通过同一个 pending capture 进入 reveal，避免两套识别和入档逻辑逐渐分叉。
const storage = require('./storage');
const photoPicker = require('./photoPicker');

/**
 * 只从相册选择一张图片。
 * 正式入口不再把“相册选择”和“主体测试”拆成两步，选完即进入正式相遇流程。
 */
function chooseAlbumImage() {
  return photoPicker.chooseAlbumImage();
}

function createPendingCapture(photoPath, options = {}) {
  const normalizedPath = String(photoPath || '').trim();
  if (!normalizedPath) throw createError('IMAGE_EMPTY', '没有拿到图片');

  return storage.savePendingCapture({
    captureId: storage.createPendingCaptureId(),
    photoPath: normalizedPath,
    sourceType: options.sourceType || 'photo',
    capturedAt: Number(options.capturedAt) || Date.now(),
    location: options.location || null,
    locationStatus: options.locationStatus || 'unavailable',
  });
}

function openReveal(photoPath, options = {}) {
  const pending = createPendingCapture(photoPath, options);
  const url = `/pages/reveal/reveal?captureId=${encodeURIComponent(pending.captureId)}&photo=${encodeURIComponent(pending.photoPath)}`;

  return new Promise((resolve, reject) => {
    wx.navigateTo({
      url,
      success: () => resolve(pending),
      fail: error => {
        storage.clearPendingCapture(pending.captureId);
        reject(error || createError('REVEAL_UNAVAILABLE', '相遇结果页暂时打不开'));
      },
    });
  });
}

module.exports = {
  chooseAlbumImage,
  createPendingCapture,
  openReveal,
};
