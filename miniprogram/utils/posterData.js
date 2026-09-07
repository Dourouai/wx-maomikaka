// 猫咪咔咔｜猫档案 → 海报数据快照
// 详情页、Canvas 和分享页都只消费这里输出的 posterData。
const storage = require('./storage');
const catShare = require('./catShare');
const catScoring = require('./catScoring');
const cloudFiles = require('./cloudFiles');
const archiveIds = require('./archiveCode');
const posterResultSchema = require('./posterResult');
const { getCatById } = require('./catData');

const TEMPLATE_VERSION = 'cat-archive-poster-v0.9';
const RESULT_KEY_PREFIX = 'maomikaka_poster_result_';
const POSTER_CACHE_VERSION = 'cat-poster-cache.v0.7';
const POSTER_RESET_VERSION = 'cat-poster-rules-reset.v0.7';
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
  const originalTempURL = media.originalTempURL || item.originalTempURL || '';
  const cutoutTempURL = media.cutoutTempURL || item.cutoutTempURL || '';
  const coverTempURL = media.coverTempURL || item.coverTempURL || '';

  return {
    recordId: id,
    clientRecordId: id,
    catId: item.catalogCatId || fallbackCatId,
    archiveCode: archiveIds.normalizeArchiveCode(item.archiveCode),
    catName: display.name || item.catName || '',
    catDescription: display.description || item.catDescription || '',
    posterCopy: display.posterCopy || item.posterCopy || '',
    posterResult: media.posterResult || null,
    copyVersion: display.copyVersion || item.copyVersion || '',
    photoPath: item.photoPath || item.photo || originalTempURL || cutoutTempURL,
    photo: item.photo || originalTempURL,
    originalPhotoPath: item.originalPhotoPath || originalTempURL,
    cutoutPhotoPath: item.cutoutPhotoPath || cutoutTempURL,
    coverPhotoPath: item.coverPhotoPath || coverTempURL,
    originalFileID: media.originalFileID || item.originalFileID || '',
    originalContentType: media.originalContentType || item.originalContentType || '',
    cutoutFileID: media.cutoutFileID || item.cutoutFileID || '',
    coverFileID: media.coverFileID || item.coverFileID || '',
    originalTempURL,
    cutoutTempURL,
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
    coverStatus: media.coverStatus || item.coverStatus || '',
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
  const hasCurrentCover = value.coverStatus === 'ready';
  const candidates = [
    // 只有明确标记 ready 的封面图才可以替代原图进入海报。
    ...(hasCurrentCover
      ? [{
        path: value.coverPhotoPath || value.coverTempURL,
        kind: 'cover',
        fileID: value.coverFileID || '',
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

  for (const candidate of getImagePathCandidates(record)) {
    try {
      const info = await getImageInfo(candidate.path);
      return { ...candidate, ...info };
    } catch (error) {
      // 临时地址失效时继续尝试 fileID 或主体图。
    }
  }

  const fileCandidates = [
    ...(record.coverStatus === 'ready'
      ? [{ fileID: record.coverFileID, kind: 'cover' }]
      : []),
    { fileID: record.originalFileID, kind: 'original' },
    { fileID: record.cutoutFileID, kind: 'cutout' },
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

async function findSourceImage(records, preferredRecordId) {
  const ordered = sortRecords(records);
  const preferred = preferredRecordId
    ? ordered.find(record => recordId(record) === preferredRecordId)
    : null;
  const candidates = preferred
    ? [preferred, ...ordered.filter(record => record !== preferred)]
    : ordered;

  for (const record of candidates) {
    const image = await resolveRecordImage(record);
    if (image) return { record, image };
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
    records: records.slice(0, 50).map(record => ({
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
        coverFileID: record.coverFileID || '',
        coverContentType: record.coverContentType || '',
        coverProvider: record.coverProvider || '',
        coverModel: record.coverModel || '',
        coverOperation: record.coverOperation || '',
        coverPromptVersion: record.coverPromptVersion || '',
        coverTargetRatio: record.coverTargetRatio || '359:537',
        coverStatus: record.coverStatus || '',
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
    })),
  };
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
  return {
    catId,
    records: sortRecords(storage.getRecordsForCat(catId)),
    profile: {
      name: entry.displayName,
      description: entry.displayDescription,
      posterCopy: entry.posterCopy,
    },
    featuredRecordId: options.recordId || entry.featuredRecordId || '',
    archiveCode: '',
    shareId: storage.getShareId(catId),
    shareArchive: null,
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
  const featuredRecordId = source.featuredRecordId || recordId(records[0]);
  const currentRecord = records[0];
  const currentEncounter = currentRecord ? catScoring.getStoredEncounter(currentRecord) : null;
  const currentLevel = catScoring.getLevelMeta(currentEncounter ? currentEncounter.levelCode : 'C');
  const sourceResult = await findSourceImage(records, featuredRecordId);
  if (!sourceResult || !sourceResult.image || !sourceResult.image.path) {
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
    sourceResult.record ? recordId(sourceResult.record) : featuredRecordId,
  );
  const scores = buildScoreSnapshot(currentEncounter, currentRecord);
  const sourceArchiveCode = getRecordArchiveCode(
    sourceResult.record,
    source.catId,
    source.archiveCode,
  );
  const sourceCover = sourceResult.image.kind === 'cover'
    ? {
      path: sourceResult.image.path,
      fileID: sourceResult.image.fileID || '',
      width: sourceResult.image.width,
      height: sourceResult.image.height,
      contentType: sourceResult.record.coverContentType || '',
      provider: sourceResult.record.coverProvider || '',
      model: sourceResult.record.coverModel || '',
      operation: sourceResult.record.coverOperation || 'image-to-image-poster-cover',
      promptVersion: sourceResult.record.coverPromptVersion || COVER_PROMPT_VERSION,
      targetRatio: sourceResult.record.coverTargetRatio || '359:537',
      status: 'ready',
      requestId: sourceResult.record.coverRequestId || '',
      createdAt: sourceResult.record.coverCreatedAt || '',
      version: 'cat-cover.v0.3',
    }
    : null;

  return {
    posterJobId: options.posterJobId || createPosterJobId(),
    templateVersion: TEMPLATE_VERSION,
    sourceArchiveId: source.catId,
    sourceRecordId: sourceResult.record ? recordId(sourceResult.record) : featuredRecordId,
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
      path: sourceResult.image.path,
      kind: sourceResult.image.kind,
      width: sourceResult.image.width,
      height: sourceResult.image.height,
      fileID: sourceResult.image.fileID || '',
      originalFileID: sourceResult.record.originalFileID || '',
      originalContentType: sourceResult.record.originalContentType || '',
      cutoutFileID: sourceResult.record.cutoutFileID || '',
      sceneSeed: sourceArchiveCode
        || source.catId
        || recordId(sourceResult.record)
        || '',
      version: sourceResult.image.kind === 'cover'
        ? 'cat-cover.v0.3'
        : (sourceResult.image.kind === 'cutout' ? 'cat-transform.v1' : 'safe-original.v1'),
    },
    coverImage: sourceCover,
    coverStatus: sourceResult.record.coverStatus || '',
    coverRejectReason: sourceResult.record.coverRejectReason || '',
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

  // 封面成功后按“猫档案 + 相遇记录 + 模板版本”固定缓存；
  // 后续重复打开优先复用最终海报，临时 PNG 失效时也只重绘 Canvas。
  if (result.isShared !== true
    && result.coverStatus === 'ready'
    && result.sourceArchiveId
    && result.sourceRecordId) {
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
  const selectedId = options.recordId || source.featuredRecordId || recordId(source.records[0]);
  let saved;
  if (source.isShared) {
    const record = source.records.find(item => recordId(item) === selectedId) || source.records[0];
    saved = record && record.posterResult;
  } else {
    saved = await require('./userData').getPosterResult(source.catId, selectedId);
    if (saved && saved.coverImage && saved.coverImage.fileID) {
      storage.updateRecordCover(selectedId, saved.coverImage);
    }
  }
  if (!saved || !saved.posterImage || !saved.posterImage.fileID) return null;
  // 地址失效时重新换取地址；读取失败交给页面重试，不悄悄重新生成。
  const url = saved.posterTempURL || await cloudFiles.getTempFileURL(saved.posterImage.fileID);
  const image = await getImageInfo(url);
  return {
    ...saved, posterPath: image.path, isShared: source.isShared,
    shareId: source.shareId, shareArchive: source.shareArchive,
    shareReady: Boolean(source.shareId), ratio: '9:16',
  };
}

function getCachedPosterResult(sourceArchiveId, sourceRecordId) {
  const key = getPosterCacheKey(sourceArchiveId, sourceRecordId);
  if (!key) return null;
  try {
    const result = wx.getStorageSync(key);
    if (!result || typeof result !== 'object') return null;
    if (result.coverStatus !== 'ready' || !result.sourceArchiveId || !result.sourceRecordId) {
      return null;
    }
    return result;
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
 * 海报规则升级时清理旧海报缓存和 poster-cover 产物。
 * 同步清理当前账号的云端分享快照与数据库封面字段，不删除原图、主体图、档案、评分或奖励数据。
 */
async function resetPosterArtifacts(options = {}) {
  if (typeof wx === 'undefined') return { reset: false, skipped: 'wx_unavailable' };

  const force = options.force === true;
  const pendingFileIDs = getPendingPosterCoverFileIDs();
  let marker = null;
  try {
    marker = wx.getStorageSync(POSTER_RESET_KEY);
  } catch (error) {
    marker = null;
  }
  if (!force
    && marker
    && marker.version === POSTER_RESET_VERSION
    && pendingFileIDs.length === 0) {
    return { reset: false, version: POSTER_RESET_VERSION };
  }

  const fileIDs = new Set(pendingFileIDs);
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
      collectPosterCoverFileIDs(wx.getStorageSync(key), fileIDs);
      wx.removeStorageSync(key);
      removedCacheCount += 1;
    } catch (error) {
      // 单条旧缓存损坏时继续清理其他海报缓存。
    }
  });

  const cleared = storage.clearAllRecordCovers();
  const clearedShareIdCount = typeof storage.clearShareIds === 'function'
    ? storage.clearShareIds()
    : 0;
  (cleared.fileIDs || []).forEach(fileID => addPosterCoverFileID(fileIDs, fileID));
  let cloudCleanup = null;
  let cloudCleanupFailed = false;
  try {
    cloudCleanup = await catShare.clearPosterArtifacts();
    if (!cloudCleanup || cloudCleanup.ok !== true) {
      cloudCleanupFailed = true;
    }
    (cloudCleanup && Array.isArray(cloudCleanup.coverFileIDs)
      ? cloudCleanup.coverFileIDs
      : []
    ).forEach(fileID => addPosterCoverFileID(fileIDs, fileID));
  } catch (error) {
    cloudCleanupFailed = true;
    cloudCleanup = {
      ok: false,
      code: String(error && (error.code || error.errCode) || 'POSTER_CLOUD_CLEANUP_FAILED'),
      message: String(error && (error.message || error.errMsg) || '云端海报数据清理失败')
        .replace(/\s+/g, ' ')
        .slice(0, 240),
    };
    console.warn('[PosterData] 云端海报产物清理失败，将在下次生成时重试:', cloudCleanup);
  }
  const filesToDelete = Array.from(fileIDs);
  try {
    wx.setStorageSync(`${POSTER_RESET_KEY}_pending`, filesToDelete);
  } catch (error) {
    // 云文件删除仍可继续；失败时由当前结果记录提示。
  }

  const deletion = await deletePosterCoverFiles(filesToDelete);
  const result = {
    reset: true,
    version: POSTER_RESET_VERSION,
    resetAt: Date.now(),
    clearedRecordCount: cleared.clearedCount || 0,
    clearedShareIdCount,
    removedCacheCount,
    deletedCoverCount: deletion.deleted,
    failedCoverCount: deletion.failed,
    cloudCleanup: cloudCleanup
      ? {
        ok: cloudCleanup.ok === true,
        clearedShareCount: Number(cloudCleanup.clearedShareCount) || 0,
        clearedEncounterCount: Number(cloudCleanup.clearedEncounterCount) || 0,
        code: cloudCleanup.ok === true ? '' : String(cloudCleanup.code || ''),
      }
      : null,
  };

  if (deletion.failed === 0 && !cloudCleanupFailed) {
    try {
      wx.removeStorageSync(`${POSTER_RESET_KEY}_pending`);
      wx.setStorageSync(POSTER_RESET_KEY, result);
    } catch (error) {
      // 标记写入失败不影响本次清理；下次进入时最多重复检查一次。
    }
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
  buildPosterData,
  applyPosterCover,
  buildPublicArchive,
  buildPosterPersistencePayload,
  getSavedPosterResult,
  savePosterResult,
  getCachedPosterResult,
  getPosterResult,
  removePosterResult,
  resetPosterArtifacts,
};
