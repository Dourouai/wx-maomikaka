// 猫咪咔咔 - 用户成长会员等级
// 会员等级描述用户的长期猫咪记录成长，与单次相遇卡的 C / U / R / SR / UR 分开。

const MEMBER_LEVEL_VERSION = 'member-level.v0.1';

const MEMBER_LEVELS = [
  { code: 'LV1', level: 1, name: '街角新客', minGrowth: 0, maxGrowth: 299 },
  { code: 'LV2', level: 2, name: '巷口寻猫人', minGrowth: 300, maxGrowth: 799 },
  { code: 'LV3', level: 3, name: '城市漫游者', minGrowth: 800, maxGrowth: 1799 },
  { code: 'LV4', level: 4, name: '猫巷探索家', minGrowth: 1800, maxGrowth: 3599 },
  { code: 'LV5', level: 5, name: '城市冒险家', minGrowth: 3600, maxGrowth: null },
];

function normalizeGrowth(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

function getMemberLevel(growthValue) {
  const growth = normalizeGrowth(growthValue);
  let current = MEMBER_LEVELS[0];

  MEMBER_LEVELS.forEach(level => {
    if (growth >= level.minGrowth) current = level;
  });

  const currentIndex = MEMBER_LEVELS.findIndex(level => level.code === current.code);
  const next = MEMBER_LEVELS[currentIndex + 1] || null;
  const range = next ? next.minGrowth - current.minGrowth : 0;
  const withinLevel = Math.max(0, growth - current.minGrowth);

  return {
    ...current,
    growthValue: growth,
    levelLabel: `Lv.${current.level}`,
    nextCode: next ? next.code : null,
    nextLevel: next ? next.level : null,
    nextName: next ? next.name : null,
    nextGrowth: next ? next.minGrowth : null,
    growthToNext: next ? Math.max(next.minGrowth - growth, 0) : 0,
    progressPercent: next
      ? Math.min(100, Math.max(0, Math.round((withinLevel / range) * 100)))
      : 100,
    isMax: !next,
    version: MEMBER_LEVEL_VERSION,
  };
}

module.exports = {
  MEMBER_LEVEL_VERSION,
  MEMBER_LEVELS,
  normalizeGrowth,
  getMemberLevel,
};
