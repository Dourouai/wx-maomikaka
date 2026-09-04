const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const USERS_COLLECTION = 'users';
const PROFILES_COLLECTION = 'cat_profiles';
const ENCOUNTERS_COLLECTION = 'encounters';
const USER_SCHEMA_VERSION = 1;
const DATA_SCHEMA_VERSION = 1;
const MAX_IMPORT_RECORDS = 20;
const MAX_QUERY_RECORDS = 1000;
const VALID_EVIDENCE_GROUPS = ['charm', 'cleverness', 'aura'];

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

function normalizeRecord(input) {
  const source = input && typeof input === 'object' ? input : {};
  const clientRecordId = trimString(source.clientRecordId || source.recordId, 128);
  const catalogCatId = normalizeCatalogCatId(source.catalogCatId || source.catId);
  if (!clientRecordId) return { error: '缺少本地记录编号' };
  if (!catalogCatId) return { error: '缺少有效的图鉴角色编号' };

  const display = source.display && typeof source.display === 'object' ? source.display : {};
  const media = source.media && typeof source.media === 'object' ? source.media : {};
  const observation = source.observation && typeof source.observation === 'object'
    ? source.observation
    : {};
  const score = source.score && typeof source.score === 'object' ? source.score : {};
  const createdAt = normalizeDate(source.createdAt || source.capturedAt);
  const capturedAt = toISOString(source.capturedAt || source.createdAt) || (createdAt && createdAt.toISOString());

  return {
    clientRecordId,
    catalogCatId,
    display: {
      name: trimString(display.name || source.catName, 40),
      description: trimString(display.description || source.catDescription, 240),
      copyVersion: trimString(display.copyVersion || source.copyVersion, 80),
    },
    media: {
      originalFileID: trimString(media.originalFileID || source.originalFileID, 512),
      cutoutFileID: trimString(media.cutoutFileID || source.cutoutFileID, 512),
      cutoutContentType: trimString(media.cutoutContentType || source.cutoutContentType, 64),
      cutoutProvider: trimString(media.cutoutProvider || source.cutoutProvider, 80),
      cutoutOperation: trimString(media.cutoutOperation || source.cutoutOperation, 120),
      cutoutRequestId: trimString(media.cutoutRequestId || source.cutoutRequestId, 160),
      cutoutCheckerboardRemoved: media.cutoutCheckerboardRemoved === true
        || source.cutoutCheckerboardRemoved === true,
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
      catCount: Math.max(1, Math.min(10, Math.round(Number(observation.catCount || source.catCount) || 1))),
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
          stats: { totalPhotos: 0, unlockedCount: 0, pawGrowth: 0 },
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
      encounterCount: 0,
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
    encounterCount: 0,
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
      display: record.display,
      media: record.media,
      observation: record.observation,
      score: record.score,
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

async function updateProfilesAfterImport(profileCounts, profileLatestRecords) {
  const increment = db.command && db.command.inc;
  await Promise.all(Object.keys(profileCounts).map(async profileId => {
    const latest = profileLatestRecords[profileId];
    const data = {
      updatedAt: db.serverDate(),
      lastSeenAt: latest && latest.createdAt ? latest.createdAt : db.serverDate(),
    };
    if (increment) data.encounterCount = increment(profileCounts[profileId]);
    else data.encounterCount = profileCounts[profileId];
    if (latest && latest.display) {
      if (latest.display.name) data.displayName = latest.display.name;
      if (latest.display.description) data.displayDescription = latest.display.description;
    }
    await db.collection(PROFILES_COLLECTION).doc(profileId).update({ data });
  }));
}

async function calculateStats(userId) {
  const [encounterResult, profileResult] = await Promise.all([
    safeGet(db.collection(ENCOUNTERS_COLLECTION)
      .where({ ownerOpenId: userId, status: 'active' })
      .limit(MAX_QUERY_RECORDS)
    ),
    safeGet(db.collection(PROFILES_COLLECTION)
      .where({ ownerOpenId: userId, status: 'active' })
      .limit(MAX_QUERY_RECORDS)
    ),
  ]);
  const encounters = encounterResult && Array.isArray(encounterResult.data)
    ? encounterResult.data
    : [];
  const profiles = profileResult && Array.isArray(profileResult.data)
    ? profileResult.data
    : [];
  const lastPhotoTime = encounters.reduce((latest, encounter) => {
    const time = normalizeDate(encounter.createdAt || encounter.capturedAt);
    return time && time.getTime() > latest ? time.getTime() : latest;
  }, 0) || null;
  const pawGrowth = encounters.reduce((total, encounter) => {
    const reward = Number(encounter.score && encounter.score.pawReward);
    return Number.isFinite(reward) && reward > 0 ? total + Math.round(reward) : total;
  }, 0);

  return {
    totalPhotos: encounters.length,
    unlockedCount: profiles.length,
    pawGrowth,
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
  return {
    catProfileId: profile._id,
    catalogCatId: profile.catalogCatId,
    identityStatus: profile.identityStatus || 'catalog-role',
    displayName: profile.displayName || null,
    displayDescription: profile.displayDescription || null,
    encounterCount: Number(profile.encounterCount) || 0,
    firstSeenAt: toISOString(profile.firstSeenAt || profile.createdAt),
    lastSeenAt: toISOString(profile.lastSeenAt || profile.updatedAt),
  };
}

function toClientEncounter(encounter) {
  return {
    encounterId: encounter._id,
    localRecordId: encounter.clientRecordId || null,
    catProfileId: encounter.catProfileId || null,
    catalogCatId: encounter.catalogCatId || '',
    display: encounter.display || {},
    media: encounter.media || {},
    observation: encounter.observation || {},
    score: encounter.score || {},
    createdAt: toISOString(encounter.createdAt || encounter.capturedAt || encounter.importedAt),
    capturedAt: encounter.capturedAt || toISOString(encounter.createdAt),
  };
}

async function getSnapshot(userId) {
  const [profileResult, encounterResult, user] = await Promise.all([
    safeGet(db.collection(PROFILES_COLLECTION)
      .where({ ownerOpenId: userId, status: 'active' })
      .limit(MAX_QUERY_RECORDS)
    ),
    safeGet(db.collection(ENCOUNTERS_COLLECTION)
      .where({ ownerOpenId: userId, status: 'active' })
      .limit(MAX_QUERY_RECORDS)
    ),
    getUser(userId),
  ]);
  const profiles = profileResult && Array.isArray(profileResult.data) ? profileResult.data : [];
  const encounters = encounterResult && Array.isArray(encounterResult.data) ? encounterResult.data : [];
  const stats = user && user.stats ? user.stats : await calculateStats(userId);

  return {
    profiles: profiles.map(toClientProfile),
    encounters: encounters.map(toClientEncounter),
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
    importedCount += 1;
    profileCounts[profile._id] = (profileCounts[profile._id] || 0) + 1;
    profileLatestRecords[profile._id] = profileLatestRecords[profile._id]
      && profileLatestRecords[profile._id].createdAt
      && record.createdAt
      && profileLatestRecords[profile._id].createdAt > record.createdAt
      ? profileLatestRecords[profile._id]
      : record;
    mappings.push({
      localRecordId: record.clientRecordId,
      encounterId,
      catProfileId: profile._id,
      catalogCatId: record.catalogCatId,
      alreadyExisted: false,
    });
  }

  await updateProfilesAfterImport(profileCounts, profileLatestRecords);
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

async function deleteCatalogArchive(userId, catalogCatId) {
  const normalizedCatId = normalizeCatalogCatId(catalogCatId);
  if (!normalizedCatId) throw createError('CATALOG_CAT_ID_REQUIRED', '缺少图鉴角色编号');

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
  if (action === 'delete-catalog-archive') {
    return deleteCatalogArchive(userId, event.catalogCatId);
  }
  throw createError('INVALID_ACTION', '不支持的数据同步操作');
};
