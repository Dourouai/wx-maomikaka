const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
  timeout: 30000,
});

const db = cloud.database();
const SHARES_COLLECTION = 'cat_shares';
const PROFILES_COLLECTION = 'cat_profiles';
const ENCOUNTERS_COLLECTION = 'encounters';
const DATA_SCHEMA_VERSION = 1;
const MAX_RECORDS = 50;
const MAX_SHARE_ID_LENGTH = 96;
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
    if (isDocumentMissing(error)) return { data: [] };
    throw error;
  }
}

async function getShare(shareId) {
  try {
    const response = await db.collection(SHARES_COLLECTION).doc(shareId).get();
    return response && response.data ? response.data : null;
  } catch (error) {
    if (isDocumentMissing(error)) return null;
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

function normalizeShareId(value) {
  const id = trimString(value, MAX_SHARE_ID_LENGTH);
  return /^[A-Za-z0-9_-]{16,96}$/.test(id) ? id : '';
}

function createShareId() {
  return `catshare_${crypto.randomBytes(18).toString('hex')}`;
}

function normalizeDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const now = Date.now();
  const min = now - 10 * 365 * 24 * 60 * 60 * 1000;
  const max = now + 5 * 60 * 1000;
  return new Date(Math.max(min, Math.min(max, date.getTime()))).toISOString();
}

function normalizeEvidence(value) {
  if (!value || typeof value !== 'object') return null;
  const result = {};
  VALID_EVIDENCE_GROUPS.forEach(group => {
    const source = value[group];
    if (!source || typeof source !== 'object') return;
    const next = {};
    Object.keys(source).slice(0, 8).forEach(key => {
      const score = clampNumber(source[key], 0, 100);
      if (score !== null) next[trimString(key, 40)] = Math.round(score);
    });
    if (Object.keys(next).length) result[group] = next;
  });
  return Object.keys(result).length ? result : null;
}

function normalizeCoverage(value) {
  if (!value || typeof value !== 'object') return null;
  const result = {};
  Object.keys(value).slice(0, 12).forEach(key => {
    const item = value[key];
    const normalizedKey = trimString(key, 40);
    if (!normalizedKey) return;
    if (typeof item === 'boolean') result[normalizedKey] = item;
    else if (typeof item === 'string') result[normalizedKey] = trimString(item, 80);
    else if (Number.isFinite(Number(item))) result[normalizedKey] = Number(item);
  });
  return Object.keys(result).length ? result : null;
}

function normalizeMedia(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    originalFileID: trimString(source.originalFileID, 512),
    cutoutFileID: trimString(source.cutoutFileID, 512),
    cutoutContentType: trimString(source.cutoutContentType, 64),
    cutoutProvider: trimString(source.cutoutProvider, 80),
    cutoutOperation: trimString(source.cutoutOperation, 120),
    cutoutRequestId: trimString(source.cutoutRequestId, 160),
    cutoutCheckerboardRemoved: source.cutoutCheckerboardRemoved === true,
  };
}

function getArchiveFileIDs(archive) {
  const fileIDs = [];
  const seen = new Set();
  const records = archive && Array.isArray(archive.records) ? archive.records : [];
  records.forEach(record => {
    const media = record && record.media && typeof record.media === 'object'
      ? record.media
      : {};
    [media.cutoutFileID, media.originalFileID].forEach(value => {
      const fileID = trimString(value, 512);
      if (!fileID || seen.has(fileID)) return;
      seen.add(fileID);
      fileIDs.push(fileID);
    });
  });
  return fileIDs;
}

async function getTempURLMap(fileIDs) {
  if (!fileIDs.length || typeof cloud.getTempFileURL !== 'function') return {};

  const urlMap = {};
  // CloudBase 单次最多换取 50 个 fileID，按批次处理，避免长档案超限。
  for (let index = 0; index < fileIDs.length; index += 50) {
    const batch = fileIDs.slice(index, index + 50);
    try {
      const response = await cloud.getTempFileURL({ fileList: batch });
      const result = response && Array.isArray(response.fileList) ? response.fileList : [];
      result.forEach(item => {
        const fileID = trimString(item && item.fileID, 512);
        const url = trimString(item && (item.tempFileURL || item.tempFileUrl), 2048);
        if (fileID && url) urlMap[fileID] = url;
      });
    } catch (error) {
      // 分享快照仍然可以返回；客户端会尝试用 fileID 再换一次临时地址。
      console.warn('[cat-archive-share] 获取分享图片临时地址失败:', error);
    }
  }
  return urlMap;
}

async function hydrateArchiveMedia(archive) {
  const fileIDs = getArchiveFileIDs(archive);
  const urlMap = await getTempURLMap(fileIDs);
  if (!Object.keys(urlMap).length) return archive;

  return {
    ...archive,
    records: archive.records.map(record => {
      const media = record && record.media && typeof record.media === 'object'
        ? record.media
        : {};
      return {
        ...record,
        media: {
          ...media,
          cutoutTempURL: urlMap[media.cutoutFileID] || '',
          originalTempURL: urlMap[media.originalFileID] || '',
        },
      };
    }),
  };
}

function normalizeScore(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    levelCode: trimString(source.levelCode, 20),
    levelLabel: trimString(source.levelLabel, 40),
    levelShortLabel: trimString(source.levelShortLabel, 80),
    charmScore: clampNumber(source.charmScore, 0, 100),
    clevernessScore: clampNumber(source.clevernessScore, 0, 100),
    auraScore: clampNumber(source.auraScore, 0, 100),
    rarityScore: clampNumber(source.rarityScore, 0, 100),
    fateScore: clampNumber(source.fateScore, 0, 100),
    overallScore: clampNumber(source.overallScore, 0, 100),
    pawReward: clampNumber(source.pawReward, 0, 100000) || 0,
    pointReward: clampNumber(source.pointReward, 0, 100000),
    scorePending: source.scorePending === true,
    scoreSource: trimString(source.scoreSource, 100),
    scoreVersion: trimString(source.scoreVersion, 100),
    scoreEvidence: normalizeEvidence(source.scoreEvidence),
    scoreCoverage: normalizeCoverage(source.scoreCoverage),
  };
}

function normalizeObservation(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    breed: trimString(source.breed, 80),
    breedConfidence: clampNumber(source.breedConfidence, 0, 1),
    traits: Array.isArray(source.traits)
      ? source.traits.slice(0, 6).map(trait => trimString(trait, 40)).filter(Boolean)
      : [],
    catCount: Math.max(1, Math.min(10, Math.round(Number(source.catCount) || 1))),
    source: trimString(source.source, 100),
  };
}

function normalizeRecord(input, fallbackCatId) {
  const source = input && typeof input === 'object' ? input : {};
  const display = source.display && typeof source.display === 'object' ? source.display : {};
  const catalogCatId = normalizeCatalogCatId(source.catalogCatId || fallbackCatId);
  const localRecordId = trimString(
    source.clientRecordId || source.localRecordId || source.recordId || source.encounterId,
    128
  );
  if (!catalogCatId || !localRecordId) return null;

  return {
    localRecordId,
    catalogCatId,
    display: {
      name: trimString(display.name || source.catName, 40),
      description: trimString(display.description || source.catDescription, 240),
      copyVersion: trimString(display.copyVersion || source.copyVersion, 80),
    },
    media: normalizeMedia(source.media || {
      originalFileID: source.originalFileID,
      cutoutFileID: source.cutoutFileID,
    }),
    observation: normalizeObservation(source.observation || {
      breed: source.detectedBreed,
      breedConfidence: source.breedConfidence,
      traits: source.detectedTraits,
      catCount: source.catCount,
      source: source.detectionSource,
    }),
    score: normalizeScore(source.score || source),
    createdAt: normalizeDate(source.createdAt || source.capturedAt) || new Date().toISOString(),
    capturedAt: normalizeDate(source.capturedAt || source.createdAt),
  };
}

function normalizeProfile(value, records) {
  const source = value && typeof value === 'object' ? value : {};
  const latest = records[0] || {};
  const latestDisplay = latest.display || {};
  const latestObservation = latest.observation || {};
  const traits = Array.isArray(source.traits) && source.traits.length
    ? source.traits
    : latestObservation.traits;

  return {
    name: trimString(source.name || source.displayName || latestDisplay.name, 40),
    description: trimString(
      source.description || source.displayDescription || latestDisplay.description,
      240
    ),
    breed: trimString(source.breed || latestObservation.breed, 80),
    traits: Array.isArray(traits)
      ? traits.slice(0, 6).map(trait => trimString(trait, 40)).filter(Boolean)
      : [],
  };
}

function normalizeArchive(input) {
  const source = input && typeof input === 'object' ? input : {};
  const catalogCatId = normalizeCatalogCatId(source.catalogCatId || source.catId);
  if (!catalogCatId) throw createError('CATALOG_CAT_ID_REQUIRED', '缺少图鉴角色编号');

  const rawRecords = Array.isArray(source.records) ? source.records.slice(0, MAX_RECORDS) : [];
  const records = rawRecords.map(record => normalizeRecord(record, catalogCatId)).filter(Boolean);
  if (!records.length) throw createError('SHARE_ARCHIVE_EMPTY', '这只猫还没有可分享的相遇记录');

  records.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const recordIds = new Set(records.map(record => record.localRecordId));
  const requestedFeaturedId = trimString(source.featuredRecordId, 128);
  const featuredRecordId = recordIds.has(requestedFeaturedId)
    ? requestedFeaturedId
    : records[0].localRecordId;

  return {
    catalogCatId,
    featuredRecordId,
    profile: normalizeProfile(source.profile || source.display, records),
    records,
  };
}

function toArchiveRecord(encounter) {
  return {
    localRecordId: encounter.clientRecordId || encounter._id,
    catalogCatId: encounter.catalogCatId,
    display: encounter.display || {},
    media: encounter.media || {},
    observation: encounter.observation || {},
    score: encounter.score || {},
    createdAt: encounter.createdAt || encounter.capturedAt,
    capturedAt: encounter.capturedAt || encounter.createdAt,
  };
}

async function loadOwnerArchive(userId, catalogCatId) {
  const [profileResult, encounterResult] = await Promise.all([
    safeGet(db.collection(PROFILES_COLLECTION)
      .where({ ownerOpenId: userId, catalogCatId, status: 'active' })
      .limit(1)
    ),
    safeGet(db.collection(ENCOUNTERS_COLLECTION)
      .where({ ownerOpenId: userId, catalogCatId, status: 'active' })
      .limit(MAX_RECORDS)
    ),
  ]);
  const profile = profileResult && Array.isArray(profileResult.data)
    ? profileResult.data[0] || null
    : null;
  const encounters = encounterResult && Array.isArray(encounterResult.data)
    ? encounterResult.data
    : [];
  if (!encounters.length) return null;

  encounters.sort((left, right) => {
    const leftTime = Date.parse(String(left.createdAt || left.capturedAt || '')) || 0;
    const rightTime = Date.parse(String(right.createdAt || right.capturedAt || '')) || 0;
    return rightTime - leftTime;
  });

  return normalizeArchive({
    catalogCatId,
    profile: profile
      ? {
        name: profile.displayName,
        description: profile.displayDescription,
      }
      : null,
    records: encounters.map(toArchiveRecord),
  });
}

async function createShare(event) {
  const ownerOpenId = getOpenId();
  const requestedCatId = normalizeCatalogCatId(
    event && event.catalogCatId
      ? event.catalogCatId
      : event && event.archive && (event.archive.catalogCatId || event.archive.catId)
  );
  if (!requestedCatId) throw createError('CATALOG_CAT_ID_REQUIRED', '缺少图鉴角色编号');

  let archive = null;
  if (event && event.archive) {
    archive = normalizeArchive({ ...event.archive, catalogCatId: requestedCatId });
  }
  if (!archive) archive = await loadOwnerArchive(ownerOpenId, requestedCatId);
  if (!archive) throw createError('SHARE_ARCHIVE_EMPTY', '这只猫还没有可分享的相遇记录');

  const shareId = normalizeShareId(event && event.shareId) || createShareId();
  const existing = await getShare(shareId);
  if (existing && existing.ownerOpenId && existing.ownerOpenId !== ownerOpenId) {
    throw createError('SHARE_ID_CONFLICT', '分享链接暂时不可用，请重新打开档案后再试');
  }

  await db.collection(SHARES_COLLECTION).doc(shareId).set({
    data: {
      schemaVersion: DATA_SCHEMA_VERSION,
      ownerOpenId,
      catalogCatId: requestedCatId,
      archive,
      status: 'active',
      createdAt: existing && existing.createdAt ? existing.createdAt : db.serverDate(),
      updatedAt: db.serverDate(),
      lastSharedAt: db.serverDate(),
    },
  });

  return {
    ok: true,
    shareId,
    archive,
  };
}

async function readShare(event) {
  const shareId = normalizeShareId(event && event.shareId);
  if (!shareId) throw createError('SHARE_ID_REQUIRED', '分享链接无效');

  const share = await getShare(shareId);
  if (!share || share.status !== 'active' || !share.archive) {
    throw createError('SHARE_NOT_FOUND', '这份猫咪档案已失效');
  }

  const archive = await hydrateArchiveMedia(share.archive);

  return {
    ok: true,
    shareId,
    archive,
  };
}

exports.main = async (event = {}) => {
  const action = event.action || 'get';
  if (action === 'create') return createShare(event);
  if (action === 'get') return readShare(event);
  throw createError('INVALID_ACTION', '不支持的档案分享操作');
};
