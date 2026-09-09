const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
  timeout: 60000,
});

const db = cloud.database();
const PROFILES_COLLECTION = 'cat_profiles';
const ENCOUNTERS_COLLECTION = 'encounters';
const PAGE_SIZE = 1000;
const MAX_PROFILES = 1000;
const MAX_ENCOUNTERS = 3000;
const MAX_PUBLIC_DETAIL_RECORDS = 50;
const PUBLIC_PAGE_SIZE = 12;
const ARCHIVE_CODE_PATTERN = /^\d{8}[0-9A-Z]{6}$/;
const RELEASED_STATUS_CODES = new Set(['release', 'released', 'deleted', 'removed', '放生', '放归']);
const LEVELS = {
  C: { label: '街角', shortLabel: '街角常客' },
  U: { label: '偶见', shortLabel: '偶尔现身' },
  R: { label: '稀遇', shortLabel: '难得一见' },
  SR: { label: '惊鸿', shortLabel: '一瞬难忘' },
  UR: { label: '神隐', shortLabel: '城市传闻' },
};

function createError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function trimString(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function hasReleaseMarker(value) {
  const source = value && typeof value === 'object' ? value : {};
  const statuses = [
    source.status,
    source.lifecycleStatus,
    source.archiveStatus,
    source.catStatus,
  ].map(status => trimString(status, 32).toLowerCase());
  if (statuses.some(status => RELEASED_STATUS_CODES.has(status))) return true;
  if (source.released === true || source.isReleased === true || source.isReleasedArchive === true) {
    return true;
  }
  return Boolean(source.releasedAt || source.releaseAt || source.deletedAt);
}

function isPublicActiveProfile(profile) {
  return Boolean(
    profile
      && profile.status === 'active'
      && profile.visibility !== 'private'
      && !hasReleaseMarker(profile),
  );
}

function isActiveEncounter(encounter) {
  return Boolean(encounter && encounter.status === 'active' && !hasReleaseMarker(encounter));
}

function isMissing(error) {
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
    if (isMissing(error)) return { data: [] };
    throw error;
  }
}

async function getAllDocuments(collectionName, where, maxCount) {
  const documents = [];
  let offset = 0;

  while (documents.length < maxCount) {
    const remaining = maxCount - documents.length;
    let query = db.collection(collectionName)
      .where(where || {})
      .limit(Math.min(PAGE_SIZE, remaining));
    if (offset > 0) {
      if (typeof query.skip !== 'function') break;
      query = query.skip(offset);
    }

    const response = await safeGet(query);
    const page = response && Array.isArray(response.data) ? response.data : [];
    documents.push(...page);
    if (page.length < Math.min(PAGE_SIZE, remaining)) break;
    offset += page.length;
  }

  return documents.slice(0, maxCount);
}

function getDateTimestamp(value) {
  if (value && typeof value === 'object') {
    if (value.$date !== undefined) return getDateTimestamp(value.$date);
    if (value.value !== undefined) return getDateTimestamp(value.value);
    if (value.seconds !== undefined) return Number(value.seconds) * 1000;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function toISOString(value) {
  const timestamp = getDateTimestamp(value);
  return timestamp ? new Date(timestamp).toISOString() : '';
}

function normalizeLevel(score) {
  const source = score && typeof score === 'object' ? score : {};
  const code = LEVELS[source.levelCode] ? source.levelCode : 'C';
  const rawScore = Number(source.overallScore);
  return {
    code,
    label: LEVELS[code].label,
    overallScore: Number.isFinite(rawScore)
      ? Math.round(Math.max(0, Math.min(100, rawScore)))
      : null,
  };
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

function normalizeScoreCoverage(value) {
  if (!value || typeof value !== 'object') return null;
  const result = {};
  Object.keys(value).slice(0, 12).forEach(key => {
    const normalizedKey = trimString(key, 40);
    const item = value[key];
    if (!normalizedKey) return;
    if (typeof item === 'boolean') result[normalizedKey] = item;
    else if (typeof item === 'string') result[normalizedKey] = trimString(item, 80);
    else if (Number.isFinite(Number(item))) result[normalizedKey] = Number(item);
  });
  return Object.keys(result).length ? result : null;
}

function normalizePublicScore(value) {
  const source = value && typeof value === 'object' ? value : {};
  const nested = source.scores && typeof source.scores === 'object' ? source.scores : {};
  const read = (...keys) => {
    for (const key of keys) {
      if (source[key] !== undefined && source[key] !== null) return source[key];
      if (nested[key] !== undefined && nested[key] !== null) return nested[key];
    }
    return null;
  };
  const levelCode = LEVELS[source.levelCode] ? source.levelCode : 'C';
  const level = LEVELS[levelCode];
  return {
    levelCode,
    levelLabel: level.label,
    levelShortLabel: level.shortLabel,
    charmScore: clampNumber(read('charmScore', 'charm'), 0, 100),
    clevernessScore: clampNumber(read('clevernessScore', 'cleverness', 'fateScore', 'fate'), 0, 100),
    auraScore: clampNumber(read('auraScore', 'aura', 'rarityScore', 'rarity'), 0, 100),
    overallScore: clampNumber(read('overallScore'), 0, 100),
    // 奖励是主人自己的资产，不进入公共猫档案。
    pawReward: null,
    pointReward: null,
    scorePending: source.scorePending === true,
    scoreSource: trimString(source.scoreSource, 100),
    scoreVersion: trimString(source.scoreVersion, 100),
    scoreCoverage: normalizeScoreCoverage(source.scoreCoverage),
  };
}

function getProfileKey(profile) {
  return `${trimString(profile && profile.ownerOpenId, 128)}:${trimString(
    profile && profile.catalogCatId,
    64,
  )}`;
}

function getEncounterKey(encounter) {
  return `${trimString(encounter && encounter.ownerOpenId, 128)}:${trimString(
    encounter && encounter.catalogCatId,
    64,
  )}`;
}

function belongsToProfile(profile, encounter) {
  const source = profile && typeof profile === 'object' ? profile : {};
  const item = encounter && typeof encounter === 'object' ? encounter : {};
  const profileId = trimString(source._id, 128);
  const ownerOpenId = trimString(source.ownerOpenId, 128);
  const catalogCatId = trimString(source.catalogCatId, 64);

  // 新数据优先使用不可变的 catProfileId；旧数据再使用用户 + 猫目录编号。
  // 公开档案已先按 profile._id 校验权限，因此按 catProfileId 查询不会扩大公开范围。
  return Boolean(
    (profileId && item.catProfileId === profileId)
      || (ownerOpenId && catalogCatId
        && item.ownerOpenId === ownerOpenId
        && item.catalogCatId === catalogCatId),
  );
}

function mergeProfileEncounters(profile, lists) {
  const merged = [];
  const seen = new Set();
  (Array.isArray(lists) ? lists : []).flat().forEach(encounter => {
    if (!isActiveEncounter(encounter) || !belongsToProfile(profile, encounter)) return;
    const identity = trimString(encounter && encounter._id, 128)
      || getPublicRecordId(encounter);
    if (!identity || seen.has(identity)) return;
    seen.add(identity);
    merged.push(encounter);
  });
  merged.sort((left, right) => getDateTimestamp(
    right.createdAt || right.capturedAt,
  ) - getDateTimestamp(left.createdAt || left.capturedAt));
  return merged;
}

function getSubjectFileID(encounter) {
  const source = encounter && typeof encounter === 'object' ? encounter : {};
  const media = source.media && typeof source.media === 'object' ? source.media : {};
  const posterResult = media.posterResult && typeof media.posterResult === 'object'
    ? media.posterResult
    : {};
  const sourceImage = posterResult.sourceImage && typeof posterResult.sourceImage === 'object'
    ? posterResult.sourceImage
    : {};
  return trimString(
    media.cutoutFileID
      || source.cutoutFileID
      || sourceImage.cutoutFileID
      || (sourceImage.kind === 'cutout' ? sourceImage.fileID : ''),
    512,
  );
}

function normalizePublicLocation(encounter) {
  const source = encounter && encounter.location && typeof encounter.location === 'object'
    ? encounter.location
    : null;
  const status = trimString(
    encounter && encounter.locationStatus || (source ? 'captured' : 'unavailable'),
    20,
  ).toLowerCase();
  if (!source || status !== 'captured') {
    return { location: null, locationStatus: 'unavailable' };
  }

  const location = {};
  const locationText = trimString(
    source.locationText || source.label || source.name,
    40,
  );
  if (locationText) location.locationText = locationText;

  const latitude = Number(source.latitude);
  const longitude = Number(source.longitude);
  if (Number.isFinite(latitude) && latitude >= -90 && latitude <= 90) {
    location.latitude = Number(latitude.toFixed(3));
  }
  if (Number.isFinite(longitude) && longitude >= -180 && longitude <= 180) {
    location.longitude = Number(longitude.toFixed(3));
  }

  return Object.keys(location).length
    ? { location, locationStatus: 'captured' }
    : { location: null, locationStatus: 'unavailable' };
}

/**
 * 公共图鉴的唯一图片入口：只认已经验收的猫生图 cover。
 * 绝不回退到 cutout、original 或 posterImage，避免把不同业务图片混在一起。
 */
function getReadyCover(encounter) {
  const media = encounter && encounter.media && typeof encounter.media === 'object'
    ? encounter.media
    : {};
  const posterResult = media.posterResult && typeof media.posterResult === 'object'
    ? media.posterResult
    : {};
  const coverImage = posterResult.coverImage && typeof posterResult.coverImage === 'object'
    ? posterResult.coverImage
    : {};
  const sourceImage = posterResult.sourceImage && typeof posterResult.sourceImage === 'object'
    ? posterResult.sourceImage
    : {};
  const fileID = trimString(
    media.coverFileID
      || encounter.coverFileID
      || coverImage.fileID
      || (sourceImage.kind === 'cover' ? sourceImage.fileID : ''),
    512,
  );
  const status = trimString(
    media.coverStatus
      || encounter.coverStatus
      || coverImage.status
      || posterResult.coverStatus
      || sourceImage.status
      || (fileID ? 'ready' : ''),
    20,
  ).toLowerCase();
  if (status !== 'ready' || !fileID) return null;

  return {
    fileID,
    width: Number(coverImage.width || media.coverWidth) || 0,
    height: Number(coverImage.height || media.coverHeight) || 0,
    createdAt: toISOString(
      media.coverCreatedAt
        || coverImage.createdAt
        || encounter.createdAt
        || encounter.capturedAt,
    ),
  };
}

function chooseLatestCover(records) {
  const sorted = (Array.isArray(records) ? records : [])
    .filter(record => record && record.status === 'active')
    .sort((left, right) => getDateTimestamp(
      right.createdAt || right.capturedAt,
    ) - getDateTimestamp(left.createdAt || left.capturedAt));

  for (const record of sorted) {
    const cover = getReadyCover(record);
    if (cover) return { record, cover };
  }
  return null;
}

async function getTempURLMap(fileIDs) {
  if (!fileIDs.length || typeof cloud.getTempFileURL !== 'function') return {};
  const result = {};
  for (let index = 0; index < fileIDs.length; index += 50) {
    const batch = fileIDs.slice(index, index + 50);
    try {
      const response = await cloud.getTempFileURL({ fileList: batch });
      const files = response && Array.isArray(response.fileList) ? response.fileList : [];
      files.forEach(file => {
        const fileID = trimString(file && file.fileID, 512);
        const url = trimString(file && (file.tempFileURL || file.tempFileUrl), 2048);
        if (fileID && url) result[fileID] = url;
      });
    } catch (error) {
      console.warn('[cat-friends] 获取猫生图临时地址失败:', error);
    }
  }
  return result;
}

function addFileID(fileIDs, value) {
  const fileID = trimString(value, 512);
  if (fileID) fileIDs.add(fileID);
}

function getPublicRecordId(encounter) {
  return trimString(
    encounter && (encounter.clientRecordId || encounter.recordId || encounter._id),
    128,
  );
}

function toPublicRecord(encounter, catalogCatId, tempURLMap) {
  const source = encounter && typeof encounter === 'object' ? encounter : {};
  const recordId = getPublicRecordId(source);
  if (!recordId) return null;

  const display = source.display && typeof source.display === 'object' ? source.display : {};
  const observation = source.observation && typeof source.observation === 'object'
    ? source.observation
    : {};
  const cover = getReadyCover(source);
  const subjectFileID = getSubjectFileID(source);
  const publicLocation = normalizePublicLocation(source);

  return {
    localRecordId: recordId,
    clientRecordId: recordId,
    catalogCatId,
    archiveCode: normalizeArchiveCode(source.archiveCode),
    sourceType: trimString(
      source.sourceType || source.captureSource || source.inputSource,
      20,
    ).toLowerCase() === 'live' ? 'live' : 'photo',
    display: {
      name: trimString(display.name || source.catName, 40),
      description: trimString(display.description || source.catDescription, 240),
      posterCopy: trimString(display.posterCopy || source.posterCopy, 52),
      copyVersion: trimString(display.copyVersion || source.copyVersion, 80),
    },
    // 只返回可公开展示的临时地址，不返回原图、主体图或海报的 fileID。
    media: {
      cutoutTempURL: subjectFileID ? (tempURLMap[subjectFileID] || '') : '',
      coverTempURL: cover ? (tempURLMap[cover.fileID] || '') : '',
      coverStatus: cover ? 'ready' : '',
    },
    observation: {
      breed: trimString(observation.breed || source.detectedBreed, 80),
      breedConfidence: clampNumber(
        observation.breedConfidence !== undefined
          ? observation.breedConfidence
          : source.breedConfidence,
        0,
        1,
      ),
      traits: Array.isArray(observation.traits || source.detectedTraits)
        ? (observation.traits || source.detectedTraits)
          .slice(0, 6)
          .map(trait => trimString(trait, 40))
          .filter(Boolean)
        : [],
      catCount: Math.max(1, Math.min(10, Math.round(Number(
        observation.catCount || source.catCount,
      ) || 1))),
      source: trimString(observation.source || source.detectionSource, 100),
    },
    score: normalizePublicScore(source.score),
    location: publicLocation.location,
    locationStatus: publicLocation.locationStatus,
    createdAt: toISOString(source.createdAt || source.capturedAt),
    capturedAt: toISOString(source.capturedAt || source.createdAt),
  };
}

async function getPublicProfile(publicCatId) {
  const profileResult = await safeGet(db.collection(PROFILES_COLLECTION)
    .where({ _id: publicCatId, status: 'active' })
    .limit(1));
  const profile = profileResult && Array.isArray(profileResult.data)
    ? profileResult.data[0] || null
    : null;
  if (!isPublicActiveProfile(profile) || !profile.ownerOpenId) {
    throw createError('CAT_FRIEND_NOT_FOUND', '这只猫咪暂时不公开');
  }
  return profile;
}

async function getProfileEncounters(profile) {
  const ownerOpenId = trimString(profile.ownerOpenId, 128);
  const catalogCatId = trimString(profile.catalogCatId, 64);
  const profileId = trimString(profile._id, 128);
  const queries = [];
  if (ownerOpenId && catalogCatId) {
    queries.push(getAllDocuments(ENCOUNTERS_COLLECTION, {
      ownerOpenId,
      catalogCatId,
      status: 'active',
    }, MAX_ENCOUNTERS));
  }
  if (profileId) {
    // 不能要求 ownerOpenId 同时存在：历史记录可能只有 catProfileId。
    queries.push(getAllDocuments(ENCOUNTERS_COLLECTION, {
      catProfileId: profileId,
      status: 'active',
    }, MAX_ENCOUNTERS));
  }
  const lists = await Promise.all(queries);
  return mergeProfileEncounters(profile, lists).slice(0, MAX_PUBLIC_DETAIL_RECORDS);
}

async function getPublicCatDetail(publicCatId) {
  const profile = await getPublicProfile(publicCatId);
  const encounters = await getProfileEncounters(profile);
  if (!encounters.length) throw createError('CAT_FRIEND_NOT_FOUND', '这只猫咪暂时没有公开档案');
  // 详情入口与列表使用同一准入规则：没有可用猫生图的猫卡不对外开放。
  if (!chooseLatestCover(encounters)) {
    throw createError('CAT_FRIEND_NOT_FOUND', '这只猫咪暂时没有可用猫生图');
  }

  const fileIDs = new Set();
  encounters.forEach(encounter => {
    addFileID(fileIDs, getSubjectFileID(encounter));
    const cover = getReadyCover(encounter);
    if (cover) addFileID(fileIDs, cover.fileID);
  });
  const tempURLMap = await getTempURLMap(Array.from(fileIDs));
  const catalogCatId = trimString(profile.catalogCatId, 64);
  const records = encounters
    .map(encounter => toPublicRecord(encounter, catalogCatId, tempURLMap))
    .filter(Boolean);
  if (!records.length) throw createError('CAT_FRIEND_NOT_FOUND', '这只猫咪暂时没有公开档案');

  const latest = records[0];
  const latestObservation = latest.observation || {};
  const latestDisplay = latest.display || {};
  return {
    ok: true,
    publicCatId,
    archive: {
      catalogCatId,
      featuredRecordId: latest.localRecordId,
      archiveCode: latest.archiveCode,
      profile: {
        name: trimString(profile.displayName || latestDisplay.name || '未命名猫卡', 40),
        description: trimString(
          profile.displayDescription || latestDisplay.description,
          240,
        ),
        posterCopy: trimString(
          profile.displayPosterCopy || latestDisplay.posterCopy,
          52,
        ),
        breed: trimString(latestObservation.breed, 80),
        traits: Array.isArray(latestObservation.traits)
          ? latestObservation.traits.slice(0, 6)
          : [],
      },
      records,
    },
  };
}

function normalizePage(value) {
  const page = Math.floor(Number(value));
  return Number.isFinite(page) && page > 0 ? page : 1;
}

async function listPublicCats(page = 1) {
  const [profiles, encounters] = await Promise.all([
    getAllDocuments(PROFILES_COLLECTION, { status: 'active' }, MAX_PROFILES),
    getAllDocuments(ENCOUNTERS_COLLECTION, { status: 'active' }, MAX_ENCOUNTERS),
  ]);
  const publicProfiles = profiles.filter(isPublicActiveProfile);
  const profileById = publicProfiles.reduce((map, profile) => {
    if (profile && profile._id) map[profile._id] = profile;
    return map;
  }, {});
  const profileByKey = publicProfiles.reduce((map, profile) => {
    map[getProfileKey(profile)] = profile;
    return map;
  }, {});
  const recordsByProfile = {};
  const recordsByKey = {};

  encounters.forEach(encounter => {
    if (!isActiveEncounter(encounter)) return;
    if (encounter.catProfileId && profileById[encounter.catProfileId]) {
      if (!recordsByProfile[encounter.catProfileId]) recordsByProfile[encounter.catProfileId] = [];
      recordsByProfile[encounter.catProfileId].push(encounter);
    }
    const key = getEncounterKey(encounter);
    if (profileByKey[key]) {
      if (!recordsByKey[key]) recordsByKey[key] = [];
      recordsByKey[key].push(encounter);
    }
  });

  const pendingRows = publicProfiles.map(profile => {
    const publicCatId = trimString(profile._id, 128);
    if (!publicCatId) return null;
    // 两种关联都要合并，不能用 || 丢掉另一侧的历史记录。
    const records = mergeProfileEncounters(profile, [
      recordsByProfile[profile._id] || [],
      recordsByKey[getProfileKey(profile)] || [],
    ]);
    const selected = chooseLatestCover(records);
    if (!selected) return null;
    const { record, cover } = selected;
    const display = record.display && typeof record.display === 'object' ? record.display : {};
    const level = normalizeLevel(record.score);
    return {
      publicCatId,
      catalogCatId: trimString(profile.catalogCatId, 64),
      displayName: trimString(profile.displayName || display.name || '未命名猫卡', 40),
      description: trimString(profile.displayDescription || display.description, 120),
      posterCopy: trimString(profile.displayPosterCopy || display.posterCopy, 52),
      levelCode: level.code,
      levelLabel: level.label,
      overallScore: level.overallScore,
      recordCount: Math.max(0, Number(profile.encounterCount) || records.length),
      sourceType: trimString(record.sourceType, 20).toLowerCase() === 'live' ? 'live' : 'photo',
      archiveCode: trimString(record.archiveCode, 32),
      coverFileID: cover.fileID,
      coverWidth: cover.width,
      coverHeight: cover.height,
      coverCreatedAt: cover.createdAt || toISOString(record.createdAt || record.capturedAt),
      recordCreatedAt: toISOString(record.createdAt || record.capturedAt),
    };
  }).filter(Boolean);

  pendingRows.sort((left, right) => (
    getDateTimestamp(right.coverCreatedAt || right.recordCreatedAt)
      - getDateTimestamp(left.coverCreatedAt || left.recordCreatedAt)
  ));
  const start = (page - 1) * PUBLIC_PAGE_SIZE;
  const pageRows = pendingRows.slice(start, start + PUBLIC_PAGE_SIZE);
  const tempURLMap = await getTempURLMap(pageRows.map(row => row.coverFileID));
  const cats = pageRows
    .filter(row => tempURLMap[row.coverFileID])
    .map(row => {
      const { coverFileID, ...publicRow } = row;
      return { ...publicRow, coverTempURL: tempURLMap[coverFileID] };
    });

  return {
    ok: true,
    cats,
    total: pendingRows.length,
    page,
    pageSize: PUBLIC_PAGE_SIZE,
    hasMore: start + PUBLIC_PAGE_SIZE < pendingRows.length,
    nextPage: start + PUBLIC_PAGE_SIZE < pendingRows.length ? page + 1 : null,
  };
}

exports.main = async (event = {}) => {
  const action = trimString(event.action || 'list', 20).toLowerCase();
  if (action === 'detail') {
    const publicCatId = trimString(event.publicCatId, 128);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(publicCatId)) {
      throw createError('CAT_FRIEND_ID_REQUIRED', '缺少猫咪档案编号');
    }
    return getPublicCatDetail(publicCatId);
  }
  if (action !== 'list') throw createError('INVALID_ACTION', '不支持的猫友图鉴操作');
  return listPublicCats(normalizePage(event.page));
};
