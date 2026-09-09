// 猫咪咔咔｜照片选择权限和选择器
//
// wx.chooseMedia / wx.chooseImage 处理的是“用户选中的照片”隐私授权；
// scope.writePhotosAlbum 只用于把海报写入相册，不能拿来代替选图授权。
const storage = require('./storage');
const privacyPolicy = require('./privacy');

function createError(code, message, cause) {
  const error = new Error(message || code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function normalizePickerError(error) {
  const message = error && (error.errMsg || error.message)
    ? String(error.errMsg || error.message)
    : '';
  if (/cancel/i.test(message)) {
    return createError('USER_CANCELLED', '用户取消选择图片', error);
  }
  return error || createError('IMAGE_PICKER_UNAVAILABLE', '图片选择器暂时不可用');
}

function markPhotoPrivacyConsent() {
  // 只记录已通过微信隐私状态确认的版本和时间，不保存隐私文本或照片内容。
  try {
    const state = storage.getSyncState();
    if (
      state
      && state.privacyPolicyVersion === privacyPolicy.PRIVACY_POLICY_VERSION
      && state.photoConsentAt
    ) {
      return;
    }
    storage.setSyncState({
      privacyPolicyVersion: privacyPolicy.PRIVACY_POLICY_VERSION,
      photoConsentAt: Date.now(),
    });
  } catch (error) {
    // 版本记录失败不应把已经通过的微信隐私确认变成选图失败。
    console.warn('[PhotoPicker] 记录隐私说明版本失败:', error);
  }
}

function requestPhotoSelectionAuthorization() {
  // 旧基础库没有隐私授权 API 时，交给选择器自行处理兼容逻辑。
  if (
    typeof wx === 'undefined'
    || typeof wx.getPrivacySetting !== 'function'
    || typeof wx.requirePrivacyAuthorize !== 'function'
  ) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    wx.getPrivacySetting({
      success: setting => {
        if (!setting || setting.needAuthorization !== true) {
          markPhotoPrivacyConsent();
          resolve();
          return;
        }

        wx.requirePrivacyAuthorize({
          success: () => {
            markPhotoPrivacyConsent();
            resolve();
          },
          fail: error => reject(createError(
            'PHOTO_PRIVACY_DENIED',
            '需要先同意照片使用说明，才能选择图片',
            error,
          )),
        });
      },
      // API 已存在但状态查询失败时不能放行，避免在隐私状态未知时读取用户照片。
      fail: error => {
        console.warn('[PhotoPicker] 读取照片隐私授权状态失败:', error);
        reject(createError(
          'PHOTO_PRIVACY_UNAVAILABLE',
          '照片隐私状态暂时无法确认，请稍后重试',
          error,
        ));
      },
    });
  });
}

// 只读取选图隐私状态，不弹出同意页。页面从微信设置返回后用它复核，
// 已同意时直接恢复“重新选择”入口，不自动替用户打开选择器。
function getPhotoSelectionAuthorizationStatus() {
  if (
    typeof wx === 'undefined'
    || typeof wx.getPrivacySetting !== 'function'
  ) {
    return Promise.resolve('unknown');
  }

  return new Promise(resolve => {
    wx.getPrivacySetting({
      success: setting => resolve(
        setting && setting.needAuthorization === true ? 'undetermined' : 'authorized'
      ),
      fail: error => {
        console.warn('[PhotoPicker] 设置返回后读取照片隐私状态失败:', error);
        resolve('unavailable');
      },
    });
  });
}

function getSelectedFilePath(response) {
  const file = response && response.tempFiles && response.tempFiles[0];
  return (file && (file.tempFilePath || file.path))
    || (response && response.tempFilePaths && response.tempFilePaths[0])
    || '';
}

function chooseMedia(options = {}) {
  const sourceType = Array.isArray(options.sourceType) && options.sourceType.length
    ? options.sourceType
    : ['album'];
  const needsPhotoAuthorization = sourceType.includes('album');

  return (needsPhotoAuthorization ? requestPhotoSelectionAuthorization() : Promise.resolve())
    .then(() => new Promise((resolve, reject) => {
      const success = response => {
        const filePath = getSelectedFilePath(response);
        if (!filePath) {
          reject(createError('IMAGE_EMPTY', '没有拿到图片'));
          return;
        }
        resolve(filePath);
      };
      const fail = error => reject(normalizePickerError(error));

      if (typeof wx.chooseMedia === 'function') {
        wx.chooseMedia({
          count: 1,
          mediaType: ['image'],
          sourceType,
          success,
          fail,
        });
        return;
      }

      if (typeof wx.chooseImage === 'function') {
        wx.chooseImage({
          count: 1,
          sourceType,
          success,
          fail,
        });
        return;
      }

      reject(createError('IMAGE_PICKER_UNAVAILABLE', '图片选择器暂时不可用'));
    }));
}

function chooseAlbumImage() {
  return chooseMedia({ sourceType: ['album'] });
}

module.exports = {
  chooseMedia,
  chooseAlbumImage,
  requestPhotoSelectionAuthorization,
  getPhotoSelectionAuthorizationStatus,
};
