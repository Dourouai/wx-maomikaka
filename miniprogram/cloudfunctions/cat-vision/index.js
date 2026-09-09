const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
  // 图片理解比普通文本调用慢，给视觉模型留出足够时间。
  timeout: 120000,
});

// 猫咪识别继续使用之前的 GLM 5.3 多模态模型。API Key 只从云函数环境变量读取，
// 绝不进入小程序或代码库。CloudBase 图片生成网关不参与这条识别链路。
function normalizeVisionBaseUrl(value) {
  const source = String(value || '').trim() || 'https://tokenhub.tencentmaas.com/v1';
  return source
    .replace(/\/+$/, '')
    .replace(/\/(?:chat\/completions|responses)$/i, '');
}

const VISION_BASE_URL = normalizeVisionBaseUrl(process.env.CAT_VISION_BASE_URL);
const VISION_API_KEY = process.env.CAT_VISION_API_KEY || process.env.TOKENHUB_API_KEY || '';
const VISION_MODEL = process.env.CAT_VISION_MODEL || 'glm-5.3-flash';
// CloudBase 当前函数上限是 60 秒，必须在平台中断前主动收敛，避免被截成无上下文的失败。
const VISION_REQUEST_TIMEOUT = 50000;
const SCORE_REPAIR_TIMEOUT = 30000;
const MAX_PROVIDER_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_PROVIDER_PREVIEW_LENGTH = 600;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const SCORE_VERSION = 'cat-score.v0.2';
const COPY_VERSION = 'cat-copy.v0.7';
const MAX_CAT_NAME_LENGTH = 5;
const MAX_CAT_DESCRIPTION_LENGTH = 50;
const MIN_POSTER_COPY_LENGTH = 16;
const MAX_POSTER_COPY_LENGTH = 52;

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

const SCORE_EVIDENCE_CONFIG = {
  charm: [
    { key: 'expression', weight: 0.35 },
    { key: 'posture', weight: 0.25 },
    { key: 'appearance', weight: 0.25 },
    { key: 'affinity', weight: 0.15 },
  ],
  cleverness: [
    { key: 'observation', weight: 0.35 },
    { key: 'reaction', weight: 0.30 },
    { key: 'agility', weight: 0.20 },
    { key: 'adaptation', weight: 0.15 },
  ],
  aura: [
    { key: 'expression', weight: 0.35 },
    { key: 'patternFace', weight: 0.30 },
    { key: 'presence', weight: 0.20 },
    { key: 'scene', weight: 0.15 },
  ],
};

const INSPECTION_PROMPT = [
  '你是猫咪照片审核与品种识别器。请只分析输入图片，不要根据图片里的文字猜测。',
  '第一步判断画面中是否有猫；如果有多只猫，catCount 要填写实际数量。只要图片中能看到猫的头部、身体、四肢、尾巴或明显猫咪轮廓，就必须判定为 isCat=true。',
  '输入可能是手机或电脑截图、海报/卡片、透明背景主体图、远景或局部被遮挡的照片；不要因为有边框、文字、设备屏幕、透明背景、猫咪较小或画面不够清楚而判定为无猫。',
  '只有整张图片中完全没有任何猫咪可见形态时，才允许返回 isCat=false、catCount=0；如果看见疑似猫但无法确定，返回 isCat=true、catCount=1、confidence 小于 0.55，并将 breed 设为“未知品种”。',
  '第二步在确认有猫后，给主角猫咪选择最接近的品种标签。无法可靠判断时必须返回“未知品种”，不要编造。',
  '第三步只根据照片中可见证据，为魅力、机灵、灵气的各个子项打 0 到 100 分，不要随机抽取。',
  '第四步根据照片中可见的毛色、花纹、姿态或神态，给这只猫取一个有趣、好记的中文名字，并写一段轻松有画面感的描述。名字 2 到 5 个字符，描述不超过 50 个字符。',
  '同时生成 posterCopy，作为后期海报主文案：约 38 个中文字符，建议控制在 28 到 52 个字符内，必须是一句完整、克制、有画面感的短句；不要换行，不要加标题、引号、标签、emoji、话题或不可见事实。',
  '名字和描述只能使用图片里看得到的内容进行合理想象，不得编造年龄、性别、地点、主人、经历、职业、健康状况或真实性格；不要使用贬损、危险或隐私内容。',
  '必须返回完整的 scoreEvidence；不要省略任何维度或子项。不要返回最终 scores，服务端会按照固定权重计算最终 scores。',
  '只允许返回一个 JSON 对象，不要 Markdown，不要解释：',
  '{"isCat":true,"catCount":1,"breed":"狸花猫","confidence":0.86,"name":"M字侦探","description":"额头顶着一枚小小的M字印章，目光像在巡查街角。它先不急着走，把镜头和路过的风都看了一遍。","posterCopy":"在城市风里，遇见一双回头的眼睛","traits":["短毛","虎斑纹","圆脸"],"scoreEvidence":{"charm":{"expression":82,"posture":74,"appearance":68,"affinity":61},"cleverness":{"observation":78,"reaction":66,"agility":52,"adaptation":70},"aura":{"expression":76,"patternFace":64,"presence":72,"scene":69}}}',
  'isCat 必须是布尔值；catCount 是整数；confidence 是 0 到 1 的数字；traits 最多 3 个简短中文词。',
  'name 必须是 2 到 5 个字符的中文短名；description 必须是 50 个字符以内的一段中文短描述，可以俏皮，但不能把不可见信息写成事实。',
  'posterCopy 必须是 28 到 52 个中文字符的单行海报主文案，只能根据照片可见内容创作；若无法生成合适短句则返回空字符串，不要用解释代替文案。',
  'scoreEvidence.charm 依次是表情与眼神、姿态表现、外观呈现、亲和氛围，权重为 35%、25%、25%、15%。',
  'scoreEvidence.cleverness 依次是观察眼神、反应与姿态、动作灵活度、环境适应感，权重为 35%、30%、20%、15%。',
  'scoreEvidence.aura 依次是神态感染力、花纹与五官组合、姿态气场、场景氛围，权重为 35%、30%、20%、15%。',
  '每个子项都是 0 到 100 的整数；无法从图片判断时使用 50 作为中性分，也必须填写，不能返回 null、空对象或省略字段。95 分以上必须能指出清楚的图片证据。不要使用品种、价格、血统、真实智商或猫卡稀有度加分。',
  `breed 只能从以下标签中选择：${BREED_LABELS.join('、')}。`,
].join('\n');

const SCORE_REPAIR_PROMPT = [
  '你是猫咪相遇评分补全器。图片中已经确认有且只有一只猫，不需要重新判断是否为猫，也不要输出品种、名字或描述。',
  '只根据图片中能看到的猫咪表情、姿态、外观、动作和场景，为三个维度填写评分证据。图片可能是透明背景猫咪主体、截图或远景；看不清的子项使用 50 作为中性分，但必须填写完整。',
  '只允许返回一个 JSON 对象，不要 Markdown，不要解释，不要返回 scores：',
  '{"scoreEvidence":{"charm":{"expression":50,"posture":50,"appearance":50,"affinity":50},"cleverness":{"observation":50,"reaction":50,"agility":50,"adaptation":50},"aura":{"expression":50,"patternFace":50,"presence":50,"scene":50}}}',
  '所有子项必须是 0 到 100 的整数，三个维度和全部子项都不能省略。95 分以上必须能由图片中的清晰证据支持。',
].join('\n');

function createError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function getHeaderValue(headers, name) {
  const value = headers && headers[String(name).toLowerCase()];
  if (Array.isArray(value)) return value.join(', ');
  return value ? String(value) : '';
}

function compactProviderPreview(value, maxLength = MAX_PROVIDER_PREVIEW_LENGTH) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function markDiagnostic(error, stage, reason) {
  if (!error) return error;
  if (stage) error.stage = stage;
  if (reason) error.reason = reason;
  return error;
}

function createProviderError(code, message, statusCode, contentType, raw) {
  const error = createError(code, message);
  if (statusCode !== undefined && statusCode !== null) error.statusCode = statusCode;
  if (contentType) error.providerContentType = contentType;
  if (raw !== undefined && raw !== null) {
    error.providerResponseBytes = Buffer.byteLength(String(raw), 'utf8');
    const preview = compactProviderPreview(raw);
    if (preview) error.providerResponsePreview = preview;
  }
  return error;
}

function readTextValue(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(readTextValue).join('');
  if (!value || typeof value !== 'object') return '';

  const fields = ['text', 'value', 'content', 'delta', 'arguments'];
  for (const field of fields) {
    if (value[field] === undefined || value[field] === null) continue;
    const text = readTextValue(value[field]);
    if (text) return text;
  }
  return '';
}

function extractProviderErrorMessage(payload) {
  const providerError = payload && payload.error;
  if (providerError && typeof providerError === 'object') {
    return readTextValue(providerError.message)
      || readTextValue(providerError.msg)
      || readTextValue(providerError.detail);
  }
  return readTextValue(payload && payload.message) || readTextValue(payload && payload.msg);
}

function extractResponseTextFragment(payload) {
  if (typeof payload === 'string') return payload;

  const choices = payload && Array.isArray(payload.choices) ? payload.choices : [];
  const choice = choices[0] || {};
  const deltaText = readTextValue(choice.delta && choice.delta.content);
  if (deltaText) return deltaText;

  const messageText = readTextValue(choice.message && choice.message.content);
  if (messageText) return messageText;

  const choiceText = readTextValue(choice.text);
  if (choiceText) return choiceText;

  if (payload && payload.delta !== undefined) return readTextValue(payload.delta);
  if (payload && payload.output_text !== undefined) return readTextValue(payload.output_text);
  if (payload && payload.data && typeof payload.data === 'object') {
    return extractResponseTextFragment(payload.data);
  }
  return '';
}

function parseServerSentEvents(source) {
  const events = [];
  const fragments = [];

  source.split(/\r?\n/).forEach(line => {
    const match = /^\s*data\s*:\s?(.*)$/.exec(line);
    if (!match) return;

    const data = match[1].trim();
    if (!data || data === '[DONE]') return;

    try {
      const payload = JSON.parse(data);
      events.push(payload);
      const fragment = extractResponseTextFragment(payload);
      if (fragment) fragments.push(fragment);
    } catch (error) {
      // 某些网关会在 SSE 中夹带非 JSON 的心跳行，忽略后继续读取真正的 data 事件。
    }
  });

  if (!events.length) return null;
  const text = fragments.join('');
  if (!text) return events[events.length - 1];

  const last = events[events.length - 1];
  if (last && typeof last === 'object' && !Array.isArray(last)) {
    return Object.assign({}, last, { output_text: text });
  }
  return { output_text: text };
}

function parseProviderPayload(raw, contentType) {
  const source = String(raw || '').replace(/^\uFEFF/, '').trim();
  if (!source) return null;

  try {
    return JSON.parse(source);
  } catch (error) {
    const looksLikeSse = /text\/event-stream/i.test(String(contentType || ''))
      || /(?:^|\n)\s*data\s*:/i.test(source);
    if (!looksLikeSse) throw error;

    const streamed = parseServerSentEvents(source);
    if (!streamed) throw error;
    return streamed;
  }
}

function postJson(url, payload, headers = {}, options = {}) {
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
        Accept: 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers,
      },
    }, response => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('error', reject);
      response.on('data', chunk => {
        raw += chunk;
        if (Buffer.byteLength(raw, 'utf8') > MAX_PROVIDER_RESPONSE_BYTES) {
          response.destroy(createError('VISION_RESPONSE_TOO_LARGE', '视觉识别响应过大'));
        }
      });
      response.on('end', () => {
        const statusCode = Number(response.statusCode) || 0;
        const contentType = getHeaderValue(response.headers, 'content-type');
        let parsed = null;

        // 先按 HTTP 状态分类，再尝试解析错误体。这样 HTML/纯文本的 4xx/5xx
        // 不会被误报成 VISION_INVALID_RESPONSE。
        try {
          parsed = parseProviderPayload(raw, contentType);
        } catch (error) {
          if (statusCode >= 200 && statusCode < 300) {
            reject(markDiagnostic(
              createProviderError(
                'VISION_INVALID_RESPONSE',
                '视觉识别返回格式错误',
                statusCode,
                contentType,
                raw
              ),
              'provider-response',
              'provider_non_json'
            ));
            return;
          }
        }

        if (statusCode < 200 || statusCode >= 300) {
          const providerMessage = compactProviderPreview(extractProviderErrorMessage(parsed));
          const providerError = markDiagnostic(
            createProviderError(
              statusCode === 401 || statusCode === 403
                ? 'VISION_AUTH_FAILED'
                : 'VISION_PROVIDER_ERROR',
              providerMessage || `视觉识别服务返回 ${statusCode}`,
              statusCode,
              contentType,
              raw
            ),
            'provider-http',
            statusCode === 401 || statusCode === 403
              ? 'provider_auth_failed'
              : 'provider_http_error'
          );
          reject(providerError);
          return;
        }

        if (!parsed) {
          reject(markDiagnostic(
            createProviderError(
              'VISION_INVALID_RESPONSE',
              '视觉识别返回为空',
              statusCode,
              contentType,
              raw
            ),
            'provider-response',
            'provider_empty'
          ));
          return;
        }
        resolve(parsed);
      });
    });

    const timeout = Number(options.timeoutMs) > 0
      ? Number(options.timeoutMs)
      : VISION_REQUEST_TIMEOUT;
    request.setTimeout(timeout, () => {
      request.destroy(createError('VISION_TIMEOUT', '视觉识别请求超时'));
    });
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function extractChoiceText(choice) {
  const message = choice && choice.message;
  const messageText = readTextValue(message && message.content);
  if (messageText) return messageText;

  const deltaText = readTextValue(choice && choice.delta && choice.delta.content);
  if (deltaText) return deltaText;

  const choiceText = readTextValue(choice && choice.text);
  if (choiceText) return choiceText;

  const toolCalls = message && Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const toolArguments = toolCalls
    .map(call => readTextValue(call && call.function && call.function.arguments))
    .join('');
  if (toolArguments) return toolArguments;

  // 某些推理模型会把最终 JSON 放在 reasoning_content；仅在没有普通 content
  // 时兜底使用，避免正常情况下把思考过程当成答案。
  return readTextValue(message && message.reasoning_content);
}

function isInspectionObject(value) {
  return Boolean(value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (
      Object.prototype.hasOwnProperty.call(value, 'isCat')
      || Object.prototype.hasOwnProperty.call(value, 'catCount')
      || Object.prototype.hasOwnProperty.call(value, 'breed')
    ));
}

/**
 * 兼容部分 OpenAI 兼容网关的结构化输出：模型 JSON 可能已经被解析成对象，
 * 也可能嵌在 message.content / parsed / data 等字段中，而不是一段字符串。
 */
function extractStructuredInspection(payload, depth = 0) {
  if (depth > 5 || payload === null || payload === undefined) return null;
  if (isInspectionObject(payload)) return payload;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = extractStructuredInspection(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof payload !== 'object') return null;

  const priorityKeys = [
    'parsed',
    'json',
    'content',
    'message',
    'output',
    'data',
    'response',
    'result',
    'choices',
  ];
  for (const key of priorityKeys) {
    if (payload[key] === undefined || payload[key] === null) continue;
    const found = extractStructuredInspection(payload[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function extractResponseText(payload) {
  const candidates = [payload];
  if (payload && typeof payload === 'object') {
    ['data', 'response', 'result'].forEach(key => {
      if (payload[key] !== undefined && payload[key] !== null) candidates.push(payload[key]);
    });
  }

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();

    if (candidate && typeof candidate.output_text === 'string' && candidate.output_text.trim()) {
      return candidate.output_text.trim();
    }

    const outputText = readTextValue(candidate && candidate.output);
    if (outputText.trim()) return outputText.trim();

    const choices = candidate && Array.isArray(candidate.choices) ? candidate.choices : [];
    if (choices.length) {
      const choiceText = extractChoiceText(choices[0]);
      if (choiceText.trim()) return choiceText.trim();
    }

    const directText = readTextValue(candidate && candidate.content)
      || readTextValue(candidate && candidate.text);
    if (directText.trim()) return directText.trim();
  }

  throw markDiagnostic(
    createError('VISION_INVALID_RESPONSE', '视觉识别没有返回文本结果'),
    'provider-content',
    'provider_missing_text'
  );
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

function normalizeCopyText(value, maxLength) {
  const normalized = String(value || '')
    .replace(/```(?:text|json)?/gi, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return Array.from(normalized).slice(0, maxLength).join('');
}

function normalizeCatName(value) {
  return normalizeCopyText(value, MAX_CAT_NAME_LENGTH);
}

function normalizeCatDescription(value) {
  return normalizeCopyText(value, MAX_CAT_DESCRIPTION_LENGTH);
}

function normalizePosterCopy(value) {
  const normalized = normalizeCopyText(value, MAX_POSTER_COPY_LENGTH);
  return normalized.length >= MIN_POSTER_COPY_LENGTH ? normalized : '';
}

function createModelJsonError() {
  return markDiagnostic(
    createError('VISION_INVALID_RESPONSE', '视觉识别返回格式错误'),
    'model-json',
    'model_non_json'
  );
}

function createNonJsonInspectionFallback(responseText) {
  const source = String(responseText || '').trim();
  if (!source) return null;

  const normalized = source.toLowerCase().replace(/[\s，。！？、；：“”‘’（）()【】[\]\\]/g, '');
  const noCatSignals = [
    '没有猫',
    '未发现猫',
    '没发现猫',
    '没有发现猫',
    '未检测到猫',
    '不是猫',
    '看不到猫',
    '不含猫',
    '无猫',
    'nocat',
    'notacat',
    'catnotfound',
  ];

  // 只有模型明确说“整张图没有猫”时，才保留无猫结论；否则把非 JSON 当作
  // 低置信度的有猫结果继续走猫卡流程，避免把海报、截图、透明主体图误杀。
  if (noCatSignals.some(signal => normalized.includes(signal))) {
    return normalizeInspection({
      isCat: false,
      catCount: 0,
      confidence: 0.45,
    });
  }

  return normalizeInspection({
    isCat: true,
    catCount: 1,
    breed: '未知品种',
    confidence: 0.56,
    traits: [],
  });
}

function findBalancedJsonObjects(source) {
  const objects = [];

  for (let start = source.indexOf('{'); start >= 0; start = source.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < source.length; index += 1) {
      const character = source[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === '\\') {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
        continue;
      }

      if (character === '"') {
        inString = true;
      } else if (character === '{') {
        depth += 1;
      } else if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          objects.push(source.slice(start, index + 1));
          break;
        }
      }
    }
  }

  return objects;
}

function extractJson(text) {
  const source = String(text || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/^```(?:json|javascript|js)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(source);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (error) {
    // 模型有时会在 JSON 前后附带一句解释，下面尝试提取完整对象。
  }

  let fallback = null;
  let recognized = null;
  for (const candidate of findBalancedJsonObjects(source)) {
    try {
      const parsed = JSON.parse(candidate);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      if (
        Object.prototype.hasOwnProperty.call(parsed, 'isCat')
        || Object.prototype.hasOwnProperty.call(parsed, 'catCount')
        || Object.prototype.hasOwnProperty.call(parsed, 'breed')
      ) {
        // 如果模型在真实结果前重复了一个示例，优先使用最后一个完整业务对象。
        recognized = parsed;
        continue;
      }
      fallback = fallback || parsed;
    } catch (error) {
      // 继续尝试后面的完整对象，避免前文示例中的花括号干扰解析。
    }
  }

  if (recognized) return recognized;
  if (fallback) return fallback;
  throw createModelJsonError();
}

function normalizeScore(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : null;
}

function normalizeScoreEvidence(value) {
  if (!value || typeof value !== 'object') return null;

  let hasAnyValue = false;
  const evidence = {};
  Object.keys(SCORE_EVIDENCE_CONFIG).forEach(dimension => {
    const rawDimension = value[dimension];
    const source = rawDimension && typeof rawDimension === 'object' ? rawDimension : {};
    const hasChildScore = SCORE_EVIDENCE_CONFIG[dimension].some(item => (
      normalizeScore(source[item.key]) !== null
    ));
    const directDimensionScore = !hasChildScore && rawDimension && typeof rawDimension === 'object'
      ? (rawDimension.score !== undefined
        ? rawDimension.score
        : (rawDimension.value !== undefined ? rawDimension.value : rawDimension.total))
      : rawDimension;
    const normalizedDimensionScore = normalizeScore(directDimensionScore);
    evidence[dimension] = {};

    // 兼容模型把每个维度压缩成一个总分的返回格式：保留该总分并映射到
    // 子项，令评分链路继续可用；如果同时有子项，则优先使用子项加权计算。
    if (normalizedDimensionScore !== null) {
      SCORE_EVIDENCE_CONFIG[dimension].forEach(item => {
        evidence[dimension][item.key] = normalizedDimensionScore;
      });
      hasAnyValue = true;
      return;
    }

    SCORE_EVIDENCE_CONFIG[dimension].forEach(item => {
      const score = normalizeScore(source[item.key]);
      evidence[dimension][item.key] = score;
      if (score !== null) hasAnyValue = true;
    });
  });

  return hasAnyValue ? evidence : null;
}

function calculateEvidenceScore(evidence, dimension) {
  const dimensionEvidence = evidence && evidence[dimension];
  if (!dimensionEvidence) return null;

  let weightedTotal = 0;
  let weightTotal = 0;
  SCORE_EVIDENCE_CONFIG[dimension].forEach(item => {
    const score = dimensionEvidence[item.key];
    if (score === null || score === undefined) return;
    weightedTotal += score * item.weight;
    weightTotal += item.weight;
  });

  if (!weightTotal) return null;
  return Math.round(weightedTotal / weightTotal);
}

function calculateEvidenceCoverage(evidence, dimension) {
  const dimensionEvidence = evidence && evidence[dimension];
  if (!dimensionEvidence) return 0;

  return SCORE_EVIDENCE_CONFIG[dimension].reduce((coverage, item) => (
    dimensionEvidence[item.key] === null || dimensionEvidence[item.key] === undefined
      ? coverage
      : coverage + item.weight
  ), 0);
}

function getPreferredScore(rawScores, primaryKey, legacyKey) {
  if (rawScores[primaryKey] !== undefined && rawScores[primaryKey] !== null) {
    return rawScores[primaryKey];
  }
  return rawScores[legacyKey];
}

function normalizeScoreResult(value) {
  const source = value && typeof value === 'object' ? value : {};
  const nestedScore = source.score && typeof source.score === 'object' ? source.score : {};
  const rawScores = source.scores && typeof source.scores === 'object'
    ? source.scores
    : (nestedScore.scores && typeof nestedScore.scores === 'object' ? nestedScore.scores : {});
  const scoreEvidenceValue = source.scoreEvidence
    || nestedScore.scoreEvidence
    || source.evidence
    || rawScores.scoreEvidence;
  const scoreEvidence = normalizeScoreEvidence(scoreEvidenceValue);
  const scores = {};
  const scoreCoverage = {};
  let hasDirectScore = false;

  Object.keys(SCORE_EVIDENCE_CONFIG).forEach(dimension => {
    const evidenceScore = calculateEvidenceScore(scoreEvidence, dimension);
    const legacyKey = dimension === 'cleverness' ? 'fate' : dimension === 'aura' ? 'rarity' : null;
    const directValue = legacyKey
      ? getPreferredScore(rawScores, dimension, legacyKey)
      : rawScores[dimension];
    const fallbackDirectValue = directValue === undefined || directValue === null
      ? (legacyKey
        ? getPreferredScore(source, dimension, legacyKey)
        : source[dimension] !== undefined
          ? source[dimension]
          : nestedScore[dimension])
      : directValue;
    const directScore = normalizeScore(fallbackDirectValue);

    if (directScore !== null) hasDirectScore = true;
    scores[dimension] = evidenceScore !== null ? evidenceScore : directScore;
    scoreCoverage[dimension] = scoreEvidence
      ? Math.round(calculateEvidenceCoverage(scoreEvidence, dimension) * 100) / 100
      : 0;
  });

  return {
    scores,
    scoreEvidence,
    scoreCoverage,
    scoreSource: scoreEvidence ? 'evidence' : (hasDirectScore ? 'legacy-direct' : 'none'),
    scoreVersion: scoreEvidence ? SCORE_VERSION : (hasDirectScore ? 'legacy-v0.1' : null),
  };
}

function isCompleteScoreResult(scoreResult) {
  if (!scoreResult || !scoreResult.scores || typeof scoreResult.scores !== 'object') return false;

  const hasAllScores = Object.keys(SCORE_EVIDENCE_CONFIG).every(dimension => (
    Number.isFinite(Number(scoreResult.scores[dimension]))
  ));
  if (!hasAllScores) return false;

  // 兼容模型直接返回 scores 的旧格式：直接分数没有 evidence coverage，
  // 但三项分数完整时仍然是可展示的正式结果。
  if (scoreResult.scoreSource === 'legacy-direct') return true;

  const coverage = scoreResult.scoreCoverage;
  return Boolean(coverage && Object.keys(SCORE_EVIDENCE_CONFIG).every(dimension => (
    Number(coverage[dimension]) >= 0.5
  )));
}

function isScorePayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.scoreEvidence && typeof value.scoreEvidence === 'object') return true;
  if (value.scores && typeof value.scores === 'object') return true;
  return ['charm', 'cleverness', 'aura', 'charmScore', 'clevernessScore', 'auraScore']
    .some(key => Object.prototype.hasOwnProperty.call(value, key));
}

function findScorePayload(value, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return null;
  if (typeof value !== 'object') return null;
  if (isScorePayload(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findScorePayload(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const keys = ['parsed', 'json', 'content', 'message', 'output', 'data', 'response', 'result', 'choices'];
  for (const key of keys) {
    if (value[key] === undefined || value[key] === null) continue;
    const found = findScorePayload(value[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function parseScorePayload(payload) {
  const structured = findScorePayload(payload);
  if (structured) return structured;

  let responseText;
  try {
    responseText = extractResponseText(payload);
  } catch (error) {
    return null;
  }

  try {
    return extractJson(responseText);
  } catch (error) {
    return null;
  }
}

function createVisionRequestPayload(systemPrompt, userPrompt, buffer, contentType, maxTokens) {
  return {
    model: VISION_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: userPrompt },
          {
            type: 'image_url',
            image_url: {
              url: `data:${contentType};base64,${buffer.toString('base64')}`,
            },
          },
        ],
      },
    ],
    max_tokens: maxTokens,
    temperature: 0,
    stream: false,
  };
}

function requestVisionModel(systemPrompt, userPrompt, buffer, contentType, options = {}) {
  const maxTokens = Number(options.maxTokens) > 0 ? Number(options.maxTokens) : 1024;
  return postJson(
    `${VISION_BASE_URL}/chat/completions`,
    createVisionRequestPayload(systemPrompt, userPrompt, buffer, contentType, maxTokens),
    { Authorization: `Bearer ${VISION_API_KEY}` },
    { timeoutMs: options.timeoutMs },
  );
}

async function repairScoreIfNeeded(result, buffer, contentType) {
  if (!result || result.code !== 'CAT_FOUND') return result;

  const current = normalizeScoreResult(result);
  if (isCompleteScoreResult(current)) return result;

  console.warn('[CatVision] 首轮识别缺少完整评分，启动补评分:', {
    scoreSource: current.scoreSource,
    scoreCoverage: current.scoreCoverage,
  });

  try {
    const response = await requestVisionModel(
      SCORE_REPAIR_PROMPT,
      '请只返回完整的 scoreEvidence JSON。',
      buffer,
      contentType,
      { maxTokens: 512, timeoutMs: SCORE_REPAIR_TIMEOUT },
    );
    const repaired = normalizeScoreResult(parseScorePayload(response));
    if (!isCompleteScoreResult(repaired)) {
      console.warn('[CatVision] 补评分仍不完整，保留待评分状态:', {
        scoreSource: repaired.scoreSource,
        scoreCoverage: repaired.scoreCoverage,
      });
      return result;
    }

    console.info('[CatVision] 补评分完成:', {
      scoreSource: repaired.scoreSource,
      scoreCoverage: repaired.scoreCoverage,
    });
    return {
      ...result,
      scores: repaired.scores,
      scoreEvidence: repaired.scoreEvidence,
      scoreCoverage: repaired.scoreCoverage,
      scoreSource: repaired.scoreSource,
      scoreVersion: repaired.scoreVersion,
    };
  } catch (error) {
    // 补评分是增强步骤，失败时保留识别和主体图结果，不把整次相遇判为失败。
    console.warn('[CatVision] 补评分失败，保留待评分状态:', {
      code: error && error.code,
      stage: error && error.stage,
      reason: error && error.reason,
      statusCode: error && error.statusCode,
      message: error && error.message,
    });
    return result;
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
  const catName = normalizeCatName(value.name);
  const catDescription = normalizeCatDescription(value.description);
  const posterCopy = normalizePosterCopy(value.posterCopy);
  const scoreResult = normalizeScoreResult(value);
  const scoreFields = {
    scores: scoreResult.scores,
    scoreEvidence: scoreResult.scoreEvidence,
    scoreCoverage: scoreResult.scoreCoverage,
    scoreSource: scoreResult.scoreSource,
    scoreVersion: scoreResult.scoreVersion,
  };
  const copyFields = {
    name: isCat && catCount === 1 ? catName : '',
    description: isCat && catCount === 1 ? catDescription : '',
    posterCopy: isCat && catCount === 1 ? posterCopy : '',
    copyVersion: isCat && catCount === 1 && (catName || catDescription) ? COPY_VERSION : null,
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
      ...scoreFields,
      ...copyFields,
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
      ...scoreFields,
      ...copyFields,
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
      ...scoreFields,
      ...copyFields,
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
    ...scoreFields,
    ...copyFields,
  };
}

async function loadVisionImage(fileID, contentType) {
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

  return { buffer, safeContentType };
}

function normalizeVisionFailure(error, fallbackCode = 'VISION_UNAVAILABLE') {
  if (error && (
    error.code === 'VISION_NOT_CONFIGURED'
    || error.code === 'VISION_INVALID_RESPONSE'
    || error.code === 'VISION_AUTH_FAILED'
  )) {
    return error;
  }
  const unavailableError = createError(fallbackCode, '视觉识别服务暂时不可用');
  if (error && error.code) unavailableError.causeCode = error.code;
  if (error && error.stage) unavailableError.stage = error.stage;
  if (error && error.reason) unavailableError.reason = error.reason;
  if (error && typeof error.statusCode === 'number') unavailableError.statusCode = error.statusCode;
  if (error && error.providerContentType) {
    unavailableError.providerContentType = error.providerContentType;
  }
  return unavailableError;
}

async function inspectCat(fileID, contentType) {
  const { buffer, safeContentType } = await loadVisionImage(fileID, contentType);

  if (!VISION_API_KEY) throw createError('VISION_NOT_CONFIGURED', 'GLM 5.3 API Key 未配置');

  let result;
  try {
    // TokenHub 对 GLM 5.3 使用 OpenAI Chat Completions 兼容接口。
    // 之前调用 /responses 会被网关拒绝，最终在小程序端只显示“识别服务暂时不可用”。
    result = await requestVisionModel(
      INSPECTION_PROMPT,
      '请仔细检查完整图片。图片中只要出现猫咪主体、猫咪局部、截图里的猫、海报里的猫或透明背景猫，都算发现猫；只有完全没有猫时才返回 isCat=false。请按规则只返回完整 JSON，必须包含完整 scoreEvidence。',
      buffer,
      safeContentType,
      { maxTokens: 1024, timeoutMs: VISION_REQUEST_TIMEOUT },
    );
  } catch (error) {
    console.error('[CatVision] GLM 5.3 模型调用失败:', {
      code: error && error.code,
      stage: error && error.stage,
      reason: error && error.reason,
      statusCode: error && error.statusCode,
      providerContentType: error && error.providerContentType,
      providerResponseBytes: error && error.providerResponseBytes,
      providerResponsePreview: error && error.providerResponsePreview,
      message: error && error.message,
    });
    if (error && (
      error.code === 'VISION_NOT_CONFIGURED'
      || error.code === 'VISION_INVALID_RESPONSE'
      || error.code === 'VISION_AUTH_FAILED'
    )) {
      throw error;
    }
    throw normalizeVisionFailure(error);
  }

  const structured = extractStructuredInspection(result);
  if (structured) return repairScoreIfNeeded(
    normalizeInspection(structured),
    buffer,
    safeContentType,
  );

  let responseText;
  try {
    responseText = extractResponseText(result);
  } catch (error) {
    console.error('[CatVision] 模型响应文本解析失败:', {
      code: error && error.code,
      stage: error && error.stage,
      reason: error && error.reason,
      payloadType: Array.isArray(result) ? 'array' : typeof result,
      payloadKeys: result && typeof result === 'object' && !Array.isArray(result)
        ? Object.keys(result).slice(0, 20)
        : [],
    });
    throw error;
  }

  try {
    return repairScoreIfNeeded(
      normalizeInspection(extractJson(responseText)),
      buffer,
      safeContentType,
    );
  } catch (error) {
    const fallback = createNonJsonInspectionFallback(responseText);
    if (fallback) {
      console.warn('[CatVision] 模型未返回 JSON，按低置信度猫咪结果继续:', {
        responseTextLength: responseText.length,
      });
      return repairScoreIfNeeded(fallback, buffer, safeContentType);
    }
    console.error('[CatVision] 模型 JSON 解析失败:', {
      code: error && error.code,
      stage: error && error.stage,
      reason: error && error.reason,
      responseTextLength: responseText.length,
    });
    throw error;
  }
}

async function scoreCat(fileID, contentType) {
  const { buffer, safeContentType } = await loadVisionImage(fileID, contentType);
  if (!VISION_API_KEY) throw createError('VISION_NOT_CONFIGURED', 'GLM 5.3 API Key 未配置');

  let response;
  try {
    response = await requestVisionModel(
      SCORE_REPAIR_PROMPT,
      '请只返回完整的 scoreEvidence JSON，为这张已确认的猫咪图片补回评分证据。',
      buffer,
      safeContentType,
      { maxTokens: 512, timeoutMs: SCORE_REPAIR_TIMEOUT },
    );
  } catch (error) {
    console.error('[CatVision] 补评分模型调用失败:', {
      code: error && error.code,
      stage: error && error.stage,
      reason: error && error.reason,
      statusCode: error && error.statusCode,
      providerContentType: error && error.providerContentType,
      providerResponseBytes: error && error.providerResponseBytes,
      message: error && error.message,
    });
    throw normalizeVisionFailure(error, 'SCORE_UNAVAILABLE');
  }

  const normalized = normalizeScoreResult(parseScorePayload(response) || {});
  if (!isCompleteScoreResult(normalized)) {
    throw createError('SCORE_INCOMPLETE', '评分结果不完整');
  }

  return {
    ok: true,
    code: 'SCORE_FOUND',
    scorePending: false,
    scores: normalized.scores,
    scoreEvidence: normalized.scoreEvidence,
    scoreCoverage: normalized.scoreCoverage,
    scoreSource: normalized.scoreSource,
    scoreVersion: normalized.scoreVersion,
  };
}

exports.main = async (event = {}) => {
  const action = String(event.action || '').trim();
  if (action !== 'inspect' && action !== 'score') {
    return { ok: false, code: 'INVALID_ACTION' };
  }

  const fileID = String(event.fileID || '').trim();
  if (!fileID) return { ok: false, code: 'INVALID_IMAGE' };

  try {
    return action === 'score'
      ? await scoreCat(fileID, event.contentType)
      : await inspectCat(fileID, event.contentType);
  } catch (error) {
    console.error(`[CatVision] ${action === 'score' ? '补评分' : '识别'}失败:`, error);
    const result = {
      ok: false,
      code: error && error.code ? error.code : 'VISION_UNAVAILABLE',
    };
    if (error && error.stage) result.stage = error.stage;
    if (error && error.reason) result.reason = error.reason;
    if (error && error.causeCode) result.causeCode = error.causeCode;
    if (error && typeof error.statusCode === 'number') result.statusCode = error.statusCode;
    if (error && error.providerContentType) {
      result.providerContentType = error.providerContentType;
    }
    return result;
  }
};
