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
const SCORE_VERSION = 'cat-score.v0.2';
const COPY_VERSION = 'cat-copy.v0.3';
const GLM_FEATURE_PROFILE_VERSION = 'glm-cat-feature.v0.1';
const GLM_FEATURE_UNKNOWN = 'unknown';
const MAX_CAT_NAME_LENGTH = 5;
const MAX_CAT_DESCRIPTION_LENGTH = 50;

// 这是轻量、可解释的特征契约，不是视觉 embedding。
// 需要和 miniprogram/utils/catFeatureProfile.js 保持版本及枚举一致。
const GLM_FEATURE_SCHEMA = {
  coatColor: ['orange', 'white', 'black', 'gray', 'brown', 'cream', 'silver', 'mixed', GLM_FEATURE_UNKNOWN],
  pattern: ['solid', 'tabby', 'bicolor', 'calico', 'tortoiseshell', 'pointed', 'spotted', 'mixed', GLM_FEATURE_UNKNOWN],
  coatLength: ['hairless', 'short', 'medium', 'long', GLM_FEATURE_UNKNOWN],
  faceShape: ['round', 'oval', 'long', 'wedge', GLM_FEATURE_UNKNOWN],
  eyeColor: ['yellow', 'green', 'blue', 'copper', 'hazel', 'odd', 'dark', GLM_FEATURE_UNKNOWN],
  faceMark: ['none', 'm_mark', 'blaze', 'eye_patch_left', 'eye_patch_right', 'eye_patch_both', 'muzzle_mark', GLM_FEATURE_UNKNOWN],
  faceAsymmetry: ['none', 'left_mark', 'right_mark', 'bilateral', GLM_FEATURE_UNKNOWN],
  earFeature: ['upright', 'folded', 'curled', 'left_notch', 'right_notch', 'bilateral_notch', GLM_FEATURE_UNKNOWN],
  tailFeature: ['long', 'short', 'ringed', 'dark_tip', 'bent', 'fluffy', GLM_FEATURE_UNKNOWN],
  bodyBuild: ['slim', 'medium', 'sturdy', GLM_FEATURE_UNKNOWN],
  noseColor: ['pink', 'black', 'brown', 'brick', GLM_FEATURE_UNKNOWN],
  distinctiveMark: ['none', 'white_chin', 'white_chest', 'white_paws', 'ear_notch', 'tail_tip', 'other', GLM_FEATURE_UNKNOWN],
};
const GLM_FEATURE_KEYS = Object.keys(GLM_FEATURE_SCHEMA);

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
  '第一步判断画面中是否有猫；如果有多只猫，catCount 要填写实际数量。',
  '第二步在确认有猫后，给主角猫咪选择最接近的品种标签。无法可靠判断时必须返回“未知品种”，不要编造。',
  '第三步只提取适合初期同猫候选比较的稳定外观特征，放进 glmCatFeatureProfile。只填写照片里确实看得见的内容，不能把姿态、场景、光线、心情或故事写进特征。',
  `glmCatFeatureProfile.version 固定为 ${GLM_FEATURE_PROFILE_VERSION}；features 只能使用固定枚举：coatColor=${GLM_FEATURE_SCHEMA.coatColor.join('|')}；pattern=${GLM_FEATURE_SCHEMA.pattern.join('|')}；coatLength=${GLM_FEATURE_SCHEMA.coatLength.join('|')}；faceShape=${GLM_FEATURE_SCHEMA.faceShape.join('|')}；eyeColor=${GLM_FEATURE_SCHEMA.eyeColor.join('|')}；faceMark=${GLM_FEATURE_SCHEMA.faceMark.join('|')}；faceAsymmetry=${GLM_FEATURE_SCHEMA.faceAsymmetry.join('|')}；earFeature=${GLM_FEATURE_SCHEMA.earFeature.join('|')}；tailFeature=${GLM_FEATURE_SCHEMA.tailFeature.join('|')}；bodyBuild=${GLM_FEATURE_SCHEMA.bodyBuild.join('|')}；noseColor=${GLM_FEATURE_SCHEMA.noseColor.join('|')}；distinctiveMark=${GLM_FEATURE_SCHEMA.distinctiveMark.join('|')}。看不清或不确定必须填 unknown。`,
  'glmCatFeatureProfile.confidence 必须为每个特征对应的 0 到 1 数字；quality.visibility 和 quality.occlusion 是 0 到 1 数字。只有单猫、主体清楚、至少有一个稳定特征且适合后续候选比较时，quality.usableForMatch 才能为 true；否则为 false。',
  '第四步只根据照片中可见证据，为魅力、机灵、灵气的各个子项打 0 到 100 分，不要随机抽取。',
  '第五步根据照片中可见的毛色、花纹、姿态或神态，给这只猫取一个有趣、好记的中文名字，并写一段轻松有画面感的描述。名字 2 到 5 个字符，描述不超过 50 个字符。',
  '名字和描述只能使用图片里看得到的内容进行合理想象，不得编造年龄、性别、地点、主人、经历、职业、健康状况或真实性格；不要使用贬损、危险或隐私内容。',
  '不要返回最终 scores；服务端会按照固定权重计算最终 scores。',
  '只允许返回一个 JSON 对象，不要 Markdown，不要解释：',
  '{"isCat":true,"catCount":1,"breed":"狸花猫","confidence":0.86,"name":"M字侦探","description":"额头顶着一枚小小的M字印章，目光像在巡查街角。它先不急着走，把镜头和路过的风都看了一遍。","traits":["短毛","虎斑纹","圆脸"],"glmCatFeatureProfile":{"version":"glm-cat-feature.v0.1","features":{"coatColor":"brown","pattern":"tabby","coatLength":"short","faceShape":"round","eyeColor":"yellow","faceMark":"m_mark","faceAsymmetry":"none","earFeature":"upright","tailFeature":"ringed","bodyBuild":"medium","noseColor":"pink","distinctiveMark":"white_chin"},"confidence":{"coatColor":0.92,"pattern":0.9,"coatLength":0.88,"faceShape":0.76,"eyeColor":0.72,"faceMark":0.83,"faceAsymmetry":0.61,"earFeature":0.9,"tailFeature":0.7,"bodyBuild":0.65,"noseColor":0.8,"distinctiveMark":0.58},"quality":{"visibility":0.84,"occlusion":0.12,"usableForMatch":true}},"scoreEvidence":{"charm":{"expression":82,"posture":74,"appearance":68,"affinity":61},"cleverness":{"observation":78,"reaction":66,"agility":52,"adaptation":70},"aura":{"expression":76,"patternFace":64,"presence":72,"scene":69}}}',
  'isCat 必须是布尔值；catCount 是整数；confidence 是 0 到 1 的数字；traits 最多 3 个简短中文词。',
  'name 必须是 2 到 5 个字符的中文短名；description 必须是 50 个字符以内的一段中文短描述，可以俏皮，但不能把不可见信息写成事实。',
  'glmCatFeatureProfile 是候选匹配辅助信息，不是猫咪的唯一生物特征；不要返回自由文本特征、地点、拍摄时间、人物、背景或品种稀有度。',
  'scoreEvidence.charm 依次是表情与眼神、姿态表现、外观呈现、亲和氛围，权重为 35%、25%、25%、15%。',
  'scoreEvidence.cleverness 依次是观察眼神、反应与姿态、动作灵活度、环境适应感，权重为 35%、30%、20%、15%。',
  'scoreEvidence.aura 依次是神态感染力、花纹与五官组合、姿态气场、场景氛围，权重为 35%、30%、20%、15%。',
  '每个子项都是 0 到 100 的整数；95 分以上必须能指出清楚的图片证据。不要使用品种、价格、血统、真实智商或图鉴稀有度加分。',
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

function normalizeProbability(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
}

function normalizeFeatureValue(value, key) {
  const options = GLM_FEATURE_SCHEMA[key] || [];
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return options.includes(normalized) ? normalized : GLM_FEATURE_UNKNOWN;
}

function normalizeFeatureProfile(value) {
  if (!value || typeof value !== 'object') return null;

  const source = value.features && typeof value.features === 'object'
    ? value.features
    : {};
  const sourceConfidence = value.confidence && typeof value.confidence === 'object'
    ? value.confidence
    : {};
  const qualitySource = value.quality && typeof value.quality === 'object'
    ? value.quality
    : {};
  const features = {};
  const confidence = {};
  let hasRecognizedFeature = false;
  let hasConfidentFeature = false;

  GLM_FEATURE_KEYS.forEach(key => {
    const normalized = normalizeFeatureValue(source[key], key);
    const confidenceValue = normalized === GLM_FEATURE_UNKNOWN
      ? 0
      : normalizeProbability(sourceConfidence[key], 0);
    features[key] = normalized;
    confidence[key] = confidenceValue;
    if (normalized !== GLM_FEATURE_UNKNOWN) hasRecognizedFeature = true;
    if (normalized !== GLM_FEATURE_UNKNOWN && confidenceValue > 0) hasConfidentFeature = true;
  });

  // 没有任何可解释特征时不把模型的空对象写入观察记录。
  if (!hasRecognizedFeature) return null;

  const visibility = normalizeProbability(qualitySource.visibility, 0);
  const occlusion = normalizeProbability(qualitySource.occlusion, 1);
  const usableForMatch = Boolean(
    qualitySource.usableForMatch === true
    && hasConfidentFeature
    && visibility >= 0.5
    && occlusion <= 0.6
  );

  return {
    version: GLM_FEATURE_PROFILE_VERSION,
    features,
    confidence,
    quality: {
      visibility,
      occlusion,
      usableForMatch,
    },
  };
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

function normalizeScore(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : null;
}

function normalizeScoreEvidence(value) {
  if (!value || typeof value !== 'object') return null;

  let hasAnyValue = false;
  const evidence = {};
  Object.keys(SCORE_EVIDENCE_CONFIG).forEach(dimension => {
    const source = value[dimension] && typeof value[dimension] === 'object'
      ? value[dimension]
      : {};
    evidence[dimension] = {};
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
  const rawScores = value.scores && typeof value.scores === 'object' ? value.scores : {};
  const scoreEvidence = normalizeScoreEvidence(value.scoreEvidence);
  const scores = {};
  const scoreCoverage = {};
  let hasDirectScore = false;

  Object.keys(SCORE_EVIDENCE_CONFIG).forEach(dimension => {
    const evidenceScore = calculateEvidenceScore(scoreEvidence, dimension);
    const legacyKey = dimension === 'cleverness' ? 'fate' : dimension === 'aura' ? 'rarity' : null;
    const directScore = normalizeScore(
      legacyKey ? getPreferredScore(rawScores, dimension, legacyKey) : rawScores[dimension]
    );

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
    copyVersion: isCat && catCount === 1 && (catName || catDescription) ? COPY_VERSION : null,
  };
  const featureFields = {
    // 多猫、非猫和主体不确定时不进入个体特征链路。
    glmCatFeatureProfile: isCat && catCount === 1 && confidence >= 0.55
      ? normalizeFeatureProfile(value.glmCatFeatureProfile)
      : null,
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
      ...featureFields,
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
      ...featureFields,
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
      ...featureFields,
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
    ...featureFields,
  };
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
