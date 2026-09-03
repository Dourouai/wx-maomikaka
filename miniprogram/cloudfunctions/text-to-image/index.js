const cloud = require('wx-server-sdk');
const https = require('https');
const http = require('http');
const { URL } = require('url');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
  timeout: 900000,
});

const IMAGE_MODEL = process.env.TEXT_IMAGE_MODEL || 'HY-Image-3.0-Plus-4090-Tob-v1.0';
const MAX_PROMPT_LENGTH = 200;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 3;
// 该页面是内部测试入口，不保存或发布用户输入。需要时可在云函数环境变量中设为 true，恢复文字安全检测。
const CHECK_PROMPT_SAFETY = process.env.TEXT_IMAGE_CHECK_PROMPT === 'true';

function createError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function getCode(result) {
  if (!result || typeof result !== 'object') return null;
  if (result.errCode !== undefined) return Number(result.errCode);
  if (result.errcode !== undefined) return Number(result.errcode);
  return null;
}

function getMessage(result) {
  if (!result || typeof result !== 'object') return '';
  return String(result.errMsg || result.errmsg || result.message || '');
}

function isRiskyResult(result) {
  const code = getCode(result);
  const message = getMessage(result).toLowerCase();
  const label = result && result.result && Number(result.result.label);
  return code === 87014 || (label && label !== 100) || message.includes('risky content') || message.includes('违规');
}

async function checkPromptSafety(prompt, context) {
  try {
    const result = await cloud.openapi.security.msgSecCheck({
      content: prompt,
      version: 2,
      scene: 4,
      openid: context && context.OPENID,
    });
    const code = getCode(result);
    const label = result && result.result && Number(result.result.label);
    if (isRiskyResult(result) || (label && label !== 100)) {
      throw createError('RISKY_PROMPT', '你输入的内容含违规信息');
    }
    if (code !== null && code !== 0) {
      throw createError('CHECK_UNAVAILABLE', '文字安全检测暂时不可用');
    }
  } catch (error) {
    if (error && error.code) throw error;
    if (isRiskyResult(error)) throw createError('RISKY_PROMPT', '你输入的内容含违规信息');
    throw createError('CHECK_UNAVAILABLE', '文字安全检测暂时不可用');
  }
}

function detectContentType(buffer, declaredContentType) {
  if (buffer && buffer.length >= 8 &&
      buffer[0] === 0x89 && buffer[1] === 0x50 &&
      buffer[2] === 0x4e && buffer[3] === 0x47 &&
      buffer[4] === 0x0d && buffer[5] === 0x0a &&
      buffer[6] === 0x1a && buffer[7] === 0x0a) return 'image/png';
  if (buffer && buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer && buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return String(declaredContentType || 'image/png').split(';')[0].trim().toLowerCase();
}

function decodeDataURL(value) {
  const match = String(value || '').match(/^data:([^;,]+);base64,([\s\S]+)$/i);
  if (!match) return null;
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) throw createError('IMAGE_RESULT_INVALID', '模型没有返回有效图片');
  return { buffer, contentType: match[1] };
}

function downloadImage(url, redirectCount = 0) {
  if (redirectCount > MAX_REDIRECTS) throw createError('IMAGE_RESULT_UNAVAILABLE', '生成图片地址重定向过多');
  const parsedURL = new URL(url);
  if (!['http:', 'https:'].includes(parsedURL.protocol)) {
    throw createError('IMAGE_RESULT_UNAVAILABLE', '生成图片地址格式不可用');
  }
  const transport = parsedURL.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const request = transport.request({
      protocol: parsedURL.protocol,
      hostname: parsedURL.hostname,
      port: parsedURL.port || (parsedURL.protocol === 'https:' ? 443 : 80),
      path: `${parsedURL.pathname}${parsedURL.search}`,
      method: 'GET',
      timeout: 120000,
    }, response => {
      const statusCode = Number(response.statusCode || 0);
      const location = response.headers && response.headers.location;
      if (statusCode >= 300 && statusCode < 400 && location) {
        response.resume();
        downloadImage(new URL(location, parsedURL).toString(), redirectCount + 1).then(resolve).catch(reject);
        return;
      }
      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(createError('IMAGE_RESULT_UNAVAILABLE', `生成图片下载失败（HTTP ${statusCode}）`));
        return;
      }

      const chunks = [];
      let totalBytes = 0;
      response.on('data', chunk => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_IMAGE_BYTES) {
          response.destroy();
          reject(createError('IMAGE_RESULT_TOO_LARGE', '生成图片过大'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        if (!buffer.length) {
          reject(createError('IMAGE_RESULT_INVALID', '模型返回了空图片'));
          return;
        }
        resolve({
          buffer,
          contentType: detectContentType(buffer, response.headers && response.headers['content-type']),
        });
      });
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(createError('IMAGE_RESULT_TIMEOUT', '生成图片下载超时')));
    request.on('error', reject);
    request.end();
  });
}

async function getImageResult(imageData) {
  if (!imageData || typeof imageData !== 'object') {
    throw createError('IMAGE_RESULT_INVALID', '模型没有返回图片');
  }
  const dataURL = decodeDataURL(imageData.url);
  if (dataURL) return dataURL;

  const base64 = imageData.b64_json || imageData.base64;
  if (base64) {
    const decoded = Buffer.from(String(base64).replace(/^data:image\/[a-z0-9.+-]+;base64,/i, ''), 'base64');
    if (!decoded.length) throw createError('IMAGE_RESULT_INVALID', '模型返回了空图片');
    return { buffer: decoded, contentType: detectContentType(decoded, 'image/png') };
  }

  const imageURL = imageData.url || imageData.image_url;
  if (!imageURL) throw createError('IMAGE_RESULT_INVALID', '模型没有返回图片地址');
  return downloadImage(String(imageURL));
}

async function generate(prompt) {
  const imageModel = cloud.ai().createImageModel('hunyuan-image');
  const response = await imageModel.generateImage({
    model: IMAGE_MODEL,
    prompt,
    size: '768x1024',
    revise: { value: false },
    // 按文生图接口的顶层参数关闭显式平台标识。
    LogoAdd: 0,
  });
  const imageData = response && response.data && response.data[0];
  const image = await getImageResult(imageData);
  const contentType = detectContentType(image.buffer, image.contentType);
  const extension = contentType === 'image/jpeg' ? 'jpg' : contentType === 'image/webp' ? 'webp' : 'png';
  const uploadResult = await cloud.uploadFile({
    cloudPath: `text-image-test/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`,
    fileContent: image.buffer,
  });

  return {
    ok: true,
    imageFileID: uploadResult.fileID,
    imageContentType: contentType,
    modelLabel: 'HY-Image-3.0-Plus',
    requestId: response && response.id ? response.id : '',
  };
}

exports.main = async (event = {}, context = {}) => {
  if (event.action !== 'generate') return { ok: false, code: 'INVALID_ACTION' };
  const prompt = String(event.prompt || '').trim();
  if (!prompt) return { ok: false, code: 'PROMPT_EMPTY', message: '请输入图片描述' };
  if (prompt.length > MAX_PROMPT_LENGTH) return { ok: false, code: 'PROMPT_TOO_LONG', message: '图片描述不能超过 200 个字' };

  try {
    if (CHECK_PROMPT_SAFETY) await checkPromptSafety(prompt, context);
    return await generate(prompt);
  } catch (error) {
    const code = error && error.code ? String(error.code).slice(0, 100) : 'TEXT_IMAGE_UNAVAILABLE';
    const message = error && error.message ? String(error.message).replace(/\s+/g, ' ').slice(0, 240) : '图片生成服务暂时不可用';
    console.error('[TextImage] 文生图失败:', { code, message });
    return { ok: false, code, message };
  }
};
