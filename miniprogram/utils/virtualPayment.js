// 微信小程序虚拟支付入口。
//
// 这里不保存 AppKey、AppSecret 或 session_key。签名和订单创建全部交给
// virtual-payment 云函数；支付成功后也不在客户端直接增加罐罐余额，必须等服务端确认发货。

const FUNCTION_NAME = 'virtual-payment';

function createError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function getResult(response) {
  return response && response.result ? response.result : response;
}

function callFunction(data) {
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    throw createError('CLOUD_NOT_READY', '云端服务暂时不可用');
  }

  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: FUNCTION_NAME,
      data: data || {},
      success(response) {
        const result = getResult(response);
        if (!result || result.ok !== true) {
          const error = createError(
            (result && result.code) || 'VIRTUAL_PAYMENT_FAILED',
            (result && result.message) || '充值服务暂时不可用'
          );
          error.result = result;
          reject(error);
          return;
        }
        resolve(result);
      },
      fail: reject,
    });
  });
}

function getLoginCode() {
  return new Promise((resolve, reject) => {
    if (typeof wx === 'undefined' || typeof wx.login !== 'function') {
      reject(createError('LOGIN_UNAVAILABLE', '当前微信登录状态不可用'));
      return;
    }

    wx.login({
      success(response) {
        const code = String(response && response.code || '').trim();
        if (!code) {
          reject(createError('LOGIN_CODE_MISSING', '当前微信登录状态不可用'));
          return;
        }
        resolve(code);
      },
      fail: reject,
    });
  });
}

async function createOrder(planId, platform) {
  const loginCode = await getLoginCode();
  return callFunction({
    action: 'create-order',
    planId,
    loginCode,
    platform,
  });
}

function listOrders() {
  return callFunction({ action: 'list-orders' });
}

function getBalance() {
  return callFunction({ action: 'get-balance' });
}

module.exports = {
  createOrder,
  listOrders,
  getBalance,
};
