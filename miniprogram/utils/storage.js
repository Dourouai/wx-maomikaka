// ============================================================
// 猫咪咔咔 - 本地存储封装
// ============================================================
const { ALL_CATS } = require('./catData');
const { MEMBER_LEVEL_VERSION } = require('./memberLevel');

const KEY_COLLECTION = 'maomikaka_collection';
const KEY_RECORDS = 'maomikaka_records';
const KEY_STATS = 'maomikaka_stats';

function _get(key) {
  try {
    return wx.getStorageSync(key) || null;
  } catch (err) {
    console.error('[Storage] read failed:', key, err);
    return null;
  }
}

function _set(key, value) {
  try {
    wx.setStorageSync(key, value);
  } catch (err) {
    console.error('[Storage] write failed:', key, err);
  }
}

function _createStats() {
  return {
    totalPhotos: 0,
    unlockedCount: 0,
    lastPhotoTime: null,
    // 猫爪是用户成长值，会员等级由 memberLevel.js 根据它计算。
    pawGrowth: 0,
    memberLevelVersion: MEMBER_LEVEL_VERSION,
  };
}

function _calculateRecordedPawGrowth() {
  const records = _get(KEY_RECORDS);
  if (!Array.isArray(records)) return 0;

  return records.reduce((total, record) => {
    const reward = Number(record && record.pawReward);
    return Number.isFinite(reward) && reward > 0
      ? total + Math.round(reward)
      : total;
  }, 0);
}

function _createCollection() {
  return ALL_CATS.reduce((collection, cat) => {
    collection[cat.id] = {
      catId: cat.id,
      unlocked: false,
      unlockedAt: null,
      photoCount: 0,
      featuredRecordId: null,
      displayName: null,
      displayDescription: null,
      copyVersion: null,
      records: [],
    };
    return collection;
  }, {});
}

function _ensureCollectionShape(collection) {
  const next = collection && typeof collection === 'object' ? collection : {};
  let changed = false;

  ALL_CATS.forEach(cat => {
    if (!next[cat.id]) {
      next[cat.id] = {
        catId: cat.id,
        unlocked: false,
        unlockedAt: null,
        photoCount: 0,
        featuredRecordId: null,
        displayName: null,
        displayDescription: null,
        copyVersion: null,
        records: [],
      };
      changed = true;
      return;
    }

    const entry = next[cat.id];
    if (!Array.isArray(entry.records)) {
      entry.records = [];
      changed = true;
    }
    if (typeof entry.photoCount !== 'number') {
      entry.photoCount = entry.records.length;
      changed = true;
    }
    if (entry.displayName === undefined) {
      entry.displayName = null;
      changed = true;
    }
    if (entry.displayDescription === undefined) {
      entry.displayDescription = null;
      changed = true;
    }
    if (entry.copyVersion === undefined) {
      entry.copyVersion = null;
      changed = true;
    }
  });

  return { collection: next, changed };
}

function initStorage() {
  const currentCollection = _get(KEY_COLLECTION);
  if (!currentCollection) {
    _set(KEY_COLLECTION, _createCollection());
  } else {
    const normalized = _ensureCollectionShape(currentCollection);
    if (normalized.changed) _set(KEY_COLLECTION, normalized.collection);
  }

  const records = _get(KEY_RECORDS);
  if (!Array.isArray(records)) _set(KEY_RECORDS, []);

  const stats = _get(KEY_STATS);
  if (!stats || typeof stats !== 'object') {
    _set(KEY_STATS, _createStats());
  }
}

function getCollection() {
  const current = _get(KEY_COLLECTION);
  if (!current) {
    const collection = _createCollection();
    _set(KEY_COLLECTION, collection);
    return collection;
  }
  return _ensureCollectionShape(current).collection;
}

function setFeaturedRecord(catId, recordId) {
  const collection = getCollection();
  const entry = collection[catId];
  if (!entry) return;

  const record = getRecordById(recordId);
  if (!record || record.catId !== catId) return;

  entry.featuredRecordId = recordId;
  _set(KEY_COLLECTION, collection);
}

/**
 * 获取记录在界面上的展示图。
 * 新记录优先展示主体处理结果；没有处理结果时才展示安全校验后的原图。
 * 旧版本的模型展示图不再作为展示图，避免继续展示历史生图结果。
 */
function getRecordDisplayPath(record) {
  if (!record) return '';
  return record.cutoutPhotoPath || record.cutoutPhoto || record.photoPath || record.photo || '';
}

/**
 * 保存一条拍摄记录。
 * 兼容 identifyCat 返回的 { catId, catData }，也兼容直接传入 catId/photoPath。
 */
function saveRecord(recordData) {
  const data = recordData || {};
  const now = Date.now();
  const catId = data.catId || (data.catData && data.catData.id);
  const photoPath = data.photoPath || data.photo || '';
  const catName = data.catName
    || data.generatedName
    || (data.catData && data.catData.name)
    || null;
  const catDescription = data.catDescription
    || data.generatedDescription
    || (data.catData && (data.catData.story || data.catData.description))
    || null;
  const pawReward = Number.isFinite(Number(data.pawReward))
    ? Math.max(0, Math.round(Number(data.pawReward)))
    : 0;
  const records = getAllRecords();
  const collection = getCollection();
  const stats = getUserStats();

  if (!catId || !collection[catId]) {
    throw new Error('[Storage] invalid catId');
  }

  const record = {
    recordId: `rec_${now}_${Math.random().toString(36).slice(2, 7)}`,
    catId,
    catName,
    catDescription,
    copyVersion: data.copyVersion || null,
    photoPath,
    // 保留 photo 字段，方便旧页面或历史数据读取。
    photo: photoPath,
    originalFileID: data.originalFileID || null,
    cutoutFileID: data.cutoutFileID || null,
    cutoutPhotoPath: data.cutoutPhotoPath || data.cutoutPhoto || '',
    cutoutContentType: data.cutoutContentType || null,
    cutoutProvider: data.cutoutProvider || null,
    cutoutOperation: data.cutoutOperation || null,
    cutoutRequestId: data.cutoutRequestId || null,
    cutoutCheckerboardRemoved: data.cutoutCheckerboardRemoved === true,
    // 相遇等级由三项相遇分计算，和图鉴条目的静态分类字段分开保存。
    levelCode: data.levelCode || data.encounterLevel || null,
    levelLabel: data.levelLabel || null,
    levelShortLabel: data.levelShortLabel || null,
    charmScore: typeof data.charmScore === 'number' ? data.charmScore : null,
    clevernessScore: typeof data.clevernessScore === 'number' ? data.clevernessScore : null,
    auraScore: typeof data.auraScore === 'number' ? data.auraScore : null,
    // 旧版本字段保留，方便历史本地记录按兼容规则读取；新记录不再填充这两个字段。
    rarityScore: typeof data.rarityScore === 'number' ? data.rarityScore : null,
    fateScore: typeof data.fateScore === 'number' ? data.fateScore : null,
    overallScore: typeof data.overallScore === 'number' ? data.overallScore : null,
    pawReward,
    pointReward: typeof data.pointReward === 'number' ? data.pointReward : null,
    scorePending: data.scorePending === true,
    scoreSource: data.scoreSource || null,
    scoreVersion: data.scoreVersion || null,
    scoreEvidence: data.scoreEvidence && typeof data.scoreEvidence === 'object'
      ? data.scoreEvidence
      : null,
    scoreCoverage: data.scoreCoverage && typeof data.scoreCoverage === 'object'
      ? data.scoreCoverage
      : null,
    detectedBreed: data.breedLabel || data.detectedBreed || data.breed || null,
    breedConfidence: typeof data.breedConfidence === 'number' ? data.breedConfidence : null,
    detectedTraits: Array.isArray(data.detectedTraits) ? data.detectedTraits.slice(0, 3) : [],
    catCount: typeof data.catCount === 'number' ? data.catCount : 1,
    detectionSource: data.detectionSource || null,
    savedPath: data.savedPath || null,
    createdAt: data.createdAt || now,
    capturedAt: new Date(data.createdAt || now).toISOString(),
  };

  records.unshift(record);
  _set(KEY_RECORDS, records);

  const entry = collection[catId];
  const isNew = !entry.unlocked;
  entry.unlocked = true;
  entry.unlockedAt = entry.unlockedAt || now;
  entry.photoCount = (entry.photoCount || 0) + 1;
  entry.records = Array.isArray(entry.records) ? entry.records : [];
  entry.records.unshift(record.recordId);
  entry.featuredRecordId = entry.featuredRecordId || record.recordId;
  entry.displayName = entry.displayName || catName;
  entry.displayDescription = entry.displayDescription || catDescription;
  entry.copyVersion = entry.copyVersion || record.copyVersion;
  _set(KEY_COLLECTION, collection);

  stats.totalPhotos = (stats.totalPhotos || 0) + 1;
  stats.unlockedCount = (stats.unlockedCount || 0) + (isNew ? 1 : 0);
  stats.lastPhotoTime = now;
  stats.pawGrowth = (stats.pawGrowth || 0) + pawReward;
  _set(KEY_STATS, stats);

  return {
    record,
    recordId: record.recordId,
    isNew,
  };
}

function getAllRecords() {
  const records = _get(KEY_RECORDS);
  return Array.isArray(records) ? records : [];
}

function getRecordById(recordId) {
  return getAllRecords().find(record => record.recordId === recordId) || null;
}

function getRecordsForCat(catId) {
  return getAllRecords()
    .filter(record => record.catId === catId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function getUserStats() {
  const current = _get(KEY_STATS);
  const stats = current && typeof current === 'object' ? current : _createStats();
  let changed = !current || typeof current !== 'object';

  if (typeof stats.totalPhotos !== 'number') {
    stats.totalPhotos = 0;
    changed = true;
  }
  if (typeof stats.unlockedCount !== 'number') {
    stats.unlockedCount = 0;
    changed = true;
  }
  if (stats.lastPhotoTime === undefined) {
    stats.lastPhotoTime = null;
    changed = true;
  }
  if (stats.memberLevelVersion !== MEMBER_LEVEL_VERSION) {
    stats.memberLevelVersion = MEMBER_LEVEL_VERSION;
    changed = true;
  }
  if (!Number.isFinite(Number(stats.pawGrowth))) {
    stats.pawGrowth = _calculateRecordedPawGrowth();
    changed = true;
  } else {
    const normalizedGrowth = Math.max(0, Math.floor(Number(stats.pawGrowth)));
    if (normalizedGrowth !== stats.pawGrowth) {
      stats.pawGrowth = normalizedGrowth;
      changed = true;
    }
  }

  if (changed) _set(KEY_STATS, stats);
  return stats;
}

/**
 * 返回已解锁猫咪的展示数据，统一从拍摄记录反查照片，避免字段漂移。
 */
function getUnlockedMap() {
  const collection = getCollection();
  const result = {};

  Object.keys(collection).forEach(catId => {
    const entry = collection[catId];
    if (!entry || !entry.unlocked) return;

    const records = getRecordsForCat(catId);
    const featured = entry.featuredRecordId
      ? getRecordById(entry.featuredRecordId)
      : records[0];
    const latest = records[0];

    result[catId] = {
      count: entry.photoCount || records.length,
      displayName: entry.displayName || (latest && latest.catName) || null,
      displayDescription: entry.displayDescription || (latest && latest.catDescription) || null,
      lastPhotoPath: getRecordDisplayPath(latest),
      featuredPhotoPath: getRecordDisplayPath(featured),
      isNew: false,
    };
  });

  return result;
}

module.exports = {
  initStorage,
  getCollection,
  saveRecord,
  getAllRecords,
  getRecordById,
  getRecordsForCat,
  getRecordDisplayPath,
  getUserStats,
  setFeaturedRecord,
  getUnlockedMap,
};
