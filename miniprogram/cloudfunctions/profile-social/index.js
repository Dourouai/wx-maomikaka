const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
  timeout: 30000,
});

const db = cloud.database();
const PROFILE_SHARES_COLLECTION = 'profile_shares';
const FOLLOWS_COLLECTION = 'user_follows';
const USERS_COLLECTION = 'users';
const PROFILES_COLLECTION = 'cat_profiles';
const ENCOUNTERS_COLLECTION = 'encounters';
const DATA_SCHEMA_VERSION = 1;
const MAX_CATS = 60;
const MAX_ENCOUNTERS = 300;
const MAX_SHARE_ID_LENGTH = 96;
const PROFILE_SHARE_PATTERN = /^profileshare_[A-Za-z0-9_-]{16,96}$/;
const PLACEHOLDER_NICKNAMES = new Set(['微信用户']);
const LEVELS = {
  C: { label: '街角' },
  U: { label: '偶见' },
  R: { label: '稀遇' },
  SR: { label: '惊鸿' },
  UR: { label: '神隐' },
};

function createError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function trimString(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function getDisplayName(value, fallback) {
  const name = trimString(value, 40);
  return name && !PLACEHOLDER_NICKNAMES.has(name.toLowerCase()) ? name : fallback;
}

function normalizeShareId(value) {
  const shareId = trimString(value, MAX_SHARE_ID_LENGTH);
  return PROFILE_SHARE_PATTERN.test(shareId) ? shareId : '';
}

function getOpenId() {
  const context = cloud.getWXContext();
  const openid = trimString(context && context.OPENID, 128);
  if (!openid) throw createError('IDENTITY_UNAVAILABLE', '当前微信身份暂时不可用');
  return openid;
}

function getOptionalOpenId() {
  try {
    const context = cloud.getWXContext();
    return trimString(context && context.OPENID, 128);
  } catch (error) {
    return '';
  }
}

function isMissing(error) {
  const code = String(error && (error.errCode || error.code) || '').toLowerCase();
  const message = String(error && (error.errMsg || error.message) || '').toLowerCase();
  return code.includes('not_exist')
    || code.includes('notfound')
    || code.includes('not_found')
    || message.includes('not exist')
    || message.includes('not found')
    || (message.includes('collection') && message.includes('not'))
    || message.includes('不存在');
}

function createCollectionConfigError(collectionName, cause) {
  const error = createError(
    'PROFILE_SOCIAL_NOT_CONFIGURED',
    `主页服务缺少数据库集合 ${collectionName}，请先完成数据库初始化`,
  );
  error.collection = collectionName;
  error.cause = String(cause && (cause.errMsg || cause.message) || '');
  return error;
}

async function setCollectionDocument(collectionName, documentId, data) {
  try {
    return await db.collection(collectionName).doc(documentId).set({ data });
  } catch (error) {
    if (isMissing(error)) throw createCollectionConfigError(collectionName, error);
    throw error;
  }
}

async function updateCollectionDocument(collectionName, documentId, data) {
  try {
    return await db.collection(collectionName).doc(documentId).update({ data });
  } catch (error) {
    if (isMissing(error)) throw createCollectionConfigError(collectionName, error);
    throw error;
  }
}

async function safeGet(query) {
  try {
    return await query.get();
  } catch (error) {
    if (isMissing(error)) return { data: [] };
    throw error;
  }
}

async function getDocument(collection, id) {
  try {
    const result = await db.collection(collection).doc(id).get();
    return result && result.data ? result.data : null;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

function createProfileShareId() {
  return `profileshare_${crypto.randomBytes(18).toString('hex')}`;
}

function createFollowId(followerOpenId, followingOpenId) {
  return crypto
    .createHash('sha256')
    .update(`${followerOpenId}:${followingOpenId}`)
    .digest('hex');
}

function normalizeScore(score) {
  const source = score && typeof score === 'object' ? score : {};
  const overall = Number(source.overallScore);
  return Number.isFinite(overall) ? Math.round(Math.max(0, Math.min(100, overall))) : 0;
}

function getLevel(score) {
  const source = score && typeof score === 'object' ? score : {};
  const code = LEVELS[source.levelCode] ? source.levelCode : 'C';
  return { code, label: LEVELS[code].label };
}

function getMediaFileId(record) {
  const media = record && record.media && typeof record.media === 'object'
    ? record.media
    : {};
  const posterResult = media.posterResult && typeof media.posterResult === 'object'
    ? media.posterResult
    : {};
  const sourceImage = posterResult.sourceImage && typeof posterResult.sourceImage === 'object'
    ? posterResult.sourceImage
    : {};
  const coverFileID = trimString(
    media.coverFileID
      || record.coverFileID
      || (posterResult.coverImage && posterResult.coverImage.fileID)
      || (sourceImage.kind === 'cover' ? sourceImage.fileID : ''),
    512,
  );
  const coverStatus = trimString(
    media.coverStatus
      || (record && record.coverStatus)
      || posterResult.coverStatus
      || sourceImage.status
      || (coverFileID ? 'ready' : ''),
    20,
  ).toLowerCase();
  return trimString(
    // 公开主页同样按 cover → cutout → original；完整海报永远不作为缩略图。
    (coverStatus === 'ready' ? coverFileID : '')
      || media.cutoutFileID
      || sourceImage.cutoutFileID
      || media.originalFileID
      || sourceImage.originalFileID
      || '',
    512,
  );
}

function getRecordTime(record) {
  const value = record && (record.createdAt || record.capturedAt || record.importedAt);
  if (value && typeof value === 'object') {
    if (value.$date !== undefined) return getRecordTime({ createdAt: value.$date });
    if (value.value !== undefined) return getRecordTime({ createdAt: value.value });
    if (value.seconds !== undefined) return Number(value.seconds) * 1000;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) ? time : 0;
}

function chooseCurrentEncounter(records) {
  return (Array.isArray(records) ? records : []).reduce((latest, current) => {
    if (!latest) return current;
    return getRecordTime(current) > getRecordTime(latest) ? current : latest;
  }, null);
}

async function getTempURLMap(fileIds) {
  if (!fileIds.length || typeof cloud.getTempFileURL !== 'function') return {};
  const urlMap = {};
  // 云存储单次最多换取 50 个 fileID，主页猫卡较多时分批处理。
  for (let index = 0; index < fileIds.length; index += 50) {
    const batch = fileIds.slice(index, index + 50);
    try {
      const response = await cloud.getTempFileURL({ fileList: batch });
      const result = response && Array.isArray(response.fileList) ? response.fileList : [];
      result.forEach(item => {
        const fileId = trimString(item && item.fileID, 512);
        const url = trimString(item && (item.tempFileURL || item.tempFileUrl), 2048);
        if (fileId && url) urlMap[fileId] = url;
      });
    } catch (error) {
      console.warn('[profile-social] 获取公开图片临时地址失败:', error);
    }
  }
  return urlMap;
}

async function createShare(event) {
  const ownerOpenId = getOpenId();
  const requested = normalizeShareId(event && event.profileShareId);
  const existing = requested ? await getDocument(PROFILE_SHARES_COLLECTION, requested) : null;
  if (existing && existing.ownerOpenId && existing.ownerOpenId !== ownerOpenId) {
    throw createError('PROFILE_SHARE_ID_CONFLICT', '主页分享码暂时不可用，请重新生成');
  }

  const profileShareId = requested || createProfileShareId();
  await setCollectionDocument(PROFILE_SHARES_COLLECTION, profileShareId, {
    schemaVersion: DATA_SCHEMA_VERSION,
    ownerOpenId,
    profileShareId,
    status: 'active',
    createdAt: existing && existing.createdAt ? existing.createdAt : db.serverDate(),
    updatedAt: db.serverDate(),
    lastSharedAt: db.serverDate(),
  });

  return { ok: true, profileShareId };
}

async function resolveOwner(profileShareId) {
  const normalized = normalizeShareId(profileShareId);
  if (!normalized) throw createError('PROFILE_SHARE_ID_REQUIRED', '主页分享码无效');
  const share = await getDocument(PROFILE_SHARES_COLLECTION, normalized);
  if (!share || share.status !== 'active' || !share.ownerOpenId) {
    throw createError('PROFILE_NOT_FOUND', '这份个人主页已失效');
  }
  return { profileShareId: normalized, ownerOpenId: share.ownerOpenId };
}

async function loadPublicCats(ownerOpenId) {
  const [profilesResult, encountersResult] = await Promise.all([
    safeGet(db.collection(PROFILES_COLLECTION)
      .where({ ownerOpenId, status: 'active' })
      .limit(MAX_CATS)),
    safeGet(db.collection(ENCOUNTERS_COLLECTION)
      .where({ ownerOpenId })
      .limit(MAX_ENCOUNTERS)),
  ]);
  // 猫卡私密是服务端边界：个人主页不能通过历史接口绕过猫卡隐私设置。
  const profiles = profilesResult && Array.isArray(profilesResult.data)
    ? profilesResult.data.filter(profile => profile && profile.visibility !== 'private')
    : [];
  const encounters = encountersResult && Array.isArray(encountersResult.data)
    ? encountersResult.data.filter(item => item && item.status === 'active')
    : [];
  const encountersByCat = encounters.reduce((map, encounter) => {
    const catId = trimString(encounter && encounter.catalogCatId, 64);
    if (!catId) return map;
    if (!map[catId]) map[catId] = [];
    map[catId].push(encounter);
    return map;
  }, {});

  const rows = profiles.map(profile => {
    const catalogCatId = trimString(profile.catalogCatId, 64);
    const records = encountersByCat[catalogCatId] || [];
    const current = chooseCurrentEncounter(records);
    const display = (current && current.display) || {};
    const level = getLevel(current && current.score);
    const description = trimString(
      profile.displayDescription || display.description,
      120,
    );
    return {
      catalogCatId,
      displayName: trimString(profile.displayName || display.name || '未命名猫卡', 40),
      levelCode: level.code,
      levelLabel: level.label,
      overallScore: normalizeScore(current && current.score),
      recordCount: Math.max(0, Number(profile.encounterCount) || records.length),
      posterCopy: trimString(profile.displayPosterCopy || display.posterCopy || description, 52),
      description,
      photoFileID: getMediaFileId(current),
      archiveCode: trimString(current && current.archiveCode, 32),
    };
  });

  rows.sort((left, right) => right.overallScore - left.overallScore);
  return {
    cats: rows,
    recordCount: rows.reduce((total, row) => total + row.recordCount, 0),
  };
}

async function countFollow(query) {
  const result = await safeGet(query.limit(1000));
  return result && Array.isArray(result.data)
    ? result.data.filter(item => item && item.status === 'active').length
    : 0;
}

async function getPublicProfile(event) {
  // 公开主页只读内容不要求登录；只有关注操作才需要身份。
  const viewerOpenId = getOptionalOpenId();
  const { profileShareId, ownerOpenId } = await resolveOwner(event && event.profileShareId);
  const [user, publicCats, followerCount, followingCount, followRecord] = await Promise.all([
    getDocument(USERS_COLLECTION, ownerOpenId),
    loadPublicCats(ownerOpenId),
    countFollow(db.collection(FOLLOWS_COLLECTION).where({
      followingOpenId: ownerOpenId,
      status: 'active',
    })),
    countFollow(db.collection(FOLLOWS_COLLECTION).where({
      followerOpenId: ownerOpenId,
      status: 'active',
    })),
    viewerOpenId === ownerOpenId
      ? Promise.resolve(null)
      : getDocument(FOLLOWS_COLLECTION, createFollowId(viewerOpenId, ownerOpenId)),
  ]);
  const profile = user && user.profile && typeof user.profile === 'object' ? user.profile : {};
  const avatarFileID = trimString(profile.avatarFileID, 512);
  const urls = await getTempURLMap([
    avatarFileID,
    ...publicCats.cats.map(item => item.photoFileID),
  ].filter(Boolean));

  const cats = publicCats.cats.map(item => ({
    catalogCatId: item.catalogCatId,
    displayName: item.displayName,
    levelCode: item.levelCode,
    levelLabel: item.levelLabel,
    overallScore: item.overallScore,
    recordCount: item.recordCount,
    posterCopy: item.posterCopy,
    description: item.description,
    archiveCode: item.archiveCode,
    photoTempURL: urls[item.photoFileID] || '',
  }));
  return {
    ok: true,
    profileShareId,
    profile: {
      name: getDisplayName(profile.nickName, '街角观察员'),
      avatarTempURL: urls[avatarFileID] || '',
    },
    stats: {
      catCount: cats.length,
      recordCount: publicCats.recordCount,
      followerCount,
      followingCount,
      isFollowing: Boolean(followRecord && followRecord.status === 'active'),
    },
    cats,
  };
}

async function updateFollow(event, shouldFollow) {
  const followerOpenId = getOpenId();
  const { ownerOpenId } = await resolveOwner(event && event.profileShareId);
  if (followerOpenId === ownerOpenId) {
    throw createError('CANNOT_FOLLOW_SELF', '不能关注自己');
  }

  const followId = createFollowId(followerOpenId, ownerOpenId);
  const existing = await getDocument(FOLLOWS_COLLECTION, followId);
  if (shouldFollow) {
    await setCollectionDocument(FOLLOWS_COLLECTION, followId, {
      schemaVersion: DATA_SCHEMA_VERSION,
      followerOpenId,
      followingOpenId: ownerOpenId,
      status: 'active',
      createdAt: existing && existing.createdAt ? existing.createdAt : db.serverDate(),
      updatedAt: db.serverDate(),
    });
  } else if (existing) {
    await updateCollectionDocument(FOLLOWS_COLLECTION, followId, {
      status: 'removed',
      updatedAt: db.serverDate(),
    });
  }

  return { ok: true, isFollowing: shouldFollow };
}

exports.main = async (event = {}) => {
  const action = String(event.action || 'get');
  if (action === 'create') return createShare(event);
  if (action === 'get') return getPublicProfile(event);
  if (action === 'follow') return updateFollow(event, true);
  if (action === 'unfollow') return updateFollow(event, false);
  throw createError('INVALID_ACTION', '不支持的主页操作');
};
