const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
  timeout: 30000,
});

const HY3_BASE_URL = (
  process.env.HY3_BASE_URL
  || process.env.CAT_VISION_BASE_URL
  || 'https://tokenhub.tencentmaas.com/v1'
).replace(/\/+$/, '');
const HY3_API_KEY = (
  process.env.HY3_API_KEY
  || process.env.CAT_VISION_API_KEY
  || process.env.TOKENHUB_API_KEY
  || ''
).trim();
const HY3_MODEL = process.env.HY3_MODEL || 'hy3';
const HY3_REQUEST_TIMEOUT = 12000;
const MIN_KNOWLEDGE_LENGTH = 12;
const MAX_KNOWLEDGE_LENGTH = 46;

// 先给页面一个稳定的本地兜底；Hy3 只负责从这些已核验的事实中选择并润色，避免科普内容自由扩写出错。
// 这条知识线不接收 fileID、照片或 GLM 识别结果，只处理固定的猫咪科普提示词。
const KNOWLEDGE_FACTS = [
  '猫咪的胡须根部有丰富的感觉神经，能帮助它感知周围空间。',
  '猫咪的耳朵可以独立转动，帮助它判断声音来自哪个方向。',
  '猫咪的瞳孔会随光线变化，明亮处变细，昏暗处变圆。',
  '猫咪会用舔舐整理毛发，也会借此留下熟悉的气味。',
  '猫咪睡眠时间较长，休息有助于保存能量和恢复状态。',
];

const KNOWLEDGE_PROMPT = [
  '你是猫咪咔咔的猫咪科普编辑。',
  '请从下方事实池中选择一条，改写成适合图片处理等待页展示的猫咪小知识。',
  '只能保留事实池中的信息，不得新增事实、医疗建议、饲养建议或无法验证的说法。',
  '要求：简体中文，12 到 46 个字符，单句，轻松准确，不要标题、引号、emoji、换行或 Markdown。',
  '只返回一个 JSON 对象，不要解释：{"text":"猫咪的胡须根部有丰富的感觉神经，能帮助它感知周围空间。"}',
  `事实池：${KNOWLEDGE_FACTS.join('；')}`,
].join('\n');

function createError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function fallbackKnowledge() {
  const index = Math.floor(Date.now() / (60 * 60 * 1000)) % KNOWLEDGE_FACTS.length;
  return KNOWLEDGE_FACTS[index];
}

function postJson(url, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    let requestUrl;
    try {
      requestUrl = new URL(url);
    } catch (error) {
      reject(createError('HY3_INVALID_URL', 'Hy3 服务地址无效'));
      return;
    }

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
        if (raw.length > 512 * 1024) {
          response.destroy(createError('HY3_RESPONSE_TOO_LARGE', 'Hy3 返回内容过大'));
        }
      });
      response.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (error) {
          reject(createError('HY3_INVALID_RESPONSE', 'Hy3 返回格式错误'));
          return;
        }

        if (response.statusCode < 200 || response.statusCode >= 300) {
          const providerMessage = parsed && parsed.error && parsed.error.message;
          const error = createError(
            response.statusCode === 401 || response.statusCode === 403
              ? 'HY3_AUTH_FAILED'
              : 'HY3_PROVIDER_ERROR',
            providerMessage || `Hy3 服务返回 ${response.statusCode}`,
          );
          error.statusCode = response.statusCode;
          reject(error);
          return;
        }
        resolve(parsed);
      });
    });

    request.setTimeout(HY3_REQUEST_TIMEOUT, () => {
      request.destroy(createError('HY3_TIMEOUT', 'Hy3 请求超时'));
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

  throw createError('HY3_INVALID_RESPONSE', 'Hy3 没有返回文案');
}

function extractTextValue(text) {
  const source = String(text || '')
    .trim()
    .replace(/^```(?:json|text)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();

  try {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === 'object' ? parsed.text : '';
  } catch (error) {
    const start = source.indexOf('{');
    const end = source.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(source.slice(start, end + 1));
        return parsed && typeof parsed === 'object' ? parsed.text : '';
      } catch (parseError) {
        return source;
      }
    }
    return source;
  }
}

function normalizeKnowledge(value) {
  const normalized = String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^["“”「」『』]+|["“”「」『』]+$/g, '')
    .replace(/^猫咪小知识[:：]\s*/i, '')
    .trim();
  const text = Array.from(normalized).slice(0, MAX_KNOWLEDGE_LENGTH).join('');
  return text.length >= MIN_KNOWLEDGE_LENGTH ? text : '';
}

async function generateKnowledge() {
  if (!HY3_API_KEY) {
    return {
      ok: true,
      source: 'fallback',
      text: fallbackKnowledge(),
      code: 'HY3_NOT_CONFIGURED',
    };
  }

  try {
    const response = await postJson(`${HY3_BASE_URL}/chat/completions`, {
      model: HY3_MODEL,
      messages: [
        { role: 'system', content: KNOWLEDGE_PROMPT },
        { role: 'user', content: '请生成一条猫咪小知识。' },
      ],
      temperature: 0.7,
      max_tokens: 128,
      reasoning_effort: 'no_think',
      stream: false,
    }, {
      Authorization: `Bearer ${HY3_API_KEY}`,
    });
    const text = normalizeKnowledge(extractTextValue(extractResponseText(response)));
    if (!text) throw createError('HY3_EMPTY_RESULT', 'Hy3 返回了空文案');

    return {
      ok: true,
      source: 'hy3',
      model: HY3_MODEL,
      text,
    };
  } catch (error) {
    console.warn('[CatKnowledge] Hy3 调用失败，使用本地兜底:', {
      code: error && error.code,
      statusCode: error && error.statusCode,
      message: error && error.message,
    });
    return {
      ok: true,
      source: 'fallback',
      text: fallbackKnowledge(),
      code: error && error.code ? error.code : 'HY3_UNAVAILABLE',
    };
  }
}

exports.main = async (event = {}) => {
  if (event.action !== 'generate') return { ok: false, code: 'INVALID_ACTION' };
  return generateKnowledge();
};
