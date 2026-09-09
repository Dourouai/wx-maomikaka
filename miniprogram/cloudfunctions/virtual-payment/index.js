const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const https = require('https');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const ORDERS_COLLECTION = 'virtual_payment_orders';
const USERS_COLLECTION = 'users';
const PAYMENT_METHOD = 'requestVirtualPayment';
const PAYMENT_MODE = 'short_series_goods';
const PAYMENT_SIGN_MODE = 'goods';
const TEST_PLAN_ID = 'can_001';
const PLANS = Object.freeze({
  [TEST_PLAN_ID]: Object.freeze({
    canAmount: 1,
    goodsPrice: 1,
    productEnvKey: 'VIRTUAL_PAYMENT_PRODUCT_ID_TEST',
    testOnly: true,
  }),
  can_1: Object.freeze({
    canAmount: 1,
    goodsPrice: 100,
    productEnvKey: 'VIRTUAL_PAYMENT_PRODUCT_ID_1',
  }),
  can_10: Object.freeze({
    canAmount: 10,
    goodsPrice: 900,
    productEnvKey: 'VIRTUAL_PAYMENT_PRODUCT_ID_10',
  }),
  can_30: Object.freeze({
    canAmount: 30,
    goodsPrice: 2900,
    productEnvKey: 'VIRTUAL_PAYMENT_PRODUCT_ID_30',
  }),
});

function createError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function getOpenId() {
  const context = cloud.getWXContext();
  const openid = String(context && context.OPENID || '').trim();
  if (!openid) throw createError('IDENTITY_UNAVAILABLE', '当前微信身份暂时不可用');
  return openid;
}

function getEnv(name) {
  return String(process.env[name] || '').trim();
}

function isTestPlanEnabled() {
  const configured = getEnv('VIRTUAL_PAYMENT_TEST_PLAN_ENABLED').toLowerCase();
  // 测试套餐必须显式开启；沙盒环境本身不代表要向用户展示 ¥0.01。
  // 这样即使云函数暂时读不到变量，也不会误把内测套餐暴露出来。
  return ['1', 'true', 'yes', 'on'].includes(configured);
}

function getPaymentEnvironment() {
  const currencyType = getEnv('VIRTUAL_PAYMENT_CURRENCY_TYPE') || 'CNY';
  const env = Number(getEnv('VIRTUAL_PAYMENT_ENV') || 0);
  if (![0, 1].includes(env)) {
    throw createError('PAYMENT_CONFIG_INVALID', '充值环境配置无效');
  }
  if (!['CNY'].includes(currencyType)) {
    throw createError('PAYMENT_CONFIG_INVALID', '充值币种配置无效');
  }
  return {
    currencyType,
    env,
    defaultPlatform: getEnv('VIRTUAL_PAYMENT_PLATFORM'),
  };
}

function getAppKeyForEnv(env) {
  const normalizedEnv = Number(env) === 1 ? 1 : 0;
  const appKey = normalizedEnv === 1
    ? (getEnv('VIRTUAL_PAYMENT_APP_KEY_SANDBOX') || getEnv('VIRTUAL_PAYMENT_APP_KEY'))
    : (getEnv('VIRTUAL_PAYMENT_APP_KEY_PROD') || getEnv('VIRTUAL_PAYMENT_APP_KEY'));
  if (!appKey) {
    throw createError(
      'PAYMENT_NOT_CONFIGURED',
      '充值服务尚未完成微信虚拟支付配置，请稍后再试'
    );
  }
  return appKey;
}

function getConfiguredPayment(paymentEnvironment) {
  const appSecret = getEnv('WX_APP_SECRET');
  const offerId = getEnv('VIRTUAL_PAYMENT_OFFER_ID');
  const environment = paymentEnvironment || getPaymentEnvironment();
  const appKey = getAppKeyForEnv(environment.env);
  if (!appSecret || !offerId) {
    throw createError(
      'PAYMENT_NOT_CONFIGURED',
      '充值服务尚未完成微信虚拟支付配置，请稍后再试'
    );
  }

  return {
    appKey,
    appSecret,
    offerId,
    ...environment,
  };
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

async function ensurePaymentUser(userId) {
  const userRef = db.collection(USERS_COLLECTION).doc(userId);
  const existing = await getUser(userId);
  if (existing) return existing;

  try {
    await userRef.set({
      data: {
        schemaVersion: 1,
        status: 'active',
        stats: {
          totalPhotos: 0,
          unlockedCount: 0,
          pawGrowth: 0,
          pointBalance: 0,
          purchasedCanBalance: 0,
        },
        createdAt: db.serverDate(),
        updatedAt: db.serverDate(),
        lastSeenAt: db.serverDate(),
      },
    });
  } catch (error) {
    if (!String(error && (error.errMsg || error.message) || '').toLowerCase().includes('exist')) {
      throw error;
    }
  }
  return getUser(userId);
}

function normalizePlatform(value, fallback) {
  const platform = String(value || fallback || '').trim().toLowerCase();
  return ['android', 'ios'].includes(platform) ? platform : '';
}

function getProductId(plan, env) {
  const suffix = env === 1 ? '_SANDBOX' : '_PROD';
  return getEnv(`${plan.productEnvKey}${suffix}`) || getEnv(plan.productEnvKey);
}

function createOrderId() {
  const suffix = crypto.randomBytes(5).toString('hex');
  return `mk${Date.now().toString(36)}${suffix}`.slice(0, 32);
}

function hmacSha256(key, value) {
  return crypto.createHmac('sha256', key).update(value, 'utf8').digest('hex');
}

function sha1(value) {
  return crypto.createHash('sha1').update(String(value || ''), 'utf8').digest('hex');
}

function getRequestQuery(event) {
  const query = event && (
    event.queryStringParameters
    || event.query
    || event.params
  );
  if (query && typeof query === 'object') return query;
  if (event && typeof event === 'object' && (
    event.signature
    || event.timestamp
    || event.nonce
    || event.echostr
  )) {
    return event;
  }

  const rawQuery = event && (
    event.queryString
    || event.rawQueryString
    || typeof event.query === 'string' && event.query
    || ''
  );
  if (!rawQuery) return {};

  return String(rawQuery)
    .replace(/^\?/, '')
    .split('&')
    .reduce((result, pair) => {
      if (!pair) return result;
      const separator = pair.indexOf('=');
      const rawKey = separator >= 0 ? pair.slice(0, separator) : pair;
      const rawValue = separator >= 0 ? pair.slice(separator + 1) : '';
      let key = rawKey;
      let value = rawValue;
      try {
        key = decodeURIComponent(String(rawKey).replace(/\+/g, ' '));
        value = decodeURIComponent(String(rawValue).replace(/\+/g, ' '));
      } catch (error) {
        // Keep the raw pair if a malformed escape appears in the query string.
      }
      if (key) result[key] = value;
      return result;
    }, {});
}

function getQueryValue(event, name) {
  const query = getRequestQuery(event);
  const value = query && query[name];
  return String(Array.isArray(value) ? value[0] : value || '').trim();
}

function getRequestMethod(event) {
  return String(
    event && (
      event.httpMethod
      || event.method
      || event.requestContext && event.requestContext.http && event.requestContext.http.method
    ) || '',
  ).toUpperCase();
}

function verifyMessagePushSignature(event) {
  const token = getEnv('WECHAT_MESSAGE_PUSH_TOKEN');
  if (!token) {
    throw createError(
      'PAYMENT_PUSH_NOT_CONFIGURED',
      '微信消息推送 Token 尚未配置',
    );
  }

  const signature = getQueryValue(event, 'signature');
  const timestamp = getQueryValue(event, 'timestamp');
  const nonce = getQueryValue(event, 'nonce');
  if (!signature || !timestamp || !nonce) {
    throw createError(
      'PAYMENT_PUSH_SIGNATURE_INVALID',
      '微信消息推送签名参数缺失',
    );
  }

  const expected = sha1([token, timestamp, nonce].sort().join(''));
  if (!constantTimeEqual(expected, signature.toLowerCase())) {
    throw createError(
      'PAYMENT_PUSH_SIGNATURE_INVALID',
      '微信消息推送签名校验失败',
    );
  }
}

function isMessagePushVerificationRequest(event) {
  const method = getRequestMethod(event);
  return (!method || method === 'GET') && Boolean(getQueryValue(event, 'echostr'));
}

function getMessagePushEchoString(event) {
  return getQueryValue(event, 'echostr');
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        let result;
        try {
          result = JSON.parse(body || '{}');
        } catch (error) {
          reject(createError('LOGIN_RESPONSE_INVALID', '微信登录响应无效'));
          return;
        }
        if (result.errcode) {
          reject(createError('LOGIN_SESSION_FAILED', result.errmsg || '微信登录状态已失效'));
          return;
        }
        resolve(result);
      });
    });
    request.setTimeout(8000, () => {
      request.destroy();
      reject(createError('LOGIN_SESSION_TIMEOUT', '微信登录状态获取超时'));
    });
    request.on('error', error => reject(error));
  });
}

async function getSession(openid, loginCode, appSecret) {
  const code = String(loginCode || '').trim();
  if (!code) throw createError('LOGIN_CODE_MISSING', '当前微信登录状态不可用');

  const context = cloud.getWXContext();
  const appId = String(context && context.APPID || process.env.WX_APP_ID || '').trim();
  if (!appId) throw createError('PAYMENT_CONFIG_INVALID', '微信 AppID 配置缺失');

  const query = [
    `appid=${encodeURIComponent(appId)}`,
    `secret=${encodeURIComponent(appSecret)}`,
    `js_code=${encodeURIComponent(code)}`,
    'grant_type=authorization_code',
  ].join('&');
  const result = await requestJson(`https://api.weixin.qq.com/sns/jscode2session?${query}`);
  if (result.openid && result.openid !== openid) {
    throw createError('IDENTITY_MISMATCH', '当前微信身份发生变化，请重试');
  }
  if (!result.session_key) throw createError('LOGIN_SESSION_FAILED', '微信登录状态不可用');
  return result.session_key;
}

async function createPaymentOrder(event) {
  const planId = String(event.planId || '').trim();
  const plan = PLANS[planId];
  if (!plan) throw createError('INVALID_PAYMENT_PLAN', '充值套餐不存在');
  const paymentEnvironment = getPaymentEnvironment();
  if (plan.testOnly && !isTestPlanEnabled(paymentEnvironment)) {
    throw createError('PAYMENT_TEST_PLAN_DISABLED', '测试充值套餐当前未开启');
  }

  const payment = getConfiguredPayment(paymentEnvironment);
  const productId = getProductId(plan, payment.env);
  if (!productId) {
    throw createError(
      'PAYMENT_NOT_CONFIGURED',
      '充值商品尚未在微信虚拟支付后台配置，请稍后再试'
    );
  }

  const platform = normalizePlatform(event.platform, payment.defaultPlatform);
  if (!platform) {
    throw createError('PAYMENT_PLATFORM_UNSUPPORTED', '当前设备暂不支持虚拟支付');
  }

  const openid = getOpenId();
  const sessionKey = await getSession(openid, event.loginCode, payment.appSecret);
  await ensurePaymentUser(openid);
  const outTradeNo = createOrderId();
  const attach = JSON.stringify({ planId, canAmount: plan.canAmount });
  const signData = JSON.stringify({
    mode: PAYMENT_SIGN_MODE,
    offerId: payment.offerId,
    buyQuantity: 1,
    env: payment.env,
    currencyType: payment.currencyType,
    platform,
    productId,
    goodsPrice: plan.goodsPrice,
    outTradeNo,
    attach,
  });

  await db.collection(ORDERS_COLLECTION).add({
    data: {
      outTradeNo,
      openid,
      planId,
      canAmount: plan.canAmount,
      goodsPrice: plan.goodsPrice,
      productId,
      env: payment.env,
      platform,
      status: 'created',
      delivered: false,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate(),
    },
  });

  return {
    ok: true,
    orderId: outTradeNo,
    planId,
    canAmount: plan.canAmount,
    mode: PAYMENT_MODE,
    signData,
    paySig: hmacSha256(payment.appKey, `${PAYMENT_METHOD}&${signData}`),
    signature: hmacSha256(sessionKey, signData),
  };
}

async function listPaymentOrders() {
  const openid = getOpenId();
  const [result, user] = await Promise.all([
    db.collection(ORDERS_COLLECTION)
      .where({ openid })
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get(),
    getUser(openid),
  ]);
  const orders = result.data || [];

  return {
    ok: true,
    purchasedCanBalance: Math.max(
      0,
      Math.floor(Number(user && user.stats && user.stats.purchasedCanBalance) || 0),
    ),
    orders: orders.map(order => ({
      orderId: order.outTradeNo || order._id,
      planId: order.planId,
      canAmount: Number(order.canAmount) || 0,
      goodsPrice: Number(order.goodsPrice) || 0,
      status: order.status || 'created',
      delivered: order.delivered === true,
      createdAt: order.createdAt || order.updatedAt || null,
      updatedAt: order.updatedAt || order.createdAt || null,
    })),
  };
}

async function getPaymentBalance() {
  const openid = getOpenId();
  const paymentEnvironment = getPaymentEnvironment();
  // 套餐开关属于支付配置，不能因为充值订单集合尚未创建或暂时不可读而被吞掉。
  // 先确保用户，再单独读取订单；首次使用时订单集合不存在，按空记录处理。
  const user = await ensurePaymentUser(openid);
  let result = { data: [] };
  try {
    result = await db.collection(ORDERS_COLLECTION)
      .where({ openid, delivered: true })
      .orderBy('updatedAt', 'desc')
      .limit(50)
      .get();
  } catch (error) {
    if (!isDocumentMissing(error)) throw error;
  }
  return {
    ok: true,
    purchasedCanBalance: Math.max(
      0,
      Math.floor(Number(user && user.stats && user.stats.purchasedCanBalance) || 0),
    ),
    testPlanEnabled: isTestPlanEnabled(paymentEnvironment),
    paymentEnv: paymentEnvironment.env,
    deliveredOrderIds: (result.data || []).map(order => order.outTradeNo || order._id),
  };
}

function constantTimeEqual(left, right) {
  const expected = Buffer.from(String(left || ''), 'utf8');
  const actual = Buffer.from(String(right || ''), 'utf8');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function parsePaymentNotification(event) {
  const hasBody = event && Object.prototype.hasOwnProperty.call(event, 'body');
  let rawBody = hasBody && typeof event.body === 'string' ? event.body : '';
  if (hasBody && event.isBase64Encoded === true) {
    rawBody = Buffer.from(rawBody, 'base64').toString('utf8');
  }

  let notification = hasBody ? rawBody : event;
  if (typeof notification === 'string') {
    try {
      notification = JSON.parse(notification || '{}');
    } catch (error) {
      throw createError('PAYMENT_CALLBACK_INVALID', '发货通知格式无效');
    }
  }
  if (!notification || typeof notification !== 'object') {
    throw createError('PAYMENT_CALLBACK_INVALID', '发货通知格式无效');
  }
  if (!rawBody) rawBody = JSON.stringify(notification);
  return { notification, rawBody };
}

function parseCallbackPayload(notification) {
  const rawPayload = notification && notification.payload;
  const payloadText = typeof rawPayload === 'string'
    ? rawPayload
    : JSON.stringify(rawPayload || {});
  let payload;
  try {
    payload = JSON.parse(payloadText || '{}');
  } catch (error) {
    throw createError('PAYMENT_CALLBACK_INVALID', '发货通知明细无效');
  }
  if (!payload || typeof payload !== 'object') {
    throw createError('PAYMENT_CALLBACK_INVALID', '发货通知明细无效');
  }
  return { payload, payloadText };
}

async function findPaymentOrder(outTradeNo) {
  const result = await db.collection(ORDERS_COLLECTION)
    .where({ outTradeNo })
    .limit(1)
    .get();
  return result && Array.isArray(result.data) ? result.data[0] || null : null;
}

function getGoodsInfo(payload) {
  const rawGoodsInfo = payload && (payload.GoodsInfo || payload.goodsInfo);
  if (typeof rawGoodsInfo === 'string') {
    try {
      return JSON.parse(rawGoodsInfo || '{}');
    } catch (error) {
      throw createError('PAYMENT_CALLBACK_INVALID', '发货通知商品明细无效');
    }
  }
  return rawGoodsInfo && typeof rawGoodsInfo === 'object' ? rawGoodsInfo : {};
}

function getPayInfo(payload) {
  const rawPayInfo = payload && (
    payload.WeChatPayInfo
    || payload.weChatPayInfo
    || payload.PayInfo
    || payload.payInfo
  );
  if (typeof rawPayInfo === 'string') {
    try {
      return JSON.parse(rawPayInfo || '{}');
    } catch (error) {
      return {};
    }
  }
  return rawPayInfo && typeof rawPayInfo === 'object' ? rawPayInfo : {};
}

async function settleDeliveredOrder(order, notification, payload) {
  const result = await db.runTransaction(async transaction => {
    const orderRef = transaction.collection(ORDERS_COLLECTION).doc(order._id);
    const orderSnapshot = await orderRef.get();
    const currentOrder = orderSnapshot && orderSnapshot.data;
    if (!currentOrder) throw createError('PAYMENT_ORDER_NOT_FOUND', '充值订单不存在');
    if (currentOrder.delivered === true) {
      return {
        alreadyDelivered: true,
        purchasedCanBalance: null,
      };
    }

    const userId = String(currentOrder.openid || '').trim();
    if (!userId) throw createError('PAYMENT_ORDER_INVALID', '充值订单缺少用户身份');
    const userRef = transaction.collection(USERS_COLLECTION).doc(userId);
    let user = null;
    try {
      const userSnapshot = await userRef.get();
      user = userSnapshot && userSnapshot.data ? userSnapshot.data : null;
    } catch (error) {
      if (!isDocumentMissing(error)) throw error;
    }

    const stats = user && user.stats && typeof user.stats === 'object'
      ? { ...user.stats }
      : {
        totalPhotos: 0,
        unlockedCount: 0,
        pawGrowth: 0,
        pointBalance: 0,
        purchasedCanBalance: 0,
      };
    const currentBalance = Math.max(0, Math.floor(Number(stats.purchasedCanBalance) || 0));
    const canAmount = Math.max(0, Math.floor(Number(currentOrder.canAmount) || 0));
    const nextBalance = currentBalance + canAmount;
    stats.purchasedCanBalance = nextBalance;

    const now = db.serverDate();
    if (user) {
      await userRef.update({
        data: {
          stats,
          updatedAt: now,
        },
      });
    } else {
      await userRef.set({
        data: {
          schemaVersion: 1,
          status: 'active',
          stats,
          createdAt: now,
          updatedAt: now,
          lastSeenAt: now,
        },
      });
    }

    const payInfo = getPayInfo(payload);
    await orderRef.update({
      data: {
        status: 'delivered',
        delivered: true,
        deliveredAt: now,
        transactionId: String(
          payInfo.TransactionId
          || payInfo.transactionId
          || notification.transactionId
          || ''
        ).trim(),
        updatedAt: now,
      },
    });

    return {
      alreadyDelivered: false,
      canAmount,
      purchasedCanBalance: nextBalance,
    };
  });

  return {
    ok: true,
    delivered: true,
    alreadyDelivered: result && result.alreadyDelivered === true,
    canAmount: result && result.canAmount || 0,
    purchasedCanBalance: result && result.purchasedCanBalance,
  };
}

async function handleLegacyPaymentCallback(event, parsed) {
  const { notification } = parsed || parsePaymentNotification(event);
  const eventName = String(notification.event || '').trim();
  if (eventName !== 'xpay_goods_deliver_notify') {
    throw createError('PAYMENT_CALLBACK_INVALID', '发货通知事件不匹配');
  }

  const { payload, payloadText } = parseCallbackPayload(notification);
  const outTradeNo = String(
    notification.outTradeNo
    || notification.out_trade_no
    || payload.OutTradeNo
    || payload.outTradeNo
    || ''
  ).trim();
  if (!outTradeNo) throw createError('PAYMENT_CALLBACK_INVALID', '发货通知缺少订单号');

  const order = await findPaymentOrder(outTradeNo);
  if (!order || !order._id) throw createError('PAYMENT_ORDER_NOT_FOUND', '充值订单不存在');

  const appKey = getAppKeyForEnv(order.env);
  const expectedSignature = hmacSha256(appKey, `${eventName}&${payloadText}`);
  if (!constantTimeEqual(expectedSignature, notification.payEventSig)) {
    throw createError('PAYMENT_CALLBACK_SIGNATURE_INVALID', '发货通知签名校验失败');
  }

  const payloadOrderId = String(payload.OutTradeNo || payload.outTradeNo || '').trim();
  const payloadOpenId = String(payload.OpenId || payload.openid || '').trim();
  if (payloadOrderId !== outTradeNo || payloadOpenId !== String(order.openid || '').trim()) {
    throw createError('PAYMENT_CALLBACK_ORDER_MISMATCH', '发货通知订单归属校验失败');
  }

  const eventType = String(notification.eventType || '').trim();
  if (eventType === 'TRANSACTION.PAYERROR') {
    if (order.delivered !== true) {
      await db.collection(ORDERS_COLLECTION).doc(order._id).update({
        data: {
          status: 'failed',
          delivered: false,
          updatedAt: db.serverDate(),
        },
      });
    }
    return { ok: true, delivered: false, failed: true };
  }
  if (eventType !== 'TRANSACTION.SUCCESS') {
    throw createError('PAYMENT_CALLBACK_INVALID', '发货通知状态不匹配');
  }

  const goodsInfo = getGoodsInfo(payload);
  const productId = String(goodsInfo.ProductId || goodsInfo.productId || '').trim();
  const quantity = Number(goodsInfo.Quantity || goodsInfo.quantity);
  const actualPrice = Number(goodsInfo.ActualPrice || goodsInfo.actualPrice);
  const originalPrice = Number(goodsInfo.OrigPrice || goodsInfo.origPrice);
  if (
    productId !== String(order.productId || '').trim()
    || quantity !== 1
    || !Number.isFinite(actualPrice)
    || actualPrice !== Number(order.goodsPrice)
    || (Number.isFinite(originalPrice) && originalPrice !== Number(order.goodsPrice))
  ) {
    throw createError('PAYMENT_CALLBACK_ORDER_MISMATCH', '发货通知商品校验失败');
  }

  return settleDeliveredOrder(order, notification, payload);
}

function isWechatMessagePushNotification(notification) {
  return Boolean(notification && (
    notification.Event
    || notification.MsgType === 'event'
  ));
}

async function handleWechatPaymentCallback(event, notification) {
  verifyMessagePushSignature(event);

  const eventName = String(notification.Event || '').trim();
  if (eventName !== 'xpay_goods_deliver_notify') {
    throw createError('PAYMENT_CALLBACK_INVALID', '发货通知事件不匹配');
  }

  const outTradeNo = String(notification.OutTradeNo || '').trim();
  const openid = String(notification.OpenId || '').trim();
  if (!outTradeNo) {
    throw createError('PAYMENT_CALLBACK_INVALID', '发货通知缺少订单号');
  }

  const order = await findPaymentOrder(outTradeNo);
  if (!order || !order._id) {
    throw createError('PAYMENT_ORDER_NOT_FOUND', '充值订单不存在');
  }
  if (!openid || openid !== String(order.openid || '').trim()) {
    throw createError('PAYMENT_CALLBACK_ORDER_MISMATCH', '发货通知订单归属校验失败');
  }

  const notificationEnv = Number(notification.Env);
  if (
    !Number.isFinite(notificationEnv)
    || notificationEnv !== Number(order.env)
  ) {
    throw createError('PAYMENT_CALLBACK_ORDER_MISMATCH', '发货通知环境校验失败');
  }

  const goodsInfo = getGoodsInfo(notification);
  const productId = String(goodsInfo.ProductId || goodsInfo.productId || '').trim();
  const quantity = Number(goodsInfo.Quantity || goodsInfo.quantity);
  const actualPrice = Number(goodsInfo.ActualPrice || goodsInfo.actualPrice);
  const originalPrice = Number(goodsInfo.OrigPrice || goodsInfo.origPrice);
  if (
    productId !== String(order.productId || '').trim()
    || quantity !== 1
    || !Number.isFinite(actualPrice)
    || actualPrice !== Number(order.goodsPrice)
    || (Number.isFinite(originalPrice) && originalPrice !== Number(order.goodsPrice))
  ) {
    throw createError('PAYMENT_CALLBACK_ORDER_MISMATCH', '发货通知商品校验失败');
  }

  return settleDeliveredOrder(order, notification, notification);
}

async function handlePaymentCallback(event, parsed) {
  const notificationData = parsed || parsePaymentNotification(event);
  if (isWechatMessagePushNotification(notificationData.notification)) {
    return {
      format: 'wechat-message-push',
      result: await handleWechatPaymentCallback(event, notificationData.notification),
    };
  }

  return {
    format: 'legacy',
    result: await handleLegacyPaymentCallback(event, notificationData),
  };
}

function isHttpCallbackEvent(event) {
  if (!event || typeof event !== 'object') return false;
  if (event.action) return false;

  const hasQuery = Boolean(
    event.queryStringParameters
    || event.query
    || event.params
    || event.queryString
    || event.rawQueryString
  );
  return Boolean(
    getRequestMethod(event)
    || Object.prototype.hasOwnProperty.call(event, 'body')
    || hasQuery
    || event.headers
    || event.path
    || event.requestContext
    || event.rawPath
    || event.http
    || event.url
    || event.method
    || event.signature
    || event.timestamp
    || event.nonce
    || event.echostr
  );
}

function toHttpResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

async function main(event = {}) {
  if (isHttpCallbackEvent(event)) {
    if (isMessagePushVerificationRequest(event)) {
      try {
        verifyMessagePushSignature(event);
        return {
          statusCode: 200,
          headers: { 'content-type': 'text/plain' },
          body: getMessagePushEchoString(event),
        };
      } catch (error) {
        return {
          statusCode: 403,
          headers: { 'content-type': 'text/plain' },
          body: String(error && error.message || 'invalid signature').slice(0, 160),
        };
      }
    }

    let responseFormat = 'legacy';
    try {
      const parsed = parsePaymentNotification(event);
      responseFormat = isWechatMessagePushNotification(parsed.notification)
        ? 'wechat-message-push'
        : 'legacy';
      const callback = await handlePaymentCallback(event, parsed);
      if (responseFormat === 'wechat-message-push') {
        return toHttpResponse(200, { ErrCode: 0, ErrMsg: 'success' });
      }

      return toHttpResponse(200, {
        returnCode: '0',
        returnMessage: 'success',
        data: 'ok',
        ...(callback.result || {}),
      });
    } catch (error) {
      if (responseFormat === 'wechat-message-push') {
        return toHttpResponse(200, {
          ErrCode: 1,
          ErrMsg: String(error && error.message || '发货通知处理失败').slice(0, 160),
        });
      }

      return toHttpResponse(400, {
        returnCode: 'FAIL',
        returnMessage: String(error && error.message || '发货通知处理失败').slice(0, 160),
      });
    }
  }
  if (event.action === 'create-order') return createPaymentOrder(event);
  if (event.action === 'list-orders') return listPaymentOrders();
  if (event.action === 'get-balance') return getPaymentBalance();
  throw createError('INVALID_ACTION', '不支持的充值操作');
}

exports.main = async (event = {}) => {
  try {
    return await main(event);
  } catch (error) {
    const hasAction = event && typeof event === 'object' && event.action;
    if (!hasAction) {
      return toHttpResponse(500, {
        returnCode: 'FAIL',
        returnMessage: String(error && error.message || '发货通知处理失败').slice(0, 160),
      });
    }
    throw error;
  }
};
