// 猫咪咔咔｜猫档案 → 海报数据快照
// 详情页、Canvas 和分享页都只消费这里输出的 posterData。
const storage = require('./storage');
const catShare = require('./catShare');
const catScoring = require('./catScoring');
const cloudFiles = require('./cloudFiles');
const archiveIds = require('./archiveCode');
const posterResultSchema = require('./posterResult');
const { getCatById } = require('./catData');

const TEMPLATE_VERSION = 'cat-archive-poster-v0.10';
const RESULT_KEY_PREFIX = 'maomikaka_poster_result_';
const POSTER_CACHE_VERSION = 'cat-poster-cache.v0.8';
const POSTER_RESET_VERSION = 'cat-poster-rules-reset.v0.9';
const POSTER_RESET_KEY = 'maomikaka_poster_rules_reset';
const COVER_PROMPT_VERSION = 'cat-cover-prompt.v0.3';
const DEFAULT_COPY = '在城市风里，遇见一只安静的猫。';
const METRIC_ORDER = [
  { key: 'charm', label: '魅力' },
  { key: 'cleverness', label: '机灵' },
  { key: 'aura', label: '灵气' },
];
const SCORE_FIELDS = {
  charm: ['charm', 'charmScore'],
  cleverness: ['cleverness', 'clevernessScore', 'fate', 'fateScore'],
  aura: ['aura', 'auraScore', 'rarity', 'rarityScore'],
};

function createError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function createPosterJobId() {
  const date = new Date();
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('');
  return `poster_${stamp}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function stableToken(value) {
  let hash = 2166136261;
  Array.from(String(value || '')).forEach(character => {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  });
  return (hash >>> 0).toString(36);
}

function getPosterCacheIdentity(sourceArchiveId, sourceRecordId) {
  const archiveId = String(sourceArchiveId || '').trim();
  const recordIdValue = String(sourceRecordId || '').trim();
  if (!archiveId || !recordIdValue) return '';
  return `${TEMPLATE_VERSION}\u0000${archiveId}\u0000${recordIdValue}`;
}

function getStablePosterJobId(sourceArchiveId, sourceRecordId) {
  const identity = getPosterCacheIdentity(sourceArchiveId, sourceRecordId);
  return identity ? `poster_fixed_${stableToken(identity)}` : '';
}

function getPosterCacheKey(sourceArchiveId, sourceRecordId) {
  const identity = getPosterCacheIdentity(sourceArchiveId, sourceRecordId);
  return identity ? `${RESULT_KEY_PREFIX}fixed_${stableToken(identity)}` : '';
}

function trimText(value, maxLength, fallback = '') {
  const normalized = String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return Array.from(normalized).slice(0, maxLength).join('') || fallback;
}

function recordId(record) {
  return String(record && (record.recordId || record.clientRecordId || record.localRecordId || '')).trim();
}

function getRecordArchiveCode(record, catId, fallbackCode = '') {
  const existing = archiveIds.normalizeArchiveCode(record && record.archiveCode);
  if (existing) return existing;
  const fallback = archiveIds.normalizeArchiveCode(fallbackCode);
  if (fallback) return fallback;

  const sourceRecordId = recordId(record) || 'latest';
  const createdAt = record && (record.createdAt || record.capturedAt);
  return archiveIds.getOrCreateArchiveCode(
    `record:${String(catId || '').trim()}:${sourceRecordId}`,
    createdAt ? new Date(createdAt) : new Date(),
  );
}

function timestampValue(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortRecords(records) {
  return (Array.isArray(records) ? records : [])
    .filter(record => record && typeof record === 'object')
    .slice()
    .sort((left, right) => timestampValue(right.createdAt || right.capturedAt)
      - timestampValue(left.createdAt || left.capturedAt));
}

function getCurrentRecordId(catId) {
  const normalizedCatId = String(catId || '').trim();
  if (!normalizedCatId) return '';
  const records = sortRecords(storage.getRecordsForCat(normalizedCatId));
  return recordId(records[0]);
}

/**
 * 读取已经生成的海报封面引用。
 *
 * coverPhotoPath / coverTempURL 只是短期或本地地址，真正能保证下次复用的是
 * coverFileID；旧数据也可能只把它保存在 posterResult.coverImage 或 sourceImage。
 */
function getRecordCoverRef(record) {
  const value = record && typeof record === 'object' ? record : {};
  const posterResult = value.posterResult && typeof value.posterResult === 'object'
    ? value.posterResult
    : {};
  const coverImage = posterResult.coverImage && typeof posterResult.coverImage === 'object'
    ? posterResult.coverImage
    : {};
  const sourceImage = posterResult.sourceImage && typeof posterResult.sourceImage === 'object'
    ? posterResult.sourceImage
    : {};
  const fileID = String(
    storage.getRecordPosterSourceFileID(value)
      || coverImage.fileID
      || (sourceImage.kind === 'cover' ? sourceImage.fileID : '')
      || '',
  ).trim();
  const status = String(
    value.coverStatus
      || posterResult.coverStatus
      || coverImage.status
      || (fileID ? 'ready' : ''),
  ).trim();
  const path = value.coverPhotoPath
    || value.coverTempURL
    || coverImage.path
    || (sourceImage.kind === 'cover' ? sourceImage.path : '')
    || '';
  return { fileID, status, path, coverImage, posterResult };
}

function normalizeSharedRecord(source, fallbackCatId) {
  const item = source && typeof source === 'object' ? source : {};
  const display = item.display && typeof item.display === 'object' ? item.display : {};
  const media = item.media && typeof item.media === 'object' ? item.media : {};
  const observation = item.observation && typeof item.observation === 'object'
    ? item.observation
    : {};
  const score = item.score && typeof item.score === 'object' ? item.score : {};
  const scoreSources = [score, item.scores, item];
  const id = item.localRecordId || item.clientRecordId || item.recordId || item.encounterId || '';
  const posterResult = media.posterResult || item.posterResult || null;
  const posterCover = posterResult && posterResult.coverImage
    && typeof posterResult.coverImage === 'object'
    ? posterResult.coverImage
    : {};
  const posterSource = posterResult && posterResult.sourceImage
    && typeof posterResult.sourceImage === 'object'
    ? posterResult.sourceImage
    : {};
  const originalTempURL = media.originalTempURL || item.originalTempURL || '';
  const cutoutTempURL = media.cutoutTempURL || item.cutoutTempURL || '';
  const coverTempURL = media.coverTempURL || item.coverTempURL || '';
  const coverFileID = media.coverFileID
    || item.coverFileID
    || posterCover.fileID
    || (posterSource.kind === 'cover' ? posterSource.fileID : '')
    || '';
  const coverStatus = media.coverStatus
    || item.coverStatus
    || (posterResult && posterResult.coverStatus)
    || posterCover.status
    || (coverFileID ? 'ready' : '');

  return {
    recordId: id,
    clientRecordId: id,
    catId: item.catalogCatId || fallbackCatId,
    archiveCode: archiveIds.normalizeArchiveCode(item.archiveCode),
    catName: display.name || item.catName || '',
    catDescription: display.description || item.catDescription || '',
    posterCopy: display.posterCopy || item.posterCopy || '',
    posterResult,
    copyVersion: display.copyVersion || item.copyVersion || '',
    photoPath: item.photoPath || item.photo || originalTempURL || cutoutTempURL,
    photo: item.photo || originalTempURL,
    originalPhotoPath: item.originalPhotoPath || originalTempURL,
    cutoutPhotoPath: item.cutoutPhotoPath || cutoutTempURL,
    coverPhotoPath: item.coverPhotoPath || coverTempURL,
    originalFileID: media.originalFileID || item.originalFileID || '',
    originalContentType: media.originalContentType || item.originalContentType || '',
    cutoutFileID: media.cutoutFileID || item.cutoutFileID || '',
    coverFileID,
    originalTempURL,
    cutoutTempURL,
    coverTempURL,
    cutoutContentType: media.cutoutContentType || item.cutoutContentType || '',
    cutoutProvider: media.cutoutProvider || item.cutoutProvider || '',
    cutoutOperation: media.cutoutOperation || item.cutoutOperation || '',
    cutoutRequestId: media.cutoutRequestId || item.cutoutRequestId || '',
    cutoutCheckerboardRemoved: media.cutoutCheckerboardRemoved === true,
    coverContentType: media.coverContentType || item.coverContentType || '',
    coverProvider: media.coverProvider || item.coverProvider || '',
    coverModel: media.coverModel || item.coverModel || '',
    coverOperation: media.coverOperation || item.coverOperation || '',
    coverPromptVersion: media.coverPromptVersion || item.coverPromptVersion || '',
    coverTargetRatio: media.coverTargetRatio || item.coverTargetRatio || '359:537',
    coverStatus,
    coverRequestId: media.coverRequestId || item.coverRequestId || '',
    coverCreatedAt: media.coverCreatedAt || item.coverCreatedAt || '',
    coverRejectReason: media.coverRejectReason || item.coverRejectReason || '',
    levelCode: score.levelCode || item.levelCode || null,
    levelLabel: score.levelLabel || item.levelLabel || null,
    levelShortLabel: score.levelShortLabel || item.levelShortLabel || null,
    charmScore: getFirstScoreValue(scoreSources, 'charm'),
    clevernessScore: getFirstScoreValue(scoreSources, 'cleverness'),
    auraScore: getFirstScoreValue(scoreSources, 'aura'),
    rarityScore: getFirstScoreValue(scoreSources, 'rarity'),
    fateScore: getFirstScoreValue(scoreSources, 'fate'),
    overallScore: getFirstScoreValue(scoreSources, 'overall'),
    pawReward: score.pawReward,
    pointReward: score.pointReward,
    scorePending: score.scorePending === true,
    scoreSource: score.scoreSource || '',
    scoreVersion: score.scoreVersion || '',
    scoreEvidence: score.scoreEvidence || null,
    scoreCoverage: score.scoreCoverage || null,
    detectedBreed: observation.breed || item.detectedBreed || '',
    breedConfidence: observation.breedConfidence,
    detectedTraits: Array.isArray(observation.traits) ? observation.traits : [],
    catCount: observation.catCount || 1,
    detectionSource: observation.source || '',
    createdAt: item.createdAt || item.capturedAt || Date.now(),
    capturedAt: item.capturedAt || item.createdAt || '',
  };
}

function getImagePathCandidates(record) {
  const value = record || {};
  const cover = getRecordCoverRef(value);
  const hasCurrentCover = cover.status === 'ready' && Boolean(cover.fileID || cover.path);
  const candidates = [
    // 只有明确标记 ready 的封面图才可以替代原图进入海报。
    ...(hasCurrentCover
      ? [{
        path: cover.path,
        kind: 'cover',
        fileID: cover.fileID,
      }]
      : []),
    // 海报采用满幅照片方向，优先使用安全校验后的原图；主体图作为回退。
    {
      path: value.originalPhotoPath || value.photo || value.originalTempURL,
      kind: 'original',
      fileID: value.originalFileID || '',
    },
    { path: value.photoPath, kind: 'original', fileID: value.originalFileID || '' },
    {
      path: value.cutoutPhotoPath || value.cutoutPhoto || value.cutoutTempURL,
      kind: 'cutout',
      fileID: value.cutoutFileID || '',
    },
  ];
  return candidates.filter(item => item.path).reduce((list, item) => {
    if (!list.some(existing => existing.path === item.path)) list.push(item);
    return list;
  }, []);
}

function getImageInfo(path) {
  if (!path || !wx.getImageInfo) return Promise.resolve({ path, width: 1, height: 1 });
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src: path,
      success(result) {
        resolve({
          path: result.path || path,
          width: Number(result.width) || 1,
          height: Number(result.height) || 1,
        });
      },
      fail: reject,
    });
  });
}

async function resolveRecordImage(record) {
  if (!record) return null;

  const cover = getRecordCoverRef(record);
  const candidates = getImagePathCandidates(record);

  // 已有封面时必须先尝试封面；不能因为原图本地路径仍然有效，就绕过已生成的猫生图。
  for (const candidate of candidates.filter(item => item.kind === 'cover')) {
    try {
      const info = await getImageInfo(candidate.path);
      return { ...candidate, ...info };
    } catch (error) {
      // 临时地址失效时继续尝试 fileID 或主体图。
    }
  }

  const coverFileCandidate = cover.status === 'ready' && cover.fileID
    ? { fileID: cover.fileID, kind: 'cover' }
    : null;
  if (coverFileCandidate) {
    try {
      const path = await cloudFiles.getTempFileURL(coverFileCandidate.fileID);
      const info = await getImageInfo(path);
      return { ...coverFileCandidate, ...info };
    } catch (error) {
      // 已保存的封面文件不可用时，才允许回退到原图或主体图。
    }
  }

  for (const candidate of candidates.filter(item => item.kind !== 'cover')) {
    try {
      const info = await getImageInfo(candidate.path);
      return { ...candidate, ...info };
    } catch (error) {
      // 临时地址失效时继续尝试 fileID。
    }
  }

  const fileCandidates = [
    { fileID: record.originalFileID, kind: 'original' },
    { fileID: storage.getRecordSubjectFileID(record), kind: 'cutout' },
  ].filter(item => item.fileID);
  for (const candidate of fileCandidates) {
    try {
      const path = await cloudFiles.getTempFileURL(candidate.fileID);
      const info = await getImageInfo(path);
      return { ...candidate, ...info };
    } catch (error) {
      // 一个文件不可用时继续尝试另一个版本。
    }
  }
  return null;
}

function normalizeProfile(profile, catData, records) {
  const source = profile && typeof profile === 'object' ? profile : {};
  const latest = records[0] || {};
  const traits = Array.isArray(source.traits) && source.traits.length
    ? source.traits
    : (Array.isArray(latest.detectedTraits) && latest.detectedTraits.length
      ? latest.detectedTraits
      : (Array.isArray(catData.trait) ? catData.trait : []));
  const description = source.description
    || latest.catDescription
    || catData.story
    || '';

  return {
    name: trimText(source.name || latest.catName || catData.name, 8, '未命名'),
    breed: trimText(source.breed || latest.detectedBreed || catData.breed, 20),
    traits: traits.map(trait => trimText(trait, 8)).filter(Boolean).slice(0, 3),
    description: trimText(description, 50),
    posterCopy: trimText(
      source.posterCopy || latest.posterCopy || description || catData.posterCopy,
      52,
      DEFAULT_COPY,
    ),
  };
}

function buildPublicArchive(catId, records, profile, featuredRecordId) {
  const featuredRecord = records.find(record => recordId(record) === featuredRecordId)
    || records[0]
    || null;
  return {
    catalogCatId: catId,
    featuredRecordId: featuredRecordId || recordId(records[0]),
    archiveCode: getRecordArchiveCode(featuredRecord, catId),
    profile: {
      name: profile.name,
      description: profile.description,
      posterCopy: profile.posterCopy,
      breed: profile.breed,
      traits: profile.traits,
    },
    records: records.slice(0, 50).map(record => {
      // 兼容旧记录：封面可能只保存在 posterResult.coverImage。
      const cover = getRecordCoverRef(record);
      const coverImage = cover.coverImage || {};
      return {
      clientRecordId: recordId(record),
      catalogCatId: catId,
      archiveCode: getRecordArchiveCode(record, catId),
      display: {
        name: record.catName || '',
        description: record.catDescription || '',
        posterCopy: record.posterCopy || '',
        copyVersion: record.copyVersion || '',
      },
      media: {
        originalFileID: record.originalFileID || '',
        originalContentType: record.originalContentType || '',
        cutoutFileID: record.cutoutFileID || '',
        cutoutContentType: record.cutoutContentType || '',
        cutoutProvider: record.cutoutProvider || '',
        cutoutOperation: record.cutoutOperation || '',
        cutoutRequestId: record.cutoutRequestId || '',
        cutoutCheckerboardRemoved: record.cutoutCheckerboardRemoved === true,
        coverFileID: record.coverFileID || cover.fileID || '',
        coverContentType: record.coverContentType || coverImage.contentType || '',
        coverProvider: record.coverProvider || coverImage.provider || '',
        coverModel: record.coverModel || coverImage.model || '',
        coverOperation: record.coverOperation || coverImage.operation || '',
        coverPromptVersion: record.coverPromptVersion || coverImage.promptVersion || '',
        coverTargetRatio: record.coverTargetRatio || '359:537',
        coverStatus: record.coverStatus || cover.status || '',
        coverRequestId: record.coverRequestId || '',
        coverCreatedAt: record.coverCreatedAt || '',
        coverRejectReason: record.coverRejectReason || '',
      },
      observation: {
        breed: record.detectedBreed || '',
        breedConfidence: record.breedConfidence,
        traits: Array.isArray(record.detectedTraits) ? record.detectedTraits : [],
        catCount: record.catCount || 1,
        source: record.detectionSource || '',
      },
      score: {
        levelCode: record.levelCode || '',
        levelLabel: record.levelLabel || '',
        levelShortLabel: record.levelShortLabel || '',
        charmScore: record.charmScore,
        clevernessScore: record.clevernessScore,
        auraScore: record.auraScore,
        rarityScore: record.rarityScore,
        fateScore: record.fateScore,
        overallScore: record.overallScore,
        pawReward: record.pawReward,
        pointReward: record.pointReward,
        scorePending: record.scorePending === true,
        scoreSource: record.scoreSource || '',
        scoreVersion: record.scoreVersion || '',
        scoreEvidence: record.scoreEvidence || null,
        scoreCoverage: record.scoreCoverage || null,
      },
      createdAt: record.createdAt || record.capturedAt || Date.now(),
      capturedAt: record.capturedAt || record.createdAt || '',
      };
    }),
  };
}

// 云端只保存轻量 posterResult，不保存完整 shareArchive。
// 重新打开已有海报时，必须从本机的当前猫卡记录重建同一份公开快照，
// 否则 poster-preview 无法准备分享，或者分享时落到空的图鉴页。
function buildLocalShareArchive(catId, records, profile, featuredRecordId) {
  const catData = getCatById(catId);
  const sortedRecords = sortRecords(records);
  if (!catData || !sortedRecords.length) return null;
  const collection = storage.getCollection();
  const entry = collection[catId] || {};
  const sourceProfile = profile && typeof profile === 'object' ? profile : {};
  const normalizedProfile = normalizeProfile({
    name: sourceProfile.name || entry.displayName,
    description: sourceProfile.description || entry.displayDescription,
    posterCopy: sourceProfile.posterCopy || entry.posterCopy,
    breed: sourceProfile.breed,
    traits: sourceProfile.traits,
  }, catData, sortedRecords);
  return buildPublicArchive(
    catId,
    sortedRecords,
    normalizedProfile,
    featuredRecordId || recordId(sortedRecords[0]),
  );
}

function getFirstScoreValue(sources, key) {
  const fields = SCORE_FIELDS[key] || [key, `${key}Score`];
  for (const source of Array.isArray(sources) ? sources : [sources]) {
    if (!source || typeof source !== 'object') continue;
    for (const field of fields) {
      const value = source[field];
      if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
  }
  return 0;
}

function buildScoreSnapshot(encounter, record) {
  const scoreItems = [
    ...(encounter && Array.isArray(encounter.scoreItems) ? encounter.scoreItems : []),
    ...(record && Array.isArray(record.scoreItems) ? record.scoreItems : []),
  ];
  const scoreSources = [
    encounter,
    encounter && encounter.scores,
    encounter && encounter.score,
    record,
    record && record.scores,
    record && record.score,
  ];
  const scores = {};
  METRIC_ORDER.forEach(item => {
    const score = scoreItems.find(entry => entry.key === item.key);
    const itemValue = score && score.value !== undefined && score.value !== null
      && String(score.value).trim() !== ''
      ? score.value
      : getFirstScoreValue(scoreSources, item.key);
    scores[item.key] = normalizePosterScore(itemValue);
  });
  return scores;
}

function normalizePosterScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function getPosterResetAt() {
  try {
    const marker = wx.getStorageSync(POSTER_RESET_KEY);
    if (!marker || marker.version !== POSTER_RESET_VERSION) return 0;
    return timestampValue(marker.resetAt);
  } catch (error) {
    return 0;
  }
}

function isPosterResultAfterReset(result) {
  const resetAt = getPosterResetAt();
  if (!resetAt) return true;
  // 规则迁移失败时云端可能还残留旧结果；旧快照不能绕过本地一次性清理。
  return timestampValue(result && result.generatedAt) > resetAt;
}

function getPosterRecordProfile(record) {
  const value = record && typeof record === 'object' ? record : {};
  const catId = String(value.catId || '').trim();
  const storedRecords = catId ? sortRecords(storage.getRecordsForCat(catId)) : [];
  const records = storedRecords.length ? storedRecords : [value];
  const currentRecord = records[0] || value;
  const catData = getCatById(catId) || { name: '', story: '', trait: [] };
  const collection = storage.getCollection();
  const entry = collection[catId] || {};
  return {
    record: currentRecord,
    records,
    profile: normalizeProfile({
      name: entry.displayName,
      description: entry.displayDescription,
      posterCopy: entry.posterCopy,
    }, catData, records),
  };
}

/**
 * 检查已保存的最终海报是否仍对应当前相遇记录。
 *
 * 海报是排版快照：评分、等级、猫名或文案更新后，旧 PNG 不能继续复用；
 * 但封面临时地址失效不应触发新的猫生图。只要旧快照的封面状态仍一致，
 * 即使封面当前暂时无法换取临时地址，也允许继续复用已经保存的最终 PNG。
 */
function isPosterResultCurrent(result, record) {
  const candidate = posterResultSchema.normalizePosterResult(result);
  if (!candidate || !record) return false;

  const source = getPosterRecordProfile(record);
  const currentRecord = source.record || record;
  const currentRecordId = recordId(currentRecord);
  if (
    candidate.sourceArchiveId !== String(currentRecord.catId || '').trim()
    || candidate.sourceRecordId !== currentRecordId
  ) return false;

  const currentEncounter = catScoring.getStoredEncounter(currentRecord);
  const currentLevel = catScoring.getLevelMeta(currentEncounter ? currentEncounter.levelCode : 'C');
  const scores = buildScoreSnapshot(currentEncounter, currentRecord);
  const formalScore = Boolean(
    currentEncounter
    && currentEncounter.scorePending !== true
    && currentEncounter.overallScore !== null
    && Array.isArray(currentEncounter.scoreItems)
    && currentEncounter.scoreItems.length === METRIC_ORDER.length
  );
  const expectedScores = {
    mika: normalizePosterScore(formalScore ? currentEncounter.overallScore : 0),
    charm: scores.charm,
    cleverness: scores.cleverness,
    aura: scores.aura,
  };
  if (candidate.levelCode !== currentLevel.code) return false;
  if (candidate.name !== source.profile.name
    || candidate.breed !== source.profile.breed
    || candidate.copy !== source.profile.posterCopy) return false;
  if (Object.keys(expectedScores).some(key => candidate.scores[key] !== expectedScores[key])) {
    return false;
  }

  const currentCover = getRecordCoverRef(currentRecord);
  const currentCoverStatus = String(currentCover.status || '').trim();
  const savedCoverFileID = candidate.coverImage && candidate.coverImage.fileID
    ? String(candidate.coverImage.fileID).trim()
    : '';
  // 旧快照可能有 coverImage.fileID 但没有 coverStatus；按 fileID 兼容为 ready。
  const candidateCoverStatus = candidate.coverStatus || (savedCoverFileID ? 'ready' : '');
  if (candidateCoverStatus !== currentCoverStatus) return false;

  const currentCoverFileID = currentCoverStatus === 'ready'
    ? String(currentCover.fileID || '').trim()
    : '';
  if (currentCoverFileID && savedCoverFileID && currentCoverFileID !== savedCoverFileID) {
    return false;
  }
  if (!currentCoverFileID && savedCoverFileID && currentCoverStatus !== 'ready') {
    return false;
  }
  if (currentCoverFileID
    && candidate.sourceImage
    && candidate.sourceImage.kind === 'cover'
    && candidate.sourceImage.fileID
    && candidate.sourceImage.fileID !== currentCoverFileID) {
    return false;
  }
  if (!currentCoverFileID
    && currentCoverStatus !== 'ready'
    && candidate.sourceImage
    && candidate.sourceImage.kind === 'cover'
    && candidate.sourceImage.fileID) {
    return false;
  }
  return true;
}

async function loadArchiveSource(options = {}) {
  const requestedShareId = String(options.shareId || '').trim();
  if (options.archive && typeof options.archive === 'object') {
    return {
      catId: options.catId || options.archive.catalogCatId || options.archive.catId || '',
      records: Array.isArray(options.archive.records)
        ? options.archive.records.map(record => normalizeSharedRecord(
          record,
          options.catId || options.archive.catalogCatId || options.archive.catId,
        ))
        : [],
      profile: options.archive.profile || {},
      featuredRecordId: options.archive.featuredRecordId || options.recordId || '',
      archiveCode: archiveIds.normalizeArchiveCode(options.archive.archiveCode),
      shareId: requestedShareId,
      shareArchive: options.archive,
      isShared: Boolean(requestedShareId),
    };
  }

  if (requestedShareId) {
    const result = await catShare.get(requestedShareId);
    const archive = result && result.archive ? result.archive : {};
    const catId = archive.catalogCatId || archive.catId || '';
    return {
      catId,
      records: Array.isArray(archive.records)
        ? archive.records.map(record => normalizeSharedRecord(record, catId))
        : [],
      profile: archive.profile || {},
      featuredRecordId: archive.featuredRecordId || options.recordId || '',
      archiveCode: archiveIds.normalizeArchiveCode(archive.archiveCode),
      shareId: requestedShareId,
      shareArchive: archive,
      isShared: true,
    };
  }

  const catId = String(options.catId || '').trim();
  if (!catId) throw createError('POSTER_CAT_REQUIRED', '缺少猫咪档案');
  const collection = storage.getCollection();
  const entry = collection[catId] || {};
  const records = sortRecords(storage.getRecordsForCat(catId));
  const profile = {
    name: entry.displayName,
    description: entry.displayDescription,
    posterCopy: entry.posterCopy,
  };
  const featuredRecordId = options.recordId
    || entry.featuredRecordId
    || recordId(records[0]);
  return {
    catId,
    records,
    profile,
    featuredRecordId,
    archiveCode: '',
    shareId: storage.getShareId(catId),
    shareArchive: buildLocalShareArchive(catId, records, profile, featuredRecordId),
    isShared: false,
  };
}

async function buildPosterData(options = {}) {
  const source = await loadArchiveSource(options);
  const catData = getCatById(source.catId);
  if (!catData) throw createError('POSTER_CAT_NOT_FOUND', '这只猫咪档案不存在');
  if (!source.records.length) throw createError('POSTER_ARCHIVE_EMPTY', '这只猫还没有可生成的相遇记录');

  const records = sortRecords(source.records);
  const profile = normalizeProfile(source.profile, catData, records);
  const currentRecord = records[0];
  const currentRecordId = recordId(currentRecord);
  const currentEncounter = currentRecord ? catScoring.getStoredEncounter(currentRecord) : null;
  const currentLevel = catScoring.getLevelMeta(currentEncounter ? currentEncounter.levelCode : 'C');
  // 海报只取当前（最新）相遇记录；精选记录只负责档案主图，不参与海报数据组装。
  const currentImage = currentRecord ? await resolveRecordImage(currentRecord) : null;
  if (!currentRecord || !currentRecordId || !currentImage || !currentImage.path) {
    throw createError('POSTER_IMAGE_UNAVAILABLE', '还没有可用的猫咪照片');
  }

  const formalScore = Boolean(
    currentEncounter
    && currentEncounter.scorePending !== true
    && currentEncounter.overallScore !== null
    && currentEncounter.scoreItems
    && currentEncounter.scoreItems.length === METRIC_ORDER.length
  );
  // 海报允许展示未完成或部分评分；缺失项统一以 0 呈现，避免出现空白占位。
  const unavailableReason = '';
  const posterShareArchive = source.shareArchive || buildPublicArchive(
    source.catId,
    records,
    profile,
    currentRecordId,
  );
  const scores = buildScoreSnapshot(currentEncounter, currentRecord);
  const sourceArchiveCode = getRecordArchiveCode(
    currentRecord,
    source.catId,
    source.archiveCode,
  );
  const sourceCoverRef = getRecordCoverRef(currentRecord);
  const hasStoredCoverReference = sourceCoverRef.status === 'ready'
    && Boolean(sourceCoverRef.fileID || sourceCoverRef.path);
  const sourceCoverMeta = sourceCoverRef.coverImage || {};
  const sourceCover = currentImage.kind === 'cover'
    ? {
      path: currentImage.path,
      fileID: currentImage.fileID || '',
      width: currentImage.width,
      height: currentImage.height,
      contentType: currentRecord.coverContentType || sourceCoverMeta.contentType || '',
      provider: currentRecord.coverProvider || sourceCoverMeta.provider || '',
      model: currentRecord.coverModel || sourceCoverMeta.model || '',
      operation: currentRecord.coverOperation
        || sourceCoverMeta.operation
        || 'image-to-image-poster-cover',
      promptVersion: currentRecord.coverPromptVersion
        || sourceCoverMeta.promptVersion
        || COVER_PROMPT_VERSION,
      targetRatio: currentRecord.coverTargetRatio || '359:537',
      status: sourceCoverRef.status || 'ready',
      requestId: currentRecord.coverRequestId || sourceCoverMeta.requestId || '',
      createdAt: currentRecord.coverCreatedAt || sourceCoverMeta.createdAt || '',
      version: 'cat-cover.v0.3',
    }
    : null;

  return {
    posterJobId: options.posterJobId || createPosterJobId(),
    templateVersion: TEMPLATE_VERSION,
    sourceArchiveId: source.catId,
    sourceRecordId: currentRecordId,
    archiveCode: sourceArchiveCode,
    levelCode: currentLevel.code,
    levelLabel: currentLevel.label,
    levelShortLabel: currentLevel.shortLabel,
    name: profile.name,
    breed: profile.breed,
    traits: profile.traits,
    copy: profile.posterCopy,
    scores: {
      mika: normalizePosterScore(formalScore && currentEncounter
        ? currentEncounter.overallScore
        : 0),
      charm: scores.charm,
      cleverness: scores.cleverness,
      aura: scores.aura,
    },
    sourceImage: {
      path: currentImage.path,
      kind: currentImage.kind,
      width: currentImage.width,
      height: currentImage.height,
      fileID: currentImage.fileID || '',
      originalFileID: currentRecord.originalFileID || '',
      originalContentType: currentRecord.originalContentType || '',
      cutoutFileID: currentRecord.cutoutFileID || '',
      sceneSeed: sourceArchiveCode
        || source.catId
        || currentRecordId
        || '',
      version: currentImage.kind === 'cover'
        ? 'cat-cover.v0.3'
        : (currentImage.kind === 'cutout' ? 'cat-transform.v1' : 'safe-original.v1'),
    },
    coverImage: sourceCover,
    coverStatus: sourceCoverRef.status || '',
    coverRejectReason: currentRecord.coverRejectReason || '',
    // 只要数据库已有 ready 封面引用，就禁止因为临时地址失效而再次调用猫生图。
    // resolveRecordImage 会尽力回退到原图/主体图，Canvas 仍可完成本次排版。
    coverGenerationAllowed: !hasStoredCoverReference,
    posterImage: {
      mode: 'cover-crop',
      width: 718,
      height: 1074,
      fileID: '',
      version: 'poster-image.local-crop.v0.2',
    },
    shareId: source.shareId || '',
    shareArchive: posterShareArchive,
    isShared: source.isShared,
    eligible: true,
    unavailableReason,
  };
}

function applyPosterCover(data, cover) {
  if (!data || !cover || cover.status !== 'ready' || !cover.fileID || !cover.path) {
    return data;
  }

  const sourceImage = {
    ...(data.sourceImage || {}),
    path: cover.path,
    kind: 'cover',
    width: Number(cover.width) || 1,
    height: Number(cover.height) || 1,
    fileID: cover.fileID,
        version: cover.version || 'cat-cover.v0.3',
  };
  const coverImage = {
    path: cover.path,
    fileID: cover.fileID,
    width: Number(cover.width) || 1,
    height: Number(cover.height) || 1,
    contentType: cover.contentType || 'image/jpeg',
    provider: cover.provider || 'hunyuan-image',
    model: cover.model || 'HY-Image-v3.0-I2I-ToB-v1.0.1',
    operation: cover.operation || 'image-to-image-poster-cover',
    promptVersion: cover.promptVersion || COVER_PROMPT_VERSION,
    targetRatio: cover.targetRatio || '359:537',
    status: 'ready',
    requestId: cover.requestId || '',
    createdAt: cover.createdAt || new Date().toISOString(),
    version: cover.version || 'cat-cover.v0.3',
  };

  const shareArchive = data.shareArchive && Array.isArray(data.shareArchive.records)
    ? {
      ...data.shareArchive,
      records: data.shareArchive.records.map(record => {
        const sameRecord = recordId(record) === String(data.sourceRecordId || '').trim();
        if (!sameRecord) return record;
        return {
          ...record,
          media: {
            ...(record.media || {}),
            coverFileID: cover.fileID,
            coverContentType: cover.contentType || 'image/jpeg',
            coverProvider: cover.provider || 'hunyuan-image',
            coverModel: cover.model || 'HY-Image-v3.0-I2I-ToB-v1.0.1',
            coverOperation: cover.operation || 'image-to-image-poster-cover',
            coverPromptVersion: cover.promptVersion || COVER_PROMPT_VERSION,
            coverTargetRatio: cover.targetRatio || '359:537',
            coverStatus: 'ready',
            coverRequestId: cover.requestId || '',
            coverCreatedAt: cover.createdAt || new Date().toISOString(),
            coverRejectReason: '',
          },
        };
      }),
    }
    : data.shareArchive;

  return {
    ...data,
    sourceImage,
    coverImage,
    coverStatus: 'ready',
    coverRejectReason: '',
    shareArchive,
  };
}

function savePosterResult(jobId, result) {
  const key = `${RESULT_KEY_PREFIX}${String(jobId || '').trim()}`;
  if (!jobId || !result) return;
  wx.setStorageSync(key, result);

  // 按“猫档案 + 相遇记录 + 模板版本”固定缓存最终海报；
  // 无论封面是否成功，只要最终 PNG 已生成，后续重复打开都不再调用图生图。
  if (result.isShared !== true
    && result.sourceArchiveId
    && result.sourceRecordId
    && (result.posterPath || (result.posterImage && result.posterImage.fileID))) {
    const cacheKey = getPosterCacheKey(result.sourceArchiveId, result.sourceRecordId);
    if (cacheKey) {
      wx.setStorageSync(cacheKey, {
        ...result,
        posterCacheVersion: POSTER_CACHE_VERSION,
        posterCachedAt: Date.now(),
      });
    }
  }
}

function buildPosterPersistencePayload(result) {
  if (!result || result.isShared === true) return null;
  return posterResultSchema.toPersistencePayload(result, {
    defaultCacheVersion: POSTER_CACHE_VERSION,
  });
}

async function getSavedPosterResult(options) {
  const source = await loadArchiveSource(options);
  const currentRecord = sortRecords(source.records)[0] || null;
  const selectedId = recordId(currentRecord);
  // 海报只复用当前最新记录的成品；精选记录上的旧海报不能覆盖当前猫咪。
  const localRecord = currentRecord;
  if (!selectedId) return null;
  const localSaved = localRecord && localRecord.posterResult;
  let saved;
  if (source.isShared) {
    saved = localSaved;
  } else {
    try {
      saved = await require('./userData').getPosterResult(source.catId, selectedId);
    } catch (error) {
      if (!localSaved) throw error;
      // 云端暂不可用时，仍可复用本地已经保存的完整海报快照。
      saved = null;
    }
    // 海报模板升级后，旧快照不能继续复用，否则颜色和布局会被旧成品带回来。
    const isCurrentTemplate = candidate => candidate
      && candidate.templateVersion === TEMPLATE_VERSION;
    const templateCandidates = [saved, localSaved].filter(candidate => (
      isCurrentTemplate(candidate) && isPosterResultAfterReset(candidate)
    ));
    const coverCandidate = templateCandidates.find(candidate => (
      candidate.coverImage && candidate.coverImage.fileID
    ));
    if (coverCandidate) {
      storage.updateRecordCover(selectedId, coverCandidate.coverImage);
    }
    saved = templateCandidates.find(candidate => isPosterResultCurrent(candidate, currentRecord)) || null;
  }
  if (!saved || !saved.posterImage || !saved.posterImage.fileID) return null;
  // 地址失效时重新换取地址；读取失败交给页面重试，不悄悄重新生成。
  const url = saved.posterTempURL || await cloudFiles.getTempFileURL(saved.posterImage.fileID);
  const image = await getImageInfo(url);
  return {
    ...saved, posterPath: image.path, isShared: source.isShared,
    shareId: source.shareId, shareArchive: source.shareArchive,
    // 本地海报的 shareId 可能已过期或对应的云端快照已被清理；
    // 预览页打开时重新幂等写入一次，避免把失效链接直接交给微信。
    shareReady: source.isShared ? Boolean(source.shareId) : false,
    ratio: '9:16',
  };
}

function getCachedPosterResult(sourceArchiveId, sourceRecordId) {
  const key = getPosterCacheKey(sourceArchiveId, sourceRecordId);
  if (!key) return null;
  try {
    const result = wx.getStorageSync(key);
    if (!result || typeof result !== 'object') return null;
    if (
      result.templateVersion !== TEMPLATE_VERSION
      || result.posterCacheVersion !== POSTER_CACHE_VERSION
      || !result.sourceArchiveId
      || !result.sourceRecordId
      || (!result.posterPath && !(result.posterImage && result.posterImage.fileID))
    ) {
      return null;
    }
    if (!isPosterResultAfterReset(result)) return null;
    let currentRecord = storage.getRecordById(String(sourceRecordId || '').trim())
      || storage.getRecordsForCat(String(sourceArchiveId || '').trim()).find(record => (
        recordId(record) === String(sourceRecordId || '').trim()
      ));
    if (!currentRecord) return null;
    // 本地缓存仍有封面 fileID 时先回填记录，兼容旧版本只把封面保存在海报缓存、
    // 或应用清理过临时路径但尚未完成媒体同步的情况。
    if (result.coverImage && result.coverImage.fileID) {
      storage.updateRecordCover(result.sourceRecordId, result.coverImage);
      currentRecord = storage.getRecordById(String(sourceRecordId || '').trim()) || currentRecord;
    }
    if (!isPosterResultCurrent(result, currentRecord)) return null;
    // 本地缓存里的 shareId 不能证明云端快照仍然存在，交给预览页重新确认。
    return { ...result, shareReady: false, shareError: '' };
  } catch (error) {
    return null;
  }
}

function getPosterResult(jobId) {
  if (!jobId) return null;
  try {
    return wx.getStorageSync(`${RESULT_KEY_PREFIX}${String(jobId).trim()}`) || null;
  } catch (error) {
    return null;
  }
}

function removePosterResult(jobId) {
  if (!jobId) return;
  try {
    wx.removeStorageSync(`${RESULT_KEY_PREFIX}${String(jobId).trim()}`);
  } catch (error) {
    // 临时结果清理失败不影响当前页面。
  }
}

function addPosterCoverFileID(fileIDs, value) {
  const fileID = String(value || '').trim();
  if (fileID) fileIDs.add(fileID);
}

function collectPosterCoverFileIDs(result, fileIDs) {
  if (!result || typeof result !== 'object') return;
  addPosterCoverFileID(fileIDs, result.posterImage && result.posterImage.fileID);
  addPosterCoverFileID(fileIDs, result.coverFileID);
  if (result.coverImage && typeof result.coverImage === 'object') {
    addPosterCoverFileID(fileIDs, result.coverImage.fileID);
  }
  if (result.sourceImage && result.sourceImage.kind === 'cover') {
    addPosterCoverFileID(fileIDs, result.sourceImage.fileID);
  }
  const shareRecords = result.shareArchive && Array.isArray(result.shareArchive.records)
    ? result.shareArchive.records
    : [];
  shareRecords.forEach(record => {
    const media = record && record.media && typeof record.media === 'object'
      ? record.media
      : {};
    addPosterCoverFileID(fileIDs, media.coverFileID);
  });
}

function getPendingPosterCoverFileIDs() {
  try {
    const pending = wx.getStorageSync(`${POSTER_RESET_KEY}_pending`);
    return Array.isArray(pending)
      ? pending.map(value => String(value || '').trim()).filter(Boolean)
      : [];
  } catch (error) {
    return [];
  }
}

function deletePosterCoverFiles(fileIDs) {
  const list = Array.from(new Set(
    (Array.isArray(fileIDs) ? fileIDs : [])
      .map(value => String(value || '').trim())
      .filter(Boolean),
  ));
  if (!list.length) return Promise.resolve({ attempted: 0, deleted: 0, failed: 0 });
  if (!wx.cloud || typeof wx.cloud.deleteFile !== 'function') {
    return Promise.resolve({ attempted: list.length, deleted: 0, failed: list.length });
  }

  return (async () => {
    let deleted = 0;
    let failed = 0;
    // 云存储删除接口按小批次提交，避免历史记录较多时超过单次参数限制。
    for (let index = 0; index < list.length; index += 20) {
      const batch = list.slice(index, index + 20);
      const outcome = await new Promise(resolve => {
        wx.cloud.deleteFile({
          fileList: batch,
          success: () => resolve({ ok: true }),
          fail: error => resolve({ ok: false, error }),
        });
      });
      if (outcome.ok) deleted += batch.length;
      else failed += batch.length;
    }
    return { attempted: list.length, deleted, failed };
  })();
}

/**
 * 海报规则升级时只清理本机的派生海报缓存。
 *
 * 猫生图封面是猫卡和猫友图鉴依赖的正式云端资产，`coverFileID`、
 * `encounters.media`、`cat_profiles` 以及云存储文件都不能在启动迁移里删除。
 * 海报 PNG 与猫生图是两种独立资产：前者用于保存/分享海报，后者用于猫卡展示。
 */
async function resetPosterArtifacts(options = {}) {
  if (typeof wx === 'undefined') return { reset: false, skipped: 'wx_unavailable' };

  const force = options.force === true;
  let marker = null;
  try {
    marker = wx.getStorageSync(POSTER_RESET_KEY);
  } catch (error) {
    marker = null;
  }
  if (!force && marker && marker.version === POSTER_RESET_VERSION) {
    return { reset: false, version: POSTER_RESET_VERSION };
  }

  let removedCacheCount = 0;
  let keys = [];
  try {
    const info = wx.getStorageInfoSync();
    keys = Array.isArray(info && info.keys) ? info.keys : [];
  } catch (error) {
    keys = [];
  }

  keys.filter(key => String(key).startsWith(RESULT_KEY_PREFIX)).forEach(key => {
    try {
      wx.removeStorageSync(key);
      removedCacheCount += 1;
    } catch (error) {
      // 单条旧缓存损坏时继续清理其他海报缓存。
    }
  });

  const clearedShareIdCount = typeof storage.clearShareIds === 'function'
    ? storage.clearShareIds()
    : 0;
  try {
    // 清掉旧版本可能留下的待删除队列，但永远不再消费其中的 fileID。
    wx.removeStorageSync(`${POSTER_RESET_KEY}_pending`);
  } catch (error) {
    // 本地清理标记写入失败不影响云端正式档案。
  }

  const result = {
    reset: true,
    version: POSTER_RESET_VERSION,
    resetAt: Date.now(),
    clearedRecordCount: 0,
    clearedShareIdCount,
    removedCacheCount,
    deletedCoverCount: 0,
    failedCoverCount: 0,
    cloudCleanup: {
      ok: true,
      skipped: 'PRESERVE_CLOUD_ARCHIVE_ASSETS',
    },
  };

  try {
    wx.setStorageSync(POSTER_RESET_KEY, result);
  } catch (error) {
    // 标记写入失败不影响本次本地缓存清理。
  }
  return result;
}

module.exports = {
  TEMPLATE_VERSION,
  COVER_PROMPT_VERSION,
  METRIC_ORDER,
  normalizePosterScore,
  buildScoreSnapshot,
  createPosterJobId,
  getStablePosterJobId,
  getCurrentRecordId,
  buildPosterData,
  isPosterResultCurrent,
  applyPosterCover,
  buildPublicArchive,
  buildLocalShareArchive,
  buildPosterPersistencePayload,
  getSavedPosterResult,
  savePosterResult,
  getCachedPosterResult,
  getPosterResult,
  removePosterResult,
  resetPosterArtifacts,
};
