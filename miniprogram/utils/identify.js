// ============================================================
// 猫咪咔咔 - 猫咪视觉识别与图鉴映射
// ============================================================
const catVision = require('./catVision');
const storage = require('./storage');
const { getCatById, getCatsByBreed } = require('./catData');

// 视觉识别服务不可用或做流程演示时，可用“未知品种”占位卡承接结果。
// 正常拍摄流程会调用 identifyCat，只有显式使用本方法时才走占位数据。
const PENDING_ENCOUNTER_CAT_ID = 'cat_060';
const MAX_CAT_NAME_LENGTH = 5;
const MAX_CAT_DESCRIPTION_LENGTH = 50;

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

function createError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function normalizeBreedLabel(value) {
  const input = String(value || '').trim();
  if (!input) return '未知品种';

  const knownBreeds = getCatsByBreed(input);
  if (knownBreeds.length) return input;

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
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return Array.from(normalized).slice(0, maxLength).join('');
}

function normalizeGeneratedName(value, fallback) {
  const generated = normalizeCopyText(value, MAX_CAT_NAME_LENGTH);
  if (generated.length >= 2) return generated;
  return normalizeCopyText(fallback, MAX_CAT_NAME_LENGTH);
}

function normalizeGeneratedDescription(value, fallback) {
  const generated = normalizeCopyText(value, MAX_CAT_DESCRIPTION_LENGTH);
  if (generated.length >= 4) return generated;
  return normalizeCopyText(fallback, MAX_CAT_DESCRIPTION_LENGTH);
}

function chooseCatalogCat(breedLabel) {
  const candidates = getCatsByBreed(breedLabel);
  const fallbackCandidates = candidates.length ? candidates : getCatsByBreed('未知品种');
  if (!fallbackCandidates.length) {
    throw createError('CAT_CATALOG_UNAVAILABLE', '暂时找不到对应的图鉴条目');
  }

  const collection = storage.getCollection();
  // 同一品种的多个游戏角色按未解锁优先，品种事实与角色抽取各自独立。
  const locked = fallbackCandidates.filter(cat => {
    const entry = collection[cat.id];
    return !entry || !entry.unlocked;
  });
  const picked = locked[0] || fallbackCandidates[0];
  const entry = collection[picked.id];

  return {
    catId: picked.id,
    catData: picked,
    isNew: !entry || !entry.unlocked,
  };
}

function createPendingEncounter() {
  const catData = getCatById(PENDING_ENCOUNTER_CAT_ID);
  if (!catData) {
    throw createError('CAT_CATALOG_UNAVAILABLE', '暂时找不到图鉴占位条目');
  }

  return {
    isCat: null,
    catCount: null,
    breedLabel: '待识别',
    breedConfidence: null,
    // 占位结果没有视觉评分，评分模块会用基础相遇分兜底。
    scores: null,
    detectedTraits: [],
    detectionSource: 'pending-vision',
    catId: catData.id,
    catData,
  };
}

/**
 * 先做猫咪检测，再把视觉模型的品种标签映射到图鉴角色。
 * 视觉模型返回事实层与受约束的展示文案；游戏角色、稀有度和唯一性仍由本地图鉴数据决定。
 */
async function identifyCat(photoPath, options) {
  const detection = await catVision.inspectCat(photoPath, options);
  if (!detection || detection.ok !== true) {
    throw createError(
      (detection && detection.code) || 'VISION_UNAVAILABLE',
      '猫咪识别服务暂时不可用'
    );
  }

  if (detection.code === 'NOT_A_CAT' || detection.isCat !== true) {
    throw createError('NOT_A_CAT', '这张照片里没有发现猫咪');
  }
  if (detection.code === 'MULTIPLE_CATS' || Number(detection.catCount) > 1) {
    throw createError('MULTIPLE_CATS', '照片里有不止一只猫咪');
  }
  if (detection.code === 'CAT_UNCERTAIN') {
    throw createError('CAT_UNCERTAIN', '猫咪主体不够清楚');
  }

  const breedLabel = normalizeBreedLabel(detection.breed);
  const catalog = chooseCatalogCat(breedLabel);
  const catName = normalizeGeneratedName(detection.name, catalog.catData.name);
  const catDescription = normalizeGeneratedDescription(detection.description, catalog.catData.story);
  const displayCatData = {
    ...catalog.catData,
    name: catName,
    story: catDescription,
  };
  console.log(
    `[Identify:Vision] ${breedLabel} -> ${catName} (${catalog.catData.rarity})`
  );

  return {
    isCat: true,
    catCount: Number(detection.catCount) || 1,
    breedLabel,
    breedConfidence: Number(detection.confidence) || 0,
    scores: detection.scores || null,
    scoreEvidence: detection.scoreEvidence || null,
    scoreCoverage: detection.scoreCoverage || null,
    scoreVersion: detection.scoreVersion || null,
    catName,
    catDescription,
    copyVersion: detection.copyVersion || 'catalog-fallback',
    detectedTraits: Array.isArray(detection.traits) ? detection.traits : [],
    detectionSource: 'tokenhub-glm-5.3-flash',
    ...catalog,
    catData: displayCatData,
  };
}

module.exports = {
  createPendingEncounter,
  identifyCat,
  normalizeBreedLabel,
};
