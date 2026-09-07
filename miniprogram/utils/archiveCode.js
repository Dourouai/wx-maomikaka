// 猫咪咔咔｜生成图片/海报的公开展示编号。
//
// 该编号只用于用户看到的图片档案标识，不替代 catId、recordId、shareId，
// 也不承载 openid 等身份信息。格式：YYYYMMDD + 6 位大写数字/字母。
const STORAGE_KEY = 'maomikaka_archive_codes_v1';
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const CODE_PATTERN = /^\d{8}[0-9A-Z]{6}$/;

function normalizeArchiveCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : '';
}

function isValidArchiveCode(value) {
  return Boolean(normalizeArchiveCode(value));
}

function toDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function dateStamp(value) {
  const date = toDate(value);
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function randomSuffix(random = Math.random) {
  let suffix = '';
  for (let index = 0; index < 6; index += 1) {
    const raw = Number(random());
    const fallback = Math.random();
    const value = Number.isFinite(raw) ? raw : fallback;
    const normalized = Math.max(0, Math.min(0.999999999, value));
    suffix += ALPHABET[Math.floor(normalized * ALPHABET.length)];
  }
  return suffix;
}

function createArchiveCode(date = new Date(), random = Math.random) {
  return `${dateStamp(date)}${randomSuffix(random)}`;
}

function readCodeMap() {
  if (typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') return {};
  try {
    const value = wx.getStorageSync(STORAGE_KEY);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (error) {
    return {};
  }
}

function writeCodeMap(map) {
  if (typeof wx === 'undefined' || typeof wx.setStorageSync !== 'function') return;
  try {
    wx.setStorageSync(STORAGE_KEY, map);
  } catch (error) {
    // 编号已经可以在本次页面使用；本地存储失败不阻断生成图片。
  }
}

function findAvailableCode(date, usedCodes) {
  let code = createArchiveCode(date);
  for (let attempt = 0; attempt < 24 && usedCodes.has(code); attempt += 1) {
    code = createArchiveCode(date);
  }
  if (!usedCodes.has(code)) return code;

  // 仅在随机源连续碰撞时启用可复现兜底，保证同一设备内不重复。
  const stamp = dateStamp(date);
  for (let sequence = 0; sequence < ALPHABET.length ** 6; sequence += 1) {
    const suffix = sequence.toString(36).toUpperCase().padStart(6, '0');
    code = `${stamp}${suffix}`;
    if (!usedCodes.has(code)) return code;
  }
  return createArchiveCode(date);
}

function getOrCreateArchiveCode(scopeKey, date = new Date()) {
  const key = String(scopeKey || '').trim().slice(0, 256);
  const map = readCodeMap();
  const existing = normalizeArchiveCode(map[key]);
  if (key && existing) {
    if (map[key] !== existing) {
      map[key] = existing;
      writeCodeMap(map);
    }
    return existing;
  }

  const usedCodes = new Set(
    Object.keys(map)
      .map(itemKey => normalizeArchiveCode(map[itemKey]))
      .filter(Boolean),
  );
  const code = findAvailableCode(toDate(date), usedCodes);
  if (key) {
    map[key] = code;
    writeCodeMap(map);
  }
  return code;
}

module.exports = {
  CODE_PATTERN,
  createArchiveCode,
  getOrCreateArchiveCode,
  isValidArchiveCode,
  normalizeArchiveCode,
};
