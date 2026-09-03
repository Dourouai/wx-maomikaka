// 猫咪咔咔 - 相遇卡评分与等级规则
// 规则来源：docs/CAT_SCORING_RULES_V0_1.md、docs/AI_PRODUCT_BRIEF_V1.md

const SCORE_CONFIG = [
  { key: 'charm', label: '魅力', weight: 0.4 },
  { key: 'rarity', label: '稀奇', weight: 0.35 },
  { key: 'fate', label: '缘分', weight: 0.25 },
];

const LEVELS = [
  { code: 'C', label: '街角', shortLabel: '街角常客', min: 0, max: 49, pointReward: 3 },
  { code: 'U', label: '偶见', shortLabel: '偶尔现身', min: 50, max: 64, pointReward: 5 },
  { code: 'R', label: '稀遇', shortLabel: '难得一见', min: 65, max: 79, pointReward: 8 },
  { code: 'SR', label: '惊鸿', shortLabel: '一瞬难忘', min: 80, max: 91, pointReward: 13 },
  { code: 'UR', label: '神隐', shortLabel: '城市传闻', min: 92, max: 100, pointReward: 21 },
];

const LEVEL_MAP = LEVELS.reduce((map, level, index) => {
  map[level.code] = { ...level, rank: index };
  return map;
}, {});

const BASELINE_SCORES = {
  charm: 50,
  rarity: 50,
  fate: 50,
};

const EMPTY_SCORES = {
  charm: 0,
  rarity: 0,
  fate: 0,
};

function clampScore(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(Math.max(0, Math.min(100, parsed)));
}

function getScoreSource(input) {
  if (input && input.scores && typeof input.scores === 'object') return input.scores;
  return input && typeof input === 'object' ? input : {};
}

function getScoreValue(source, key) {
  const directValue = source[key];
  const storedValue = source[`${key}Score`];
  return directValue !== undefined && directValue !== null
    ? directValue
    : storedValue;
}

function hasExplicitScores(input) {
  const source = getScoreSource(input);
  return SCORE_CONFIG.some(item => {
    const value = getScoreValue(source, item.key);
    return value !== undefined && value !== null && Number.isFinite(Number(value));
  });
}

function normalizeScores(input, fallbackScores) {
  const source = getScoreSource(input);
  const fallback = fallbackScores || BASELINE_SCORES;
  return SCORE_CONFIG.reduce((scores, item) => {
    const value = getScoreValue(source, item.key);
    scores[item.key] = clampScore(value, fallback[item.key]);
    return scores;
  }, {});
}

function isPendingPlaceholderScore(input) {
  if (!input || input.scorePending !== true) return false;
  if (input.scoreSource === 'evidence') return false;

  const source = getScoreSource(input);
  const values = SCORE_CONFIG.map(item => getScoreValue(source, item.key));
  const hasAnyValue = values.some(value => value !== undefined && value !== null);
  return hasAnyValue && values.every(value => Number(value) === 0);
}

function calculateOverallScore(scores) {
  const result = SCORE_CONFIG.reduce(
    (sum, item) => sum + scores[item.key] * item.weight,
    0
  );
  return Math.round(result);
}

function resolveLevel(scores, overallScore) {
  const standoutCount = SCORE_CONFIG.filter(item => scores[item.key] >= 70).length;

  // UR 必须同时满足综合分、稀奇值和缘分值门槛。
  if (overallScore >= 92 && scores.rarity >= 85 && scores.fate >= 80) return 'UR';

  // 未满足 UR 门槛但综合表现突出时，仍按 SR 的“至少两项突出”规则处理。
  if (overallScore >= 80 && standoutCount >= 2) return 'SR';
  if (overallScore >= 65) return 'R';
  if (overallScore >= 50) return 'U';
  return 'C';
}

function getLevelMeta(code) {
  return LEVEL_MAP[code] || LEVEL_MAP.C;
}

function calculatePawReward(overallScore) {
  return Math.round((70 + overallScore * 0.6) / 5) * 5;
}

function createScoreItems(scores) {
  return SCORE_CONFIG.map(item => ({
    key: item.key,
    label: item.label,
    value: scores[item.key],
    weight: item.weight,
  }));
}

/**
 * 根据三项相遇分计算相遇卡等级与奖励。
 * 未接入视觉评分时使用 50/50/50 的基础记录，不伪造高等级；
 * 视觉模型恢复后，只需传入 charm / rarity / fate 即可替换。
 */
function scoreEncounter(input, options = {}) {
  const explicit = hasExplicitScores(input);
  const fallbackScores = options.useBaseline === false ? EMPTY_SCORES : BASELINE_SCORES;
  const scores = normalizeScores(input, fallbackScores);
  const overallScore = calculateOverallScore(scores);
  const levelCode = resolveLevel(scores, overallScore);
  const level = getLevelMeta(levelCode);

  return {
    charmScore: scores.charm,
    rarityScore: scores.rarity,
    fateScore: scores.fate,
    overallScore,
    levelCode: level.code,
    levelLabel: level.label,
    levelShortLabel: level.shortLabel,
    pawReward: calculatePawReward(overallScore),
    pointReward: level.pointReward,
    scoreItems: createScoreItems(scores),
    scorePending: options.scorePending === true || !explicit,
    scoreSource: options.scoreSource || (explicit ? 'evidence' : 'baseline'),
  };
}

/**
 * 读取旧记录和新记录的等级数据。
 * 旧记录没有评分字段时按 C 档待评估，不把旧版 N/R/SR/SSR 当成新等级。
 */
function getStoredEncounter(record) {
  const value = record || {};
  const explicit = hasExplicitScores(value) && !isPendingPlaceholderScore(value);
  const storedLevel = LEVEL_MAP[value.levelCode];
  const pending = value.scorePending === true;

  if (!explicit) {
    return {
      charmScore: null,
      rarityScore: null,
      fateScore: null,
      overallScore: null,
      levelCode: storedLevel ? storedLevel.code : 'C',
      levelLabel: storedLevel ? storedLevel.label : LEVEL_MAP.C.label,
      levelShortLabel: storedLevel ? storedLevel.shortLabel : LEVEL_MAP.C.shortLabel,
      pawReward: null,
      pointReward: storedLevel ? storedLevel.pointReward : null,
      scoreItems: [],
      scorePending: true,
      scoreSource: storedLevel ? (value.scoreSource || 'stored') : 'legacy',
    };
  }

  const result = scoreEncounter(value, {
    scorePending: pending || !explicit,
    scoreSource: value.scoreSource || (explicit ? 'stored' : 'legacy'),
  });

  if (storedLevel && !explicit) {
    result.levelCode = storedLevel.code;
    result.levelLabel = storedLevel.label;
    result.levelShortLabel = storedLevel.shortLabel;
    result.pointReward = storedLevel.pointReward;
  }
  return result;
}

function getBestEncounter(records) {
  if (!Array.isArray(records) || records.length === 0) return null;

  return records.reduce((best, record) => {
    const current = {
      record,
      ...getStoredEncounter(record),
    };
    if (!best) return current;

    const currentRank = getLevelMeta(current.levelCode).rank;
    const bestRank = getLevelMeta(best.levelCode).rank;
    if (currentRank !== bestRank) return currentRank > bestRank ? current : best;
    if (current.overallScore !== best.overallScore) {
      return current.overallScore > best.overallScore ? current : best;
    }
    return (current.record.createdAt || 0) > (best.record.createdAt || 0) ? current : best;
  }, null);
}

module.exports = {
  SCORE_CONFIG,
  LEVELS,
  BASELINE_SCORES,
  calculateOverallScore,
  calculatePawReward,
  getBestEncounter,
  getLevelMeta,
  getStoredEncounter,
  hasExplicitScores,
  resolveLevel,
  scoreEncounter,
};
