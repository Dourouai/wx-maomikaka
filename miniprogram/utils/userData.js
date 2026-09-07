// 用户身份与猫咪档案同步。
//
// 小程序端不保存、不传递 openid。CloudBase 云函数从
// cloud.getWXContext().OPENID 读取当前微信用户身份。
const storage = require('./storage');
const posterResultSchema = require('./posterResult');

const AUTH_FUNCTION_NAME = 'auth-bootstrap';
const SYNC_FUNCTION_NAME = 'sync-guest-data';
// 首次导入不能阻塞在一个长云函数调用里，按小批次提交，便于失败重试。
const MAX_SYNC_BATCH_SIZE = 20;
let activeSyncPromise = null;
let activeAccountCheckPromise = null;

function createError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function assertCloudAvailable() {
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    throw createError('CLOUD_NOT_READY', '云端服务暂时不可用');
  }
}

function getResult(response) {
  return response && response.result ? response.result : response;
}

function callFunction(name, data) {
  assertCloudAvailable();
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name,
      data: data || {},
      success(response) {
        const result = getResult(response);
        if (!result || result.ok !== true) {
          const error = createError(
            (result && result.code) || 'CLOUD_DATA_FAILED',
            (result && result.message) || '云端数据处理失败'
          );
          error.result = result;
          reject(error);
          return;
        }
        resolve(result);
      },
      fail: reject,
    });
  });
}

function trimString(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeLocation(value, fallbackCapturedAt) {
  const source = value && typeof value === 'object' ? value : {};
  const latitude = Number(source.latitude);
  const longitude = Number(source.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;

  const rawCapturedAt = source.capturedAt || fallbackCapturedAt;
  const numeric = Number(rawCapturedAt);
  const timestamp = Number.isFinite(numeric) && numeric > 0
    ? numeric
    : Date.parse(rawCapturedAt);
  return {
    source: trimString(source.source || 'wx.getFuzzyLocation', 80),
    coordinateSystem: source.coordinateSystem === 'gcj02' ? 'gcj02' : 'wgs84',
    latitude: Number(latitude.toFixed(3)),
    longitude: Number(longitude.toFixed(3)),
    locationText: trimString(source.locationText || source.label || source.name, 40) || null,
    capturedAt: Number.isFinite(timestamp) && timestamp > 0
      ? new Date(timestamp).toISOString()
      : null,
  };
}

function normalizeLocationStatus(value, location) {
  const status = trimString(value, 20);
  if (status === 'captured' && !location) return 'unavailable';
  if (['captured', 'skipped', 'denied', 'unavailable'].includes(status)) return status;
  return location ? 'captured' : 'unavailable';
}

function toRecordPayload(record, deviceId, source) {
  const item = record || {};
  const clientRecordId = trimString(item.clientRecordId || item.recordId, 128);
  if (!clientRecordId) return null;
  const location = normalizeLocation(item.location, item.capturedAt || item.createdAt);

  return {
    clientRecordId,
    captureId: trimString(item.captureId, 128),
    source: source || 'guest-import',
    catalogCatId: trimString(item.catId, 64),
    archiveCode: trimString(item.archiveCode, 32).toUpperCase(),
    display: {
      name: trimString(item.catName, 40),
      description: trimString(item.catDescription, 240),
      posterCopy: trimString(item.posterCopy, 52),
      copyVersion: trimString(item.copyVersion, 80),
    },
    media: {
      originalFileID: trimString(item.originalFileID, 512),
      originalContentType: trimString(item.originalContentType, 64),
      cutoutFileID: trimString(item.cutoutFileID, 512),
      cutoutContentType: trimString(item.cutoutContentType, 64),
      cutoutProvider: trimString(item.cutoutProvider, 80),
      cutoutOperation: trimString(item.cutoutOperation, 120),
      cutoutRequestId: trimString(item.cutoutRequestId, 160),
      cutoutCheckerboardRemoved: item.cutoutCheckerboardRemoved === true,
      coverFileID: trimString(item.coverFileID, 512),
      coverContentType: trimString(item.coverContentType, 64),
      coverProvider: trimString(item.coverProvider, 80),
      coverModel: trimString(item.coverModel, 160),
      coverOperation: trimString(item.coverOperation, 120),
      coverPromptVersion: trimString(item.coverPromptVersion, 120),
      coverTargetRatio: trimString(item.coverTargetRatio, 20),
      coverStatus: trimString(item.coverStatus, 20),
      coverRequestId: trimString(item.coverRequestId, 160),
      coverCreatedAt: trimString(item.coverCreatedAt, 80),
      coverRejectReason: trimString(item.coverRejectReason, 240),
      posterResult: posterResultSchema.toPersistencePayload(item.posterResult),
    },
    observation: {
      breed: trimString(item.detectedBreed, 80),
      breedConfidence: toNumber(item.breedConfidence),
      traits: Array.isArray(item.detectedTraits)
        ? item.detectedTraits.slice(0, 3).map(trait => trimString(trait, 40)).filter(Boolean)
        : [],
      catCount: Number.isFinite(Number(item.catCount)) ? Number(item.catCount) : 1,
      source: trimString(item.detectionSource, 100),
    },
    score: {
      levelCode: trimString(item.levelCode, 20),
      levelLabel: trimString(item.levelLabel, 40),
      levelShortLabel: trimString(item.levelShortLabel, 80),
      charmScore: toNumber(item.charmScore),
      clevernessScore: toNumber(item.clevernessScore),
      auraScore: toNumber(item.auraScore),
      rarityScore: toNumber(item.rarityScore),
      fateScore: toNumber(item.fateScore),
      overallScore: toNumber(item.overallScore),
      pawReward: toNumber(item.pawReward) || 0,
      pointReward: toNumber(item.pointReward),
      scorePending: item.scorePending === true,
      scoreSource: trimString(item.scoreSource, 100),
      scoreVersion: trimString(item.scoreVersion, 100),
      scoreEvidence: item.scoreEvidence && typeof item.scoreEvidence === 'object'
        ? item.scoreEvidence
        : null,
      scoreCoverage: item.scoreCoverage && typeof item.scoreCoverage === 'object'
        ? item.scoreCoverage
        : null,
    },
    location,
    locationStatus: normalizeLocationStatus(item.locationStatus, location),
    createdAt: item.createdAt || null,
    capturedAt: trimString(item.capturedAt, 80),
    clientDeviceId: deviceId,
  };
}

async function bootstrap(options = {}) {
  const previousState = storage.getSyncState();
  const localProfile = options.profile
    || (previousState.userBound === true ? storage.getUserProfile() : null);
  const authPayload = { action: 'bootstrap' };
  if (localProfile && (localProfile.avatarUrl || localProfile.avatarFileID || localProfile.nickName)) {
    authPayload.profile = localProfile;
  }
  const result = await callFunction(AUTH_FUNCTION_NAME, authPayload);
  const bindingKey = result
    && result.user
    && String(result.user.accountBindingKey || '').trim();
  const accountChanged = Boolean(
    previousState.accountBindingKey
    && bindingKey
    && previousState.accountBindingKey !== bindingKey
  );
  if (accountChanged) storage.clearUserProfile();
  if (result && result.user && result.user.profile) {
    storage.setUserProfile(result.user.profile);
  }
  const dataBound = accountChanged
    ? false
    : (options.bindData === true || previousState.userBound === true);
  storage.setSyncState({
    userBound: dataBound,
    accountBindingKey: bindingKey || previousState.accountBindingKey || null,
    accountChanged,
    accountCheckPending: false,
    status: accountChanged
      ? 'local'
      : (options.bindData === true
        ? (previousState.status === 'synced' ? 'synced' : 'ready')
        : previousState.status),
    importConsentAt: accountChanged ? null : previousState.importConsentAt,
    lastSyncedAt: accountChanged ? null : previousState.lastSyncedAt,
    lastSyncError: accountChanged ? null : previousState.lastSyncError,
  });
  if (accountChanged && !previousState.accountChanged) {
    storage.prepareRecordsForAccountRebind();
  }
  return { ...result, accountChanged };
}

async function verifyAccount() {
  const previousState = storage.getSyncState();
  const result = await callFunction(AUTH_FUNCTION_NAME, { action: 'check' });
  const bindingKey = result
    && result.user
    && String(result.user.accountBindingKey || '').trim();
  const accountChanged = previousState.accountChanged === true || Boolean(
    previousState.accountBindingKey
    && (!bindingKey || previousState.accountBindingKey !== bindingKey)
  );
  if (accountChanged) storage.clearUserProfile();
  if (result && result.user && result.user.profile) {
    storage.setUserProfile(result.user.profile);
  }
  storage.setSyncState({
    userBound: accountChanged ? false : previousState.userBound === true,
    accountBindingKey: bindingKey || null,
    accountChanged,
    accountCheckPending: false,
    status: accountChanged ? 'local' : previousState.status,
    importConsentAt: accountChanged ? null : previousState.importConsentAt,
    lastSyncedAt: accountChanged ? null : previousState.lastSyncedAt,
    lastSyncError: accountChanged ? null : previousState.lastSyncError,
  });
  if (accountChanged && !previousState.accountChanged) {
    storage.prepareRecordsForAccountRebind();
  }
  return { ...result, accountChanged };
}

function checkAccount() {
  if (activeAccountCheckPromise) return activeAccountCheckPromise;
  storage.setSyncState({ accountCheckPending: true });
  const promise = verifyAccount();
  activeAccountCheckPromise = promise.then(
    result => {
      activeAccountCheckPromise = null;
      return result;
    },
    error => {
      storage.setSyncState({ accountCheckPending: false });
      activeAccountCheckPromise = null;
      throw error;
    }
  );
  return activeAccountCheckPromise;
}

async function pullMine() {
  return callFunction(SYNC_FUNCTION_NAME, { action: 'pull' });
}

/**
 * 将已完成的海报排版快照写入所属 encounters.media.posterResult。
 * PNG 上传云存储，数据库保存成品 fileID 和排版快照。
 */
async function savePosterResult(posterResult) {
  const result = posterResultSchema.toPersistencePayload(posterResult);
  if (!result || !result.sourceArchiveId || !result.sourceRecordId) {
    return { ok: true, skipped: true, reason: 'POSTER_RESULT_INVALID' };
  }

  // 即使当前未绑定账号，也把轻量元数据挂到本地记录，待用户绑定后随首次导入提交。
  if (typeof storage.updateRecordPosterResult === 'function') {
    storage.updateRecordPosterResult(result.sourceRecordId, result);
  }
  if (!isUserBound()) {
    return { ok: true, skipped: true, reason: 'USER_NOT_BOUND' };
  }

  if (!result.posterImage.fileID && posterResult.posterPath) {
    const existing = await getPosterResult(result.sourceArchiveId, result.sourceRecordId);
    if (existing && existing.posterImage && existing.posterImage.fileID) {
      storage.updateRecordPosterResult(result.sourceRecordId, existing);
      return { ok: true, saved: true, reused: true, posterResult: existing };
    }
    const upload = await wx.cloud.uploadFile({
      cloudPath: `posters/${storage.getDeviceId()}/${Date.now()}-${Math.random().toString(36).slice(2)}.png`,
      filePath: posterResult.posterPath,
    });
    result.posterImage.fileID = upload.fileID;
    storage.updateRecordPosterResult(result.sourceRecordId, result);
  }

  const request = {
    action: 'save-poster-result',
    deviceId: storage.getDeviceId(),
    catalogCatId: trimString(result.sourceArchiveId, 64),
    sourceRecordId: trimString(result.sourceRecordId, 128),
    posterResult: result,
  };
  let response = await callFunction(SYNC_FUNCTION_NAME, request);
  if (response.reason === 'POSTER_SOURCE_NOT_SYNCED') {
    await syncLocalData();
    response = await callFunction(SYNC_FUNCTION_NAME, request);
  }
  return response;
}

async function getPosterResult(catalogCatId, sourceRecordId) {
  if (!isUserBound()) return null;
  const response = await callFunction(SYNC_FUNCTION_NAME, {
    action: 'get-poster-result', deviceId: storage.getDeviceId(), catalogCatId, sourceRecordId,
  });
  return response.posterResult || null;
}

async function performSyncLocalData(options = {}) {
  const state = storage.getSyncState();
  if (!options.force && state.userBound !== true) {
    return { ok: true, skipped: true, reason: 'USER_NOT_BOUND', importedCount: 0, mergedCount: 0 };
  }

  storage.setSyncState({
    userBound: state.userBound === true,
    status: 'syncing',
    lastSyncError: null,
    importConsentAt: options.markConsent ? Date.now() : state.importConsentAt,
  });

  try {
    const bootstrapResult = await bootstrap({ bindData: true, profile: options.profile });
    if (bootstrapResult.accountChanged) {
      throw createError(
        'ACCOUNT_CHANGED_REQUIRES_CONFIRMATION',
        '检测到当前微信账号已变化，请重新确认本机记录的绑定关系'
      );
    }
    const pendingRecords = storage.getPendingRecords();
    const deviceId = storage.getDeviceId();
    const source = options.source || 'guest-import';
    const mappings = [];
    const rejected = [];
    let importedCount = 0;

    for (let index = 0; index < pendingRecords.length; index += MAX_SYNC_BATCH_SIZE) {
      const batch = pendingRecords
        .slice(index, index + MAX_SYNC_BATCH_SIZE)
        .map(record => toRecordPayload(record, deviceId, source))
        .filter(Boolean);
      if (!batch.length) continue;

      const result = await callFunction(SYNC_FUNCTION_NAME, {
        action: 'import',
        deviceId,
        source,
        records: batch,
      });
      if (Array.isArray(result.mappings)) mappings.push(...result.mappings);
      if (Array.isArray(result.rejected)) rejected.push(...result.rejected);
      importedCount += Number(result.importedCount) || 0;
    }

    storage.markRecordsSynced(mappings);
    const snapshot = await pullMine();
    const mergedCount = storage.mergeRemoteRecords(snapshot.encounters || []);
    storage.mergeRemoteStats(snapshot.stats);
    const remoteRecordCount = Array.isArray(snapshot.encounters)
      ? snapshot.encounters.length
      : 0;
    const remainingPendingCount = storage.getSyncSummary().pendingRecords;

    storage.setSyncState({
      userBound: true,
      status: remainingPendingCount > 0 ? 'error' : 'synced',
      lastSyncedAt: Date.now(),
      lastSyncError: remainingPendingCount > 0
        ? `还有 ${remainingPendingCount} 条记录未完成同步`
        : null,
      lastRemoteRecordCount: remoteRecordCount,
    });

    return {
      ok: true,
      importedCount,
      mergedCount,
      mappings,
      rejected,
      snapshot,
    };
  } catch (error) {
    const message = String(error && (error.message || error.errMsg) || '同步失败').slice(0, 160);
    storage.markPendingSyncError(message);
    storage.setSyncState({
      userBound: storage.getSyncState().userBound === true,
      status: 'error',
      lastSyncError: message,
    });
    throw error;
  }
}

function syncLocalData(options = {}) {
  if (activeSyncPromise) return activeSyncPromise;
  const promise = performSyncLocalData(options);
  activeSyncPromise = promise.then(
    result => {
      activeSyncPromise = null;
      return result;
    },
    error => {
      activeSyncPromise = null;
      throw error;
    }
  );
  return activeSyncPromise;
}

async function deleteCatalogArchive(catalogCatId) {
  const state = storage.getSyncState();
  if (state.userBound !== true) return { ok: true, skipped: true };

  return callFunction(SYNC_FUNCTION_NAME, {
    action: 'delete-catalog-archive',
    catalogCatId: trimString(catalogCatId, 64),
  });
}

function isUserBound() {
  const state = storage.getSyncState();
  return state.userBound === true
    && state.accountCheckPending !== true
    && state.accountChanged !== true;
}

module.exports = {
  bootstrap,
  checkAccount,
  pullMine,
  getPosterResult,
  savePosterResult,
  syncLocalData,
  deleteCatalogArchive,
  isUserBound,
  getLocalSyncSummary: storage.getSyncSummary,
};
