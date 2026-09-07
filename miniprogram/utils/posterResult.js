// 海报结果的轻量云端快照。
//
// 最终 Canvas PNG 上传云存储，数据库保存 fileID 与排版快照。
// 临时路径只用于本地预览，不写入 encounters。

const POSTER_RESULT_SCHEMA_VERSION = 1;
const DEFAULT_POSTER_CACHE_VERSION = 'cat-poster-cache.v0.7';

function text(value, maxLength) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function number(value, fallback = 0, min = 0, max = 100) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function normalizeImageRef(value, options = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const includeCoverMetadata = options.includeCoverMetadata === true;
  const image = {
    kind: text(source.kind, 20),
    fileID: text(source.fileID || source.coverFileID, 512),
    width: number(source.width, 0, 0, 10000),
    height: number(source.height, 0, 0, 10000),
    version: text(source.version, 120),
  };

  if (source.originalFileID || source.originalContentType) {
    image.originalFileID = text(source.originalFileID, 512);
    image.originalContentType = text(source.originalContentType, 64);
  }
  if (source.cutoutFileID) image.cutoutFileID = text(source.cutoutFileID, 512);

  if (includeCoverMetadata) {
    image.contentType = text(source.contentType, 64);
    image.provider = text(source.provider, 80);
    image.model = text(source.model, 160);
    image.operation = text(source.operation, 120);
    image.promptVersion = text(source.promptVersion, 120);
    image.targetRatio = text(source.targetRatio, 20);
    image.status = text(source.status, 20);
    image.requestId = text(source.requestId, 160);
    image.createdAt = text(source.createdAt, 80);
  }

  return image;
}

function normalizePosterResult(value, options = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const sourceArchiveId = text(source.sourceArchiveId || source.catalogCatId, 64);
  const sourceRecordId = text(source.sourceRecordId || source.clientRecordId, 128);
  if (!sourceArchiveId || !sourceRecordId) return null;

  const traits = Array.isArray(source.traits)
    ? source.traits.slice(0, 3).map(trait => text(trait, 40)).filter(Boolean)
    : [];
  const scores = source.scores && typeof source.scores === 'object' ? source.scores : {};
  const coverImage = source.coverImage && typeof source.coverImage === 'object'
    ? normalizeImageRef({
      kind: 'cover',
      ...source.coverImage,
      fileID: source.coverImage.fileID || source.coverFileID,
      status: source.coverImage.status || source.coverStatus,
      promptVersion: source.coverImage.promptVersion || source.coverPromptVersion,
    }, { includeCoverMetadata: true })
    : null;
  const generatedAt = source.generatedAt || source.createdAt || null;
  const normalized = {
    schemaVersion: POSTER_RESULT_SCHEMA_VERSION,
    status: source.status === 'failed' ? 'failed' : 'ready',
    posterJobId: text(source.posterJobId || source.jobId, 128),
    templateVersion: text(source.templateVersion, 120),
    posterCacheVersion: text(
      source.posterCacheVersion || options.defaultCacheVersion,
      120,
    ) || DEFAULT_POSTER_CACHE_VERSION,
    sourceArchiveId,
    sourceRecordId,
    archiveCode: text(source.archiveCode, 32).toUpperCase(),
    levelCode: text(source.levelCode, 20),
    levelLabel: text(source.levelLabel, 40),
    levelShortLabel: text(source.levelShortLabel, 80),
    name: text(source.name, 40),
    breed: text(source.breed, 80),
    traits,
    copy: text(source.copy, 52),
    scores: {
      mika: number(scores.mika, 0),
      charm: number(scores.charm, 0),
      cleverness: number(scores.cleverness, 0),
      aura: number(scores.aura, 0),
    },
    sourceImage: normalizeImageRef(source.sourceImage),
    coverImage,
    coverStatus: text(source.coverStatus || (coverImage && coverImage.status), 20),
    coverRejectReason: text(source.coverRejectReason, 240),
    posterImage: normalizeImageRef({
      ...(source.posterImage || {}),
      fileID: source.posterImage && source.posterImage.fileID || '',
    }),
    shareId: text(source.shareId, 96),
    generatedAt,
  };

  return normalized;
}

function toPersistencePayload(result, options = {}) {
  const normalized = normalizePosterResult(result, options);
  if (!normalized || normalized.status !== 'ready') return null;
  return normalized;
}

module.exports = {
  POSTER_RESULT_SCHEMA_VERSION,
  DEFAULT_POSTER_CACHE_VERSION,
  normalizePosterResult,
  toPersistencePayload,
};
