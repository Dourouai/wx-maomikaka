const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const https = require('https');
const { URL } = require('url');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const USERS_COLLECTION = 'users';
const USER_SCHEMA_VERSION = 1;
const MAX_AVATAR_FILE_ID_LENGTH = 512;
const MAX_NICKNAME_LENGTH = 40;
const MAX_AVATAR_URL_LENGTH = 2048;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const MAX_AVATAR_CHECK_BYTES = 1024 * 1024;
const MAX_AVATAR_REDIRECTS = 2;
const ALLOWED_AVATAR_HOSTS = new Set(['thirdwx.qlogo.cn', 'wx.qlogo.cn']);
const PLACEHOLDER_NICKNAMES = new Set(['微信用户']);

function createError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function createBindingKey() {
  return crypto.randomBytes(16).toString('hex');
}

function normalizeAvatarUrl(value) {
  const raw = String(value || '').trim().slice(0, MAX_AVATAR_URL_LENGTH);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const hostname = String(parsed.hostname || '').toLowerCase();
    if (parsed.protocol !== 'https:' || !ALLOWED_AVATAR_HOSTS.has(hostname)) return '';
    return parsed.toString();
  } catch (error) {
    return '';
  }
}

function downloadWechatAvatar(avatarUrl, redirectCount = 0) {
  if (!avatarUrl || redirectCount > MAX_AVATAR_REDIRECTS) {
    return Promise.reject(createError('AVATAR_UNAVAILABLE', '微信头像地址不可用'));
  }

  let parsed;
  try {
    parsed = new URL(avatarUrl);
  } catch (error) {
    return Promise.reject(createError('AVATAR_UNAVAILABLE', '微信头像地址无效'));
  }
  if (parsed.protocol !== 'https:' || !ALLOWED_AVATAR_HOSTS.has(parsed.hostname.toLowerCase())) {
    return Promise.reject(createError('AVATAR_UNAVAILABLE', '微信头像来源不可用'));
  }

  return new Promise((resolve, reject) => {
    const request = https.get(
      parsed,
      {
        timeout: 12000,
        headers: { 'User-Agent': 'maomi-kaka-auth-bootstrap' },
      },
      response => {
        const statusCode = Number(response.statusCode || 0);
        const location = response.headers && response.headers.location;
        if (statusCode >= 300 && statusCode < 400 && location) {
          response.resume();
          let nextUrl;
          try {
            nextUrl = normalizeAvatarUrl(new URL(location, parsed).toString());
          } catch (error) {
            nextUrl = '';
          }
          downloadWechatAvatar(nextUrl, redirectCount + 1).then(resolve).catch(reject);
          return;
        }
        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(createError('AVATAR_UNAVAILABLE', `微信头像下载失败（HTTP ${statusCode}）`));
          return;
        }

        const contentType = String(response.headers && response.headers['content-type'] || '')
          .split(';')[0]
          .trim()
          .toLowerCase();
        if (contentType && !contentType.startsWith('image/')) {
          response.resume();
          reject(createError('AVATAR_INVALID', '微信头像格式不可用'));
          return;
        }

        const chunks = [];
        let totalBytes = 0;
        let tooLarge = false;
        response.on('data', chunk => {
          totalBytes += chunk.length;
          if (totalBytes > MAX_AVATAR_BYTES) {
            tooLarge = true;
            response.destroy();
            reject(createError('AVATAR_TOO_LARGE', '微信头像文件过大'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (tooLarge) return;
          const buffer = Buffer.concat(chunks);
          if (!buffer.length) {
            reject(createError('AVATAR_INVALID', '微信头像为空'));
            return;
          }
          resolve({ buffer, contentType: contentType || 'image/jpeg' });
        });
        response.on('error', reject);
      },
    );
    request.on('timeout', () => request.destroy(createError('AVATAR_TIMEOUT', '微信头像下载超时')));
    request.on('error', reject);
  });
}

async function persistWechatAvatar(avatarUrl, userId) {
  const normalizedUrl = normalizeAvatarUrl(avatarUrl);
  if (!normalizedUrl) return '';
  const downloaded = await downloadWechatAvatar(normalizedUrl);
  const userKey = crypto.createHash('sha256').update(String(userId)).digest('hex').slice(0, 24);
  const upload = await cloud.uploadFile({
    cloudPath: `user-profile/avatar/${userKey}-${Date.now()}.jpg`,
    fileContent: downloaded.buffer,
  });
  return String(upload && upload.fileID || '').trim();
}

function normalizeUserProfile(value) {
  const source = value && typeof value === 'object' ? value : {};
  const avatarFileID = String(source.avatarFileID || '').trim().slice(0, MAX_AVATAR_FILE_ID_LENGTH);
  const avatarUrl = normalizeAvatarUrl(source.avatarUrl);
  const rawNickName = String(source.nickName || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const nickName = PLACEHOLDER_NICKNAMES.has(rawNickName.toLowerCase())
    ? ''
    : Array.from(rawNickName).slice(0, MAX_NICKNAME_LENGTH).join('');
  if (!avatarFileID && !avatarUrl && !nickName) return null;
  return { avatarFileID, avatarUrl, nickName };
}

function toStoredUserProfile(value) {
  const profile = normalizeUserProfile(value);
  return profile
    ? { avatarFileID: profile.avatarFileID, nickName: profile.nickName }
    : null;
}

function getSecurityCode(result) {
  if (!result || typeof result !== 'object') return null;
  if (result.errCode !== undefined) return Number(result.errCode);
  if (result.errcode !== undefined) return Number(result.errcode);
  return null;
}

function getSecurityMessage(result) {
  if (!result || typeof result !== 'object') return '';
  return String(result.errMsg || result.errmsg || result.message || '').toLowerCase();
}

function isRiskyNicknameResult(result) {
  const code = getSecurityCode(result);
  const message = getSecurityMessage(result);
  const label = result && result.result && Number(result.result.label);
  return code === 87014
    || (label && label !== 100)
    || message.includes('risky content')
    || message.includes('违规');
}

async function checkNicknameSafety(nickName, openid) {
  if (!nickName) return;

  try {
    const result = await cloud.openapi.security.msgSecCheck({
      content: nickName,
      version: 2,
      scene: 4,
      openid,
    });
    const code = getSecurityCode(result);
    const label = result && result.result && Number(result.result.label);

    if (isRiskyNicknameResult(result) || (label && label !== 100)) {
      throw createError('NICKNAME_RISKY', '昵称包含不适宜内容');
    }
    if (code !== null && code !== 0) {
      throw createError('NICKNAME_CHECK_UNAVAILABLE', '昵称审核暂时不可用');
    }
  } catch (error) {
    if (error && error.code) throw error;
    if (isRiskyNicknameResult(error)) {
      throw createError('NICKNAME_RISKY', '昵称包含不适宜内容');
    }
    // 审核服务不可用时不写入昵称，避免绕过审核链路。
    throw createError('NICKNAME_CHECK_UNAVAILABLE', '昵称审核暂时不可用');
  }
}

async function checkAvatarSafety(avatarFileID) {
  const fileID = String(avatarFileID || '').trim();
  if (!fileID) return;

  let downloaded;
  try {
    downloaded = await cloud.downloadFile({ fileID });
  } catch (error) {
    throw createError('AVATAR_CHECK_UNAVAILABLE', '微信头像审核暂时不可用');
  }

  const buffer = downloaded && downloaded.fileContent;
  if (!buffer || !buffer.length) {
    throw createError('AVATAR_INVALID', '微信头像格式不可用');
  }
  if (buffer.length > MAX_AVATAR_CHECK_BYTES) {
    throw createError('AVATAR_TOO_LARGE', '微信头像文件过大');
  }

  try {
    const result = await cloud.openapi.security.imgSecCheck({
      media: {
        contentType: 'image/jpeg',
        value: buffer,
      },
    });
    const code = getSecurityCode(result);
    if (isRiskyNicknameResult(result)) {
      throw createError('AVATAR_RISKY', '头像包含不适宜内容');
    }
    if (code !== null && code !== 0) {
      throw createError('AVATAR_CHECK_UNAVAILABLE', '微信头像审核暂时不可用');
    }
  } catch (error) {
    if (error && error.code) throw error;
    if (isRiskyNicknameResult(error)) {
      throw createError('AVATAR_RISKY', '头像包含不适宜内容');
    }
    throw createError('AVATAR_CHECK_UNAVAILABLE', '微信头像审核暂时不可用');
  }
}

function shouldCheckProfileSafety(value) {
  const source = String(value || '').trim().toLowerCase();
  return source === 'custom' || source === 'settings';
}

function getOpenId() {
  const wxContext = cloud.getWXContext();
  const openid = String(wxContext && wxContext.OPENID || '').trim();
  if (!openid) throw createError('IDENTITY_UNAVAILABLE', '当前微信身份暂时不可用');
  return openid;
}

function isDocumentMissing(error) {
  const code = String(error && (error.errCode || error.code) || '').toLowerCase();
  const message = String(error && (error.errMsg || error.message) || '').toLowerCase();
  return code.includes('not_exist')
    || code.includes('notfound')
    || code.includes('not_found')
    || message.includes('not exist')
    || message.includes('not found')
    || message.includes('不存在');
}

async function getUser(userId) {
  try {
    const response = await db.collection(USERS_COLLECTION).doc(userId).get();
    return response && response.data ? response.data : null;
  } catch (error) {
    if (isDocumentMissing(error)) return null;
    throw error;
  }
}

async function ensureUser(userId, profileValue, nicknameSource) {
  const userRef = db.collection(USERS_COLLECTION).doc(userId);
  let existing = await getUser(userId);
  const profileInput = normalizeUserProfile(profileValue);
  // 登录只建立微信身份，不强制读取用户资料；头像昵称在用户主动设置时再写入。
  // 已存在账号的资料同步仍只提交变化字段，缺失字段不能覆盖云端已有资料。
  let profile = profileInput
    ? {
      avatarFileID: profileInput.avatarFileID,
      nickName: profileInput.nickName,
    }
    : null;
  if (profileInput && !profile.avatarFileID && profileInput.avatarUrl) {
    try {
      profile.avatarFileID = await persistWechatAvatar(profileInput.avatarUrl, userId);
    } catch (error) {
      if (!existing) {
        throw createError('AVATAR_UNAVAILABLE', '微信头像暂时无法保存，请稍后重试');
      }
      // 已有账号修复资料时，保留云端旧头像，不能因一次抓取失败清空资料。
      console.warn('[auth-bootstrap] 微信头像云端保存失败，保留已有头像:', error);
    }
  }
  if (shouldCheckProfileSafety(nicknameSource)) {
    await checkNicknameSafety(profile && profile.nickName, userId);
    await checkAvatarSafety(profile && profile.avatarFileID);
  }
  if (!existing) {
    const bindingKey = createBindingKey();
    try {
      await userRef.set({
        data: {
          schemaVersion: USER_SCHEMA_VERSION,
          clientBindingKey: bindingKey,
          status: 'active',
          stats: {
            totalPhotos: 0,
            unlockedCount: 0,
            pawGrowth: 0,
            pointBalance: 0,
            purchasedCanBalance: 0,
          },
          profile: profile || null,
          createdAt: db.serverDate(),
          updatedAt: db.serverDate(),
          lastSeenAt: db.serverDate(),
        },
      });
      return { created: true, bindingKey, profile };
    } catch (error) {
      // 并发首次打开时，另一请求可能已经创建了同一用户；继续走更新即可。
      if (!String(error && (error.errMsg || error.message) || '').toLowerCase().includes('exist')) {
        throw error;
      }
      existing = await getUser(userId);
    }
  }

  const bindingKey = existing && existing.clientBindingKey
    ? existing.clientBindingKey
    : createBindingKey();
  const existingProfile = toStoredUserProfile(existing && existing.profile);
  const effectiveProfile = profile
    ? {
      avatarFileID: profile.avatarFileID || (existingProfile && existingProfile.avatarFileID) || '',
      nickName: profile.nickName || (existingProfile && existingProfile.nickName) || '',
    }
    : existingProfile;
  const updateData = {
    schemaVersion: USER_SCHEMA_VERSION,
    clientBindingKey: bindingKey,
    status: 'active',
    updatedAt: db.serverDate(),
    lastSeenAt: db.serverDate(),
  };
  if (effectiveProfile) updateData.profile = effectiveProfile;
  const existingStats = existing && existing.stats && typeof existing.stats === 'object'
    ? { ...existing.stats }
    : {
      totalPhotos: 0,
      unlockedCount: 0,
      pawGrowth: 0,
      purchasedCanBalance: 0,
  };
  if (!Number.isFinite(Number(existingStats.pointBalance))) existingStats.pointBalance = 0;
  if (!Number.isFinite(Number(existingStats.purchasedCanBalance))) existingStats.purchasedCanBalance = 0;
  updateData.stats = existingStats;
  await userRef.update({
    data: updateData,
  });
  return { created: false, bindingKey, profile: effectiveProfile };
}

exports.main = async (event = {}) => {
  const action = event.action || 'bootstrap';
  if (action !== 'bootstrap' && action !== 'check') {
    throw createError('INVALID_ACTION', '不支持的身份操作');
  }

  const userId = getOpenId();
  if (action === 'check') {
    const existing = await getUser(userId);
    return {
      ok: true,
      code: existing ? 'USER_READY' : 'USER_NOT_INITIALIZED',
      user: {
        schemaVersion: USER_SCHEMA_VERSION,
        bound: Boolean(existing),
        profile: toStoredUserProfile(existing && existing.profile),
        accountBindingKey: existing && existing.clientBindingKey
          ? existing.clientBindingKey
          : null,
      },
    };
  }

  const result = await ensureUser(userId, event.profile, event.nicknameSource);

  // 不把 openid 返回给小程序，只返回业务上需要的绑定状态。
  return {
    ok: true,
    code: result.created ? 'USER_CREATED' : 'USER_READY',
    user: {
      schemaVersion: USER_SCHEMA_VERSION,
      bound: true,
      // 仅用于客户端识别“当前微信账号是否发生变化”，不是身份凭证。
      accountBindingKey: result.bindingKey,
      profile: result.profile,
    },
  };
};
