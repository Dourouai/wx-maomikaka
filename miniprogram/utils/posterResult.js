// 海报结果的轻量云端快照。
//
// 最终 Canvas PNG 上传云存储，数据库保存 fileID 与排版快照。
// 临时路径只用于本地预览，不写入 encounters。

const POSTER_RESULT_SCHEMA_VERSION = 1;
const DEFAULT_POSTER_CACHE_VERSION = 'cat-poster-cache.v0.8';

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

function canonicalTime(value) {
  if (value === undefined || value === null || value === '') return '';
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return String(Math.round(numeric));
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? String(parsed) : String(value);
}

function imageIdentity(value) {
  const image = value && typeof value === 'object' ? value : {};
  return [
    text(image.kind, 20),
    text(image.fileID || image.coverFileID, 512),
    text(image.version, 120),
  ].join('\u0000');
}

/**
 * 判断两个结果是否来自同一份海报数据快照。
 *
 * posterImage.fileID 不参与比较：同一份快照在数据库写入失败后可能重新上传
 * 一次 PNG，但不能因此把它误判成新的海报。generatedAt 用来区分用户重新排版
 * 后的结果，保证评分、文案或封面发生变化时可以替换旧的成品。
 */
function isSamePosterSnapshot(left, right) {
  const a = normalizePosterResult(left);
  const b = normalizePosterResult(right);
  if (!a || !b) return false;

  const textFields = [
    'sourceArchiveId',
    'sourceRecordId',
    'templateVersion',
    'posterCacheVersion',
    'archiveCode',
    'levelCode',
    'levelLabel',
    'levelShortLabel',
    'name',
    'breed',
    'copy',
    'coverStatus',
  ];
  if (textFields.some(field => a[field] !== b[field])) return false;
  if (canonicalTime(a.generatedAt) !== canonicalTime(b.generatedAt)) return false;

  const scoreFields = ['mika', 'charm', 'cleverness', 'aura'];
  if (scoreFields.some(field => a.scores[field] !== b.scores[field])) return false;
  if (imageIdentity(a.sourceImage) !== imageIdentity(b.sourceImage)) return false;
  if (imageIdentity(a.coverImage) !== imageIdentity(b.coverImage)) return false;
  return true;
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
  isSamePosterSnapshot,
  toPersistencePayload,
};
