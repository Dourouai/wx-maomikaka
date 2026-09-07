const https = require('https');
const http = require('http');
const { URL } = require('url');
const cloud = require('wx-server-sdk');

// 这里使用混元图生图做受约束的主体处理，只输出适合猫卡展示的猫咪主体素材。
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

const PROMPT_VERSION = 'cat-subject-only-cloudbase-i2i-v13-required-completion';
// 按项目原来的 CloudBase 图生图链路处理主体，不使用原生 aiart 接口。
const CAT_TRANSFORM_PROVIDER = 'hunyuan-image';
const CAT_TRANSFORM_MODEL = process.env.CAT_TRANSFORM_MODEL || 'HY-Image-v3.0-I2I-ToB-v1.0.1';
const CAT_TRANSFORM_SUB_URL = 'images/ar/generations';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const MAX_CLEANUP_PIXELS = 3 * 1024 * 1024;

const SUBJECT_PROMPT = `这是一个猫咪背景移除与主体完整补齐任务，不是重新生成一只猫，也不是改变猫咪特征。

请以输入图片中的猫咪为唯一主体。先识别猫咪是否因画面边缘裁切、遮挡或原图缺失而不完整。

【原图特征锁定】

原图中已经存在的猫咪区域必须保持不变，禁止重新绘制、替换、变形、拉伸、旋转、缩放、锐化、美化或改变风格。

必须保留猫咪原始的真实照片样式、脸部特征、眼睛、鼻子、嘴巴、胡须、毛色、花纹、体型、比例、姿态、动作、耳朵、四肢、爪子、尾巴、项圈和所有可见细节。不得把猫咪改成另一只猫，不得改变猫咪的表情、体态、姿势、动作、比例或身体结构。

保留猫咪绒绒的、柔软的、蓬松的真实毛发，包括耳缘绒毛、脸颊毛、胸口毛、身体边缘细毛、飞毛、尾巴边缘毛发和胡须。不得压平、削薄、裁掉、模糊或硬化猫咪毛发。

【必须补齐】

如果检测到猫咪被画面边缘裁切、身体被截断、四肢或尾巴缺失，必须对缺失区域进行自然补齐，不能只保留残缺的猫咪轮廓。

补齐只能发生在原图中确实缺失的区域。原图中已经存在的猫咪区域必须原样保留，不得因为补齐而重新生成或修改整只猫。

根据可见的身体结构、姿态、比例、毛色、花纹、光照、透视和毛发方向，补齐自然的下半身、四肢、爪子、尾巴或其他缺失部分。补齐内容必须与原猫咪保持一致，继续使用真实照片风格和柔软蓬松的毛发质感。

不得因为补齐而改变猫咪的动作、体型、脸部、头身比例或原始特征。不得添加多余或重复的眼睛、耳朵、腿、爪子、尾巴或身体结构。不要把“补齐”理解成重新设计猫咪。

如果猫咪本身已经完整，则不要额外生成任何身体部位。如果某个缺失部位完全无法判断，优先根据猫咪自然解剖和可见姿态进行最合理的补齐，但不得生成明显不符合结构的内容。

如猫咪被画面边缘裁切，允许向缺失方向适度扩展透明画布，确保补齐后的猫咪完整显示，不得再次裁切补齐部分。

【去除背景】

只保留猫咪及必要的补齐区域，移除所有不属于猫咪的背景内容，包括地面、墙面、家具、布料、植物、阴影、反光、其他动物、文字、水印和界面元素。即使背景与猫咪接触、重叠或遮挡，也必须删除，不能把背景误判为猫咪。

对猫咪边缘使用自然的 Alpha Matting，保留柔软的半透明毛发，只去除毛发外侧的背景污染。不要保留大片背景，不要误删尾巴、四肢、胡须、细毛或浅色毛发。

最终输出一张完整的猫咪透明 PNG。保持原图猫咪的可见特征不变，补齐所有合理缺失部分，背景必须是真正透明。不要输出原始背景、白底、灰底、纯色背景或棋盘格图案，不要添加其他动物、物体、文字或水印。`;

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

function decodeDataURL(value) {
  const match = String(value || '').match(/^data:([^;,]+);base64,([\s\S]+)$/i);
  if (!match) return null;
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) throw createError('CUTOUT_IMAGE_INVALID', '模型没有返回有效图片');
  return { buffer, contentType: match[1] };
}

async function getGeneratedImage(imageData) {
  if (!imageData || typeof imageData !== 'object') {
    throw createError('CUTOUT_IMAGE_UNAVAILABLE', '模型没有返回主体图片');
  }

  const dataURL = decodeDataURL(imageData.url);
  if (dataURL) return dataURL;

  const base64 = imageData.b64_json || imageData.base64;
  if (base64) {
    const buffer = Buffer.from(
      String(base64).replace(/^data:image\/[a-z0-9.+-]+;base64,/i, ''),
      'base64'
    );
    if (!buffer.length) throw createError('CUTOUT_IMAGE_INVALID', '模型返回了空主体图片');
    return { buffer, contentType: detectImageContentType(buffer, 'image/png') };
  }

  const imageURL = imageData.url || imageData.image_url;
  if (!imageURL) throw createError('CUTOUT_IMAGE_UNAVAILABLE', '模型没有返回主体图片地址');
  return downloadImage(String(imageURL));
}

function normalizeCloudBaseError(error) {
  if (error && error.code && String(error.code).startsWith('CLOUDBASE_IMAGE_')) return error;
  const providerMessage = error && error.message ? String(error.message) : '';
  const isTimeout = /timeout|timed out|超时/i.test(providerMessage);
  const normalized = createError(
    isTimeout ? 'CLOUDBASE_IMAGE_TIMEOUT' : 'CLOUDBASE_IMAGE_API_ERROR',
    isTimeout ? 'CloudBase 图生图等待超时' : 'CloudBase 图生图服务暂时不可用'
  );
  normalized.providerMessage = providerMessage.replace(/\s+/g, ' ').slice(0, 240);
  return normalized;
}

function createCloudBaseImageModel() {
  if (!cloud.ai || typeof cloud.ai !== 'function') {
    throw createError('CLOUDBASE_IMAGE_NOT_CONFIGURED', 'CloudBase 图像模型未配置');
  }
  const ai = cloud.ai();
  if (!ai || typeof ai.createImageModel !== 'function') {
    throw createError('CLOUDBASE_IMAGE_NOT_CONFIGURED', 'CloudBase 图像模型未配置');
  }

  const imageModel = ai.createImageModel(CAT_TRANSFORM_PROVIDER);
  // SDK 默认也是该路径，这里显式固定，避免模型路由被 SDK 默认值改动。
  if (imageModel && typeof imageModel === 'object') {
    imageModel.defaultGenerateImageSubUrl = CAT_TRANSFORM_SUB_URL;
  }
  return imageModel;
}

async function generateCloudBaseSubjectImage(sourceImage) {
  const imageBase64 = sourceImage.buffer.toString('base64');
  let response;
  try {
    const imageModel = createCloudBaseImageModel();
    response = await imageModel.generateImage({
      model: CAT_TRANSFORM_MODEL,
      prompt: SUBJECT_PROMPT,
      // CloudBase 图生图官方支持 images（base64）或 image_urls；images 优先级更高。
      images: [imageBase64],
      // 关闭 prompt 改写，避免模型把主体抠图改成海报/插画创作。
      revise: { value: false },
      // 仅保留一个轻量自定义标识，不传 LogoAdd，避免混用平台水印控制参数。
      footnote: '·',
    });
  } catch (error) {
    throw normalizeCloudBaseError(error);
  }

  const imageData = response && Array.isArray(response.data) ? response.data[0] : null;
  const image = await getGeneratedImage(imageData);
  return {
    ...image,
    provider: CAT_TRANSFORM_PROVIDER,
    model: CAT_TRANSFORM_MODEL,
    requestId: response && response.id ? response.id : '',
  };
}

async function generateSubjectImage(sourceImage) {
  if (CAT_TRANSFORM_PROVIDER !== 'hunyuan-image') {
    throw createError('CUTOUT_PROVIDER_INVALID', '主体图片处理服务配置无效');
  }
  return generateCloudBaseSubjectImage(sourceImage);
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
