// ============================================================
// 猫咪咔咔 - 本地存储封装
// ============================================================
const { ALL_CATS } = require('./catData');
const { MEMBER_LEVEL_VERSION } = require('./memberLevel');
const archiveIds = require('./archiveCode');
const posterResultSchema = require('./posterResult');

const KEY_COLLECTION = 'maomikaka_collection';
const KEY_RECORDS = 'maomikaka_records';
const KEY_STATS = 'maomikaka_stats';
const KEY_SYNC_STATE = 'maomikaka_sync_state';
const KEY_DEVICE_ID = 'maomikaka_device_id';
const KEY_GUEST_TOKEN = 'maomikaka_guest_token';
const KEY_SHARE_IDS = 'maomikaka_share_ids';
const KEY_USER_PROFILE = 'maomikaka_user_profile';
const KEY_PENDING_CAPTURE = 'maomikaka_pending_capture';
const KEY_LOCATION_CONSENT = 'maomikaka_location_consent';
const SYNC_SCHEMA_VERSION = 1;
const DAILY_CAN_LIMIT = 3;
const LOCATION_STATUSES = ['captured', 'skipped', 'denied', 'unavailable'];
const LOCATION_CONSENTS = ['skipped'];
const SOURCE_TYPES = ['live', 'photo'];
const COVER_STATUSES = ['ready', 'rejected', 'pending'];
const VISIBILITIES = ['public', 'private'];
const COVER_TARGET_RATIO = '359:537';
const PLACEHOLDER_NICKNAMES = new Set(['微信用户']);

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

function _normalizeUserProfile(value) {
  const source = value && typeof value === 'object' ? value : {};
  const avatarUrl = String(source.avatarUrl || '').trim().slice(0, 1024);
  const avatarFileID = String(source.avatarFileID || '').trim().slice(0, 512);
  const nickName = String(source.nickName || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const normalizedNickName = PLACEHOLDER_NICKNAMES.has(nickName.toLowerCase())
    ? ''
    : Array.from(nickName).slice(0, 40).join('');
  return { avatarUrl, avatarFileID, nickName: normalizedNickName };
}

function _normalizePosterCopy(value) {
  return Array.from(String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim())
    .slice(0, 52)
    .join('');
}

function getUserProfile() {
  return _normalizeUserProfile(_get(KEY_USER_PROFILE));
}

function setUserProfile(value, options = {}) {
  const current = getUserProfile();
  const next = _normalizeUserProfile(value);
  const replaceAvatar = options && options.replaceAvatar === true;
  const profile = {
    avatarUrl: next.avatarUrl || current.avatarUrl,
    avatarFileID: replaceAvatar ? next.avatarFileID : (next.avatarFileID || current.avatarFileID),
    nickName: next.nickName || current.nickName,
  };
  _set(KEY_USER_PROFILE, profile);
  return profile;
}

function clearUserProfile() {
  _set(KEY_USER_PROFILE, _normalizeUserProfile(null));
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

function _normalizeLocation(value, fallbackCapturedAt) {
  const source = value && typeof value === 'object' ? value : {};
  const latitude = Number(source.latitude);
  const longitude = Number(source.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;

  const capturedAtTimestamp = _getTimestamp(source.capturedAt || fallbackCapturedAt);
  const locationText = String(source.locationText || source.label || source.name || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 40);
  return {
    source: String(source.source || 'wx.getFuzzyLocation').trim().slice(0, 80),
    coordinateSystem: source.coordinateSystem === 'gcj02' ? 'gcj02' : 'wgs84',
    latitude: Number(latitude.toFixed(3)),
    longitude: Number(longitude.toFixed(3)),
    locationText: locationText || null,
    capturedAt: capturedAtTimestamp ? new Date(capturedAtTimestamp).toISOString() : null,
  };
}

function _normalizeLocationStatus(value, location) {
  const status = String(value || '').trim();
  if (status === 'captured' && !location) return 'unavailable';
  if (LOCATION_STATUSES.includes(status)) return status;
  return location ? 'captured' : 'unavailable';
}

function _normalizeSourceType(value, fallback = 'photo') {
  const sourceType = String(value || '').trim().toLowerCase();
  if (SOURCE_TYPES.includes(sourceType)) return sourceType;
  return SOURCE_TYPES.includes(fallback) ? fallback : 'photo';
}

function _normalizeVisibility(value) {
  const visibility = String(value || '').trim().toLowerCase();
  return VISIBILITIES.includes(visibility) ? visibility : 'public';
}

function _normalizeCoverStatus(value, fileID) {
  const status = String(value || '').trim();
  if (status === 'ready' && fileID) return 'ready';
  if (COVER_STATUSES.includes(status)) return status;
  return fileID ? 'ready' : null;
}

function _normalizeCoverTargetRatio(value) {
  const targetRatio = String(value || '').trim();
  return targetRatio === COVER_TARGET_RATIO ? targetRatio : COVER_TARGET_RATIO;
}

function getDeviceId() {
  const current = _get(KEY_DEVICE_ID);
  if (typeof current === 'string' && current.trim()) return current;

  const deviceId = _createLocalId('device');
  _set(KEY_DEVICE_ID, deviceId);
  return deviceId;
}

// 未绑定账号时用于认领匿名云端临时记录的本机凭证。
// 只保存在本机，服务端只保存它的哈希值；不要把它当成用户身份凭证。
function getGuestToken() {
  const current = _get(KEY_GUEST_TOKEN);
  if (typeof current === 'string' && current.trim().length >= 32) return current.trim();

  const parts = Array.from({ length: 8 }, () => Math.random().toString(36).slice(2));
  const token = `guest_${Date.now().toString(36)}_${parts.join('')}`.slice(0, 192);
  _set(KEY_GUEST_TOKEN, token);
  return token;
}

function createPendingCaptureId() {
  return _createLocalId('capture');
}

function savePendingCapture(context = {}) {
  const source = context && typeof context === 'object' ? context : {};
  const captureId = String(source.captureId || createPendingCaptureId()).trim().slice(0, 128);
  const capturedAt = _getTimestamp(source.capturedAt) || Date.now();
  const location = _normalizeLocation(source.location, capturedAt);
  const pending = {
    captureId,
    photoPath: String(source.photoPath || '').trim().slice(0, 2048),
    sourceType: _normalizeSourceType(
      source.sourceType || source.captureSource || source.inputSource,
    ),
    capturedAt,
    location,
    locationStatus: _normalizeLocationStatus(source.locationStatus, location),
  };
  _set(KEY_PENDING_CAPTURE, pending);
  return pending;
}

function getPendingCapture(captureId) {
  const pending = _get(KEY_PENDING_CAPTURE);
  if (!pending || typeof pending !== 'object') return null;
  if (!captureId || String(pending.captureId) !== String(captureId)) return null;
  return pending;
}

function clearPendingCapture(captureId) {
  const pending = _get(KEY_PENDING_CAPTURE);
  if (!pending || !captureId || String(pending.captureId) === String(captureId)) {
    _set(KEY_PENDING_CAPTURE, null);
  }
}

function getLocationConsent() {
  const consent = String(_get(KEY_LOCATION_CONSENT) || '').trim();
  return LOCATION_CONSENTS.includes(consent) ? consent : '';
}

function setLocationConsent(consent) {
  const normalized = String(consent || '').trim();
  if (!LOCATION_CONSENTS.includes(normalized)) {
    _set(KEY_LOCATION_CONSENT, null);
    return '';
  }
  _set(KEY_LOCATION_CONSENT, normalized);
  return normalized;
}

function clearLocationConsent() {
  _set(KEY_LOCATION_CONSENT, null);
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

function clearShareIds() {
  const shareIds = _getShareIdMap();
  const scopePrefix = `${_getShareScope()}:`;
  let clearedCount = 0;

  Object.keys(shareIds).forEach((key) => {
    if (!key.startsWith(scopePrefix)) return;
    delete shareIds[key];
    clearedCount += 1;
  });

  if (clearedCount > 0) _set(KEY_SHARE_IDS, shareIds);
  return clearedCount;
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
    privacyPolicyVersion: null,
    photoConsentAt: null,
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
    // 咔咔分是可独立核对的余额，变动明细由云端奖励流水保存。
    pointBalance: 0,
    // 已购买且尚未使用的罐罐；每日赠送额度由页面按自然日单独计算。
    purchasedCanBalance: 0,
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

function _calculateRecordedPointBalance() {
  const records = _get(KEY_RECORDS);
  if (!Array.isArray(records)) return 0;

  return records.reduce((total, record) => {
    const reward = Number(record && record.pointReward);
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
      posterCopy: null,
      copyVersion: null,
      visibility: 'public',
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
        posterCopy: null,
        copyVersion: null,
        visibility: 'public',
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
    if (entry.posterCopy === undefined) {
      entry.posterCopy = null;
      changed = true;
    }
    if (entry.copyVersion === undefined) {
      entry.copyVersion = null;
      changed = true;
    }
    if (!VISIBILITIES.includes(entry.visibility)) {
      entry.visibility = 'public';
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

function getCatVisibility(catId) {
  const collection = getCollection();
  const entry = collection[catId];
  return _normalizeVisibility(entry && entry.visibility);
}

function setCatVisibility(catId, value) {
  const collection = getCollection();
  const entry = collection[catId];
  if (!entry) return null;

  const visibility = _normalizeVisibility(value);
  entry.visibility = visibility;
  _set(KEY_COLLECTION, collection);
  return visibility;
}

/**
 * 获取记录的原始拍摄图。
 * 原图是重新处理和主体图缺失时的事实来源，与主体生图、海报分开保存。
 */
function getRecordOriginalPath(record) {
  if (!record) return '';
  return record.originalPhotoPath
    || record.originalPhoto
    || record.photo
    || record.photoPath
    || record.originalTempURL
    || '';
}

/**
 * 获取记录的猫咪主体图。
 * 主体图是猫卡和档案详情的首选主图；它和海报封面、带排版的海报不是同一张媒体。
 */
function getRecordSubjectPath(record) {
  if (!record) return '';
  return record.cutoutPhotoPath
    || record.cutoutPhoto
    || record.cutoutTempURL
    || '';
}

/**
 * 获取记录的透明主体云文件 ID。
 * 旧海报快照可能只在 sourceImage.cutoutFileID 保存主体 ID，也要兼容读取。
 */
function getRecordSubjectFileID(record) {
  if (!record) return '';
  const posterResult = record.posterResult && typeof record.posterResult === 'object'
    ? record.posterResult
    : {};
  const sourceImage = posterResult.sourceImage && typeof posterResult.sourceImage === 'object'
    ? posterResult.sourceImage
    : {};
  return record.cutoutFileID
    || posterResult.cutoutFileID
    || sourceImage.cutoutFileID
    || '';
}

/**
 * 获取海报里的生成主视觉原图。
 * 这是 cover 生成图，不是带文字排版的 posterImage，也不是用户拍摄原图。
 */
function getRecordPosterSourcePath(record) {
  if (!record) return '';
  const posterResult = record.posterResult && typeof record.posterResult === 'object'
    ? record.posterResult
    : {};
  const coverImage = posterResult.coverImage && typeof posterResult.coverImage === 'object'
    ? posterResult.coverImage
    : {};
  const sourceImage = posterResult.sourceImage && typeof posterResult.sourceImage === 'object'
    ? posterResult.sourceImage
    : {};
  return record.coverPhotoPath
    || record.coverTempURL
    || coverImage.path
    || (sourceImage.kind === 'cover' ? sourceImage.path : '')
    || '';
}

function getRecordPosterSourceFileID(record) {
  if (!record) return '';
  const posterResult = record.posterResult && typeof record.posterResult === 'object'
    ? record.posterResult
    : {};
  const coverImage = posterResult.coverImage && typeof posterResult.coverImage === 'object'
    ? posterResult.coverImage
    : {};
  const sourceImage = posterResult.sourceImage && typeof posterResult.sourceImage === 'object'
    ? posterResult.sourceImage
    : {};
  return record.coverFileID
    || coverImage.fileID
    || (sourceImage.kind === 'cover' ? sourceImage.fileID : '')
    || '';
}

/**
 * 获取记录在界面上的展示图。
 * 列表和档案主图优先展示透明主体，其次是用户原图；cover 只作为旧记录没有主体时的兼容回退。
 * 海报封面和最终海报始终由 posterData/posterShare 单独使用。
 */
function getRecordDisplayPath(record) {
  if (!record) return '';
  return getRecordSubjectPath(record)
    || getRecordOriginalPath(record)
    || getRecordPosterSourcePath(record);
}

function _getLocalDateKey(value) {
  const timestamp = _getTimestamp(value) || Date.now();
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * 罐罐额度统一口径：每日赠送和购买余额分开计算，页面只读取这里的结果。
 * 每日赠送按本地自然日重置，购买余额不随日期变化。
 */
function getCanQuota(referenceTime = Date.now()) {
  const records = getAllRecords();
  const todayKey = _getLocalDateKey(referenceTime);
  const todayCount = records.filter(record => _getLocalDateKey(record.createdAt) === todayKey).length;
  const stats = getUserStats();
  const purchasedCanBalance = Math.max(0, Math.floor(Number(stats.purchasedCanBalance) || 0));
  const dailyRemainingCans = Math.max(0, DAILY_CAN_LIMIT - todayCount);

  return {
    dailyCanLimit: DAILY_CAN_LIMIT,
    todayCount,
    dailyRemainingCans,
    purchasedCanBalance,
    remainingCans: dailyRemainingCans + purchasedCanBalance,
  };
}

function _createCanQuotaError() {
  const error = new Error('罐罐额度已用完');
  error.code = 'CAN_QUOTA_EXHAUSTED';
  return error;
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
  const originalPhotoPath = data.originalPhotoPath
    || data.originalPhoto
    || data.photoPath
    || data.photo
    || '';
  // photoPath/photo 是历史字段，继续保存为原图，避免旧页面把海报当成主图。
  const photoPath = originalPhotoPath;
  const catName = data.catName
    || data.generatedName
    || (data.catData && data.catData.name)
    || null;
  const catDescription = data.catDescription
    || data.generatedDescription
    || (data.catData && (data.catData.story || data.catData.description))
    || null;
  const posterCopy = _normalizePosterCopy(data.posterCopy);
  const location = _normalizeLocation(data.location, data.capturedAt || data.createdAt || now);
  const pawReward = Number.isFinite(Number(data.pawReward))
    ? Math.max(0, Math.round(Number(data.pawReward)))
    : 0;
  const pointReward = Number.isFinite(Number(data.pointReward))
    ? Math.max(0, Math.round(Number(data.pointReward)))
    : 0;
  const capturedAtTimestamp = _getTimestamp(data.capturedAt || data.createdAt || now) || now;
  const records = getAllRecords();
  const collection = getCollection();
  const stats = getUserStats();

  if (!catId || !collection[catId]) {
    throw new Error('[Storage] invalid catId');
  }

  // 先用当天赠送额度；当天赠送已经用完时，才从购买余额扣除 1 个。
  // 扣减发生在记录写入前的同一同步流程里，避免保存成功但库存没有变化。
  const recordDateKey = _getLocalDateKey(data.createdAt || now);
  const todayCountBeforeSave = records.filter(record => (
    _getLocalDateKey(record.createdAt) === recordDateKey
  )).length;
  const dailyRemainingBeforeSave = Math.max(0, DAILY_CAN_LIMIT - todayCountBeforeSave);
  let canUsageSource = 'daily-gift';
  if (dailyRemainingBeforeSave <= 0) {
    const purchasedCanBalance = Math.max(0, Math.floor(Number(stats.purchasedCanBalance) || 0));
    if (purchasedCanBalance <= 0) throw _createCanQuotaError();
    stats.purchasedCanBalance = purchasedCanBalance - 1;
    canUsageSource = 'purchased';
  }

  const existingRecord = records.find(record => (
    record
    && (record.recordId === localRecordId || record.clientRecordId === localRecordId)
  ));
  const archiveCode = archiveIds.normalizeArchiveCode(data.archiveCode)
    || archiveIds.normalizeArchiveCode(existingRecord && existingRecord.archiveCode)
    || archiveIds.getOrCreateArchiveCode(
      `record:${catId}:${localRecordId}`,
      new Date(capturedAtTimestamp),
    );

  const record = {
    recordId: localRecordId,
    clientRecordId: localRecordId,
    syncState: 'pending',
    syncedAt: null,
    syncError: null,
    serverEncounterId: null,
    captureId: data.captureId || null,
    sourceType: _normalizeSourceType(
      data.sourceType || data.captureSource || data.inputSource,
    ),
    catProfileId: data.catProfileId || null,
    catId,
    archiveCode,
    catName,
    catDescription,
    posterCopy: posterCopy || null,
    copyVersion: data.copyVersion || null,
    photoPath,
    // 保留 photo 字段，方便旧页面或历史数据读取。
    photo: photoPath,
    originalPhotoPath,
    originalFileID: data.originalFileID || null,
    originalContentType: data.originalContentType || null,
    cutoutFileID: data.cutoutFileID || null,
    cutoutPhotoPath: data.cutoutPhotoPath || data.cutoutPhoto || '',
    cutoutContentType: data.cutoutContentType || null,
    cutoutProvider: data.cutoutProvider || null,
    cutoutOperation: data.cutoutOperation || null,
    cutoutRequestId: data.cutoutRequestId || null,
    cutoutCheckerboardRemoved: data.cutoutCheckerboardRemoved === true,
    // 封面图是独立的 poster-cover 产物，不能覆盖原图或主体图字段。
    coverFileID: data.coverFileID || null,
    coverPhotoPath: data.coverPhotoPath || data.coverPhoto || '',
    coverContentType: data.coverContentType || null,
    coverProvider: data.coverProvider || null,
    coverModel: data.coverModel || null,
    coverOperation: data.coverOperation || null,
    coverPromptVersion: data.coverPromptVersion || null,
    coverTargetRatio: _normalizeCoverTargetRatio(data.coverTargetRatio),
    coverStatus: _normalizeCoverStatus(data.coverStatus, data.coverFileID),
    coverRequestId: data.coverRequestId || null,
    coverCreatedAt: data.coverCreatedAt || null,
    coverRejectReason: data.coverRejectReason || null,
    posterResult: posterResultSchema.normalizePosterResult(data.posterResult),
    // 相遇等级由三项相遇分计算，和猫卡条目的静态分类字段分开保存。
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
    pointReward: pointReward || null,
    canUsageSource,
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
    location,
    locationStatus: _normalizeLocationStatus(data.locationStatus, location),
    createdAt: data.createdAt || now,
    capturedAt: new Date(capturedAtTimestamp).toISOString(),
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
  entry.posterCopy = entry.posterCopy || record.posterCopy;
  entry.copyVersion = entry.copyVersion || record.copyVersion;
  _set(KEY_COLLECTION, collection);

  stats.totalPhotos = (stats.totalPhotos || 0) + 1;
  stats.unlockedCount = (stats.unlockedCount || 0) + (isNew ? 1 : 0);
  stats.lastPhotoTime = now;
  stats.pawGrowth = (stats.pawGrowth || 0) + pawReward;
  stats.pointBalance = (stats.pointBalance || 0) + pointReward;
  _set(KEY_STATS, stats);

  return {
    record,
    recordId: record.recordId,
    isNew,
    canUsageSource,
  };
}

/**
 * 写入一条记录已经通过验收的封面图元数据。
 * 该更新只改变 poster-cover 字段，永远不覆盖原图和主体图。
 */
function updateRecordCover(recordId, cover = {}) {
  const normalizedRecordId = String(recordId || '').trim();
  if (!normalizedRecordId) return null;

  const records = getAllRecords();
  const index = records.findIndex(record => (
    record
    && (record.recordId === normalizedRecordId || record.clientRecordId === normalizedRecordId)
  ));
  if (index < 0) return null;

  const existing = records[index];
  const patch = cover && typeof cover === 'object' ? cover : {};
  const fileID = String(patch.fileID || patch.coverFileID || '').trim();
  const status = _normalizeCoverStatus(patch.status || patch.coverStatus, fileID);

  // 旧封面已经可用时，新的失败结果不能把它降级成空图。
  if (status === 'rejected' && existing.coverStatus === 'ready' && existing.coverFileID) {
    return existing;
  }
  if (status === 'ready' && !fileID) return existing;

  const next = {
    ...existing,
    coverFileID: status === 'ready' ? fileID : null,
    coverPhotoPath: status === 'ready'
      ? String(patch.path || patch.coverPhotoPath || '').trim().slice(0, 2048)
      : '',
    coverContentType: status === 'ready'
      ? String(patch.contentType || patch.coverContentType || '').trim().slice(0, 64) || null
      : null,
    coverProvider: status === 'ready'
      ? String(patch.provider || patch.coverProvider || '').trim().slice(0, 80) || null
      : null,
    coverModel: status === 'ready'
      ? String(patch.model || patch.coverModel || '').trim().slice(0, 160) || null
      : null,
    coverOperation: status === 'ready'
      ? String(patch.operation || patch.coverOperation || 'image-to-image-poster-cover')
        .trim().slice(0, 120) || null
      : null,
    coverPromptVersion: status === 'ready'
      ? String(patch.promptVersion || patch.coverPromptVersion || '').trim().slice(0, 120) || null
      : null,
    coverTargetRatio: _normalizeCoverTargetRatio(
      patch.targetRatio || patch.coverTargetRatio || COVER_TARGET_RATIO,
    ),
    coverStatus: status,
    coverRequestId: status === 'ready'
      ? String(patch.requestId || patch.coverRequestId || '').trim().slice(0, 160) || null
      : null,
    coverCreatedAt: status === 'ready'
      ? String(patch.createdAt || patch.coverCreatedAt || new Date().toISOString()).trim().slice(0, 80)
      : null,
    coverRejectReason: status === 'rejected'
      ? String(patch.rejectReason || patch.coverRejectReason || 'COVER_GENERATION_FAILED')
        .replace(/\s+/g, ' ').trim().slice(0, 240)
      : null,
  };
  const coverFields = [
    'coverFileID',
    'coverPhotoPath',
    'coverContentType',
    'coverProvider',
    'coverModel',
    'coverOperation',
    'coverPromptVersion',
    'coverTargetRatio',
    'coverStatus',
    'coverRequestId',
    'coverCreatedAt',
    'coverRejectReason',
  ];
  const changed = coverFields.some(field => next[field] !== existing[field]);
  if (changed && existing.syncState === 'synced') {
    next.syncState = 'pending';
    next.syncedAt = null;
    next.syncError = null;
  }
  records[index] = next;
  _set(KEY_RECORDS, records);
  return next;
}

/**
 * 写入一条记录补回的正式评分。
 * 补评分只更新评分字段，并保留原有奖励，避免重复增加猫爪或咔咔分。
 * 同时把记录标记为待同步，让已有云端 encounter 走幂等更新而不是重复创建。
 */
function updateRecordScore(recordId, score = {}) {
  const normalizedRecordId = String(recordId || '').trim();
  if (!normalizedRecordId || !score || typeof score !== 'object') return null;

  const scoreValues = ['charmScore', 'clevernessScore', 'auraScore', 'overallScore'];
  if (score.scorePending === true || scoreValues.some(key => (
    !Number.isFinite(Number(score[key]))
  ))) return null;

  const records = getAllRecords();
  const index = records.findIndex(record => (
    record
    && (record.recordId === normalizedRecordId || record.clientRecordId === normalizedRecordId)
  ));
  if (index < 0) return null;

  const existing = records[index];
  const next = {
    ...existing,
    levelCode: score.levelCode || existing.levelCode || null,
    levelLabel: score.levelLabel || existing.levelLabel || null,
    levelShortLabel: score.levelShortLabel || existing.levelShortLabel || null,
    charmScore: Number(score.charmScore),
    clevernessScore: Number(score.clevernessScore),
    auraScore: Number(score.auraScore),
    overallScore: Number(score.overallScore),
    scorePending: false,
    scoreSource: score.scoreSource || 'evidence',
    scoreVersion: score.scoreVersion || null,
    scoreEvidence: score.scoreEvidence && typeof score.scoreEvidence === 'object'
      ? score.scoreEvidence
      : existing.scoreEvidence || null,
    scoreCoverage: score.scoreCoverage && typeof score.scoreCoverage === 'object'
      ? score.scoreCoverage
      : existing.scoreCoverage || null,
    // 补评分不是一次新的相遇，不重新计算或累加既有奖励。
    pawReward: existing.pawReward,
    pointReward: existing.pointReward,
    syncState: 'pending',
    syncedAt: null,
    syncError: null,
  };
  records[index] = next;
  _set(KEY_RECORDS, records);
  return next;
}

/**
 * 保存一条记录对应的海报排版快照。
 * 这是派生数据，不覆盖原图、主体图、评分或猫咪档案字段。
 */
function updateRecordPosterResult(recordId, result) {
  const normalizedRecordId = String(recordId || '').trim();
  const normalizedResult = posterResultSchema.normalizePosterResult(result);
  if (!normalizedRecordId || !normalizedResult) return null;

  const records = getAllRecords();
  const index = records.findIndex(record => (
    record
    && (record.recordId === normalizedRecordId || record.clientRecordId === normalizedRecordId)
  ));
  if (index < 0) return null;

  const existing = records[index];
  const unchanged = JSON.stringify(existing.posterResult || null)
    === JSON.stringify(normalizedResult);
  if (unchanged) return existing;

  const next = {
    ...existing,
    posterResult: normalizedResult,
  };
  // 海报是 encounters.media 的派生字段；账号记录已同步后再产生/更新海报，
  // 必须重新进入待同步队列，避免只保存在本机而数据库仍为空或是旧快照。
  if (existing.syncState === 'synced') {
    next.syncState = 'pending';
    next.syncedAt = null;
    next.syncError = null;
  }
  records[index] = next;
  _set(KEY_RECORDS, records);
  return next;
}

/**
 * 清理历史海报封面元数据，保留原图、主体图、档案、评分和奖励数据。
 * 返回待从云存储删除的旧封面 fileID，由海报缓存模块负责执行删除。
 */
function clearAllRecordCovers() {
  const records = getAllRecords();
  const fileIDs = [];
  const seen = new Set();
  let clearedCount = 0;
  const nextRecords = records.map(record => {
    if (!record || (
      !record.coverFileID
      && !record.coverPhotoPath
      && !record.coverStatus
      && !record.posterResult
    )) {
      return record;
    }

    const fileID = String(record.coverFileID || '').trim();
    if (fileID && !seen.has(fileID)) {
      seen.add(fileID);
      fileIDs.push(fileID);
    }
    const posterCoverFileID = record.posterResult
      && record.posterResult.coverImage
      && record.posterResult.coverImage.fileID
      ? String(record.posterResult.coverImage.fileID).trim()
      : '';
    if (posterCoverFileID && !seen.has(posterCoverFileID)) {
      seen.add(posterCoverFileID);
      fileIDs.push(posterCoverFileID);
    }
    const posterSourceFileID = record.posterResult
      && record.posterResult.sourceImage
      && record.posterResult.sourceImage.kind === 'cover'
      && record.posterResult.sourceImage.fileID
      ? String(record.posterResult.sourceImage.fileID).trim()
      : '';
    if (posterSourceFileID && !seen.has(posterSourceFileID)) {
      seen.add(posterSourceFileID);
      fileIDs.push(posterSourceFileID);
    }
    const posterFileID = record.posterResult && record.posterResult.posterImage
      && record.posterResult.posterImage.fileID;
    if (posterFileID && !seen.has(posterFileID)) {
      seen.add(posterFileID);
      fileIDs.push(posterFileID);
    }
    clearedCount += 1;
    return {
      ...record,
      coverFileID: null,
      coverPhotoPath: '',
      coverContentType: null,
      coverProvider: null,
      coverModel: null,
      coverOperation: null,
      coverPromptVersion: null,
      coverTargetRatio: COVER_TARGET_RATIO,
      coverStatus: null,
      coverRequestId: null,
      coverCreatedAt: null,
      coverRejectReason: null,
      posterResult: null,
      // 让已有账号记录有机会随下一次同步提交清理后的媒体字段。
      syncState: record.syncState === 'synced' ? 'pending' : record.syncState,
      syncedAt: record.syncState === 'synced' ? null : record.syncedAt,
      syncError: null,
    };
  });

  if (clearedCount) _set(KEY_RECORDS, nextRecords);
  return { clearedCount, fileIDs };
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
  if (state.privacyPolicyVersion === undefined) {
    state.privacyPolicyVersion = null;
    changed = true;
  }
  if (state.photoConsentAt === undefined) {
    state.photoConsentAt = null;
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
  const catId = source.catalogCatId || 'cat_060';
  const location = _normalizeLocation(source.location, source.capturedAt || source.createdAt);
  const archiveCode = archiveIds.normalizeArchiveCode(source.archiveCode)
    || archiveIds.getOrCreateArchiveCode(
      `record:${catId}:${recordId}`,
      new Date(source.createdAt || source.capturedAt || Date.now()),
    );

  return {
    recordId,
    clientRecordId: source.localRecordId || null,
    syncState: 'synced',
    syncedAt: Date.now(),
    syncError: null,
    serverEncounterId: source.encounterId || null,
    captureId: source.captureId || null,
    sourceType: _normalizeSourceType(
      source.sourceType || source.captureSource || source.inputSource,
    ),
    catProfileId: source.catProfileId || null,
    catId,
    archiveCode,
    canUsageSource: source.canUsageSource === 'purchased' ? 'purchased' : 'daily-gift',
    catName: display.name || source.catName || null,
    catDescription: display.description || source.catDescription || null,
    posterCopy: _normalizePosterCopy(display.posterCopy || source.posterCopy),
    copyVersion: display.copyVersion || source.copyVersion || null,
    photoPath: media.originalTempURL || source.originalTempURL || '',
    photo: media.originalTempURL || source.originalTempURL || '',
    originalPhotoPath: media.originalTempURL || source.originalTempURL || '',
    originalFileID: media.originalFileID || source.originalFileID || null,
    originalContentType: media.originalContentType || source.originalContentType || null,
    cutoutFileID: media.cutoutFileID || source.cutoutFileID || null,
    cutoutPhotoPath: '',
    cutoutContentType: media.cutoutContentType || source.cutoutContentType || null,
    cutoutProvider: media.cutoutProvider || source.cutoutProvider || null,
    cutoutOperation: media.cutoutOperation || source.cutoutOperation || null,
    cutoutRequestId: media.cutoutRequestId || source.cutoutRequestId || null,
    cutoutCheckerboardRemoved: media.cutoutCheckerboardRemoved === true
      || source.cutoutCheckerboardRemoved === true,
    coverFileID: media.coverFileID || source.coverFileID || null,
    coverPhotoPath: media.coverTempURL || source.coverTempURL || '',
    coverContentType: media.coverContentType || source.coverContentType || null,
    coverProvider: media.coverProvider || source.coverProvider || null,
    coverModel: media.coverModel || source.coverModel || null,
    coverOperation: media.coverOperation || source.coverOperation || null,
    coverPromptVersion: media.coverPromptVersion || source.coverPromptVersion || null,
    coverTargetRatio: _normalizeCoverTargetRatio(
      media.coverTargetRatio || source.coverTargetRatio,
    ),
    coverStatus: _normalizeCoverStatus(
      media.coverStatus || source.coverStatus,
      media.coverFileID || source.coverFileID,
    ),
    coverRequestId: media.coverRequestId || source.coverRequestId || null,
    coverCreatedAt: media.coverCreatedAt || source.coverCreatedAt || null,
    coverRejectReason: media.coverRejectReason || source.coverRejectReason || null,
    posterResult: posterResultSchema.normalizePosterResult(
      media.posterResult || source.posterResult,
    ),
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
    location,
    locationStatus: _normalizeLocationStatus(source.locationStatus, location),
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
        originalPhotoPath: normalized.originalPhotoPath || existing.originalPhotoPath
          || existing.photoPath || existing.photo || '',
        originalFileID: normalized.originalFileID || existing.originalFileID || null,
        cutoutPhotoPath: normalized.cutoutPhotoPath || existing.cutoutPhotoPath || '',
        cutoutFileID: normalized.cutoutFileID || existing.cutoutFileID || null,
        cutoutContentType: normalized.cutoutContentType || existing.cutoutContentType || null,
        cutoutProvider: normalized.cutoutProvider || existing.cutoutProvider || null,
        cutoutOperation: normalized.cutoutOperation || existing.cutoutOperation || null,
        cutoutRequestId: normalized.cutoutRequestId || existing.cutoutRequestId || null,
        cutoutCheckerboardRemoved: normalized.cutoutCheckerboardRemoved
          || existing.cutoutCheckerboardRemoved === true,
        coverFileID: normalized.coverFileID || existing.coverFileID || null,
        coverPhotoPath: normalized.coverPhotoPath || existing.coverPhotoPath || '',
        coverContentType: normalized.coverContentType || existing.coverContentType || null,
        coverProvider: normalized.coverProvider || existing.coverProvider || null,
        coverModel: normalized.coverModel || existing.coverModel || null,
        coverOperation: normalized.coverOperation || existing.coverOperation || null,
        coverPromptVersion: normalized.coverPromptVersion || existing.coverPromptVersion || null,
        coverTargetRatio: normalized.coverTargetRatio || existing.coverTargetRatio || COVER_TARGET_RATIO,
        coverStatus: normalized.coverStatus || existing.coverStatus || null,
        coverRequestId: normalized.coverRequestId || existing.coverRequestId || null,
        coverCreatedAt: normalized.coverCreatedAt || existing.coverCreatedAt || null,
        coverRejectReason: normalized.coverRejectReason || existing.coverRejectReason || null,
        posterResult: normalized.posterResult || existing.posterResult || null,
        originalContentType: normalized.originalContentType
          || existing.originalContentType
          || null,
        posterCopy: normalized.posterCopy || existing.posterCopy || null,
        archiveCode: existing.archiveCode || normalized.archiveCode,
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

function mergeRemoteProfiles(remoteProfiles) {
  if (!Array.isArray(remoteProfiles) || !remoteProfiles.length) return 0;

  const collection = getCollection();
  let changedCount = 0;
  remoteProfiles.forEach(profile => {
    const catId = String(profile && (profile.catalogCatId || profile.catId) || '').trim();
    if (!catId || !collection[catId]) return;
    const visibility = _normalizeVisibility(profile.visibility);
    if (collection[catId].visibility === visibility) return;
    collection[catId].visibility = visibility;
    changedCount += 1;
  });

  if (changedCount) _set(KEY_COLLECTION, collection);
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
    entry.posterCopy = entry.posterCopy || (latest && latest.posterCopy) || null;
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
  const pointBalance = safeRecords.reduce((total, record) => {
    const reward = Number(record.pointReward);
    return Number.isFinite(reward) && reward > 0 ? total + Math.round(reward) : total;
  }, 0);
  const stats = getUserStats();
  stats.totalPhotos = safeRecords.length;
  stats.unlockedCount = Object.keys(collection).filter(catId => collection[catId].unlocked).length;
  stats.lastPhotoTime = lastPhotoTime;
  // 猫爪成长值和咔咔分是累计值；放归猫咪或刷新远端快照时不能因展示记录减少而倒退。
  stats.pawGrowth = Math.max(Number(stats.pawGrowth) || 0, pawGrowth);
  stats.pointBalance = Math.max(Number(stats.pointBalance) || 0, pointBalance);
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
 * 放归一只猫：从本地猫卡和相遇记录中移除它，但保留累计猫爪成长值。
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
  entry.posterCopy = null;
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
  if (!Number.isFinite(Number(stats.pointBalance))) {
    stats.pointBalance = _calculateRecordedPointBalance();
    changed = true;
  } else {
    const normalizedPoints = Math.max(0, Math.floor(Number(stats.pointBalance)));
    if (normalizedPoints !== stats.pointBalance) {
      stats.pointBalance = normalizedPoints;
      changed = true;
    }
  }
  if (!Number.isFinite(Number(stats.purchasedCanBalance))) {
    stats.purchasedCanBalance = 0;
    changed = true;
  } else {
    const normalizedPurchasedCans = Math.max(0, Math.floor(Number(stats.purchasedCanBalance)));
    if (normalizedPurchasedCans !== stats.purchasedCanBalance) {
      stats.purchasedCanBalance = normalizedPurchasedCans;
      changed = true;
    }
  }

  if (changed) _set(KEY_STATS, stats);
  return stats;
}

function mergeRemoteStats(remoteStats) {
  const source = remoteStats && typeof remoteStats === 'object' ? remoteStats : null;
  if (!source) return getUserStats();

  const stats = getUserStats();
  const totalPhotos = Number(source.totalPhotos);
  const unlockedCount = Number(source.unlockedCount);
  const pawGrowth = Number(source.pawGrowth);
  const pointBalance = Number(source.pointBalance);

  if (Number.isFinite(totalPhotos)) stats.totalPhotos = Math.max(0, Math.floor(totalPhotos));
  if (Number.isFinite(unlockedCount)) stats.unlockedCount = Math.max(0, Math.floor(unlockedCount));
  if (source.lastPhotoTime) stats.lastPhotoTime = source.lastPhotoTime;
  if (Number.isFinite(pawGrowth)) {
    stats.pawGrowth = Math.max(stats.pawGrowth || 0, Math.floor(pawGrowth));
  }
  if (Number.isFinite(pointBalance)) {
    stats.pointBalance = Math.max(stats.pointBalance || 0, Math.floor(pointBalance));
  }
  const purchasedCanBalance = Number(source.purchasedCanBalance);
  if (Number.isFinite(purchasedCanBalance)) {
    // 购买余额是可消耗库存，远端数值可以比本地更小，不能使用奖励余额的 max 合并规则。
    stats.purchasedCanBalance = Math.max(0, Math.floor(purchasedCanBalance));
  }
  _set(KEY_STATS, stats);
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
      posterCopy: entry.posterCopy || (latest && latest.posterCopy) || null,
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
  getGuestToken,
  getUserProfile,
  setUserProfile,
  clearUserProfile,
  createPendingCaptureId,
  savePendingCapture,
  getPendingCapture,
  clearPendingCapture,
  normalizeSourceType: _normalizeSourceType,
  getLocationConsent,
  setLocationConsent,
  clearLocationConsent,
  normalizeVisibility: _normalizeVisibility,
  getShareId,
  setShareId,
  getOrCreateShareId,
  clearShareIds,
  getCollection,
  getCatVisibility,
  setCatVisibility,
  saveRecord,
  updateRecordCover,
  updateRecordScore,
  updateRecordPosterResult,
  clearAllRecordCovers,
  getAllRecords,
  getRecordById,
  getRecordsForCat,
  getRecordOriginalPath,
  getRecordSubjectPath,
  getRecordSubjectFileID,
  getRecordPosterSourcePath,
  getRecordPosterSourceFileID,
  getRecordDisplayPath,
  getCanQuota,
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
  mergeRemoteProfiles,
  mergeRemoteStats,
};
