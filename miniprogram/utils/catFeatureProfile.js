// ============================================================
// 猫咪咔咔 - GLM 猫咪特征档案与轻量向量编码
//
// 这不是图像 embedding，也不是唯一生物识别指纹。
// 它把 GLM 观察到的、可解释的稳定特征压成固定槽位，供后续候选匹配使用。
// ============================================================

const GLM_FEATURE_PROFILE_VERSION = 'glm-cat-feature.v0.2';
const GLM_FEATURE_VECTOR_VERSION = 'glm-cat-vector.v0.2';
const UNKNOWN_VALUE = 'unknown';

// 模型只能从这些枚举中选择一个值；无法看清时统一返回 unknown。
const FEATURE_SCHEMA = Object.freeze({
  coatColor: Object.freeze([
    'orange', 'white', 'black', 'gray', 'brown', 'cream', 'silver', 'mixed', UNKNOWN_VALUE,
  ]),
  pattern: Object.freeze([
    'solid', 'tabby', 'bicolor', 'calico', 'tortoiseshell', 'pointed', 'spotted', 'mixed', UNKNOWN_VALUE,
  ]),
  coatLength: Object.freeze(['hairless', 'short', 'medium', 'long', UNKNOWN_VALUE]),
  faceShape: Object.freeze(['round', 'oval', 'long', 'wedge', UNKNOWN_VALUE]),
  eyeColor: Object.freeze(['yellow', 'green', 'blue', 'copper', 'hazel', 'odd', 'dark', UNKNOWN_VALUE]),
  faceMark: Object.freeze([
    'none', 'm_mark', 'blaze', 'eye_patch_left', 'eye_patch_right', 'eye_patch_both', 'muzzle_mark', UNKNOWN_VALUE,
  ]),
  faceAsymmetry: Object.freeze(['none', 'left_mark', 'right_mark', 'bilateral', UNKNOWN_VALUE]),
  earFeature: Object.freeze([
    'upright', 'folded', 'curled', 'left_notch', 'right_notch', 'bilateral_notch', UNKNOWN_VALUE,
  ]),
  tailFeature: Object.freeze(['long', 'short', 'ringed', 'dark_tip', 'bent', 'fluffy', UNKNOWN_VALUE]),
  bodyBuild: Object.freeze(['slim', 'medium', 'sturdy', UNKNOWN_VALUE]),
  noseColor: Object.freeze(['pink', 'black', 'brown', 'brick', UNKNOWN_VALUE]),
  distinctiveMark: Object.freeze([
    'none', 'white_chin', 'white_chest', 'white_paws', 'ear_notch', 'tail_tip', 'other', UNKNOWN_VALUE,
  ]),
  // 追加面部比例、局部标记和尾部形态，让向量能保留更多可解释的个体差异。
  faceProportion: Object.freeze(['narrow', 'balanced', 'broad', 'long', UNKNOWN_VALUE]),
  muzzleShape: Object.freeze(['short', 'balanced', 'long', 'broad', UNKNOWN_VALUE]),
  foreheadMark: Object.freeze(['none', 'm_mark', 'vertical', 'blaze', 'other', UNKNOWN_VALUE]),
  cheekMark: Object.freeze(['none', 'left', 'right', 'bilateral', 'other', UNKNOWN_VALUE]),
  chestMark: Object.freeze(['none', 'white', 'cream', 'dark', UNKNOWN_VALUE]),
  pawPattern: Object.freeze(['none', 'front_white', 'hind_white', 'all_white', 'mixed', UNKNOWN_VALUE]),
  tailCurl: Object.freeze(['straight', 'slight_curve', 'hooked', 'coiled', 'plume', 'kinked', UNKNOWN_VALUE]),
});

const FEATURE_KEYS = Object.freeze(Object.keys(FEATURE_SCHEMA));

// 权重只用于特征槽位之间的候选比较，不代表科学意义上的身份概率。
const FEATURE_WEIGHTS = Object.freeze({
  coatColor: 0.16,
  pattern: 0.18,
  coatLength: 0.04,
  faceShape: 0.05,
  eyeColor: 0.10,
  faceMark: 0.15,
  faceAsymmetry: 0.08,
  earFeature: 0.08,
  tailFeature: 0.08,
  bodyBuild: 0.03,
  noseColor: 0.01,
  distinctiveMark: 0.04,
  faceProportion: 0.025,
  muzzleShape: 0.025,
  foreheadMark: 0.04,
  cheekMark: 0.035,
  chestMark: 0.03,
  pawPattern: 0.04,
  tailCurl: 0.055,
});

const ENCODED_FEATURE_VALUES = Object.freeze(FEATURE_KEYS.reduce((result, key) => {
  result[key] = Object.freeze(FEATURE_SCHEMA[key].filter(value => value !== UNKNOWN_VALUE));
  return result;
}, {}));

const FEATURE_ONE_HOT_DIMENSION = FEATURE_KEYS.reduce((dimension, key) => (
  dimension + ENCODED_FEATURE_VALUES[key].length
), 0);
const FEATURE_CONFIDENCE_DIMENSION = FEATURE_KEYS.length;
const FEATURE_QUALITY_DIMENSION = 8;
const FEATURE_VECTOR_DIMENSION = FEATURE_ONE_HOT_DIMENSION
  + FEATURE_CONFIDENCE_DIMENSION
  + FEATURE_QUALITY_DIMENSION;

function clamp01(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
}

function normalizeFeatureValue(value, key) {
  const options = FEATURE_SCHEMA[key];
  if (!options) return UNKNOWN_VALUE;
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return options.includes(normalized) ? normalized : UNKNOWN_VALUE;
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
  const knownConfidences = [];

  FEATURE_KEYS.forEach(key => {
    const normalized = normalizeFeatureValue(source[key], key);
    const confidenceValue = normalized === UNKNOWN_VALUE
      ? 0
      : clamp01(sourceConfidence[key], 0);
    features[key] = normalized;
    confidence[key] = confidenceValue;
    if (normalized !== UNKNOWN_VALUE) hasRecognizedFeature = true;
    if (normalized !== UNKNOWN_VALUE && confidenceValue > 0) hasConfidentFeature = true;
    if (normalized !== UNKNOWN_VALUE) knownConfidences.push(confidenceValue);
  });

  // 没有任何有效槽位时不保存一个看似完整、实际为空的特征档案。
  if (!hasRecognizedFeature) return null;

  const visibility = clamp01(qualitySource.visibility, 0);
  const occlusion = clamp01(qualitySource.occlusion, 1);
  const meanKnownConfidence = knownConfidences.length
    ? knownConfidences.reduce((total, item) => total + item, 0) / knownConfidences.length
    : 0;
  const profileConfidence = clamp01(qualitySource.confidence, meanKnownConfidence);
  const knownFeatureRatio = knownConfidences.length / FEATURE_KEYS.length;
  const maxKnownConfidence = knownConfidences.length ? Math.max(...knownConfidences) : 0;
  const minKnownConfidence = knownConfidences.length ? Math.min(...knownConfidences) : 0;
  const requestedUsable = qualitySource.usableForMatch === true;
  const usableForMatch = Boolean(
    requestedUsable
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
      confidence: profileConfidence,
      usableForMatch,
      knownFeatureRatio,
      meanKnownConfidence,
      maxKnownConfidence,
      minKnownConfidence,
    },
  };
}

/**
 * 将结构化特征编码为固定维度的数值数组。
 * unknown 不占用匹配信号；每个槽位后附一个字段置信度，末尾附 8 个质量元信息。
 * 当前顺序固定为：可见度、无遮挡度、可匹配标记、整体置信度、已知特征占比、
 * 已知字段平均置信度、最高字段置信度、最低字段置信度。
 */
function encodeFeatureProfile(value) {
  const profile = normalizeFeatureProfile(value);
  if (!profile || !profile.quality.usableForMatch) return null;

  const vector = [];
  FEATURE_KEYS.forEach(key => {
    const selected = profile.features[key];
    ENCODED_FEATURE_VALUES[key].forEach(option => {
      vector.push(option === selected ? 1 : 0);
    });
  });
  FEATURE_KEYS.forEach(key => vector.push(profile.confidence[key]));
  vector.push(profile.quality.visibility);
  vector.push(1 - profile.quality.occlusion);
  vector.push(profile.quality.usableForMatch ? 1 : 0);
  vector.push(profile.quality.confidence);
  vector.push(profile.quality.knownFeatureRatio);
  vector.push(profile.quality.meanKnownConfidence);
  vector.push(profile.quality.maxKnownConfidence);
  vector.push(profile.quality.minKnownConfidence);

  return vector.length === FEATURE_VECTOR_DIMENSION ? vector : null;
}

function roundScore(value) {
  return Math.round(value * 10000) / 10000;
}

/**
 * 比较两个结构化特征档案。
 * 分数是“已比较字段中的加权一致度”，coverage 表示有多少权重真正有可用证据。
 */
function compareFeatureProfiles(leftValue, rightValue) {
  const left = normalizeFeatureProfile(leftValue);
  const right = normalizeFeatureProfile(rightValue);
  if (!left || !right) {
    return {
      score: null,
      coverage: 0,
      matchedFields: [],
      comparedFields: [],
      usableForMatch: false,
    };
  }

  let weightedAgreement = 0;
  let comparedWeight = 0;
  const matchedFields = [];
  const comparedFields = [];

  FEATURE_KEYS.forEach(key => {
    const leftFeature = left.features[key];
    const rightFeature = right.features[key];
    const confidence = Math.min(left.confidence[key], right.confidence[key]);
    if (
      leftFeature === UNKNOWN_VALUE
      || rightFeature === UNKNOWN_VALUE
      || confidence <= 0
    ) return;

    const weight = FEATURE_WEIGHTS[key];
    comparedWeight += weight * confidence;
    comparedFields.push(key);
    if (leftFeature === rightFeature) {
      weightedAgreement += weight * confidence;
      matchedFields.push(key);
    }
  });

  const totalWeight = FEATURE_KEYS.reduce((total, key) => total + FEATURE_WEIGHTS[key], 0);
  return {
    score: comparedWeight ? roundScore(weightedAgreement / comparedWeight) : null,
    coverage: roundScore(comparedWeight / totalWeight),
    matchedFields,
    comparedFields,
    usableForMatch: Boolean(
      left.quality.usableForMatch
      && right.quality.usableForMatch
      && comparedWeight / totalWeight >= 0.25
    ),
  };
}

function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || !left.length) {
    return null;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = Number(left[index]);
    const rightValue = Number(right[index]);
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) return null;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (!leftMagnitude || !rightMagnitude) return null;
  return roundScore(dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude)));
}

module.exports = {
  GLM_FEATURE_PROFILE_VERSION,
  GLM_FEATURE_VECTOR_VERSION,
  UNKNOWN_VALUE,
  FEATURE_SCHEMA,
  FEATURE_KEYS,
  FEATURE_WEIGHTS,
  FEATURE_VECTOR_DIMENSION,
  normalizeFeatureProfile,
  encodeFeatureProfile,
  compareFeatureProfiles,
  cosineSimilarity,
};
