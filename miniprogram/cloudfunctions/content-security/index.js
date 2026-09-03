const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const MAX_IMAGE_BYTES = 1024 * 1024;
const DEFAULT_SCENE = 4;

function getCode(result) {
  if (!result || typeof result !== 'object') return null;
  if (result.errCode !== undefined) return Number(result.errCode);
  if (result.errcode !== undefined) return Number(result.errcode);
  return null;
}

function getMessage(result) {
  if (!result || typeof result !== 'object') return '';
  return String(result.errMsg || result.errmsg || '');
}

function isRiskyResult(result) {
  const code = getCode(result);
  const message = getMessage(result).toLowerCase();
  return code === 87014 || message.includes('risky content') || message.includes('违规');
}

function successResult(traceId) {
  return {
    ok: true,
    code: 'OK',
    traceId: traceId || '',
  };
}

function riskyResult() {
  return {
    ok: false,
    code: 'RISKY_CONTENT',
  };
}

function unavailableResult() {
  return {
    ok: false,
    code: 'CHECK_UNAVAILABLE',
  };
}

function invalidResult() {
  return {
    ok: false,
    code: 'INVALID_CONTENT',
  };
}

async function checkImage(event) {
  if (!event.fileID) return invalidResult();

  let downloaded;
  try {
    downloaded = await cloud.downloadFile({ fileID: event.fileID });
  } catch (error) {
    return unavailableResult();
  }

  const buffer = downloaded && downloaded.fileContent;
  if (!buffer || !buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    return invalidResult();
  }

  const contentType = String(event.contentType || 'image/jpeg').toLowerCase();
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];
  if (!allowedTypes.includes(contentType)) return invalidResult();

  try {
    const result = await cloud.openapi.security.imgSecCheck({
      media: {
        contentType,
        value: buffer,
      },
    });
    const code = getCode(result);

    if (isRiskyResult(result)) return riskyResult();
    if (code !== null && code !== 0) return unavailableResult();
    return successResult(result && result.traceId);
  } catch (error) {
    if (isRiskyResult(error)) return riskyResult();
    return unavailableResult();
  }
}

async function checkText(event, context) {
  const content = String(event.content || '').trim();
  if (!content) return successResult();
  if (content.length > 2500) return invalidResult();

  const scene = [1, 2, 3, 4].includes(Number(event.scene))
    ? Number(event.scene)
    : DEFAULT_SCENE;

  try {
    const result = await cloud.openapi.security.msgSecCheck({
      content,
      version: 2,
      scene,
      openid: context && context.OPENID,
    });
    const code = getCode(result);
    const label = result && result.result && Number(result.result.label);

    if (isRiskyResult(result) || (label && label !== 100)) return riskyResult();
    if (code !== null && code !== 0) return unavailableResult();
    return successResult(result && result.traceId);
  } catch (error) {
    if (isRiskyResult(error)) return riskyResult();
    return unavailableResult();
  }
}

exports.main = async (event = {}, context = {}) => {
  if (event.action === 'image') return checkImage(event);
  if (event.action === 'text') return checkText(event, context);
  return invalidResult();
};
