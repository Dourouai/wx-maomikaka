const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const cloud = require('wx-server-sdk');

// 这里使用混元图生图做受约束的主体处理，只输出适合图鉴展示的猫咪主体素材。
// 提示词只约束图像处理，不生成故事、标签或装饰；原图仍然是事实记录，模型结果只作为展示图。
let PNG = null;
let jpeg = null;
try {
  PNG = require('pngjs').PNG;
} catch (error) {
  console.warn('[CatTransform] pngjs 未加载，跳过透明背景清理');
}
try {
  jpeg = require('jpeg-js');
} catch (error) {
  console.warn('[CatTransform] jpeg-js 未加载，跳过 JPEG 清理');
}

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
  timeout: 900000,
});

const PROMPT_VERSION = 'cat-subject-only-v9-transparent-png';
const LOGO_ADD = 0;
// ImageToImage 不传 Styles 时会默认套用 201（日系动漫）风格；主体图必须显式关闭预置风格。
const NATIVE_STYLES = [];
// 在不启用预置画风的前提下，给模型足够自由度清理树枝、地面等背景残留。
const NATIVE_SUBJECT_STRENGTH = 0.6;
// 正式主体处理固定使用腾讯云原生 ImageToImage；不走 CloudBase 生图，避免平台强制 AI 标识。
const CAT_TRANSFORM_PROVIDER = 'tencent-native';
const NATIVE_AIART_HOST = 'aiart.tencentcloudapi.com';
const NATIVE_AIART_SERVICE = 'aiart';
const NATIVE_AIART_ACTION = 'ImageToImage';
const NATIVE_AIART_VERSION = '2022-12-29';
const NATIVE_AIART_DEFAULT_REGION = 'ap-guangzhou';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_NATIVE_INPUT_BASE64_BYTES = 8 * 1024 * 1024;
const MAX_NATIVE_RESPONSE_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const MAX_CLEANUP_PIXELS = 3 * 1024 * 1024;

const NATIVE_SUBJECT_PROMPT = [
  '这是主体抠图任务，不是文生图创作，不是风格转换，也不是海报设计。请对输入照片做前景主体分离，只保留照片中这只猫。',
  '输出为透明背景 PNG，带真实 alpha 透明通道：猫以外的每一个像素都必须完全透明，不要白色背景，不要彩色背景，不要灰色背景，不要棋盘格图案。',
  '完整保留原猫的头部、耳朵、眼睛、胡须、毛发、身体、四肢、爪子和尾巴，以及原有毛色、花纹、姿势、比例、朝向和真实照片质感；不要裁切，不要补画，不要换猫，不要改变外观。',
].join('');
const NATIVE_NEGATIVE_PROMPT = [
  '树枝，树干，树皮，叶子，花，植物，草，地面，泥土，道路，墙面，天空，窗户，家具，室内，室外，环境，场景，背景，背景残留，边缘残留，杂物，人物，其他动物，白底，白色背景，彩色背景，灰色背景，棋盘格，',
  '文字，乱码，水印，AI生成标识，标题，标签，品种名，故事，评分，徽章，边框，画框，卡片，海报，贴纸，版式，报纸，画布，装饰，阴影，倒影，',
  '插画，动漫，卡通，水彩，油画，素描，艺术风格，生成新猫，替换猫，换猫，重绘，修图，磨皮，虚构细节，裁切耳朵，裁切胡须，裁切身体，裁切爪子，裁切尾巴，缺失身体',
].join('');

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
  return (
    code === 87014 ||
    (label && label !== 100) ||
    message.includes('risky content') ||
    message.includes('违规')
  );
}

function getImageContentType(contentType) {
  const normalized = String(contentType || 'image/jpeg')
    .split(';')[0]
    .trim()
    .toLowerCase();
  return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
}

function detectImageContentType(buffer, declaredContentType) {
  if (buffer && buffer.length >= 8 &&
      buffer[0] === 0x89 && buffer[1] === 0x50 &&
      buffer[2] === 0x4e && buffer[3] === 0x47 &&
      buffer[4] === 0x0d && buffer[5] === 0x0a &&
      buffer[6] === 0x1a && buffer[7] === 0x0a) {
    return 'image/png';
  }
  if (buffer && buffer.length >= 3 &&
      buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  return getImageContentType(declaredContentType);
}

function isSupportedImage(buffer, contentType) {
  const safeType = getImageContentType(contentType);
  return safeType === 'image/png'
    ? detectImageContentType(buffer, safeType) === 'image/png'
    : safeType === 'image/jpeg' && detectImageContentType(buffer, safeType) === 'image/jpeg';
}

function quantizeColor(value) {
  return Math.min(255, Math.round(value / 8) * 8);
}

function colorDistanceSquared(first, second) {
  return (first.r - second.r) ** 2 +
    (first.g - second.g) ** 2 +
    (first.b - second.b) ** 2;
}

function getCheckerboardPalette(png) {
  const { width, height, data } = png;
  const border = Math.max(4, Math.min(48, Math.round(Math.min(width, height) * 0.08)));
  const counts = new Map();
  const sample = (x, y) => {
    const offset = (y * width + x) * 4;
    if (data[offset + 3] < 245) return;
    const color = { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
    if (Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b) > 30) return;
    const key = [quantizeColor(color.r), quantizeColor(color.g), quantizeColor(color.b)].join(',');
    counts.set(key, (counts.get(key) || 0) + 1);
  };

  for (let y = 0; y < Math.min(border, height); y += 1) {
    for (let x = 0; x < width; x += 1) sample(x, y);
  }
  for (let y = Math.max(0, height - border); y < height; y += 1) {
    for (let x = 0; x < width; x += 1) sample(x, y);
  }
  for (let x = 0; x < Math.min(border, width); x += 1) {
    for (let y = border; y < Math.max(border, height - border); y += 1) sample(x, y);
  }
  for (let x = Math.max(0, width - border); x < width; x += 1) {
    for (let y = border; y < Math.max(border, height - border); y += 1) sample(x, y);
  }

  const colors = [...counts.entries()]
    .map(([key, count]) => {
      const [r, g, b] = key.split(',').map(Number);
      return { r, g, b, count };
    })
    .sort((first, second) => second.count - first.count);
  if (colors.length < 2) return [];
  const first = colors[0];
  const second = colors.find(color => colorDistanceSquared(first, color) > 100);
  if (!second || second.count < Math.max(12, first.count * 0.04)) return [];
  return [first, second];
}

function getPaletteIndex(data, offset, palette) {
  if (data[offset + 3] < 240) return -1;
  const pixel = { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
  let nearest = -1;
  let nearestDistance = Infinity;
  palette.forEach((color, index) => {
    const distance = colorDistanceSquared(pixel, color);
    if (distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
    }
  });
  return nearestDistance <= 34 ** 2 * 3 ? nearest : -1;
}

function looksLikeCheckerboard(png, palette) {
  const { width, height, data } = png;
  let transitions = 0;
  let pairs = 0;
  const checkPair = (firstX, firstY, secondX, secondY) => {
    const first = getPaletteIndex(data, (firstY * width + firstX) * 4, palette);
    const second = getPaletteIndex(data, (secondY * width + secondX) * 4, palette);
    if (first < 0 || second < 0) return;
    pairs += 1;
    if (first !== second) transitions += 1;
  };

  for (let x = 1; x < width; x += 1) {
    checkPair(x - 1, 0, x, 0);
    if (height > 1) checkPair(x - 1, height - 1, x, height - 1);
  }
  for (let y = 1; y < height; y += 1) {
    checkPair(0, y - 1, 0, y);
    if (width > 1) checkPair(width - 1, y - 1, width - 1, y);
  }
  return pairs >= 40 && transitions / pairs > 0.01;
}

function removeBakedCheckerboard(buffer, contentType) {
  const safeType = getImageContentType(contentType);
  if (!PNG || !['image/png', 'image/jpeg'].includes(safeType) || (safeType === 'image/jpeg' && !jpeg)) {
    return { buffer, contentType: safeType, removed: false };
  }

  try {
    const png = safeType === 'image/png'
      ? PNG.sync.read(buffer)
      : PNG.sync.read(PNG.sync.write(jpeg.decode(buffer, { useTArray: true })));
    const totalPixels = png.width * png.height;
    if (totalPixels > MAX_CLEANUP_PIXELS) return { buffer, contentType: safeType, removed: false };
    const palette = getCheckerboardPalette(png);
    if (palette.length < 2 || !looksLikeCheckerboard(png, palette)) {
      return safeType === 'image/jpeg'
        ? { buffer: PNG.sync.write(png), contentType: 'image/png', removed: false }
        : { buffer, contentType: safeType, removed: false };
    }

    const visited = new Uint8Array(totalPixels);
    const queue = new Int32Array(totalPixels);
    let queueHead = 0;
    let queueTail = 0;
    const enqueue = index => {
      if (index < 0 || index >= totalPixels || visited[index]) return;
      const offset = index * 4;
      if (getPaletteIndex(png.data, offset, palette) < 0) return;
      visited[index] = 1;
      queue[queueTail] = index;
      queueTail += 1;
    };

    for (let x = 0; x < png.width; x += 1) {
      enqueue(x);
      enqueue((png.height - 1) * png.width + x);
    }
    for (let y = 0; y < png.height; y += 1) {
      enqueue(y * png.width);
      enqueue(y * png.width + png.width - 1);
    }
    while (queueHead < queueTail) {
      const index = queue[queueHead];
      queueHead += 1;
      const x = index % png.width;
      const y = Math.floor(index / png.width);
      if (x > 0) enqueue(index - 1);
      if (x + 1 < png.width) enqueue(index + 1);
      if (y > 0) enqueue(index - png.width);
      if (y + 1 < png.height) enqueue(index + png.width);
    }
    if (queueTail < totalPixels * 0.05) return { buffer, contentType: safeType, removed: false };
    for (let index = 0; index < queueTail; index += 1) png.data[queue[index] * 4 + 3] = 0;
    return {
      buffer: PNG.sync.write(png),
      contentType: 'image/png',
      removed: true,
    };
  } catch (error) {
    console.warn('[CatTransform] 透明背景清理跳过:', error && error.message);
    return { buffer, contentType: safeType, removed: false };
  }
}

async function getSourceImage(fileID, contentType) {
  let downloaded;
  try {
    downloaded = await cloud.downloadFile({ fileID });
  } catch (error) {
    throw createError('SOURCE_IMAGE_UNAVAILABLE', '原始图片不可用');
  }
  const buffer = downloaded && downloaded.fileContent;
  if (!buffer || !buffer.length) throw createError('SOURCE_IMAGE_UNAVAILABLE', '原始图片不可用');
  if (buffer.length > MAX_IMAGE_BYTES) throw createError('SOURCE_IMAGE_TOO_LARGE', '原始图片过大');
  const safeType = getImageContentType(contentType);
  if (!['image/png', 'image/jpeg'].includes(safeType) || !isSupportedImage(buffer, safeType)) {
    throw createError('SOURCE_IMAGE_FORMAT_UNSUPPORTED', '原始图片格式不可用');
  }
  return { buffer, contentType: safeType };
}

function downloadImage(url, redirectCount = 0) {
  if (!url || redirectCount > MAX_REDIRECTS) {
    return Promise.reject(createError('CUTOUT_IMAGE_UNAVAILABLE', '主体图片不可用'));
  }

  let parsedURL;
  try {
    parsedURL = new URL(url);
  } catch (error) {
    return Promise.reject(createError('CUTOUT_IMAGE_UNAVAILABLE', '主体图片地址无效'));
  }
  const request = parsedURL.protocol === 'http:' ? http.get : https.get;
  return new Promise((resolve, reject) => {
    const requestInstance = request(
      parsedURL,
      { timeout: 120000, headers: { 'User-Agent': 'maomi-kaka-cat-transform' } },
      response => {
        const statusCode = Number(response.statusCode || 0);
        const location = response.headers && response.headers.location;
        if (statusCode >= 300 && statusCode < 400 && location) {
          response.resume();
          downloadImage(new URL(location, parsedURL).toString(), redirectCount + 1)
            .then(resolve)
            .catch(reject);
          return;
        }
        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(createError('CUTOUT_IMAGE_UNAVAILABLE', '主体图片下载失败'));
          return;
        }

        const chunks = [];
        let totalBytes = 0;
        response.on('data', chunk => {
          totalBytes += chunk.length;
          if (totalBytes > MAX_IMAGE_BYTES) {
            response.destroy(createError('CUTOUT_IMAGE_TOO_LARGE', '主体图片过大'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            buffer,
            contentType: detectImageContentType(buffer, response.headers && response.headers['content-type']),
          });
        });
        response.on('error', reject);
      }
    );
    requestInstance.on('timeout', () => {
      requestInstance.destroy(createError('CUTOUT_IMAGE_TIMEOUT', '主体图片处理超时'));
    });
    requestInstance.on('error', reject);
  });
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmacSha256(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value).digest(encoding);
}

function getNativeAiartConfig() {
  return {
    secretId: String(process.env.AIART_SECRET_ID || process.env.TENCENTCLOUD_SECRETID || '').trim(),
    secretKey: String(process.env.AIART_SECRET_KEY || process.env.TENCENTCLOUD_SECRETKEY || '').trim(),
    sessionToken: String(process.env.AIART_SESSION_TOKEN || process.env.TENCENTCLOUD_SESSIONTOKEN || '').trim(),
    region: String(process.env.AIART_REGION || process.env.TENCENTCLOUD_REGION || NATIVE_AIART_DEFAULT_REGION).trim(),
  };
}

function createTencentAuthorization(body, timestamp, config) {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${NATIVE_AIART_HOST}\n`;
  const signedHeaders = 'content-type;host';
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    sha256(body),
  ].join('\n');
  const credentialScope = `${date}/${NATIVE_AIART_SERVICE}/tc3_request`;
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(timestamp),
    credentialScope,
    sha256(canonicalRequest),
  ].join('\n');
  const secretDate = hmacSha256(`TC3${config.secretKey}`, date);
  const secretService = hmacSha256(secretDate, NATIVE_AIART_SERVICE);
  const secretSigning = hmacSha256(secretService, 'tc3_request');
  const signature = hmacSha256(secretSigning, stringToSign, 'hex');
  return {
    authorization: `TC3-HMAC-SHA256 Credential=${config.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    date,
  };
}

function requestNativeImageToImage(payload) {
  const config = getNativeAiartConfig();
  if (!config.secretId || !config.secretKey) {
    throw createError(
      'NATIVE_IMAGE_AUTH_MISSING',
      '腾讯云原生图生图未配置 API 密钥，请配置 AIART_SECRET_ID 和 AIART_SECRET_KEY'
    );
  }

  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const auth = createTencentAuthorization(body, timestamp, config);
  const headers = {
    Authorization: auth.authorization,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-TC-Action': NATIVE_AIART_ACTION,
    'X-TC-Version': NATIVE_AIART_VERSION,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Region': config.region,
  };
  if (config.sessionToken) headers['X-TC-Token'] = config.sessionToken;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };
    const request = https.request(
      {
        hostname: NATIVE_AIART_HOST,
        port: 443,
        path: '/',
        method: 'POST',
        headers,
        timeout: 120000,
      },
      response => {
        const chunks = [];
        let totalBytes = 0;
        response.on('data', chunk => {
          totalBytes += chunk.length;
          if (totalBytes > MAX_NATIVE_RESPONSE_BYTES) {
            response.destroy();
            finish(createError('NATIVE_IMAGE_RESPONSE_TOO_LARGE', '腾讯云原生图生图返回结果过大'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          const responseText = Buffer.concat(chunks).toString('utf8');
          let result;
          try {
            result = JSON.parse(responseText);
          } catch (error) {
            finish(createError('NATIVE_IMAGE_RESPONSE_INVALID', '腾讯云原生图生图返回格式无效'));
            return;
          }

          const apiResponse = result && result.Response;
          if (!apiResponse || apiResponse.Error) {
            const apiError = apiResponse && apiResponse.Error;
            const error = createError(
              'NATIVE_IMAGE_API_ERROR',
              apiError && apiError.Message
                ? `腾讯云原生图生图失败：${apiError.Message}`
                : `腾讯云原生图生图请求失败（HTTP ${response.statusCode || 0}）`
            );
            error.requestId = apiResponse && apiResponse.RequestId ? apiResponse.RequestId : '';
            error.tencentCode = apiError && apiError.Code ? String(apiError.Code) : '';
            finish(error);
            return;
          }

          if (Number(response.statusCode || 0) < 200 || Number(response.statusCode || 0) >= 300) {
            finish(createError('NATIVE_IMAGE_HTTP_ERROR', `腾讯云原生图生图请求失败（HTTP ${response.statusCode || 0}）`));
            return;
          }

          const resultImage = String(apiResponse.ResultImage || '').trim();
          if (!resultImage) {
            finish(createError('NATIVE_IMAGE_UNAVAILABLE', '腾讯云原生图生图没有返回图片'));
            return;
          }
          const base64 = resultImage.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '');
          let buffer;
          try {
            buffer = Buffer.from(base64, 'base64');
          } catch (error) {
            finish(createError('NATIVE_IMAGE_RESPONSE_INVALID', '腾讯云原生图生图图片格式无效'));
            return;
          }
          if (!buffer.length) {
            finish(createError('NATIVE_IMAGE_RESPONSE_INVALID', '腾讯云原生图生图图片为空'));
            return;
          }
          finish(null, {
            buffer,
            contentType: detectImageContentType(buffer, 'image/jpeg'),
            requestId: apiResponse.RequestId || '',
          });
        });
        response.on('error', error => finish(error));
      }
    );
    request.on('timeout', () => {
      request.destroy();
      finish(createError('NATIVE_IMAGE_TIMEOUT', '腾讯云原生图生图超时'));
    });
    request.on('error', error => {
      if (error && error.code === 'ECONNRESET') {
        finish(createError('NATIVE_IMAGE_TIMEOUT', '腾讯云原生图生图超时'));
        return;
      }
      finish(error);
    });
    request.write(body);
    request.end();
  });
}

async function generateNativeSubjectImage(sourceImage) {
  const imageBase64 = sourceImage.buffer.toString('base64');
  if (Buffer.byteLength(imageBase64, 'utf8') >= MAX_NATIVE_INPUT_BASE64_BYTES) {
    throw createError('NATIVE_IMAGE_TOO_LARGE', '原始图片超过腾讯云原生图生图大小限制');
  }
  const result = await requestNativeImageToImage({
    InputImage: imageBase64,
    Prompt: NATIVE_SUBJECT_PROMPT,
    NegativePrompt: NATIVE_NEGATIVE_PROMPT,
    Styles: NATIVE_STYLES,
    ResultConfig: { Resolution: 'origin' },
    LogoAdd: LOGO_ADD,
    Strength: NATIVE_SUBJECT_STRENGTH,
    RspImgType: 'base64',
    EnhanceImage: 0,
    RestoreFace: 0,
  });
  return {
    ...result,
    provider: 'tencent-aiart',
    model: NATIVE_AIART_ACTION,
  };
}

async function generateSubjectImage(sourceImage) {
  if (CAT_TRANSFORM_PROVIDER !== 'tencent-native') {
    throw createError('CUTOUT_PROVIDER_INVALID', '主体图片处理服务配置无效');
  }
  return generateNativeSubjectImage(sourceImage);
}

async function cutoutCat(fileID, contentType) {
  const sourceImage = await getSourceImage(fileID, contentType);
  const generated = await generateSubjectImage(sourceImage);
  const cleaned = removeBakedCheckerboard(generated.buffer, generated.contentType);
  // 按当前产品决定：原图在进入流程前已经完成安全检测；模型结果不再二次复核，
  // 直接保留为主体展示图。若后续需要恢复复核，只在这里增加，不要绕过原图校验。
  const extension = cleaned.contentType === 'image/jpeg' ? 'jpg' : 'png';
  const uploadResult = await cloud.uploadFile({
    cloudPath: `cat-album/cutout/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`,
    fileContent: cleaned.buffer,
  });

  return {
    ok: true,
    cutoutFileID: uploadResult.fileID,
    cutoutContentType: cleaned.contentType,
    checkerboardRemoved: cleaned.removed,
    provider: generated.provider,
    operation: 'image-to-image-subject-only',
    model: generated.model,
    promptVersion: PROMPT_VERSION,
    requestId: generated.requestId || '',
  };
}

exports.main = async (event = {}) => {
  if (event.action !== 'matting') {
    return { ok: false, code: 'INVALID_ACTION' };
  }
  const fileID = String(event.fileID || '').trim();
  if (!fileID) return { ok: false, code: 'INVALID_IMAGE' };

  try {
    return await cutoutCat(fileID, event.contentType);
  } catch (error) {
    const code = error && error.code ? String(error.code).slice(0, 100) : 'CUTOUT_IMAGE_UNAVAILABLE';
    const message = error && error.message
      ? String(error.message).replace(/\s+/g, ' ').slice(0, 240)
      : '主体图片处理失败';
    console.error('[CatTransform] 主体处理失败:', { code, message });
    return {
      ok: false,
      code,
      message,
    };
  }
};
