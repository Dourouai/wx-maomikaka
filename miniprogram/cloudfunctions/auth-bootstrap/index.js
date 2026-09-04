const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const USERS_COLLECTION = 'users';
const USER_SCHEMA_VERSION = 1;

function createError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function createBindingKey() {
  return crypto.randomBytes(16).toString('hex');
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

async function ensureUser(userId) {
  const userRef = db.collection(USERS_COLLECTION).doc(userId);
  let existing = await getUser(userId);
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
          },
          createdAt: db.serverDate(),
          updatedAt: db.serverDate(),
          lastSeenAt: db.serverDate(),
        },
      });
      return { created: true, bindingKey };
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
  const updateData = {
    schemaVersion: USER_SCHEMA_VERSION,
    clientBindingKey: bindingKey,
    status: 'active',
    updatedAt: db.serverDate(),
    lastSeenAt: db.serverDate(),
  };
  const existingStats = existing && existing.stats && typeof existing.stats === 'object'
    ? { ...existing.stats }
    : {
      totalPhotos: 0,
      unlockedCount: 0,
      pawGrowth: 0,
    };
  if (!Number.isFinite(Number(existingStats.pointBalance))) existingStats.pointBalance = 0;
  updateData.stats = existingStats;
  await userRef.update({
    data: updateData,
  });
  return { created: false, bindingKey };
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
        accountBindingKey: existing && existing.clientBindingKey
          ? existing.clientBindingKey
          : null,
      },
    };
  }

  const result = await ensureUser(userId);

  // 不把 openid 返回给小程序，只返回业务上需要的绑定状态。
  return {
    ok: true,
    code: result.created ? 'USER_CREATED' : 'USER_READY',
    user: {
      schemaVersion: USER_SCHEMA_VERSION,
      bound: true,
      // 仅用于客户端识别“当前微信账号是否发生变化”，不是身份凭证。
      accountBindingKey: result.bindingKey,
    },
  };
};
