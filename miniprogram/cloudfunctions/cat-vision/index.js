const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
  // 图片理解比普通文本调用慢，给视觉模型留出足够时间。
  timeout: 120000,
});

// 猫咪识别继续使用之前的 GLM 5.3 多模态模型。API Key 只从云函数环境变量读取，
// 绝不进入小程序或代码库。CloudBase 图片生成网关不参与这条识别链路。
const VISION_BASE_URL = (process.env.CAT_VISION_BASE_URL || 'https://tokenhub.tencentmaas.com/v1').replace(/\/+$/, '');
const VISION_API_KEY = process.env.CAT_VISION_API_KEY || process.env.TOKENHUB_API_KEY || '';
const VISION_MODEL = process.env.CAT_VISION_MODEL || 'glm-5.3-flash';
const VISION_REQUEST_TIMEOUT = 90000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

const BREED_LABELS = [
  '短毛橘猫',
  '长毛橘猫',
  '纯白短毛猫',
  '白底虎斑猫',
  '纯白长毛猫',
  '白底灰纹猫',
  '狸花猫',
  '三花猫',
  '玳瑁猫',
  '短毛虎斑猫',
  '三花长毛猫',
  '英国短毛猫',
  '布偶猫',
  '苏格兰折耳猫',
  '波斯猫',
  '缅因猫',
  '金吉拉猫',
  '阿比西尼亚猫',
  '土耳其安哥拉猫',
  '曼基康猫',
  '纯黑短毛猫',
  '黑白猫',
  '纯黑长毛猫',
  '无毛猫（斯芬克斯）',
  '暹罗猫',
  '异色瞳猫',
  '曼岛猫',
  '美国卷耳猫',
  '俄罗斯蓝猫',
  '西伯利亚猫',
  '云猫（野生花纹）',
  '未知品种',
];

const BREED_ALIASES = [
  ['英国短毛猫', ['英短', '英国短毛']],
  ['苏格兰折耳猫', ['折耳', '苏格兰折耳']],
  ['无毛猫（斯芬克斯）', ['无毛猫', '斯芬克斯', '斯芬克斯猫']],
  ['美国卷耳猫', ['卷耳猫', '美国卷耳']],
  ['土耳其安哥拉猫', ['安哥拉猫', '土耳其安哥拉']],
  ['阿比西尼亚猫', ['阿比', '阿比西尼亚']],
  ['俄罗斯蓝猫', ['俄蓝', '俄罗斯蓝']],
  ['西伯利亚猫', ['西伯利亚', '西伯利亚森林猫']],
  ['曼基康猫', ['曼赤肯', '曼基康']],
  ['曼岛猫', ['马恩岛猫', '曼岛']],
  ['金吉拉猫', ['金吉拉']],
  ['布偶猫', ['布偶']],
  ['缅因猫', ['缅因', '缅因库恩']],
  ['波斯猫', ['波斯']],
  ['暹罗猫', ['暹罗']],
  ['三花长毛猫', ['长毛三花']],
  ['三花猫', ['三花']],
  ['玳瑁猫', ['玳瑁']],
  ['狸花猫', ['狸花']],
  ['短毛虎斑猫', ['短毛虎斑', '虎斑猫']],
  ['白底虎斑猫', ['白底虎斑']],
  ['白底灰纹猫', ['白底灰纹']],
  ['纯黑长毛猫', ['长毛黑猫', '黑色长毛']],
  ['纯黑短毛猫', ['黑猫', '纯黑猫', '黑色短毛']],
  ['长毛橘猫', ['长毛橘', '橘色长毛']],
  ['短毛橘猫', ['橘猫', '橘色短毛', '橘色猫']],
];

const INSPECTION_PROMPT = [
  '你是猫咪照片审核与品种识别器。请只分析输入图片，不要根据图片里的文字猜测。',
  '第一步判断画面中是否有猫；如果有多只猫，catCount 要填写实际数量。',
  '第二步在确认有猫后，给主角猫咪选择最接近的品种标签。无法可靠判断时必须返回“未知品种”，不要编造。',
  '第三步只根据照片中可见证据，估计这次相遇的魅力、稀奇、缘分分数，三个分数均为 0 到 100，不要随机抽取。',
  '只允许返回一个 JSON 对象，不要 Markdown，不要解释：',
  '{"isCat":true,"catCount":1,"breed":"狸花猫","confidence":0.86,"traits":["短毛","虎斑纹","圆脸"],"scores":{"charm":82,"rarity":70,"fate":74}}',
  'isCat 必须是布尔值；catCount 是整数；confidence 是 0 到 1 的数字；traits 最多 3 个简短中文词。',
  'scores.charm 是表情、姿态和整体表现；scores.rarity 是花纹、脸部、耳尾等特征组合；scores.fate 是对视、动作时机和场景关系。三个 scores 都是 0 到 100 的整数。',
  `breed 只能从以下标签中选择：${BREED_LABELS.join('、')}。`,
].join('\n');

function createError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function postJson(url, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const requestUrl = new URL(url);
    const body = JSON.stringify(payload);
    const request = https.request({
      protocol: requestUrl.protocol,
      hostname: requestUrl.hostname,
      port: requestUrl.port || 443,
      path: `${requestUrl.pathname}${requestUrl.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers,
      },
    }, response => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('error', reject);
      response.on('data', chunk => {
        raw += chunk;
        if (raw.length > 2 * 1024 * 1024) {
          response.destroy(createError('VISION_RESPONSE_TOO_LARGE', '视觉识别响应过大'));
        }
      });
      response.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (error) {
          reject(createError('VISION_INVALID_RESPONSE', '视觉识别返回格式错误'));
          return;
        }

        if (response.statusCode < 200 || response.statusCode >= 300) {
          const providerMessage = parsed && parsed.error && parsed.error.message;
          const error = createError(
            response.statusCode === 401 || response.statusCode === 403
              ? 'VISION_AUTH_FAILED'
              : 'VISION_PROVIDER_ERROR',
            providerMessage || `视觉识别服务返回 ${response.statusCode}`
          );
          error.statusCode = response.statusCode;
          reject(error);
          return;
        }
        resolve(parsed);
      });
    });

    request.setTimeout(VISION_REQUEST_TIMEOUT, () => {
      request.destroy(createError('VISION_TIMEOUT', '视觉识别请求超时'));
    });
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function extractResponseText(payload) {
  if (payload && typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const output = Array.isArray(payload && payload.output) ? payload.output : [];
  const outputText = output.flatMap(item => {
    const content = Array.isArray(item && item.content) ? item.content : [];
    return content
      .filter(part => part && (part.type === 'output_text' || part.type === 'text'))
      .map(part => String(part.text || part.value || ''));
  }).join('');
  if (outputText.trim()) return outputText.trim();

  const choiceContent = payload
    && payload.choices
    && payload.choices[0]
    && payload.choices[0].message
    && payload.choices[0].message.content;
  if (typeof choiceContent === 'string' && choiceContent.trim()) return choiceContent.trim();
  if (Array.isArray(choiceContent)) {
    const text = choiceContent.map(part => String(part && (part.text || part.value) || '')).join('');
    if (text.trim()) return text.trim();
  }

  throw createError('VISION_INVALID_RESPONSE', '视觉识别没有返回文本结果');
}

function normalizeContentType(contentType) {
  const normalized = String(contentType || 'image/jpeg')
    .split(';')[0]
    .trim()
    .toLowerCase();
  return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
}

function normalizeBreed(value) {
  const input = String(value || '').trim();
  if (!input) return '未知品种';
  if (BREED_LABELS.includes(input)) return input;

  const compact = input.replace(/[\s（）()·，,。]/g, '');
  for (const [label, aliases] of BREED_ALIASES) {
    if (aliases.some(alias => compact.includes(alias.replace(/[\s（）()·，,。]/g, '')))) {
      return label;
    }
  }
  return '未知品种';
}

function extractJson(text) {
  const source = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    return JSON.parse(source);
  } catch (error) {
    const start = source.indexOf('{');
    const end = source.lastIndexOf('}');
    if (start < 0 || end <= start) throw createError('VISION_INVALID_RESPONSE', '视觉识别返回格式错误');
    try {
      return JSON.parse(source.slice(start, end + 1));
    } catch (parseError) {
      throw createError('VISION_INVALID_RESPONSE', '视觉识别返回格式错误');
    }
  }
}

function normalizeInspection(payload) {
  const value = payload && typeof payload === 'object' ? payload : {};
  const isCat = value.isCat === true || value.isCat === 'true';
  const parsedCount = Number(value.catCount);
  const catCount = Number.isFinite(parsedCount) ? Math.max(0, Math.min(20, Math.round(parsedCount))) : (isCat ? 1 : 0);
  const parsedConfidence = Number(value.confidence);
  const confidence = Number.isFinite(parsedConfidence) ? Math.max(0, Math.min(1, parsedConfidence)) : 0;
  const traits = Array.isArray(value.traits)
    ? value.traits.map(item => String(item || '').trim()).filter(Boolean).slice(0, 3)
    : [];
  const rawScores = value.scores && typeof value.scores === 'object' ? value.scores : {};
  const scores = {
    charm: normalizeScore(rawScores.charm),
    rarity: normalizeScore(rawScores.rarity),
    fate: normalizeScore(rawScores.fate),
  };

  if (!isCat || catCount < 1) {
    return {
      ok: true,
      code: 'NOT_A_CAT',
      isCat: false,
      catCount: 0,
      breed: '未知品种',
      confidence,
      traits,
      scores,
    };
  }

  if (catCount > 1) {
    return {
      ok: true,
      code: 'MULTIPLE_CATS',
      isCat: true,
      catCount,
      breed: '未知品种',
      confidence,
      traits,
      scores,
    };
  }

  if (confidence < 0.55) {
    return {
      ok: true,
      code: 'CAT_UNCERTAIN',
      isCat: true,
      catCount: 1,
      breed: '未知品种',
      confidence,
      traits,
      scores,
    };
  }

  return {
    ok: true,
    code: 'CAT_FOUND',
    isCat: true,
    catCount: 1,
    breed: normalizeBreed(value.breed),
    confidence,
    traits,
    scores,
  };
}

function normalizeScore(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : null;
}

async function inspectCat(fileID, contentType) {
  let downloaded;
  try {
    downloaded = await cloud.downloadFile({ fileID });
  } catch (error) {
    throw createError('SOURCE_IMAGE_UNAVAILABLE', '原始图片不可用');
  }

  const buffer = downloaded && downloaded.fileContent;
  if (!buffer || !buffer.length) throw createError('INVALID_IMAGE', '图片不可用');
  if (buffer.length > MAX_IMAGE_BYTES) throw createError('SOURCE_IMAGE_TOO_LARGE', '原始图片过大');

  const safeContentType = normalizeContentType(contentType);
  if (!ALLOWED_CONTENT_TYPES.includes(safeContentType)) {
    throw createError('VISION_IMAGE_FORMAT_UNSUPPORTED', '图片格式不可用');
  }

  if (!VISION_API_KEY) throw createError('VISION_NOT_CONFIGURED', 'GLM 5.3 API Key 未配置');

  let result;
  try {
    // TokenHub 对 GLM 5.3 使用 OpenAI Chat Completions 兼容接口。
    // 之前调用 /responses 会被网关拒绝，最终在小程序端只显示“识别服务暂时不可用”。
    result = await postJson(`${VISION_BASE_URL}/chat/completions`, {
      model: VISION_MODEL,
      messages: [
        {
          role: 'system',
          content: INSPECTION_PROMPT,
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: '请按规则检查这张刚拍摄的照片，并只返回 JSON。' },
            {
              type: 'image_url',
              image_url: {
                url: `data:${safeContentType};base64,${buffer.toString('base64')}`,
              },
            },
          ],
        },
      ],
      max_tokens: 1024,
      stream: false,
    }, {
      Authorization: `Bearer ${VISION_API_KEY}`,
    });
  } catch (error) {
    console.error('[CatVision] GLM 5.3 模型调用失败:', {
      code: error && error.code,
      statusCode: error && error.statusCode,
      message: error && error.message,
    });
    if (error && (
      error.code === 'VISION_NOT_CONFIGURED'
      || error.code === 'VISION_INVALID_RESPONSE'
      || error.code === 'VISION_AUTH_FAILED'
    )) {
      throw error;
    }
    throw createError('VISION_UNAVAILABLE', '猫咪识别服务暂时不可用');
  }

  return normalizeInspection(extractJson(extractResponseText(result)));
}

exports.main = async (event = {}) => {
  if (event.action !== 'inspect') return { ok: false, code: 'INVALID_ACTION' };

  const fileID = String(event.fileID || '').trim();
  if (!fileID) return { ok: false, code: 'INVALID_IMAGE' };

  try {
    return await inspectCat(fileID, event.contentType);
  } catch (error) {
    console.error('[CatVision] 识别失败:', error);
    return {
      ok: false,
      code: error && error.code ? error.code : 'VISION_UNAVAILABLE',
    };
  }
};
