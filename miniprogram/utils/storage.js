// ============================================================
// 猫咪咔咔 - 本地存储封装
// ============================================================
const { ALL_CATS } = require('./catData');
const { MEMBER_LEVEL_VERSION } = require('./memberLevel');

const KEY_COLLECTION = 'maomikaka_collection';
const KEY_RECORDS = 'maomikaka_records';
const KEY_STATS = 'maomikaka_stats';
const KEY_SYNC_STATE = 'maomikaka_sync_state';
const KEY_DEVICE_ID = 'maomikaka_device_id';
const KEY_SHARE_IDS = 'maomikaka_share_ids';
const SYNC_SCHEMA_VERSION = 1;

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

function _createLocalId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function _getTimestamp(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getDeviceId() {
  const current = _get(KEY_DEVICE_ID);
  if (typeof current === 'string' && current.trim()) return current;

  const deviceId = _createLocalId('device');
  _set(KEY_DEVICE_ID, deviceId);
  return deviceId;
}

function _getShareScope() {
  const syncState = _get(KEY_SYNC_STATE);
  const bindingKey = syncState && typeof syncState.accountBindingKey === 'string'
    ? syncState.accountBindingKey.trim()
    : '';
  return bindingKey || 'local';
}

function _getShareIdMap() {
  const current = _get(KEY_SHARE_IDS);
  return current && typeof current === 'object' ? current : {};
}

function getShareId(catId) {
  const normalizedCatId = String(catId || '').trim();
  if (!normalizedCatId) return '';
  const shareId = _getShareIdMap()[`${_getShareScope()}:${normalizedCatId}`];
  return typeof shareId === 'string' ? shareId : '';
}

function setShareId(catId, shareId) {
  const normalizedCatId = String(catId || '').trim();
  const normalizedShareId = String(shareId || '').trim();
  if (!normalizedCatId || !normalizedShareId) return '';

  const shareIds = _getShareIdMap();
  shareIds[`${_getShareScope()}:${normalizedCatId}`] = normalizedShareId;
  _set(KEY_SHARE_IDS, shareIds);
  return normalizedShareId;
}

function getOrCreateShareId(catId) {
  const existing = getShareId(catId);
  if (existing) return existing;

  const shareId = `catshare_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
  return setShareId(catId, shareId);
}

function _createSyncState() {
  return {
    schemaVersion: SYNC_SCHEMA_VERSION,
    deviceId: getDeviceId(),
    status: 'local',
    userBound: false,
    accountBindingKey: null,
    accountChanged: false,
    accountCheckPending: false,
    importConsentAt: null,
    lastSyncedAt: null,
    lastSyncError: null,
    lastRemoteRecordCount: 0,
  };
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

  const syncState = _get(KEY_SYNC_STATE);
  if (!syncState || typeof syncState !== 'object') {
    _set(KEY_SYNC_STATE, _createSyncState());
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
  const localRecordId = data.clientRecordId
    || `rec_${now}_${Math.random().toString(36).slice(2, 7)}`;
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
    recordId: localRecordId,
    clientRecordId: localRecordId,
    syncState: 'pending',
    syncedAt: null,
    syncError: null,
    serverEncounterId: null,
    catProfileId: data.catProfileId || null,
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

function getSyncState() {
  const current = _get(KEY_SYNC_STATE);
  const state = current && typeof current === 'object'
    ? current
    : _createSyncState();
  let changed = !current || typeof current !== 'object';

  if (state.schemaVersion !== SYNC_SCHEMA_VERSION) {
    state.schemaVersion = SYNC_SCHEMA_VERSION;
    changed = true;
  }
  if (!state.deviceId) {
    state.deviceId = getDeviceId();
    changed = true;
  }
  if (!state.status) {
    state.status = 'local';
    changed = true;
  }
  if (typeof state.userBound !== 'boolean') {
    state.userBound = false;
    changed = true;
  }
  if (state.accountBindingKey === undefined) {
    state.accountBindingKey = null;
    changed = true;
  }
  if (typeof state.accountChanged !== 'boolean') {
    state.accountChanged = false;
    changed = true;
  }
  if (typeof state.accountCheckPending !== 'boolean') {
    state.accountCheckPending = false;
    changed = true;
  }
  if (state.importConsentAt === undefined) {
    state.importConsentAt = null;
    changed = true;
  }
  if (state.lastSyncedAt === undefined) {
    state.lastSyncedAt = null;
    changed = true;
  }
  if (state.lastSyncError === undefined) {
    state.lastSyncError = null;
    changed = true;
  }
  if (typeof state.lastRemoteRecordCount !== 'number') {
    state.lastRemoteRecordCount = 0;
    changed = true;
  }

  if (changed) _set(KEY_SYNC_STATE, state);
  return state;
}

function setSyncState(patch) {
  const state = {
    ...getSyncState(),
    ...(patch && typeof patch === 'object' ? patch : {}),
    schemaVersion: SYNC_SCHEMA_VERSION,
  };
  _set(KEY_SYNC_STATE, state);
  return state;
}

function getSyncSummary() {
  const records = getAllRecords();
  const pendingRecords = records.filter(record => record.syncState !== 'synced');
  return {
    totalRecords: records.length,
    pendingRecords: pendingRecords.length,
    syncedRecords: records.length - pendingRecords.length,
    deviceId: getDeviceId(),
  };
}

function getPendingRecords() {
  return getAllRecords().filter(record => record.syncState !== 'synced');
}

function markRecordsSynced(mappings) {
  if (!Array.isArray(mappings) || !mappings.length) return 0;

  const mappingByLocalId = mappings.reduce((map, mapping) => {
    const localId = mapping && (mapping.localRecordId || mapping.recordId);
    if (localId) map[localId] = mapping;
    return map;
  }, {});
  const records = getAllRecords();
  let changedCount = 0;
  const nextRecords = records.map(record => {
    const localId = record.clientRecordId || record.recordId;
    const mapping = mappingByLocalId[localId];
    if (!mapping) return record;

    changedCount += 1;
    return {
      ...record,
      clientRecordId: record.clientRecordId || localId,
      syncState: 'synced',
      syncedAt: Date.now(),
      syncError: null,
      serverEncounterId: mapping.encounterId || mapping.serverEncounterId || record.serverEncounterId || null,
      catProfileId: mapping.catProfileId || record.catProfileId || null,
    };
  });

  if (changedCount) _set(KEY_RECORDS, nextRecords);
  return changedCount;
}

function markPendingSyncError(message) {
  const normalized = String(message || '同步失败').slice(0, 160);
  const records = getAllRecords().map(record => (
    record.syncState === 'synced'
      ? record
      : { ...record, syncState: 'pending', syncError: normalized }
  ));
  _set(KEY_RECORDS, records);
  return normalized;
}

function prepareRecordsForAccountRebind() {
  const records = getAllRecords();
  let changedCount = 0;
  const nextRecords = records.map(record => {
    if (
      record.syncState !== 'synced'
      || record.serverEncounterId
      || record.catProfileId
      || record.syncedAt
      || record.syncError
    ) {
      changedCount += 1;
    }
    return {
      ...record,
      syncState: 'pending',
      syncedAt: null,
      syncError: null,
      serverEncounterId: null,
      catProfileId: null,
    };
  });

  if (changedCount) _set(KEY_RECORDS, nextRecords);
  return changedCount;
}

function _normalizeRemoteRecord(remote) {
  const source = remote && typeof remote === 'object' ? remote : {};
  const media = source.media && typeof source.media === 'object' ? source.media : {};
  const observation = source.observation && typeof source.observation === 'object'
    ? source.observation
    : {};
  const score = source.score && typeof source.score === 'object' ? source.score : {};
  const display = source.display && typeof source.display === 'object' ? source.display : {};
  const recordId = source.localRecordId || `remote_${source.encounterId || _createLocalId('record')}`;

  return {
    recordId,
    clientRecordId: source.localRecordId || null,
    syncState: 'synced',
    syncedAt: Date.now(),
    syncError: null,
    serverEncounterId: source.encounterId || null,
    catProfileId: source.catProfileId || null,
    catId: source.catalogCatId || 'cat_060',
    catName: display.name || source.catName || null,
    catDescription: display.description || source.catDescription || null,
    copyVersion: display.copyVersion || source.copyVersion || null,
    photoPath: '',
    photo: '',
    originalFileID: media.originalFileID || source.originalFileID || null,
    cutoutFileID: media.cutoutFileID || source.cutoutFileID || null,
    cutoutPhotoPath: '',
    cutoutContentType: media.cutoutContentType || source.cutoutContentType || null,
    cutoutProvider: media.cutoutProvider || source.cutoutProvider || null,
    cutoutOperation: media.cutoutOperation || source.cutoutOperation || null,
    cutoutRequestId: media.cutoutRequestId || source.cutoutRequestId || null,
    cutoutCheckerboardRemoved: media.cutoutCheckerboardRemoved === true
      || source.cutoutCheckerboardRemoved === true,
    levelCode: score.levelCode || source.levelCode || null,
    levelLabel: score.levelLabel || source.levelLabel || null,
    levelShortLabel: score.levelShortLabel || source.levelShortLabel || null,
    charmScore: typeof score.charmScore === 'number' ? score.charmScore : source.charmScore,
    clevernessScore: typeof score.clevernessScore === 'number' ? score.clevernessScore : source.clevernessScore,
    auraScore: typeof score.auraScore === 'number' ? score.auraScore : source.auraScore,
    rarityScore: typeof score.rarityScore === 'number' ? score.rarityScore : source.rarityScore,
    fateScore: typeof score.fateScore === 'number' ? score.fateScore : source.fateScore,
    overallScore: typeof score.overallScore === 'number' ? score.overallScore : source.overallScore,
    pawReward: typeof score.pawReward === 'number' ? score.pawReward : Number(source.pawReward) || 0,
    pointReward: typeof score.pointReward === 'number' ? score.pointReward : source.pointReward,
    scorePending: score.scorePending === true || source.scorePending === true,
    scoreSource: score.scoreSource || source.scoreSource || null,
    scoreVersion: score.scoreVersion || source.scoreVersion || null,
    scoreEvidence: score.scoreEvidence || source.scoreEvidence || null,
    scoreCoverage: score.scoreCoverage || source.scoreCoverage || null,
    detectedBreed: observation.breed || source.detectedBreed || null,
    breedConfidence: typeof observation.breedConfidence === 'number'
      ? observation.breedConfidence
      : source.breedConfidence,
    detectedTraits: Array.isArray(observation.traits)
      ? observation.traits.slice(0, 3)
      : (Array.isArray(source.detectedTraits) ? source.detectedTraits.slice(0, 3) : []),
    catCount: typeof observation.catCount === 'number' ? observation.catCount : 1,
    detectionSource: observation.source || source.detectionSource || null,
    savedPath: null,
    createdAt: source.createdAt || source.capturedAt || Date.now(),
    capturedAt: source.capturedAt || source.createdAt || new Date().toISOString(),
  };
}

function mergeRemoteRecords(remoteRecords) {
  if (!Array.isArray(remoteRecords) || !remoteRecords.length) return 0;

  const localRecords = getAllRecords();
  const byServerId = localRecords.reduce((map, record) => {
    if (record.serverEncounterId) map[record.serverEncounterId] = record;
    return map;
  }, {});
  const byLocalId = localRecords.reduce((map, record) => {
    const localId = record.clientRecordId || record.recordId;
    if (localId) map[localId] = record;
    return map;
  }, {});
  let changedCount = 0;
  const nextRecords = localRecords.slice();

  remoteRecords.forEach(remote => {
    const normalized = _normalizeRemoteRecord(remote);
    const existing = byServerId[normalized.serverEncounterId]
      || byLocalId[normalized.clientRecordId];
    if (existing) {
      const index = nextRecords.findIndex(record => record === existing);
      if (index < 0) return;
      nextRecords[index] = {
        ...existing,
        ...normalized,
        // 临时 URL 只服务于当前设备，不能被云端空值覆盖。
        photoPath: normalized.photoPath || existing.photoPath || '',
        photo: normalized.photo || existing.photo || '',
        cutoutPhotoPath: normalized.cutoutPhotoPath || existing.cutoutPhotoPath || '',
      };
      changedCount += 1;
      return;
    }

    nextRecords.push(normalized);
    changedCount += 1;
  });

  if (!changedCount) return 0;

  _set(KEY_RECORDS, nextRecords.sort((a, b) => (
    _getTimestamp(b.createdAt) - _getTimestamp(a.createdAt)
  )));
  _rebuildDerivedState(nextRecords);
  return changedCount;
}

function _rebuildDerivedState(records) {
  const collection = getCollection();
  const safeRecords = Array.isArray(records) ? records : [];

  Object.keys(collection).forEach(catId => {
    const entry = collection[catId];
    const catRecords = safeRecords
      .filter(record => record.catId === catId)
      .sort((a, b) => _getTimestamp(b.createdAt) - _getTimestamp(a.createdAt));
    const existingFeatured = entry.featuredRecordId;
    const featuredStillExists = catRecords.some(record => record.recordId === existingFeatured);
    const latest = catRecords[0];

    entry.unlocked = catRecords.length > 0;
    entry.unlockedAt = entry.unlockedAt || (latest ? _getTimestamp(latest.createdAt) || Date.now() : null);
    entry.photoCount = catRecords.length;
    entry.records = catRecords.map(record => record.recordId);
    entry.featuredRecordId = featuredStillExists
      ? existingFeatured
      : (catRecords[0] ? catRecords[0].recordId : null);
    entry.displayName = entry.displayName || (latest && latest.catName) || null;
    entry.displayDescription = entry.displayDescription || (latest && latest.catDescription) || null;
    entry.copyVersion = entry.copyVersion || (latest && latest.copyVersion) || null;
  });
  _set(KEY_COLLECTION, collection);

  const lastPhotoTime = safeRecords.reduce((latest, record) => (
    Math.max(latest, _getTimestamp(record.createdAt))
  ), 0) || null;
  const pawGrowth = safeRecords.reduce((total, record) => {
    const reward = Number(record.pawReward);
    return Number.isFinite(reward) && reward > 0 ? total + Math.round(reward) : total;
  }, 0);
  const stats = getUserStats();
  stats.totalPhotos = safeRecords.length;
  stats.unlockedCount = Object.keys(collection).filter(catId => collection[catId].unlocked).length;
  stats.lastPhotoTime = lastPhotoTime;
  stats.pawGrowth = pawGrowth;
  _set(KEY_STATS, stats);
}

function getRecordById(recordId) {
  return getAllRecords().find(record => record.recordId === recordId) || null;
}

function getRecordsForCat(catId) {
  return getAllRecords()
    .filter(record => record.catId === catId)
    .sort((a, b) => _getTimestamp(b.createdAt) - _getTimestamp(a.createdAt));
}

/**
 * 放归一只猫：从本地图鉴和相遇记录中移除它，但保留累计猫爪成长值。
 * 云端图片文件不在这里删除，避免档案操作误删远端资源。
 */
function removeCatArchive(catId) {
  const collection = getCollection();
  const entry = collection[catId];
  if (!entry) return { removedCount: 0, wasUnlocked: false };

  const records = getAllRecords();
  const removedRecords = records.filter(record => record.catId === catId);
  const remainingRecords = records.filter(record => record.catId !== catId);
  const wasUnlocked = entry.unlocked === true || removedRecords.length > 0;

  _set(KEY_RECORDS, remainingRecords);

  entry.unlocked = false;
  entry.unlockedAt = null;
  entry.photoCount = 0;
  entry.featuredRecordId = null;
  entry.displayName = null;
  entry.displayDescription = null;
  entry.copyVersion = null;
  entry.records = [];
  _set(KEY_COLLECTION, collection);

  const stats = getUserStats();
  stats.totalPhotos = Math.max(0, (stats.totalPhotos || 0) - removedRecords.length);
  stats.unlockedCount = Math.max(0, (stats.unlockedCount || 0) - (wasUnlocked ? 1 : 0));
  stats.lastPhotoTime = remainingRecords.reduce((latest, record) => {
    return Math.max(latest, _getTimestamp(record.createdAt));
  }, 0) || null;
  _set(KEY_STATS, stats);

  return { removedCount: removedRecords.length, wasUnlocked };
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
  getDeviceId,
  getShareId,
  setShareId,
  getOrCreateShareId,
  getCollection,
  saveRecord,
  getAllRecords,
  getRecordById,
  getRecordsForCat,
  getRecordDisplayPath,
  getUserStats,
  setFeaturedRecord,
  removeCatArchive,
  getUnlockedMap,
  getSyncState,
  setSyncState,
  getSyncSummary,
  getPendingRecords,
  markRecordsSynced,
  markPendingSyncError,
  prepareRecordsForAccountRebind,
  mergeRemoteRecords,
};
