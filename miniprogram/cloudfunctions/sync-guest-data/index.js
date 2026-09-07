const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
  // 首次绑定会按小批次写入相遇、猫卡和奖励流水，给云端事务留出余量。
  timeout: 60000,
});

const db = cloud.database();
const USERS_COLLECTION = 'users';
const PROFILES_COLLECTION = 'cat_profiles';
const ENCOUNTERS_COLLECTION = 'encounters';
const REWARD_LEDGER_COLLECTION = 'user_reward_ledger';
const USER_SCHEMA_VERSION = 1;
const DATA_SCHEMA_VERSION = 1;
const REWARD_SCHEMA_VERSION = 1;
const POSTER_RESULT_SCHEMA_VERSION = 1;
const MAX_IMPORT_RECORDS = 20;
const MAX_QUERY_RECORDS = 1000;
const VALID_EVIDENCE_GROUPS = ['charm', 'cleverness', 'aura'];
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

  return {
    clientRecordId,
    captureId: trimString(source.captureId, 128),
    catalogCatId,
    archiveCode: normalizeArchiveCode(source.archiveCode),
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
          stats: { totalPhotos: 0, unlockedCount: 0, pawGrowth: 0, pointBalance: 0 },
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

async function updateProfilesAfterImport(profileCounts, profileLatestRecords, profileLocationStats, profileCache) {
  await Promise.all(Object.keys(profileCounts).map(async profileId => {
    const latest = profileLatestRecords[profileId];
    const profile = profileCache[profileId] || {};
    const existingSummary = normalizeLocationSummary(profile.locationSummary);
    const incoming = profileLocationStats[profileId] || {
      count: 0,
      first: null,
      latest: null,
    };
    const data = {
      updatedAt: db.serverDate(),
      lastSeenAt: latest && latest.createdAt ? latest.createdAt : db.serverDate(),
      locationSummary: {
        firstLocation: chooseEarlierLocation(existingSummary.firstLocation, incoming.first),
        latestLocation: chooseLaterLocation(existingSummary.latestLocation, incoming.latest),
        locationCount: existingSummary.locationCount + incoming.count,
      },
    };
    const increment = db.command && db.command.inc;
    if (increment) data.encounterCount = increment(profileCounts[profileId]);
    else data.encounterCount = (Number(profile.encounterCount) || 0) + profileCounts[profileId];
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
  const stats = await calculateStats(userId);
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

async function importRecords(userId, event) {
  const deviceId = trimString(event.deviceId, 128);
  if (!deviceId) throw createError('DEVICE_ID_REQUIRED', '缺少本地设备编号');
  const inputs = Array.isArray(event.records) ? event.records.slice(0, MAX_IMPORT_RECORDS) : [];
  const source = event.source === 'capture' ? 'capture' : 'guest-import';
  const profileCache = {};
  const profileCounts = {};
  const profileLatestRecords = {};
  const profileLocationStats = {};
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
      await ensureRewardLedgerEntry(userId, existing, source);
      mappings.push({
        localRecordId: record.clientRecordId,
        encounterId: existing._id,
        catProfileId: existing.catProfileId || null,
        catalogCatId: existing.catalogCatId || record.catalogCatId,
        alreadyExisted: true,
      });
      continue;
    }

    const profile = await getOrCreateProfile(userId, record, profileCache);
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
    importedCount += 1;
    profileCounts[profile._id] = (profileCounts[profile._id] || 0) + 1;
    profileLatestRecords[profile._id] = profileLatestRecords[profile._id]
      && profileLatestRecords[profile._id].createdAt
      && record.createdAt
      && profileLatestRecords[profile._id].createdAt > record.createdAt
      ? profileLatestRecords[profile._id]
      : record;
    if (record.location) {
      const locationStats = profileLocationStats[profile._id] || {
        count: 0,
        first: null,
        latest: null,
      };
      locationStats.count += 1;
      if (!locationStats.first || (
        record.createdAt
        && locationStats.first.createdAt
        && record.createdAt < locationStats.first.createdAt
      )) {
        locationStats.first = record;
      }
      if (!locationStats.latest || (
        record.createdAt
        && locationStats.latest.createdAt
        && record.createdAt >= locationStats.latest.createdAt
      )) {
        locationStats.latest = record;
      }
      profileLocationStats[profile._id] = locationStats;
    }
    mappings.push({
      localRecordId: record.clientRecordId,
      encounterId,
      catProfileId: profile._id,
      catalogCatId: record.catalogCatId,
      alreadyExisted: false,
    });
  }

  await updateProfilesAfterImport(
    profileCounts,
    profileLatestRecords,
    profileLocationStats,
    profileCache
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
  if (media.posterResult && media.posterResult.posterImage && media.posterResult.posterImage.fileID) {
    return { ok: true, saved: true, reused: true, posterResult: media.posterResult };
  }
  await db.collection(ENCOUNTERS_COLLECTION).doc(encounter._id).update({
    data: {
      // 仅替换 media 中的派生 posterResult，保留原图、主体图和既有封面字段。
      media: {
        ...media,
        posterResult,
      },
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

exports.main = async (event = {}) => {
  const userId = getOpenId();
  await ensureUser(userId);

  const action = event.action || 'import';
  if (action === 'import') return importRecords(userId, event);
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
  throw createError('INVALID_ACTION', '不支持的数据同步操作');
};
