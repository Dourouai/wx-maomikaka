const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
  timeout: 60000,
});

const db = cloud.database();
const SHARES_COLLECTION = 'cat_shares';
const PROFILES_COLLECTION = 'cat_profiles';
const ENCOUNTERS_COLLECTION = 'encounters';
const DATA_SCHEMA_VERSION = 1;
const MAX_RECORDS = 50;
const MAX_CLEANUP_PAGE_SIZE = 1000;
const MAX_SHARE_ID_LENGTH = 96;
const VALID_EVIDENCE_GROUPS = ['charm', 'cleverness', 'aura'];
const ARCHIVE_CODE_PATTERN = /^\d{8}[0-9A-Z]{6}$/;
const POSTER_MEDIA_FIELDS = [
  'coverFileID',
  'coverPhotoPath',
  'coverTempURL',
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
  'posterResult',
];

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

async function getAllOwnedDocuments(collectionName, ownerOpenId) {
  const documents = [];
  let offset = 0;

  while (true) {
    let query = db.collection(collectionName)
      .where({ ownerOpenId })
      .limit(MAX_CLEANUP_PAGE_SIZE);
    if (offset > 0) {
      if (typeof query.skip !== 'function') {
        throw createError('POSTER_CLEANUP_QUERY_UNSUPPORTED', '海报清理查询暂不支持分页');
      }
      query = query.skip(offset);
    }

    const response = await safeGet(query);
    const page = response && Array.isArray(response.data) ? response.data : [];
    documents.push(...page);
    if (page.length < MAX_CLEANUP_PAGE_SIZE) return documents;
    offset += page.length;
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

function normalizeSourceType(value) {
  const sourceType = trimString(value, 20).toLowerCase();
  return sourceType === 'live' ? 'live' : 'photo';
}

function normalizeArchiveCode(value) {
  const code = trimString(value, 32).toUpperCase();
  return ARCHIVE_CODE_PATTERN.test(code) ? code : '';
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
    originalContentType: trimString(source.originalContentType, 64),
    cutoutFileID: trimString(source.cutoutFileID, 512),
    cutoutContentType: trimString(source.cutoutContentType, 64),
    cutoutProvider: trimString(source.cutoutProvider, 80),
    cutoutOperation: trimString(source.cutoutOperation, 120),
    cutoutRequestId: trimString(source.cutoutRequestId, 160),
    cutoutCheckerboardRemoved: source.cutoutCheckerboardRemoved === true,
    coverFileID: trimString(source.coverFileID, 512),
    coverContentType: trimString(source.coverContentType, 64),
    coverProvider: trimString(source.coverProvider, 80),
    coverModel: trimString(source.coverModel, 160),
    coverOperation: trimString(source.coverOperation, 120),
    coverPromptVersion: trimString(source.coverPromptVersion, 120),
    coverTargetRatio: trimString(source.coverTargetRatio, 20),
    coverStatus: trimString(source.coverStatus, 20),
    coverRequestId: trimString(source.coverRequestId, 160),
    coverCreatedAt: trimString(source.coverCreatedAt, 80),
    coverRejectReason: trimString(source.coverRejectReason, 240),
  };
}

function addPosterCoverFileID(fileIDs, value) {
  const fileID = trimString(value, 512);
  if (fileID) fileIDs.add(fileID);
}

function collectArchivePosterCoverFileIDs(archive, fileIDs) {
  const records = archive && Array.isArray(archive.records) ? archive.records : [];
  records.forEach(record => {
    const media = record && record.media && typeof record.media === 'object'
      ? record.media
      : {};
    addPosterCoverFileID(fileIDs, media.coverFileID);
    const posterResult = media.posterResult && typeof media.posterResult === 'object'
      ? media.posterResult
      : {};
    const coverImage = posterResult.coverImage && typeof posterResult.coverImage === 'object'
      ? posterResult.coverImage
      : {};
    addPosterCoverFileID(fileIDs, coverImage.fileID);
    const sourceImage = posterResult.sourceImage && typeof posterResult.sourceImage === 'object'
      ? posterResult.sourceImage
      : {};
    if (sourceImage.kind === 'cover') addPosterCoverFileID(fileIDs, sourceImage.fileID);
    addPosterCoverFileID(fileIDs, posterResult.posterImage && posterResult.posterImage.fileID);
  });
}

function hasPosterMediaData(value) {
  const source = value && typeof value === 'object' ? value : {};
  return POSTER_MEDIA_FIELDS.some(field => (
    source[field] !== undefined
    && source[field] !== null
    && String(source[field]).trim() !== ''
  ));
}

function clearPosterMedia(value) {
  const source = value && typeof value === 'object' ? value : {};
  const next = { ...source };
  POSTER_MEDIA_FIELDS.forEach(field => {
    if (Object.prototype.hasOwnProperty.call(next, field)) next[field] = null;
  });
  return next;
}

function getPosterCleanupData(encounter) {
  const source = encounter && typeof encounter === 'object' ? encounter : {};
  const data = {};
  const media = source.media && typeof source.media === 'object' ? source.media : {};

  if (hasPosterMediaData(media)) data.media = clearPosterMedia(media);
  // 兼容早期曾把封面字段写在 encounter 根节点的历史数据。
  POSTER_MEDIA_FIELDS.forEach(field => {
    if (Object.prototype.hasOwnProperty.call(source, field)
      && source[field] !== undefined
      && source[field] !== null
      && String(source[field]).trim() !== '') {
      data[field] = null;
    }
  });
  return Object.keys(data).length ? data : null;
}

function collectEncounterPosterCoverFileIDs(encounter, fileIDs) {
  const source = encounter && typeof encounter === 'object' ? encounter : {};
  const media = source.media && typeof source.media === 'object' ? source.media : {};
  addPosterCoverFileID(fileIDs, media.coverFileID);
  const posterResult = media.posterResult && typeof media.posterResult === 'object'
    ? media.posterResult
    : {};
  const coverImage = posterResult.coverImage && typeof posterResult.coverImage === 'object'
    ? posterResult.coverImage
    : {};
  addPosterCoverFileID(fileIDs, coverImage.fileID);
  addPosterCoverFileID(fileIDs, posterResult.posterImage && posterResult.posterImage.fileID);
  addPosterCoverFileID(fileIDs, source.coverFileID);
}

function getArchiveFileIDs(archive) {
  const fileIDs = [];
  const seen = new Set();
  const records = archive && Array.isArray(archive.records) ? archive.records : [];
  records.forEach(record => {
    const media = record && record.media && typeof record.media === 'object'
      ? record.media
      : {};
    [media.coverFileID, media.cutoutFileID, media.originalFileID].forEach(value => {
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
          coverTempURL: urlMap[media.coverFileID] || '',
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
    archiveCode: normalizeArchiveCode(source.archiveCode),
    sourceType: normalizeSourceType(
      source.sourceType || source.captureSource || source.inputSource,
    ),
    display: {
      name: trimString(display.name || source.catName, 40),
      description: trimString(display.description || source.catDescription, 240),
      posterCopy: trimString(display.posterCopy || source.posterCopy, 52),
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
    posterCopy: trimString(
      source.posterCopy || source.displayPosterCopy || latestDisplay.posterCopy,
      52
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
  if (!catalogCatId) throw createError('CATALOG_CAT_ID_REQUIRED', '缺少猫卡角色编号');

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
    archiveCode: normalizeArchiveCode(source.archiveCode)
      || (records.find(record => record.localRecordId === featuredRecordId) || records[0]).archiveCode
      || '',
    profile: normalizeProfile(source.profile || source.display, records),
    records,
  };
}

function toArchiveRecord(encounter) {
  return {
    localRecordId: encounter.clientRecordId || encounter._id,
    catalogCatId: encounter.catalogCatId,
    archiveCode: normalizeArchiveCode(encounter.archiveCode),
    sourceType: normalizeSourceType(encounter.sourceType),
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
  if (profile && profile.visibility === 'private') {
    throw createError('CAT_ARCHIVE_PRIVATE', '这只猫咪已设为私密');
  }
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
        posterCopy: profile.displayPosterCopy,
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
  if (!requestedCatId) throw createError('CATALOG_CAT_ID_REQUIRED', '缺少猫卡角色编号');

  // 客户端可以带历史 archive 快照，不能让快照绕过当前猫卡的私密状态。
  const profileResult = await safeGet(db.collection(PROFILES_COLLECTION)
    .where({ ownerOpenId, catalogCatId: requestedCatId, status: 'active' })
    .limit(1));
  const currentProfile = profileResult && Array.isArray(profileResult.data)
    ? profileResult.data[0] || null
    : null;
  if (currentProfile && currentProfile.visibility === 'private') {
    throw createError('CAT_ARCHIVE_PRIVATE', '这只猫咪已设为私密');
  }

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

  const profileResult = await safeGet(db.collection(PROFILES_COLLECTION)
    .where({
      ownerOpenId: share.ownerOpenId,
      catalogCatId: share.catalogCatId,
      status: 'active',
    })
    .limit(1));
  const currentProfile = profileResult && Array.isArray(profileResult.data)
    ? profileResult.data[0] || null
    : null;
  if (currentProfile && currentProfile.visibility === 'private') {
    throw createError('CAT_ARCHIVE_PRIVATE', '这只猫咪已设为私密');
  }

  // 分享只授权这份档案；每次读取从所属相遇查询最新海报，避免旧分享快照失效。
  const owned = await safeGet(db.collection(ENCOUNTERS_COLLECTION).where({
    ownerOpenId: share.ownerOpenId, catalogCatId: share.catalogCatId, status: 'active',
  }).limit(MAX_CLEANUP_PAGE_SIZE));
  const records = await Promise.all(share.archive.records.map(async record => {
    const encounter = (owned.data || []).find(item => item.clientRecordId === record.clientRecordId);
    const result = encounter && encounter.media && encounter.media.posterResult;
    const fileID = result && result.posterImage && result.posterImage.fileID;
    const urls = fileID ? await getTempURLMap([fileID]) : {};
    const posterResult = fileID ? {
      name: result.name, copy: result.copy, scores: result.scores,
      levelCode: result.levelCode, sourceArchiveId: result.sourceArchiveId,
      sourceRecordId: result.sourceRecordId, posterImage: { fileID },
      posterTempURL: urls[fileID] || '',
    } : null;
    return { ...record, media: { ...record.media, posterResult } };
  }));
  const archive = await hydrateArchiveMedia({ ...share.archive, records });

  return {
    ok: true,
    shareId,
    archive,
  };
}

async function clearPosterArtifacts() {
  // 兼容旧客户端的防护：猫生图封面和 encounters.media 是正式档案资产，
  // 不能再通过“海报规则升级”接口批量清除。真正需要清理的本机派生缓存
  // 由客户端自行处理，云函数不删除任何分享快照、档案字段或云文件。
  return {
    ok: true,
    skipped: 'PRESERVE_CLOUD_ARCHIVE_ASSETS',
    clearedShareCount: 0,
    clearedEncounterCount: 0,
    coverFileIDs: [],
  };
}

exports.main = async (event = {}) => {
  const action = event.action || 'get';
  if (action === 'create') return createShare(event);
  if (action === 'get') return readShare(event);
  if (action === 'clear-poster-artifacts') return clearPosterArtifacts();
  throw createError('INVALID_ACTION', '不支持的档案分享操作');
};
