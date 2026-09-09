const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
  // 首次绑定会按小批次写入相遇、猫卡和奖励流水，给云端事务留出余量。
  timeout: 60000,
});

const db = cloud.database();
const USERS_COLLECTION = 'users';
const PROFILES_COLLECTION = 'cat_profiles';
const ENCOUNTERS_COLLECTION = 'encounters';
const GUEST_ENCOUNTERS_COLLECTION = 'guest_encounters';
const REWARD_LEDGER_COLLECTION = 'user_reward_ledger';
const CAN_USAGE_COLLECTION = 'can_usage_ledger';
const USER_SCHEMA_VERSION = 1;
const DATA_SCHEMA_VERSION = 1;
const REWARD_SCHEMA_VERSION = 1;
const POSTER_RESULT_SCHEMA_VERSION = 1;
const MAX_IMPORT_RECORDS = 20;
const MAX_QUERY_RECORDS = 1000;
const GUEST_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const PRIVACY_POLICY_VERSION = 'V0.2';
const VALID_EVIDENCE_GROUPS = ['charm', 'cleverness', 'aura'];
const VISIBILITIES = ['public', 'private'];
const ARCHIVE_CODE_PATTERN = /^\d{8}[0-9A-Z]{6}$/;

function createError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function getOpenId() {
  const wxContext = cloud.getWXContext();
  const openid = String(wxContext && wxContext.OPENID || '').trim();
  if (!openid) throw createError('IDENTITY_UNAVAILABLE', '当前微信身份暂时不可用');
  return openid;
}

function isDocumentMissing(error) {
  const code = String(error && (error.errCode || error.code) || '').toLowerCase();
  const message = String(error && (error.errMsg || error.message) || '').toLowerCase();
  return code.includes('not_exist')
    || code.includes('notfound')
    || code.includes('not_found')
    || message.includes('not exist')
    || message.includes('not found')
    || message.includes('不存在')
    || (message.includes('collection') && message.includes('not'));
}

async function safeGet(query) {
  try {
    return await query.get();
  } catch (error) {
    // 新用户还没有产生猫档案时，相关集合可能尚未创建；把它视为空快照。
    if (isDocumentMissing(error)) return { data: [] };
    throw error;
  }
}

function trimString(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeSourceType(value) {
  const sourceType = trimString(value, 20).toLowerCase();
  return sourceType === 'live' ? 'live' : 'photo';
}

function normalizeVisibility(value) {
  const visibility = trimString(value, 20).toLowerCase();
  return VISIBILITIES.includes(visibility) ? visibility : '';
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(min, Math.min(max, number));
}

function normalizeCatalogCatId(value) {
  const id = trimString(value, 64);
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : '';
}

function normalizeArchiveCode(value) {
  const code = trimString(value, 32).toUpperCase();
  return ARCHIVE_CODE_PATTERN.test(code) ? code : '';
}

function normalizeDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  // 历史导入允许保留合理的本地时间，但不接受极端时间污染排序和统计。
  const now = Date.now();
  const min = now - 10 * 365 * 24 * 60 * 60 * 1000;
  const max = now + 5 * 60 * 1000;
  return new Date(Math.max(min, Math.min(max, date.getTime())));
}

function toISOString(value) {
  const date = normalizeDate(value);
  return date ? date.toISOString() : null;
}

function normalizeLocation(value, fallbackCapturedAt) {
  const source = value && typeof value === 'object' ? value : {};
  const latitude = clampNumber(source.latitude, -90, 90);
  const longitude = clampNumber(source.longitude, -180, 180);
  if (latitude === null || longitude === null) return null;

  return {
    source: trimString(source.source || 'wx.getFuzzyLocation', 80),
    coordinateSystem: source.coordinateSystem === 'gcj02' ? 'gcj02' : 'wgs84',
    latitude: Number(latitude.toFixed(3)),
    longitude: Number(longitude.toFixed(3)),
    locationText: trimString(source.locationText || source.label || source.name, 40),
    capturedAt: toISOString(source.capturedAt || fallbackCapturedAt),
  };
}

function normalizeLocationStatus(value, location) {
  const status = trimString(value, 20);
  if (status === 'captured' && !location) return 'unavailable';
  if (['captured', 'skipped', 'denied', 'unavailable'].includes(status)) return status;
  return location ? 'captured' : 'unavailable';
}

function normalizeEvidence(value) {
  if (!value || typeof value !== 'object') return null;
  return VALID_EVIDENCE_GROUPS.reduce((result, group) => {
    const source = value[group];
    if (!source || typeof source !== 'object') return result;
    const next = {};
    Object.keys(source).slice(0, 8).forEach(key => {
      const score = clampNumber(source[key], 0, 100);
      if (score !== null) next[trimString(key, 40)] = Math.round(score);
    });
    if (Object.keys(next).length) result[group] = next;
    return result;
  }, {});
}

function normalizeCoverage(value) {
  if (!value || typeof value !== 'object') return null;
  const result = {};
  Object.keys(value).slice(0, 12).forEach(key => {
    const item = value[key];
    if (typeof item === 'boolean') result[trimString(key, 40)] = item;
    else if (typeof item === 'string') result[trimString(key, 40)] = trimString(item, 80);
    else if (Number.isFinite(Number(item))) result[trimString(key, 40)] = Number(item);
  });
  return Object.keys(result).length ? result : null;
}

function normalizePosterImage(value, options = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const image = {
    kind: trimString(source.kind, 20),
    fileID: trimString(source.fileID || source.coverFileID, 512),
    width: clampNumber(source.width, 0, 10000) || 0,
    height: clampNumber(source.height, 0, 10000) || 0,
    version: trimString(source.version, 120),
  };
  if (source.originalFileID || source.originalContentType) {
    image.originalFileID = trimString(source.originalFileID, 512);
    image.originalContentType = trimString(source.originalContentType, 64);
  }
  if (source.cutoutFileID) image.cutoutFileID = trimString(source.cutoutFileID, 512);

  if (options.includeCoverMetadata === true) {
    image.contentType = trimString(source.contentType, 64);
    image.provider = trimString(source.provider, 80);
    image.model = trimString(source.model, 160);
    image.operation = trimString(source.operation, 120);
    image.promptVersion = trimString(source.promptVersion, 120);
    image.targetRatio = trimString(source.targetRatio, 20);
    image.status = trimString(source.status, 20);
    image.requestId = trimString(source.requestId, 160);
    image.createdAt = toISOString(source.createdAt);
  }
  return image;
}

function normalizePosterResult(value) {
  const source = value && typeof value === 'object' ? value : {};
  const sourceArchiveId = normalizeCatalogCatId(source.sourceArchiveId || source.catalogCatId);
  const sourceRecordId = trimString(source.sourceRecordId || source.clientRecordId, 128);
  if (!sourceArchiveId || !sourceRecordId) return null;

  const scores = source.scores && typeof source.scores === 'object' ? source.scores : {};
  const traits = Array.isArray(source.traits)
    ? source.traits.slice(0, 3).map(trait => trimString(trait, 40)).filter(Boolean)
    : [];
  const coverSource = source.coverImage && typeof source.coverImage === 'object'
    ? {
      kind: 'cover',
      ...source.coverImage,
      fileID: source.coverImage.fileID || source.coverFileID,
      status: source.coverImage.status || source.coverStatus,
      promptVersion: source.coverImage.promptVersion || source.coverPromptVersion,
    }
    : null;
  const coverImage = coverSource
    ? normalizePosterImage(coverSource, { includeCoverMetadata: true })
    : null;

  return {
    schemaVersion: POSTER_RESULT_SCHEMA_VERSION,
    status: source.status === 'failed' ? 'failed' : 'ready',
    posterJobId: trimString(source.posterJobId || source.jobId, 128),
    templateVersion: trimString(source.templateVersion, 120),
    posterCacheVersion: trimString(source.posterCacheVersion, 120),
    sourceArchiveId,
    sourceRecordId,
    archiveCode: normalizeArchiveCode(source.archiveCode),
    levelCode: trimString(source.levelCode, 20),
    levelLabel: trimString(source.levelLabel, 40),
    levelShortLabel: trimString(source.levelShortLabel, 80),
    name: trimString(source.name, 40),
    breed: trimString(source.breed, 80),
    traits,
    copy: trimString(source.copy, 52),
    scores: {
      mika: clampNumber(scores.mika, 0, 100) || 0,
      charm: clampNumber(scores.charm, 0, 100) || 0,
      cleverness: clampNumber(scores.cleverness, 0, 100) || 0,
      aura: clampNumber(scores.aura, 0, 100) || 0,
    },
    sourceImage: normalizePosterImage(source.sourceImage),
    coverImage,
    coverStatus: trimString(source.coverStatus || (coverImage && coverImage.status), 20),
    coverRejectReason: trimString(source.coverRejectReason, 240),
    posterImage: normalizePosterImage({
      ...(source.posterImage || {}),
      fileID: source.posterImage && source.posterImage.fileID || '',
    }),
    shareId: trimString(source.shareId, 96),
    generatedAt: toISOString(source.generatedAt || source.createdAt),
  };
}

function normalizeRecord(input) {
  const source = input && typeof input === 'object' ? input : {};
  const clientRecordId = trimString(source.clientRecordId || source.recordId, 128);
  const catalogCatId = normalizeCatalogCatId(source.catalogCatId || source.catId);
  if (!clientRecordId) return { error: '缺少本地记录编号' };
  if (!catalogCatId) return { error: '缺少有效的猫卡角色编号' };

  const display = source.display && typeof source.display === 'object' ? source.display : {};
  const media = source.media && typeof source.media === 'object' ? source.media : {};
  const observation = source.observation && typeof source.observation === 'object'
    ? source.observation
    : {};
  const score = source.score && typeof source.score === 'object' ? source.score : {};
  const catCount = Math.max(1, Math.min(10, Math.round(Number(observation.catCount || source.catCount) || 1)));
  const createdAt = normalizeDate(source.createdAt || source.capturedAt);
  const capturedAt = toISOString(source.capturedAt || source.createdAt) || (createdAt && createdAt.toISOString());
  const location = normalizeLocation(source.location, capturedAt);
  const rawVisibility = source.visibility !== undefined
    ? source.visibility
    : source.publicVisibility;

  return {
    clientRecordId,
    captureId: trimString(source.captureId, 128),
    sourceType: normalizeSourceType(
      source.sourceType || source.captureSource || source.inputSource,
    ),
    catalogCatId,
    visibility: normalizeVisibility(rawVisibility),
    archiveCode: normalizeArchiveCode(source.archiveCode),
    canUsageSource: normalizeCanUsageSource(source.canUsageSource),
    display: {
      name: trimString(display.name || source.catName, 40),
      description: trimString(display.description || source.catDescription, 240),
      posterCopy: trimString(display.posterCopy || source.posterCopy, 52),
      copyVersion: trimString(display.copyVersion || source.copyVersion, 80),
    },
    media: {
      originalFileID: trimString(media.originalFileID || source.originalFileID, 512),
      originalContentType: trimString(
        media.originalContentType || source.originalContentType,
        64,
      ),
      cutoutFileID: trimString(media.cutoutFileID || source.cutoutFileID, 512),
      cutoutContentType: trimString(media.cutoutContentType || source.cutoutContentType, 64),
      cutoutProvider: trimString(media.cutoutProvider || source.cutoutProvider, 80),
      cutoutOperation: trimString(media.cutoutOperation || source.cutoutOperation, 120),
      cutoutRequestId: trimString(media.cutoutRequestId || source.cutoutRequestId, 160),
      cutoutCheckerboardRemoved: media.cutoutCheckerboardRemoved === true
        || source.cutoutCheckerboardRemoved === true,
      coverFileID: trimString(media.coverFileID || source.coverFileID, 512),
      coverContentType: trimString(media.coverContentType || source.coverContentType, 64),
      coverProvider: trimString(media.coverProvider || source.coverProvider, 80),
      coverModel: trimString(media.coverModel || source.coverModel, 160),
      coverOperation: trimString(media.coverOperation || source.coverOperation, 120),
      coverPromptVersion: trimString(media.coverPromptVersion || source.coverPromptVersion, 120),
      coverTargetRatio: trimString(media.coverTargetRatio || source.coverTargetRatio, 20),
      coverStatus: trimString(media.coverStatus || source.coverStatus, 20),
      coverRequestId: trimString(media.coverRequestId || source.coverRequestId, 160),
      coverCreatedAt: trimString(media.coverCreatedAt || source.coverCreatedAt, 80),
      coverRejectReason: trimString(media.coverRejectReason || source.coverRejectReason, 240),
      posterResult: normalizePosterResult(media.posterResult || source.posterResult),
    },
    observation: {
      breed: trimString(observation.breed || source.detectedBreed, 80),
      breedConfidence: clampNumber(
        observation.breedConfidence !== undefined
          ? observation.breedConfidence
          : source.breedConfidence,
        0,
        1
      ),
      traits: Array.isArray(observation.traits || source.detectedTraits)
        ? (observation.traits || source.detectedTraits)
          .slice(0, 3)
          .map(trait => trimString(trait, 40))
          .filter(Boolean)
        : [],
      catCount,
      source: trimString(observation.source || source.detectionSource, 100),
    },
    score: {
      levelCode: trimString(score.levelCode || source.levelCode, 20),
      levelLabel: trimString(score.levelLabel || source.levelLabel, 40),
      levelShortLabel: trimString(score.levelShortLabel || source.levelShortLabel, 80),
      charmScore: clampNumber(score.charmScore !== undefined ? score.charmScore : source.charmScore, 0, 100),
      clevernessScore: clampNumber(
        score.clevernessScore !== undefined ? score.clevernessScore : source.clevernessScore,
        0,
        100
      ),
      auraScore: clampNumber(score.auraScore !== undefined ? score.auraScore : source.auraScore, 0, 100),
      rarityScore: clampNumber(score.rarityScore !== undefined ? score.rarityScore : source.rarityScore, 0, 100),
      fateScore: clampNumber(score.fateScore !== undefined ? score.fateScore : source.fateScore, 0, 100),
      overallScore: clampNumber(score.overallScore !== undefined ? score.overallScore : source.overallScore, 0, 100),
      pawReward: clampNumber(score.pawReward !== undefined ? score.pawReward : source.pawReward, 0, 100000) || 0,
      pointReward: clampNumber(score.pointReward !== undefined ? score.pointReward : source.pointReward, 0, 100000),
      scorePending: score.scorePending === true || source.scorePending === true,
      scoreSource: trimString(score.scoreSource || source.scoreSource, 100),
      scoreVersion: trimString(score.scoreVersion || source.scoreVersion, 100),
      scoreEvidence: normalizeEvidence(score.scoreEvidence || source.scoreEvidence),
      scoreCoverage: normalizeCoverage(score.scoreCoverage || source.scoreCoverage),
    },
    location,
    locationStatus: normalizeLocationStatus(source.locationStatus, location),
    createdAt,
    capturedAt,
  };
}

function normalizeGuestToken(value) {
  const token = trimString(value, 256);
  return token.length >= 32 ? token : '';
}

function hashGuestToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function createGuestRecordKey(guestTokenHash, deviceId, clientRecordId) {
  return crypto.createHash('sha256')
    .update(`${guestTokenHash}:${deviceId}:${clientRecordId}`, 'utf8')
    .digest('hex')
    .slice(0, 48);
}

function getDateTimestamp(value) {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === 'object' && value.$date) {
    const numeric = Number(value.$date);
    if (Number.isFinite(numeric)) return numeric;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function getGuestEncounter(guestRecordKey) {
  try {
    const response = await db.collection(GUEST_ENCOUNTERS_COLLECTION).doc(guestRecordKey).get();
    return response && response.data ? response.data : null;
  } catch (error) {
    if (isDocumentMissing(error)) return null;
    throw error;
  }
}

async function stageGuestRecords(event) {
  const deviceId = trimString(event.deviceId, 128);
  const guestToken = normalizeGuestToken(event.guestToken);
  if (!deviceId) throw createError('DEVICE_ID_REQUIRED', '缺少本地设备编号');
  if (!guestToken) throw createError('GUEST_TOKEN_REQUIRED', '匿名记录凭证不可用');

  const inputs = Array.isArray(event.records)
    ? event.records.slice(0, MAX_IMPORT_RECORDS)
    : [];
  const guestTokenHash = hashGuestToken(guestToken);
  const rejected = [];
  let stagedCount = 0;
  let skippedCount = 0;

  for (const input of inputs) {
    const record = normalizeRecord(input);
    if (record.error) {
      rejected.push({
        localRecordId: trimString(input && (input.clientRecordId || input.recordId), 128),
        reason: record.error,
      });
      continue;
    }

    const guestRecordKey = createGuestRecordKey(
      guestTokenHash,
      deviceId,
      record.clientRecordId,
    );
    const existing = await getGuestEncounter(guestRecordKey);
    if (existing && existing.status === 'claimed') {
      skippedCount += 1;
      continue;
    }

    await db.collection(GUEST_ENCOUNTERS_COLLECTION).doc(guestRecordKey).set({
      data: {
        schemaVersion: DATA_SCHEMA_VERSION,
        guestRecordKey,
        guestTokenHash,
        clientDeviceId: deviceId,
        clientRecordId: record.clientRecordId,
        source: trimString(event.source || 'guest-stage', 40),
        storageScope: 'guest-temporary',
        clientPrivacyPolicyVersion: trimString(event.privacyPolicyVersion, 32) || null,
        serverPrivacyPolicyVersion: PRIVACY_POLICY_VERSION,
        retentionDays: 30,
        status: 'pending',
        record,
        createdAt: existing && existing.createdAt ? existing.createdAt : db.serverDate(),
        updatedAt: db.serverDate(),
        expiresAt: new Date(Date.now() + GUEST_RETENTION_MS),
      },
    });
    stagedCount += 1;
  }

  return {
    ok: true,
    stagedCount,
    skippedCount,
    rejected,
  };
}

async function getUser(userId) {
  try {
    const response = await db.collection(USERS_COLLECTION).doc(userId).get();
    return response && response.data ? response.data : null;
  } catch (error) {
    if (isDocumentMissing(error)) return null;
    throw error;
  }
}

async function ensureUser(userId) {
  const userRef = db.collection(USERS_COLLECTION).doc(userId);
  const existing = await getUser(userId);
  if (!existing) {
    try {
      await userRef.set({
        data: {
          schemaVersion: USER_SCHEMA_VERSION,
          status: 'active',
          stats: {
            totalPhotos: 0,
            unlockedCount: 0,
            pawGrowth: 0,
            pointBalance: 0,
            purchasedCanBalance: 0,
          },
          createdAt: db.serverDate(),
          updatedAt: db.serverDate(),
          lastSeenAt: db.serverDate(),
        },
      });
      return;
    } catch (error) {
      if (!String(error && (error.errMsg || error.message) || '').toLowerCase().includes('exist')) {
        throw error;
      }
    }
  }

  await userRef.update({
    data: {
      schemaVersion: USER_SCHEMA_VERSION,
      status: 'active',
      updatedAt: db.serverDate(),
      lastSeenAt: db.serverDate(),
    },
  });
}

async function findProfile(userId, catalogCatId) {
  const result = await safeGet(db.collection(PROFILES_COLLECTION)
    .where({
      ownerOpenId: userId,
      catalogCatId,
      profileKind: 'catalog-role',
      status: 'active',
    })
    .limit(1)
  );
  return result && Array.isArray(result.data) ? result.data[0] || null : null;
}

async function createProfile(userId, record) {
  const firstSeenAt = record.createdAt || db.serverDate();
  const result = await db.collection(PROFILES_COLLECTION).add({
    data: {
      schemaVersion: DATA_SCHEMA_VERSION,
      ownerOpenId: userId,
      profileKind: 'catalog-role',
      identityStatus: 'catalog-role',
      status: 'active',
      catalogCatId: record.catalogCatId,
      visibility: record.visibility || 'public',
      displayName: record.display.name || null,
      displayDescription: record.display.description || null,
      displayPosterCopy: record.display.posterCopy || null,
      encounterCount: 0,
      locationSummary: {
        firstLocation: null,
        latestLocation: null,
        locationCount: 0,
      },
      firstSeenAt,
      lastSeenAt: firstSeenAt,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate(),
    },
  });
  const profileId = result && (result._id || result.id);
  if (!profileId) throw createError('PROFILE_CREATE_FAILED', '猫咪档案创建失败');

  return {
    _id: profileId,
    catalogCatId: record.catalogCatId,
    visibility: record.visibility || 'public',
    displayName: record.display.name || null,
    displayDescription: record.display.description || null,
    displayPosterCopy: record.display.posterCopy || null,
    encounterCount: 0,
    locationSummary: {
      firstLocation: null,
      latestLocation: null,
      locationCount: 0,
    },
  };
}

async function getOrCreateProfile(userId, record, cache) {
  const key = record.catalogCatId;
  if (cache[key]) return cache[key];

  const existing = await findProfile(userId, key);
  const profile = existing || await createProfile(userId, record);
  cache[key] = profile;
  return profile;
}

async function updateProfileVisibility(profileId, visibility) {
  const normalized = normalizeVisibility(visibility);
  if (!profileId || !normalized) return;
  await db.collection(PROFILES_COLLECTION).doc(profileId).update({
    data: {
      visibility: normalized,
      updatedAt: db.serverDate(),
    },
  });
}

async function findExistingEncounter(userId, clientRecordKey) {
  const result = await safeGet(db.collection(ENCOUNTERS_COLLECTION)
    .where({ ownerOpenId: userId, clientRecordKey, status: 'active' })
    .limit(1)
  );
  return result && Array.isArray(result.data) ? result.data[0] || null : null;
}

function createRewardLedgerId(encounterId) {
  const normalized = trimString(encounterId, 100).replace(/[^A-Za-z0-9_-]/g, '_');
  return normalized ? `encounter_${normalized}` : '';
}

function normalizeRewardSource(source) {
  if (source === 'capture') return 'legacy-client-capture';
  if (source === 'guest-import') return 'guest-import';
  return 'legacy-client-sync';
}

function normalizeCanUsageSource(source) {
  if (source === 'purchased') return 'purchased';
  if (source === 'daily-gift') return 'daily-gift';
  return '';
}

function normalizeRewardDelta(value) {
  const number = clampNumber(value, -100000, 100000);
  return number === null ? 0 : Math.round(number);
}

async function getRewardLedgerEntry(rewardId) {
  if (!rewardId) return null;
  try {
    const response = await db.collection(REWARD_LEDGER_COLLECTION).doc(rewardId).get();
    return response && response.data ? response.data : null;
  } catch (error) {
    if (isDocumentMissing(error)) return null;
    throw error;
  }
}

async function ensureRewardLedgerEntry(userId, encounter, source) {
  const encounterId = trimString(encounter && (encounter._id || encounter.encounterId), 128);
  const rewardId = createRewardLedgerId(encounterId);
  if (!encounterId || !rewardId) return null;

  const existing = await getRewardLedgerEntry(rewardId);
  if (existing) {
    if (existing.ownerOpenId && existing.ownerOpenId !== userId) {
      throw createError('REWARD_LEDGER_CONFLICT', '奖励流水归属校验失败');
    }
    return existing;
  }

  const score = encounter && encounter.score && typeof encounter.score === 'object'
    ? encounter.score
    : {};
  const occurredAt = normalizeDate(encounter && (encounter.createdAt || encounter.capturedAt));
  const data = {
    schemaVersion: REWARD_SCHEMA_VERSION,
    ownerOpenId: userId,
    rewardType: 'encounter-reward',
    settlementState: 'legacy-client-sync',
    source: normalizeRewardSource(source),
    status: 'active',
    encounterId,
    clientRecordId: trimString(encounter && encounter.clientRecordId, 128),
    clientRecordKey: trimString(encounter && encounter.clientRecordKey, 256),
    catProfileId: trimString(encounter && encounter.catProfileId, 128),
    catalogCatId: normalizeCatalogCatId(encounter && encounter.catalogCatId),
    delta: {
      pawGrowth: normalizeRewardDelta(score.pawReward),
      points: normalizeRewardDelta(score.pointReward),
    },
    occurredAt: occurredAt || db.serverDate(),
    createdAt: db.serverDate(),
    updatedAt: db.serverDate(),
  };

  try {
    await db.collection(REWARD_LEDGER_COLLECTION).doc(rewardId).set({ data });
    return { ...data, _id: rewardId };
  } catch (error) {
    // 并发重试时允许另一请求先写入同一幂等流水。
    if (String(error && (error.errMsg || error.message) || '').toLowerCase().includes('exist')) {
      return getRewardLedgerEntry(rewardId);
    }
    throw error;
  }
}

async function ensureRewardLedgerForEncounters(userId, encounters, source) {
  const entries = [];
  for (const encounter of Array.isArray(encounters) ? encounters : []) {
    const entry = await ensureRewardLedgerEntry(userId, encounter, source);
    if (entry) entries.push(entry);
  }
  return entries;
}

function createCanUsageLedgerId(encounterId) {
  const normalized = trimString(encounterId, 100).replace(/[^A-Za-z0-9_-]/g, '_');
  return normalized ? `can_usage_${normalized}` : '';
}

async function getCanUsageLedgerEntry(ledgerId) {
  if (!ledgerId) return null;
  try {
    const response = await db.collection(CAN_USAGE_COLLECTION).doc(ledgerId).get();
    return response && response.data ? response.data : null;
  } catch (error) {
    if (isDocumentMissing(error)) return null;
    throw error;
  }
}

async function ensureCanUsageLedgerEntry(userId, encounter) {
  const source = normalizeCanUsageSource(encounter && encounter.canUsageSource);
  if (source !== 'purchased') return null;

  const encounterId = trimString(encounter && (encounter._id || encounter.encounterId), 128);
  const ledgerId = createCanUsageLedgerId(encounterId);
  if (!encounterId || !ledgerId) return null;

  const existing = await getCanUsageLedgerEntry(ledgerId);
  if (existing) {
    if (existing.ownerOpenId && existing.ownerOpenId !== userId) {
      throw createError('CAN_USAGE_LEDGER_CONFLICT', '罐罐使用流水归属校验失败');
    }
    return { ...existing, _id: ledgerId };
  }

  const data = {
    schemaVersion: 1,
    ownerOpenId: userId,
    encounterId,
    clientRecordId: trimString(encounter && encounter.clientRecordId, 128),
    source,
    debit: 1,
    status: 'pending',
    occurredAt: normalizeDate(encounter && (encounter.createdAt || encounter.capturedAt)) || db.serverDate(),
    createdAt: db.serverDate(),
    updatedAt: db.serverDate(),
  };

  try {
    await db.collection(CAN_USAGE_COLLECTION).doc(ledgerId).set({ data });
    return { ...data, _id: ledgerId };
  } catch (error) {
    if (String(error && (error.errMsg || error.message) || '').toLowerCase().includes('exist')) {
      return getCanUsageLedgerEntry(ledgerId);
    }
    throw error;
  }
}

/**
 * 购买罐罐的扣减也必须在服务端落账，避免客户端同步后又被远端余额覆盖。
 * ledger 先落幂等键，再用事务把用户余额和 ledger 状态一起结算。
 */
async function settleCanUsageLedger(userId, ledger) {
  if (!ledger || !ledger._id || ledger.status === 'settled') {
    return { debited: 0, alreadySettled: true };
  }

  return db.runTransaction(async transaction => {
    const ledgerRef = transaction.collection(CAN_USAGE_COLLECTION).doc(ledger._id);
    const ledgerSnapshot = await ledgerRef.get();
    const currentLedger = ledgerSnapshot && ledgerSnapshot.data;
    if (!currentLedger || currentLedger.status === 'settled') {
      return { debited: 0, alreadySettled: true };
    }

    const userRef = transaction.collection(USERS_COLLECTION).doc(userId);
    let user = null;
    try {
      const userSnapshot = await userRef.get();
      user = userSnapshot && userSnapshot.data ? userSnapshot.data : null;
    } catch (error) {
      if (!isDocumentMissing(error)) throw error;
    }

    const stats = user && user.stats && typeof user.stats === 'object'
      ? { ...user.stats }
      : {
        totalPhotos: 0,
        unlockedCount: 0,
        pawGrowth: 0,
        pointBalance: 0,
        purchasedCanBalance: 0,
      };
    const currentBalance = Math.max(0, Math.floor(Number(stats.purchasedCanBalance) || 0));
    const debited = currentBalance > 0 ? 1 : 0;
    stats.purchasedCanBalance = currentBalance - debited;

    if (user) {
      await userRef.update({
        data: {
          stats,
          updatedAt: db.serverDate(),
        },
      });
    } else {
      await userRef.set({
        data: {
          schemaVersion: USER_SCHEMA_VERSION,
          status: 'active',
          stats,
          createdAt: db.serverDate(),
          updatedAt: db.serverDate(),
          lastSeenAt: db.serverDate(),
        },
      });
    }

    await ledgerRef.update({
      data: {
        status: 'settled',
        debited,
        settledAt: db.serverDate(),
        updatedAt: db.serverDate(),
      },
    });
    return { debited, alreadySettled: false };
  });
}

async function settleEncounterCanUsage(userId, encounter) {
  const ledger = await ensureCanUsageLedgerEntry(userId, encounter);
  if (!ledger) return { debited: 0, skipped: true };
  return settleCanUsageLedger(userId, ledger);
}

async function getActiveRewardLedger(userId) {
  const result = await safeGet(db.collection(REWARD_LEDGER_COLLECTION)
    .where({ ownerOpenId: userId, status: 'active' })
    .limit(MAX_QUERY_RECORDS)
  );
  return result && Array.isArray(result.data) ? result.data : [];
}

async function createEncounter(userId, deviceId, clientRecordKey, record, profile, source) {
  const result = await db.collection(ENCOUNTERS_COLLECTION).add({
    data: {
      schemaVersion: DATA_SCHEMA_VERSION,
      ownerOpenId: userId,
      clientDeviceId: deviceId,
      clientRecordId: record.clientRecordId,
      clientRecordKey,
      source: source === 'capture' ? 'legacy-client-capture' : 'guest-import',
      settlementState: 'legacy-client-sync',
      status: 'active',
      catProfileId: profile._id,
      catalogCatId: record.catalogCatId,
      archiveCode: record.archiveCode || null,
      captureId: record.captureId || null,
      sourceType: normalizeSourceType(record.sourceType),
      canUsageSource: normalizeCanUsageSource(record.canUsageSource) || 'daily-gift',
      display: record.display,
      media: record.media,
      observation: record.observation,
      score: record.score,
      location: record.location || null,
      locationStatus: record.locationStatus,
      createdAt: record.createdAt || db.serverDate(),
      capturedAt: record.capturedAt || null,
      importedAt: db.serverDate(),
      updatedAt: db.serverDate(),
    },
  });
  const encounterId = result && (result._id || result.id);
  if (!encounterId) throw createError('ENCOUNTER_CREATE_FAILED', '相遇记录写入失败');
  return encounterId;
}

function normalizeLocationSummary(value) {
  const source = value && typeof value === 'object' ? value : {};
  const firstLocation = normalizeLocation(source.firstLocation);
  const latestLocation = normalizeLocation(source.latestLocation);
  const locationCount = Math.max(0, Math.floor(Number(source.locationCount) || 0));
  return { firstLocation, latestLocation, locationCount };
}

function getLocationTimestamp(location) {
  const timestamp = Date.parse(location && location.capturedAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function chooseEarlierLocation(current, candidate) {
  if (!current) return candidate || null;
  if (!candidate) return current;
  return getLocationTimestamp(candidate) < getLocationTimestamp(current) ? candidate : current;
}

function chooseLaterLocation(current, candidate) {
  if (!current) return candidate || null;
  if (!candidate) return current;
  return getLocationTimestamp(candidate) >= getLocationTimestamp(current) ? candidate : current;
}

async function updateProfilesAfterImport(userId, affectedProfiles, profileCacheById) {
  await Promise.all(Object.keys(affectedProfiles).map(async profileId => {
    const profile = profileCacheById[profileId] || {};
    const encounterResult = await safeGet(db.collection(ENCOUNTERS_COLLECTION)
      .where({ ownerOpenId: userId, catProfileId: profileId, status: 'active' })
      .limit(MAX_QUERY_RECORDS)
    );
    const encounters = encounterResult && Array.isArray(encounterResult.data)
      ? encounterResult.data.slice()
      : [];
    encounters.sort((left, right) => (
      getDateTimestamp(left && (left.createdAt || left.capturedAt))
      - getDateTimestamp(right && (right.createdAt || right.capturedAt))
    ));

    let firstLocation = null;
    let latestLocation = null;
    let locationCount = 0;
    encounters.forEach(encounter => {
      const location = normalizeLocation(
        encounter && encounter.location,
        encounter && (encounter.capturedAt || encounter.createdAt),
      );
      if (!location) return;
      locationCount += 1;
      firstLocation = chooseEarlierLocation(firstLocation, location);
      latestLocation = chooseLaterLocation(latestLocation, location);
    });

    const first = encounters[0];
    const latest = encounters[encounters.length - 1];
    const nextLocationSummary = {
      firstLocation,
      latestLocation,
      locationCount,
    };
    const data = {
      updatedAt: db.serverDate(),
      firstSeenAt: first && (first.createdAt || first.capturedAt)
        ? first.createdAt || first.capturedAt
        : (profile.firstSeenAt || db.serverDate()),
      lastSeenAt: latest && (latest.createdAt || latest.capturedAt)
        ? latest.createdAt || latest.capturedAt
        : db.serverDate(),
      // 历史数据可能是 null 或旧结构，整段替换避免 CloudBase 深层合并时
      // 尝试在 locationSummary.firstLocation/null 上创建 archiveCode 等字段。
      locationSummary: db.command && typeof db.command.set === 'function'
        ? db.command.set(nextLocationSummary)
        : nextLocationSummary,
      // 按当前用户的有效相遇记录重算，兼容上一次导入已写入 encounter、
      // 但更新 cat_profiles 聚合字段失败的半成功状态。
      encounterCount: encounters.length,
    };
    if (latest && latest.display) {
      if (latest.display.name) data.displayName = latest.display.name;
      if (latest.display.description) data.displayDescription = latest.display.description;
      if (latest.display.posterCopy) data.displayPosterCopy = latest.display.posterCopy;
    }
    await db.collection(PROFILES_COLLECTION).doc(profileId).update({ data });
  }));
}

async function calculateStats(userId) {
  const [encounterResult, profileResult, rewardResult] = await Promise.all([
    safeGet(db.collection(ENCOUNTERS_COLLECTION)
      .where({ ownerOpenId: userId })
      .limit(MAX_QUERY_RECORDS)
    ),
    safeGet(db.collection(PROFILES_COLLECTION)
      .where({ ownerOpenId: userId, status: 'active' })
      .limit(MAX_QUERY_RECORDS)
    ),
    getActiveRewardLedger(userId),
  ]);
  const allEncounters = encounterResult && Array.isArray(encounterResult.data)
    ? encounterResult.data
    : [];
  const encounters = allEncounters.filter(encounter => encounter.status === 'active');
  const profiles = profileResult && Array.isArray(profileResult.data)
    ? profileResult.data
    : [];
  const rewardEntries = Array.isArray(rewardResult) ? rewardResult : [];
  const rewardEncounterIds = new Set(
    rewardEntries.map(entry => trimString(entry && entry.encounterId, 128)).filter(Boolean)
  );
  const lastPhotoTime = encounters.reduce((latest, encounter) => {
    const time = normalizeDate(encounter.createdAt || encounter.capturedAt);
    return time && time.getTime() > latest ? time.getTime() : latest;
  }, 0) || null;
  const ledgerTotals = rewardEntries.reduce((totals, entry) => {
    const delta = entry && entry.delta && typeof entry.delta === 'object'
      ? entry.delta
      : {};
    const pawGrowth = normalizeRewardDelta(delta.pawGrowth);
    const points = normalizeRewardDelta(delta.points);
    return {
      pawGrowth: totals.pawGrowth + pawGrowth,
      points: totals.points + points,
    };
  }, { pawGrowth: 0, points: 0 });
  // 兼容奖励流水集合上线前已经写入的历史相遇：只补计尚未进入流水的记录，避免重复累计。
  const legacyTotals = allEncounters.reduce((totals, encounter) => {
    if (rewardEncounterIds.has(trimString(encounter && encounter._id, 128))) return totals;
    const score = encounter && encounter.score && typeof encounter.score === 'object'
      ? encounter.score
      : {};
    return {
      pawGrowth: totals.pawGrowth + normalizeRewardDelta(score.pawReward),
      points: totals.points + normalizeRewardDelta(score.pointReward),
    };
  }, { pawGrowth: 0, points: 0 });

  return {
    totalPhotos: encounters.length,
    unlockedCount: profiles.length,
    pawGrowth: ledgerTotals.pawGrowth + legacyTotals.pawGrowth,
    pointBalance: ledgerTotals.points + legacyTotals.points,
    lastPhotoTime,
  };
}

async function updateUserStats(userId) {
  const [stats, user] = await Promise.all([
    calculateStats(userId),
    getUser(userId),
  ]);
  const purchasedCanBalance = Number(
    user && user.stats && user.stats.purchasedCanBalance
  );
  if (Number.isFinite(purchasedCanBalance)) {
    // 购买余额不是奖励流水的计算结果，刷新相遇统计时必须原样保留。
    stats.purchasedCanBalance = Math.max(0, Math.floor(purchasedCanBalance));
  }
  await db.collection(USERS_COLLECTION).doc(userId).update({
    data: {
      stats,
      updatedAt: db.serverDate(),
    },
  });
  return stats;
}

function toClientProfile(profile) {
  const locationSummary = normalizeLocationSummary(profile.locationSummary);
  return {
    catProfileId: profile._id,
    catalogCatId: profile.catalogCatId,
    identityStatus: profile.identityStatus || 'catalog-role',
    visibility: profile.visibility === 'private' ? 'private' : 'public',
    displayName: profile.displayName || null,
    displayDescription: profile.displayDescription || null,
    displayPosterCopy: profile.displayPosterCopy || null,
    locationSummary,
    firstSeenAt: toISOString(profile.firstSeenAt || profile.createdAt),
    lastSeenAt: toISOString(profile.lastSeenAt || profile.updatedAt),
  };
}

function toClientObservation(observation) {
  const source = observation && typeof observation === 'object' ? observation : {};
  return {
    breed: source.breed || '',
    breedConfidence: source.breedConfidence === undefined ? null : source.breedConfidence,
    traits: Array.isArray(source.traits) ? source.traits.slice(0, 3) : [],
    catCount: Number(source.catCount) || 1,
    source: source.source || '',
  };
}

function toClientEncounter(encounter) {
  const location = normalizeLocation(encounter.location, encounter.capturedAt || encounter.createdAt);
  return {
    encounterId: encounter._id,
    localRecordId: encounter.clientRecordId || null,
    captureId: encounter.captureId || null,
    catProfileId: encounter.catProfileId || null,
    catalogCatId: encounter.catalogCatId || '',
    archiveCode: normalizeArchiveCode(encounter.archiveCode),
    sourceType: normalizeSourceType(encounter.sourceType),
    canUsageSource: normalizeCanUsageSource(encounter.canUsageSource),
    display: encounter.display || {},
    media: encounter.media || {},
    // 特征向量和 GLM 结构化参数仅停留在数据库内部，不回传给小程序。
    observation: toClientObservation(encounter.observation),
    score: encounter.score || {},
    location,
    locationStatus: normalizeLocationStatus(encounter.locationStatus, location),
    createdAt: toISOString(encounter.createdAt || encounter.capturedAt || encounter.importedAt),
    capturedAt: encounter.capturedAt || toISOString(encounter.createdAt),
  };
}

function toClientRewardEntry(entry) {
  const delta = entry && entry.delta && typeof entry.delta === 'object'
    ? entry.delta
    : {};
  return {
    rewardId: entry && entry._id ? entry._id : '',
    rewardType: entry && entry.rewardType ? entry.rewardType : 'encounter-reward',
    settlementState: entry && entry.settlementState ? entry.settlementState : '',
    source: entry && entry.source ? entry.source : '',
    encounterId: entry && entry.encounterId ? entry.encounterId : '',
    clientRecordId: entry && entry.clientRecordId ? entry.clientRecordId : '',
    catProfileId: entry && entry.catProfileId ? entry.catProfileId : '',
    catalogCatId: entry && entry.catalogCatId ? entry.catalogCatId : '',
    delta: {
      pawGrowth: normalizeRewardDelta(delta.pawGrowth),
      points: normalizeRewardDelta(delta.points),
    },
    occurredAt: toISOString(entry && (entry.occurredAt || entry.createdAt)),
    createdAt: toISOString(entry && (entry.createdAt || entry.occurredAt)),
  };
}

async function getSnapshot(userId) {
  const [profileResult, encounterResult] = await Promise.all([
    safeGet(db.collection(PROFILES_COLLECTION)
      .where({ ownerOpenId: userId, status: 'active' })
      .limit(MAX_QUERY_RECORDS)
    ),
    safeGet(db.collection(ENCOUNTERS_COLLECTION)
      .where({ ownerOpenId: userId })
      .limit(MAX_QUERY_RECORDS)
    ),
  ]);
  const profiles = profileResult && Array.isArray(profileResult.data) ? profileResult.data : [];
  const allEncounters = encounterResult && Array.isArray(encounterResult.data)
    ? encounterResult.data
    : [];
  const encounters = allEncounters.filter(encounter => encounter.status === 'active');
  await ensureRewardLedgerForEncounters(userId, allEncounters, 'legacy-client-sync');
  const [rewardLedger, stats] = await Promise.all([
    getActiveRewardLedger(userId),
    updateUserStats(userId),
  ]);

  return {
    profiles: profiles.map(toClientProfile),
    encounters: encounters.map(toClientEncounter),
    rewardLedger: rewardLedger.map(toClientRewardEntry),
    stats,
  };
}

function mergeEncounterMedia(existingMedia, incomingMedia) {
  const current = existingMedia && typeof existingMedia === 'object' ? existingMedia : {};
  const incoming = incomingMedia && typeof incomingMedia === 'object' ? incomingMedia : {};
  const merged = { ...current };

  Object.keys(incoming).forEach(key => {
    const value = incoming[key];
    const hasValue = value === true
      || typeof value === 'number'
      || (typeof value === 'string' && value.trim())
      || (value && typeof value === 'object');
    if (hasValue) merged[key] = value;
  });
  return merged;
}

async function mergeExistingEncounterMedia(existing, record) {
  if (!existing || !existing._id) return existing;
  const currentMedia = existing.media && typeof existing.media === 'object'
    ? existing.media
    : {};
  const nextMedia = mergeEncounterMedia(currentMedia, record && record.media);
  if (JSON.stringify(currentMedia) === JSON.stringify(nextMedia)) return existing;

  await db.collection(ENCOUNTERS_COLLECTION).doc(existing._id).update({
    data: {
      media: nextMedia,
      updatedAt: db.serverDate(),
    },
  });
  return { ...existing, media: nextMedia };
}

function hasCompleteStoredScore(score) {
  if (!score || typeof score !== 'object' || score.scorePending === true) return false;
  return ['charmScore', 'clevernessScore', 'auraScore', 'overallScore'].every(key => (
    Number.isFinite(Number(score[key]))
  ));
}

async function mergeExistingEncounterScore(existing, record) {
  if (!existing || !existing._id) return existing;

  const incomingScore = record && record.score && typeof record.score === 'object'
    ? record.score
    : null;
  if (!hasCompleteStoredScore(incomingScore)) return existing;

  const currentScore = existing.score && typeof existing.score === 'object'
    ? existing.score
    : null;
  if (hasCompleteStoredScore(currentScore)) return existing;

  // 整段替换评分对象，避免旧记录中残留的 null/旧版字段触发深层结构冲突。
  await db.collection(ENCOUNTERS_COLLECTION).doc(existing._id).update({
    data: {
      score: db.command && typeof db.command.set === 'function'
        ? db.command.set(incomingScore)
        : incomingScore,
      updatedAt: db.serverDate(),
    },
  });
  return { ...existing, score: incomingScore };
}

async function importRecords(userId, event) {
  const deviceId = trimString(event.deviceId, 128);
  if (!deviceId) throw createError('DEVICE_ID_REQUIRED', '缺少本地设备编号');
  const inputs = Array.isArray(event.records) ? event.records.slice(0, MAX_IMPORT_RECORDS) : [];
  const source = event.source === 'capture' ? 'capture' : 'guest-import';
  const profileCache = {};
  const affectedProfiles = {};
  const profileCacheById = {};
  const mappings = [];
  const rejected = [];
  let importedCount = 0;
  let alreadySyncedCount = 0;

  for (const input of inputs) {
    const record = normalizeRecord(input);
    if (record.error) {
      rejected.push({
        localRecordId: trimString(input && (input.clientRecordId || input.recordId), 128),
        reason: record.error,
      });
      continue;
    }

    const clientRecordKey = `${deviceId}:${record.clientRecordId}`;
    const existing = await findExistingEncounter(userId, clientRecordKey);
    if (existing) {
      alreadySyncedCount += 1;
      const mergedExistingMedia = await mergeExistingEncounterMedia(existing, record);
      const mergedExisting = await mergeExistingEncounterScore(mergedExistingMedia, record);
      // 历史客户端会把缺省状态规范化成 public，不能让普通导入覆盖用户已经
      // 设置的 private；公开/私密切换统一通过 set-cat-visibility 操作完成。
      if (record.visibility === 'private') {
        await updateProfileVisibility(existing.catProfileId, record.visibility);
      }
      await ensureRewardLedgerEntry(userId, mergedExisting, source);
      await settleEncounterCanUsage(userId, mergedExisting);
      if (existing.catProfileId) {
        affectedProfiles[existing.catProfileId] = true;
        profileCacheById[existing.catProfileId] = { _id: existing.catProfileId };
      }
      mappings.push({
        localRecordId: record.clientRecordId,
        encounterId: mergedExisting._id,
        catProfileId: mergedExisting.catProfileId || null,
        catalogCatId: mergedExisting.catalogCatId || record.catalogCatId,
        alreadyExisted: true,
      });
      continue;
    }

    const profile = await getOrCreateProfile(userId, record, profileCache);
    if (record.visibility === 'private') {
      await updateProfileVisibility(profile._id, record.visibility);
    }
    affectedProfiles[profile._id] = true;
    profileCacheById[profile._id] = profile;
    const encounterId = await createEncounter(
      userId,
      deviceId,
      clientRecordKey,
      record,
      profile,
      source
    );
    await ensureRewardLedgerEntry(userId, {
      _id: encounterId,
      ...record,
      clientRecordKey,
      catProfileId: profile._id,
    }, source);
    await settleEncounterCanUsage(userId, {
      _id: encounterId,
      ...record,
      clientRecordKey,
      catProfileId: profile._id,
    });
    importedCount += 1;
    mappings.push({
      localRecordId: record.clientRecordId,
      encounterId,
      catProfileId: profile._id,
      catalogCatId: record.catalogCatId,
      alreadyExisted: false,
    });
  }

  await updateProfilesAfterImport(
    userId,
    affectedProfiles,
    profileCacheById
  );
  const stats = await updateUserStats(userId);

  return {
    ok: true,
    importedCount,
    alreadySyncedCount,
    rejected,
    mappings,
    stats,
  };
}

async function claimGuestRecords(userId, event) {
  const deviceId = trimString(event.deviceId, 128);
  const guestToken = normalizeGuestToken(event.guestToken);
  if (!deviceId) throw createError('DEVICE_ID_REQUIRED', '缺少本地设备编号');
  if (!guestToken) throw createError('GUEST_TOKEN_REQUIRED', '匿名记录凭证不可用');

  const guestTokenHash = hashGuestToken(guestToken);
  const result = await safeGet(db.collection(GUEST_ENCOUNTERS_COLLECTION)
    .where({
      guestTokenHash,
      clientDeviceId: deviceId,
      status: 'pending',
    })
    .limit(MAX_IMPORT_RECORDS)
  );
  const now = Date.now();
  const documents = Array.isArray(result.data) ? result.data : [];
  const pending = documents.filter(item => (
    item
    && item.record
    && (!item.expiresAt || getDateTimestamp(item.expiresAt) > now)
  ));
  const expired = documents.filter(item => (
    item
    && item.expiresAt
    && getDateTimestamp(item.expiresAt) <= now
  ));

  await Promise.all(expired.filter(item => item._id).map(item => (
    db.collection(GUEST_ENCOUNTERS_COLLECTION).doc(item._id).update({
      data: {
        status: 'expired',
        updatedAt: db.serverDate(),
      },
    }).catch(() => null)
  )));

  if (!pending.length) {
    return {
      ok: true,
      claimedCount: 0,
      importedCount: 0,
      alreadySyncedCount: 0,
      rejected: [],
      mappings: [],
    };
  }

  const imported = await importRecords(userId, {
    deviceId,
    source: 'guest-import',
    records: pending.map(item => item.record),
  });
  const mappingByLocalId = (imported.mappings || []).reduce((map, mapping) => {
    const localRecordId = trimString(mapping && mapping.localRecordId, 128);
    if (localRecordId) map[localRecordId] = mapping;
    return map;
  }, {});
  const rejectedByLocalId = (imported.rejected || []).reduce((map, item) => {
    const localRecordId = trimString(item && item.localRecordId, 128);
    if (localRecordId) map[localRecordId] = item.reason || '记录校验失败';
    return map;
  }, {});
  let claimedCount = 0;

  await Promise.all(pending.map(async item => {
    if (!item || !item._id) return;
    const localRecordId = trimString(
      item.clientRecordId || item.record && item.record.clientRecordId,
      128,
    );
    const mapping = mappingByLocalId[localRecordId];
    if (mapping) {
      await db.collection(GUEST_ENCOUNTERS_COLLECTION).doc(item._id).update({
        data: {
          status: 'claimed',
          encounterId: mapping.encounterId || null,
          claimedByOpenId: userId,
          claimedAt: db.serverDate(),
          updatedAt: db.serverDate(),
        },
      });
      claimedCount += 1;
      return;
    }

    if (rejectedByLocalId[localRecordId]) {
      await db.collection(GUEST_ENCOUNTERS_COLLECTION).doc(item._id).update({
        data: {
          status: 'rejected',
          rejectReason: trimString(rejectedByLocalId[localRecordId], 240),
          updatedAt: db.serverDate(),
        },
      });
    }
  }));

  return {
    ok: true,
    claimedCount,
    importedCount: imported.importedCount || 0,
    alreadySyncedCount: imported.alreadySyncedCount || 0,
    rejected: imported.rejected || [],
    mappings: imported.mappings || [],
  };
}

async function findPosterEncounter(userId, deviceId, sourceRecordId, catalogCatId) {
  const normalizedDeviceId = trimString(deviceId, 128);
  const normalizedRecordId = trimString(sourceRecordId, 128);
  const normalizedCatId = normalizeCatalogCatId(catalogCatId);
  if (!normalizedRecordId || !normalizedCatId) return null;

  if (normalizedDeviceId) {
    const byDevice = await findExistingEncounter(
      userId,
      `${normalizedDeviceId}:${normalizedRecordId}`,
    );
    if (byDevice && byDevice.catalogCatId === normalizedCatId) return byDevice;
  }

  const result = await safeGet(db.collection(ENCOUNTERS_COLLECTION)
    .where({
      ownerOpenId: userId,
      clientRecordId: normalizedRecordId,
      catalogCatId: normalizedCatId,
      status: 'active',
    })
    .limit(1)
  );
  return result && Array.isArray(result.data) ? result.data[0] || null : null;
}

async function savePosterResult(userId, event) {
  const catalogCatId = normalizeCatalogCatId(event.catalogCatId);
  const sourceRecordId = trimString(event.sourceRecordId || event.clientRecordId, 128);
  const posterResult = normalizePosterResult(event.posterResult);
  if (!catalogCatId || !sourceRecordId || !posterResult) {
    throw createError('POSTER_RESULT_INVALID', '海报结果数据不完整');
  }
  if (
    posterResult.sourceArchiveId !== catalogCatId
    || posterResult.sourceRecordId !== sourceRecordId
  ) {
    throw createError('POSTER_RESULT_SOURCE_MISMATCH', '海报结果来源校验失败');
  }
  if (posterResult.status !== 'ready') {
    throw createError('POSTER_RESULT_NOT_READY', '只能保存已完成的海报结果');
  }
  if (!posterResult.posterImage || !posterResult.posterImage.fileID) {
    throw createError('POSTER_IMAGE_FILE_REQUIRED', '海报成品尚未上传完成');
  }

  const encounter = await findPosterEncounter(
    userId,
    event.deviceId,
    sourceRecordId,
    catalogCatId,
  );
  if (!encounter || !encounter._id) {
    // 生成可能发生在首次档案导入之前；本地结果会继续保留，下一次生成或同步时重试。
    return {
      ok: true,
      saved: false,
      reason: 'POSTER_SOURCE_NOT_SYNCED',
      sourceRecordId,
      catalogCatId,
    };
  }

  const media = encounter.media && typeof encounter.media === 'object'
    ? encounter.media
    : {};
  const existingPosterFileID = media.posterResult
    && media.posterResult.posterImage
    && trimString(media.posterResult.posterImage.fileID, 512);
  const incomingPosterFileID = trimString(posterResult.posterImage.fileID, 512);
  const nextMedia = {
    ...media,
    posterResult,
  };
  const coverImage = posterResult.coverImage && typeof posterResult.coverImage === 'object'
    ? posterResult.coverImage
    : null;
  const coverFileID = coverImage && trimString(coverImage.fileID, 512);
  const coverStatus = trimString(
    (coverImage && coverImage.status) || posterResult.coverStatus,
    20,
  );
  // posterResult 是派生快照，但封面 fileID 也同步落在 media 顶层，方便列表、
  // 分享和后续迁移直接判断“是否已有猫生图”，不必依赖临时 URL。
  if (coverFileID && coverStatus === 'ready') {
    Object.assign(nextMedia, {
      coverFileID,
      coverContentType: trimString(coverImage.contentType, 64),
      coverProvider: trimString(coverImage.provider, 80),
      coverModel: trimString(coverImage.model, 160),
      coverOperation: trimString(coverImage.operation, 120),
      coverPromptVersion: trimString(coverImage.promptVersion, 120),
      coverTargetRatio: trimString(coverImage.targetRatio, 20),
      coverStatus: 'ready',
      coverRequestId: trimString(coverImage.requestId, 160),
      coverCreatedAt: trimString(coverImage.createdAt, 80),
      coverRejectReason: '',
    });
  }
  if (
    existingPosterFileID
    && existingPosterFileID === incomingPosterFileID
    && JSON.stringify(nextMedia) === JSON.stringify(media)
  ) {
    return { ok: true, saved: true, reused: true, posterResult: media.posterResult };
  }
  // CloudBase 的普通 update 会对对象做深层合并：当历史数据里的
  // media.posterResult 是 null 时，写入 posterResult.archiveCode 会被
  // 解释成“在 null 上创建子字段”，最终触发 -502001。用 set 命令
  // 明确替换整个 media 字段，兼容 null 和旧版本的海报快照。
  const mediaUpdate = db.command && typeof db.command.set === 'function'
    ? db.command.set(nextMedia)
    : nextMedia;
  await db.collection(ENCOUNTERS_COLLECTION).doc(encounter._id).update({
    data: {
      // 仅替换 media 中的派生 posterResult，保留原图、主体图和既有封面字段。
      media: mediaUpdate,
      updatedAt: db.serverDate(),
    },
  });

  return {
    ok: true,
    saved: true,
    encounterId: encounter._id,
    sourceRecordId,
    catalogCatId,
    posterResult,
  };
}

async function deleteCatalogArchive(userId, catalogCatId) {
  const normalizedCatId = normalizeCatalogCatId(catalogCatId);
  if (!normalizedCatId) throw createError('CATALOG_CAT_ID_REQUIRED', '缺少猫卡角色编号');

  const now = db.serverDate();
  const encounterResult = await db.collection(ENCOUNTERS_COLLECTION)
    .where({
      ownerOpenId: userId,
      catalogCatId: normalizedCatId,
      status: 'active',
    })
    .update({
      data: {
        status: 'deleted',
        deletedAt: now,
        updatedAt: now,
      },
    });
  const profileResult = await db.collection(PROFILES_COLLECTION)
    .where({
      ownerOpenId: userId,
      catalogCatId: normalizedCatId,
      status: 'active',
    })
    .update({
      data: {
        status: 'deleted',
        deletedAt: now,
        updatedAt: now,
      },
    });
  const stats = await updateUserStats(userId);

  return {
    ok: true,
    deletedEncounterCount: encounterResult && encounterResult.stats
      ? encounterResult.stats.updated || 0
      : 0,
    deletedProfileCount: profileResult && profileResult.stats
      ? profileResult.stats.updated || 0
      : 0,
    stats,
  };
}

async function setCatVisibility(userId, event) {
  const catalogCatId = normalizeCatalogCatId(event && event.catalogCatId);
  const visibility = normalizeVisibility(event && event.visibility);
  if (!catalogCatId) throw createError('CATALOG_CAT_ID_REQUIRED', '缺少猫卡角色编号');
  if (!visibility) throw createError('VISIBILITY_INVALID', '猫卡公开状态无效');

  const profile = await findProfile(userId, catalogCatId);
  if (!profile || !profile._id) {
    throw createError('CAT_PROFILE_NOT_FOUND', '猫卡档案还未同步完成');
  }

  await db.collection(PROFILES_COLLECTION).doc(profile._id).update({
    data: {
      visibility,
      updatedAt: db.serverDate(),
    },
  });
  return { ok: true, catalogCatId, visibility };
}

exports.main = async (event = {}) => {
  const action = event.action || 'import';
  // 未绑定账号时只允许写入不带 ownerOpenId 的匿名临时集合，不创建 users 关系。
  if (action === 'stage-guest-records') {
    getOpenId();
    return stageGuestRecords(event);
  }

  const userId = getOpenId();
  await ensureUser(userId);

  if (action === 'import') return importRecords(userId, event);
  if (action === 'claim-guest-records') return claimGuestRecords(userId, event);
  if (action === 'pull') {
    const snapshot = await getSnapshot(userId);
    return { ok: true, ...snapshot };
  }
  if (action === 'save-poster-result') return savePosterResult(userId, event);
  if (action === 'get-poster-result') {
    const encounter = await findPosterEncounter(userId, event.deviceId, event.sourceRecordId, event.catalogCatId);
    return { ok: true, posterResult: encounter && encounter.media && encounter.media.posterResult || null };
  }
  if (action === 'delete-catalog-archive') {
    return deleteCatalogArchive(userId, event.catalogCatId);
  }
  if (action === 'set-cat-visibility') return setCatVisibility(userId, event);
  throw createError('INVALID_ACTION', '不支持的数据同步操作');
};
