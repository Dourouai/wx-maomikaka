const https = require('https');
const http = require('http');
const { URL } = require('url');
const cloud = require('wx-server-sdk');

// 海报封面是独立的图生图业务，不修改 cat-transform 的主体抠图入口。
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
  timeout: 900000,
});

const db = cloud.database();
const ENCOUNTERS_COLLECTION = 'encounters';
const COVER_VERSION = 'cat-cover.v0.3';
const PROMPT_VERSION = 'cat-cover-prompt.v0.3';
const COVER_PROVIDER = 'hunyuan-image';
const COVER_MODEL = process.env.CAT_TRANSFORM_MODEL || 'HY-Image-v3.0-I2I-ToB-v1.0.1';
const COVER_SUB_URL = 'images/ar/generations';
const TARGET_RATIO = '359:537';
const TARGET_SIZE = '718x1074';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 3;

const BASE_COVER_PROMPT = `这是一个猫咪海报主视觉封面图生成任务，只生成一张竖版“真实照片猫咪＋高品质手绘动漫背景”的合成图，不是完整海报，不是卡片版式，也不是重新设计一只猫。

【猫咪不可替换、不可重绘】
输入图片中的唯一猫咪是不可替换、不可重绘的真实照片主体。必须保持原图猫咪的实拍摄影风格、真实质感、脸部特征、眼睛、鼻子、嘴巴、胡须、毛色、花纹、体型、比例、姿态、动作、耳朵、四肢、爪子、尾巴和所有可见细节。不要生成另一只猫，不要改变表情、动作、姿势、身体比例、花纹或尾巴。不得把猫咪变成手绘、动漫、插画、油画、卡通、3D、塑料模型或玩偶。不得把背景的纹理、线条、笔触、植物、地面或物体覆盖到猫咪身上。

【猫咪大小与构图】
猫咪必须明显小于当前首版，作为环境中的小比例真实主体，而不是人像特写。采用中远景或完整全身构图，通过整体缩放猫咪来调整大小，不改变身体比例。猫咪整体外接矩形控制在画面面积约 8%—15%，主体高度约占画面高度 22%—30%，宽度不超过画面宽度 45%；猫咪不得占据画面一半以上。画面至少保留约 70% 的可见环境空间，猫咪放在下方中央或略偏下的位置，耳朵、尾巴、四肢和爪子完整可见，周围保留充分安全边距，不贴边、不裁切、不被背景遮挡。背景必须占据画面主要区域并形成完整场景，禁止把猫咪放大成前景主角或近距离坐像。

【毛发保真】
保留猫咪绒绒、柔软、蓬松的实拍毛发，包括耳缘绒毛、脸颊毛、胸口绒毛、身体边缘细毛、飞毛、尾巴边缘毛发和胡须。毛发边缘自然、柔和、细碎，不压平、不削薄、不模糊、不硬化、不凭空增加原图没有的花纹、长毛、肢体或结构。

【统一的背景画风】
背景使用高品质手绘动画电影与精致卡牌插画风格，细腻手绘线条、水彩与水粉笔触、丰富但克制的环境材质、前景中景远景层次、自然光影、空气透视和电影感构图。统一的是笔触、色彩控制、光影质量和猫咪与环境的融合方式，不要复制固定模板、固定机位或固定建筑。背景要有明确主题、温暖、有故事感且有辨识度，但不能杂乱、空白、普通、幼稚卡通、扁平矢量或喧宾夺主。根据猫咪动作匹配合理的透视、地面支撑、接触阴影、环境光和色温，只用柔和环境光让照片猫咪融入背景，不改变猫咪照片质感。

【场景差异硬约束】
绝对不要把“日式小店门口＋木门＋连续屋檐＋纸灯笼＋盆栽”当作默认背景。只有本次场景方向明确要求时，才允许出现其中一项建筑元素，而且不能让它成为每张图的主体结构。

【画幅与输出】
输出尺寸严格为 718×1074，比例 359:537，适配猫咪海报主图区域。只生成一张完整、不透明的猫咪与手绘背景合成图。不要生成透明背景、棋盘格、白底、灰底或留白画布。

【禁止内容】
禁止第二只猫、重复猫、其他动物、人物、猫脸变化、花纹变化、换品种、额外眼睛、额外耳朵、多余四肢、断尾、残肢、融化、塑料毛发、动漫化猫咪、插画化猫咪、海报、卡片、相框、边框、标签、编号、中文、英文、乱码、Logo、水印、品牌字样、相机界面、截图、UI、评分、数字和任何文字。不要在图片中写入猫咪名字、品种、描述、等级或海报文案。`;

const SCENE_VARIANTS = [
  {
    key: 'riverside-stone-bridge',
    label: '河岸小路与石桥',
    include: '低矮石岸、浅水反光、小拱桥、芦苇或岸边野草、开阔天空和较远的树影',
    avoid: '店铺正面、木门、纸灯笼、连续屋檐、密集盆栽',
  },
  {
    key: 'seaside-harbor',
    label: '海边堤岸或小码头',
    include: '海平线、潮湿石面、潮池或木质护栏、海风吹动的草丛、通透天空和远处海雾',
    avoid: '日式店铺门面、室内窗边、纸灯笼、密集建筑立面',
  },
  {
    key: 'forest-park-trail',
    label: '林间公园小径',
    include: '高大树干、斑驳树影、苔藓、落叶小径、蕨类植物和深浅不同的绿色层次',
    avoid: '木门、商店、灯笼、城市招牌、规则排列的盆栽',
  },
  {
    key: 'courtyard-garden',
    label: '开放庭院与花园角落',
    include: '低矮围墙、花坛、野花、石板小路、树荫、藤蔓和一处远景建筑边缘',
    avoid: '正面木门、完整店铺立面、重复屋檐、成排灯笼',
  },
  {
    key: 'rooftop-skyline',
    label: '屋顶平台与远景天空',
    include: '低矮女儿墙、屋顶植物、晾晒杆或水箱的简化轮廓、远处城市天际线和大面积天空',
    avoid: '地面街巷、店铺门口、近距离建筑正面、纸灯笼',
  },
  {
    key: 'rainy-concrete-alley',
    label: '雨后混凝土小巷',
    include: '湿润地面、浅浅倒影、混凝土墙面、排水沟、柔和路灯反光和雨后空气感',
    avoid: '木质日式门面、纸灯笼、清晰招牌、人物、车辆',
  },
  {
    key: 'quiet-station-platform',
    label: '安静的旧车站月台',
    include: '月台边缘、铁轨或木质长椅的局部、站棚结构、远处树线和清晨薄雾',
    avoid: '店铺街景、完整招牌、可读文字、纸灯笼、人物',
  },
  {
    key: 'sunlit-stairway',
    label: '阳光下的旧住宅台阶',
    include: '石阶、粗糙灰泥墙、扶手、墙角植物、强弱交替的日照和向上延伸的空间',
    avoid: '商业店铺、正面木门、重复灯笼、卡片式对称构图',
  },
];

function normalizeSceneSeed(value) {
  return String(value || 'poster-scene-default')
    .replace(/[^a-z0-9:_-]/gi, '')
    .slice(0, 120) || 'poster-scene-default';
}

function getSceneVariant(sceneSeed) {
  const normalized = normalizeSceneSeed(sceneSeed);
  let hash = 2166136261;
  Array.from(normalized).forEach(character => {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  });
  return SCENE_VARIANTS[(hash >>> 0) % SCENE_VARIANTS.length];
}

function buildCoverPrompt(sceneSeed) {
  const scene = getSceneVariant(sceneSeed);
  return `${BASE_COVER_PROMPT}

【本张图的场景方向】
本次必须执行以下唯一场景方向：${scene.label}。
场景中至少清晰体现以下 3 项环境线索：${scene.include}。
这组环境线索只服务于本张图的空间叙事，要自然分布在前景、中景和远景，不要把物件堆成装饰清单。明确避开：${scene.avoid}。
不要退回常见的木门店铺街景，不要因为输入猫咪照片而自动套用上一张图的背景。不要固定使用晴天午后、暖黄色光、正面居中的建筑构图；请在清晨薄雾、阴天柔光、雨后反光、蓝调黄昏、侧逆光等氛围中选择最适合本张图的一种，并改变机位和远近层次。猫咪仍是唯一真实照片主体，场景必须有明显不同的空间类型、机位、光线和主色关系。`;
}

function createError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
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
      buffer[6] === 0x1a && buffer[7] === 0x0a) return 'image/png';
  if (buffer && buffer.length >= 3 &&
      buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  return getImageContentType(declaredContentType);
}

function isSupportedImage(buffer, contentType) {
  const safeType = getImageContentType(contentType);
  return ['image/png', 'image/jpeg'].includes(safeType)
    && detectImageContentType(buffer, safeType) === safeType;
}

function getCurrentOpenId() {
  try {
    const context = cloud.getWXContext();
    return String(context && context.OPENID || '').trim().slice(0, 128);
  } catch (error) {
    return '';
  }
}

function getCoverIdentity(event) {
  const source = event && typeof event === 'object' ? event : {};
  return {
    ownerOpenId: getCurrentOpenId(),
    deviceId: String(source.deviceId || '').trim().slice(0, 128),
    sourceRecordId: String(source.sourceRecordId || source.recordId || '')
      .trim().slice(0, 128),
    catalogCatId: String(source.catalogCatId || source.sourceArchiveId || '')
      .trim().slice(0, 64),
  };
}

function getStoredCover(encounter) {
  const source = encounter && typeof encounter === 'object' ? encounter : {};
  const media = source.media && typeof source.media === 'object' ? source.media : {};
  const posterResult = media.posterResult && typeof media.posterResult === 'object'
    ? media.posterResult
    : {};
  const coverImage = posterResult.coverImage && typeof posterResult.coverImage === 'object'
    ? posterResult.coverImage
    : {};
  const declaredStatus = String(
    media.coverStatus
      || source.coverStatus
      || posterResult.coverStatus
      || coverImage.status
      || '',
  ).trim().toLowerCase();
  const fileID = String(
    media.coverFileID
      || source.coverFileID
      || coverImage.fileID
      || (posterResult.sourceImage
        && posterResult.sourceImage.kind === 'cover'
        ? posterResult.sourceImage.fileID
        : '')
      || '',
  ).trim();

  // 旧记录可能只有 coverFileID，没有 coverStatus；只要没有明确标记失败/处理中，
  // 就按已经生成过的成品兼容读取。明确 rejected/pending 时不能误判为可复用。
  const status = declaredStatus || (fileID ? 'ready' : '');
  if (!fileID || status !== 'ready') return null;

  return {
    ok: true,
    reused: true,
    coverFileID: fileID,
    coverContentType: String(
      media.coverContentType || source.coverContentType || coverImage.contentType || 'image/jpeg',
    ).trim(),
    coverStatus: 'ready',
    coverVersion: String(coverImage.version || COVER_VERSION).trim(),
    targetRatio: String(media.coverTargetRatio || source.coverTargetRatio
      || coverImage.targetRatio || TARGET_RATIO).trim(),
    targetSize: TARGET_SIZE,
    provider: String(media.coverProvider || source.coverProvider
      || coverImage.provider || COVER_PROVIDER).trim(),
    model: String(media.coverModel || source.coverModel
      || coverImage.model || COVER_MODEL).trim(),
    operation: String(media.coverOperation || source.coverOperation
      || coverImage.operation || 'image-to-image-poster-cover').trim(),
    promptVersion: String(media.coverPromptVersion || source.coverPromptVersion
      || coverImage.promptVersion || PROMPT_VERSION).trim(),
    sceneVariant: String(coverImage.sceneVariant || '').trim(),
    requestId: String(media.coverRequestId || source.coverRequestId
      || coverImage.requestId || '').trim(),
    createdAt: String(media.coverCreatedAt || source.coverCreatedAt
      || coverImage.createdAt || '').trim() || new Date().toISOString(),
    coverRejectReason: '',
  };
}

async function findStoredCover(event) {
  const identity = getCoverIdentity(event);
  if (!identity.ownerOpenId || !identity.sourceRecordId || !identity.catalogCatId) return null;

  try {
    let response = null;
    if (identity.deviceId) {
      response = await db.collection(ENCOUNTERS_COLLECTION)
        .where({
          ownerOpenId: identity.ownerOpenId,
          clientRecordKey: `${identity.deviceId}:${identity.sourceRecordId}`,
          status: 'active',
        })
        .limit(1)
        .get();
    }
    if (!response || !Array.isArray(response.data) || !response.data.length) {
      response = await db.collection(ENCOUNTERS_COLLECTION)
        .where({
          ownerOpenId: identity.ownerOpenId,
          clientRecordId: identity.sourceRecordId,
          catalogCatId: identity.catalogCatId,
          status: 'active',
        })
        .limit(1)
        .get();
    }
    const encounter = response && Array.isArray(response.data)
      ? response.data[0]
      : null;
    if (encounter && String(encounter.catalogCatId || '').trim() !== identity.catalogCatId) {
      return null;
    }
    return getStoredCover(encounter);
  } catch (error) {
    // 缓存查询失败不能阻断本次生成；生成结果仍会返回，客户端/同步链路继续兜底保存。
    console.warn('[PosterCover] 查询已有封面失败，继续生成:', {
      code: error && (error.errCode || error.code) || '',
      message: error && (error.errMsg || error.message) || '',
    });
    return null;
  }
}

async function persistGeneratedCover(event, cover) {
  const identity = getCoverIdentity(event);
  if (!identity.ownerOpenId || !identity.sourceRecordId || !identity.catalogCatId) {
    return { saved: false, reason: 'COVER_SOURCE_NOT_SYNCED' };
  }

  try {
    let response = null;
    if (identity.deviceId) {
      response = await db.collection(ENCOUNTERS_COLLECTION)
        .where({
          ownerOpenId: identity.ownerOpenId,
          clientRecordKey: `${identity.deviceId}:${identity.sourceRecordId}`,
          status: 'active',
        })
        .limit(1)
        .get();
    }
    if (!response || !Array.isArray(response.data) || !response.data.length) {
      response = await db.collection(ENCOUNTERS_COLLECTION)
        .where({
          ownerOpenId: identity.ownerOpenId,
          clientRecordId: identity.sourceRecordId,
          catalogCatId: identity.catalogCatId,
          status: 'active',
        })
        .limit(1)
        .get();
    }
    const encounter = response && Array.isArray(response.data)
      ? response.data[0]
      : null;
    if (!encounter || !encounter._id
      || String(encounter.catalogCatId || '').trim() !== identity.catalogCatId) {
      return { saved: false, reason: 'COVER_SOURCE_NOT_SYNCED' };
    }

    const media = encounter.media && typeof encounter.media === 'object'
      ? encounter.media
      : {};
    const nextMedia = {
      ...media,
      coverFileID: cover.coverFileID,
      coverContentType: cover.coverContentType,
      coverProvider: cover.provider,
      coverModel: cover.model,
      coverOperation: cover.operation,
      coverPromptVersion: cover.promptVersion,
      coverTargetRatio: cover.targetRatio,
      coverStatus: 'ready',
      coverRequestId: cover.requestId || '',
      coverCreatedAt: cover.createdAt,
      coverRejectReason: '',
    };
    const mediaUpdate = db.command && typeof db.command.set === 'function'
      ? db.command.set(nextMedia)
      : nextMedia;
    await db.collection(ENCOUNTERS_COLLECTION).doc(encounter._id).update({
      data: {
        // 先保存封面再排版最终海报，避免 posterResult 同步失败导致下次重复生图。
        media: mediaUpdate,
        updatedAt: db.serverDate(),
      },
    });
    return { saved: true, encounterId: encounter._id };
  } catch (error) {
    // 不能因为“立即落库”失败而丢掉已经生成的封面；后续 save-poster-result/import 仍会重试。
    console.warn('[PosterCover] 立即保存封面失败，保留生成结果:', {
      code: error && (error.errCode || error.code) || '',
      message: error && (error.errMsg || error.message) || '',
    });
    return { saved: false, reason: 'COVER_PERSIST_FAILED' };
  }
}

async function getSourceImage(fileID, contentType) {
  let downloaded;
  try {
    downloaded = await cloud.downloadFile({ fileID });
  } catch (error) {
    throw createError('SOURCE_IMAGE_UNAVAILABLE', '用于生成封面的猫咪照片不可用');
  }

  const buffer = downloaded && downloaded.fileContent;
  if (!buffer || !buffer.length) {
    throw createError('SOURCE_IMAGE_UNAVAILABLE', '用于生成封面的猫咪照片为空');
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw createError('SOURCE_IMAGE_TOO_LARGE', '用于生成封面的猫咪照片过大');
  }

  const safeType = getImageContentType(contentType);
  if (!isSupportedImage(buffer, safeType)) {
    throw createError('SOURCE_IMAGE_FORMAT_UNSUPPORTED', '用于生成封面的图片格式不可用');
  }
  return { buffer, contentType: safeType };
}

function downloadImage(url, redirectCount = 0) {
  if (!url || redirectCount > MAX_REDIRECTS) {
    return Promise.reject(createError('COVER_IMAGE_UNAVAILABLE', '封面图片地址不可用'));
  }

  let parsedURL;
  try {
    parsedURL = new URL(url);
  } catch (error) {
    return Promise.reject(createError('COVER_IMAGE_UNAVAILABLE', '封面图片地址无效'));
  }
  if (!['http:', 'https:'].includes(parsedURL.protocol)) {
    return Promise.reject(createError('COVER_IMAGE_UNAVAILABLE', '封面图片地址协议不可用'));
  }

  const request = parsedURL.protocol === 'http:' ? http.get : https.get;
  return new Promise((resolve, reject) => {
    const requestInstance = request(
      parsedURL,
      { timeout: 120000, headers: { 'User-Agent': 'maomi-kaka-poster-cover' } },
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
          reject(createError('COVER_IMAGE_UNAVAILABLE', `封面图片下载失败（HTTP ${statusCode}）`));
          return;
        }

        const chunks = [];
        let totalBytes = 0;
        response.on('data', chunk => {
          totalBytes += chunk.length;
          if (totalBytes > MAX_IMAGE_BYTES) {
            response.destroy();
            reject(createError('COVER_IMAGE_TOO_LARGE', '封面图片过大'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          const buffer = Buffer.concat(chunks);
          if (!buffer.length) {
            reject(createError('COVER_IMAGE_INVALID', '模型返回了空封面图片'));
            return;
          }
          resolve({
            buffer,
            contentType: detectImageContentType(
              buffer,
              response.headers && response.headers['content-type'],
            ),
          });
        });
        response.on('error', reject);
      },
    );
    requestInstance.on('timeout', () => {
      requestInstance.destroy(createError('COVER_IMAGE_TIMEOUT', '封面图片下载超时'));
    });
    requestInstance.on('error', reject);
  });
}

function decodeDataURL(value) {
  const match = String(value || '').match(/^data:([^;,]+);base64,([\s\S]+)$/i);
  if (!match) return null;
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) throw createError('COVER_IMAGE_INVALID', '模型返回了空封面图片');
  return { buffer, contentType: match[1] };
}

async function getGeneratedImage(imageData) {
  if (!imageData || typeof imageData !== 'object') {
    throw createError('COVER_IMAGE_UNAVAILABLE', '模型没有返回封面图片');
  }

  const dataURL = decodeDataURL(imageData.url);
  if (dataURL) return dataURL;

  const base64 = imageData.b64_json || imageData.base64;
  if (base64) {
    const buffer = Buffer.from(
      String(base64).replace(/^data:image\/[a-z0-9.+-]+;base64,/i, ''),
      'base64',
    );
    if (!buffer.length) throw createError('COVER_IMAGE_INVALID', '模型返回了空封面图片');
    return { buffer, contentType: detectImageContentType(buffer, 'image/png') };
  }

  const imageURL = imageData.url || imageData.image_url;
  if (!imageURL) throw createError('COVER_IMAGE_UNAVAILABLE', '模型没有返回封面图片地址');
  return downloadImage(String(imageURL));
}

function normalizeCloudBaseError(error) {
  if (
    error &&
    error.code &&
    (String(error.code).startsWith('CLOUDBASE_IMAGE_') || error.code === 'COVER_PROVIDER_UNAVAILABLE')
  ) {
    return error;
  }
  const providerMessage = error && error.message ? String(error.message) : '';
  const isTimeout = /timeout|timed out|超时/i.test(providerMessage);
  const normalized = createError(
    isTimeout ? 'CLOUDBASE_IMAGE_TIMEOUT' : 'CLOUDBASE_IMAGE_API_ERROR',
    isTimeout ? 'CloudBase 图生图等待超时' : 'CloudBase 图生图服务暂时不可用',
  );
  normalized.providerMessage = providerMessage.replace(/\s+/g, ' ').slice(0, 240);
  return normalized;
}

function createCloudBaseImageModel() {
  if (!cloud.ai || typeof cloud.ai !== 'function') {
    throw createError('COVER_PROVIDER_UNAVAILABLE', 'CloudBase 图像模型未配置');
  }
  const ai = cloud.ai();
  if (!ai || typeof ai.createImageModel !== 'function') {
    throw createError('COVER_PROVIDER_UNAVAILABLE', 'CloudBase 图像模型未配置');
  }

  const imageModel = ai.createImageModel(COVER_PROVIDER);
  if (imageModel && typeof imageModel === 'object') {
    imageModel.defaultGenerateImageSubUrl = COVER_SUB_URL;
  }
  return imageModel;
}

async function generateCoverImage(sourceImage, sceneSeed) {
  const scene = getSceneVariant(sceneSeed);
  let response;
  try {
    const imageModel = createCloudBaseImageModel();
    response = await imageModel.generateImage({
      model: COVER_MODEL,
      prompt: buildCoverPrompt(sceneSeed),
      size: TARGET_SIZE,
      // 关闭提示词改写，避免服务把封面任务扩写成完整海报。
      revise: { value: false },
      // 按产品要求保留一个轻量自定义标识；Canvas 仍负责海报中的所有档案文字。
      footnote: '·',
      images: [sourceImage.buffer.toString('base64')],
    });
  } catch (error) {
    throw normalizeCloudBaseError(error);
  }

  const imageData = response && Array.isArray(response.data) ? response.data[0] : null;
  const generated = await getGeneratedImage(imageData);
  const contentType = detectImageContentType(generated.buffer, generated.contentType);
  if (!isSupportedImage(generated.buffer, contentType)) {
    throw createError('COVER_IMAGE_FORMAT_UNSUPPORTED', '模型返回的封面图片格式不可用');
  }
  if (generated.buffer.length > MAX_IMAGE_BYTES) {
    throw createError('COVER_IMAGE_TOO_LARGE', '模型返回的封面图片过大');
  }

  return {
    buffer: generated.buffer,
    contentType,
    provider: COVER_PROVIDER,
    model: COVER_MODEL,
    requestId: response && response.id ? response.id : '',
    sceneVariant: scene.key,
  };
}

async function generatePosterCover(fileID, contentType, sceneSeed, event) {
  const sourceImage = await getSourceImage(fileID, contentType);
  const generated = await generateCoverImage(sourceImage, sceneSeed);
  const extension = generated.contentType === 'image/jpeg' ? 'jpg' : 'png';
  const uploadResult = await cloud.uploadFile({
    cloudPath: `cat-album/poster-cover/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`,
    fileContent: generated.buffer,
  });
  if (!uploadResult || !uploadResult.fileID) {
    throw createError('COVER_UPLOAD_FAILED', '封面图片保存失败');
  }

  const result = {
    ok: true,
    coverFileID: uploadResult.fileID,
    coverContentType: generated.contentType,
    coverStatus: 'ready',
    coverVersion: COVER_VERSION,
    targetRatio: TARGET_RATIO,
    targetSize: TARGET_SIZE,
    provider: generated.provider,
    model: generated.model,
    operation: 'image-to-image-poster-cover',
    promptVersion: PROMPT_VERSION,
    sceneVariant: generated.sceneVariant || '',
    requestId: generated.requestId || '',
    createdAt: new Date().toISOString(),
    coverRejectReason: '',
  };
  await persistGeneratedCover(event, result);
  return result;
}

exports.main = async (event = {}) => {
  if (event.action !== 'generate') return { ok: false, code: 'INVALID_ACTION' };

  const fileID = String(
    event.fileID || event.originalFileID || event.subjectFileID || '',
  ).trim();
  if (!fileID) return { ok: false, code: 'SOURCE_IMAGE_UNAVAILABLE' };

  const targetRatio = String(event.targetRatio || TARGET_RATIO).trim();
  if (targetRatio !== TARGET_RATIO) {
    return { ok: false, code: 'COVER_RATIO_INVALID', message: '封面图比例必须为 359:537' };
  }

  const sceneSeed = event.sceneSeed || event.archiveCode || event.recordId || fileID;
  try {
    // 同一猫卡记录命中已保存的封面时，直接返回原 fileID，绝不再次调用图生图模型。
    const stored = await findStoredCover(event);
    if (stored) return stored;
    return await generatePosterCover(fileID, event.contentType, sceneSeed, event);
  } catch (error) {
    const code = error && error.code ? String(error.code).slice(0, 100) : 'COVER_PROVIDER_UNAVAILABLE';
    const message = error && error.message
      ? String(error.message).replace(/\s+/g, ' ').slice(0, 240)
      : '猫咪封面生成失败';
    console.error('[PosterCover] 封面生成失败:', { code, message });
    return { ok: false, code, message };
  }
};
