/**
 * 猫咪咔咔 - 猫咪图鉴数据
 * 共60只猫，分6大类，每类10只
 * 稀有度分布：N(普通) / R(稀有) / SR(超稀有) / SSR(传说)
 */

// ─────────────────────────────────────────
// 橘猫系 (cat_001 ~ cat_010)
// ─────────────────────────────────────────
const ORANGE_CATS = [
  {
    id: 'cat_001', name: '阿橘队长', breed: '短毛橘猫', rarity: 'SR',
    trait: ['霸道', '护食'],
    story: '据说它守着这条巷子已经三年了，谁也不知道它从哪里来。每天准时在路口巡逻，附近的猫都叫它队长。',
    color: '#FFA040',
  },
  {
    id: 'cat_002', name: '肥橘大人', breed: '短毛橘猫', rarity: 'R',
    trait: ['慵懒', '爱吃'],
    story: '体重已经超过了小区门卫大爷的警戒线，但它完全不在意，每天的目标就是吃饱睡着。',
    color: '#FF8C00',
  },
  {
    id: 'cat_003', name: '小橘子', breed: '短毛橘猫', rarity: 'N',
    trait: ['好奇', '活泼'],
    story: '刚满六个月，什么都想凑过去闻一闻，尤其对相机镜头特别感兴趣。',
    color: '#FFA040',
  },
  {
    id: 'cat_004', name: '橘皮先生', breed: '长毛橘猫', rarity: 'R',
    trait: ['傲娇', '爱干净'],
    story: '毛发蓬松如狮子鬃毛，每天花两小时梳理自己。有人靠近时会假装没看见，但其实在偷偷观察。',
    color: '#FF9520',
  },
  {
    id: 'cat_005', name: '橘将军', breed: '短毛橘猫', rarity: 'N',
    trait: ['威严', '慵懒'],
    story: '总是以最气派的姿势趴在最高处，俯视芸芸众生。但一到饭点就秒变小可爱。',
    color: '#E8890C',
  },
  {
    id: 'cat_006', name: '太阳橘', breed: '短毛橘猫', rarity: 'N',
    trait: ['温柔', '黏人'],
    story: '喜欢追着太阳光斑睡觉，不管到哪里都能找到最暖的那块地方。',
    color: '#FFB347',
  },
  {
    id: 'cat_007', name: '橘宝贝', breed: '短毛橘猫', rarity: 'N',
    trait: ['胆小', '可爱'],
    story: '一听到相机快门声就躲，但躲完又忍不住探出头来看看。',
    color: '#FFA040',
  },
  {
    id: 'cat_008', name: '霸王橘', breed: '短毛橘猫', rarity: 'R',
    trait: ['强势', '记仇'],
    story: '方圆三条街的猫都认识它，惹过它的没有一个有好果子吃。但对熟悉的人格外温柔。',
    color: '#E07010',
  },
  {
    id: 'cat_009', name: '金丝橘', breed: '长毛橘猫', rarity: 'SR',
    trait: ['优雅', '神秘'],
    story: '毛色在阳光下泛着金色光泽，走路轻如无声，偶尔出现又突然消失，像是城市里的精灵。',
    color: '#FFD700',
  },
  {
    id: 'cat_010', name: '橘色传说', breed: '短毛橘猫', rarity: 'SSR',
    trait: ['传奇', '万能'],
    story: '只有极少数人见过它真正的样子。据说它是所有橘猫的祖先，见到它的人当天会有好事发生。',
    color: '#FF6B00',
  },
]

// ─────────────────────────────────────────
// 白猫系 (cat_011 ~ cat_020)
// ─────────────────────────────────────────
const WHITE_CATS = [
  {
    id: 'cat_011', name: '雪球', breed: '纯白短毛猫', rarity: 'R',
    trait: ['安静', '优雅'],
    story: '像一团刚落下的雪，喜欢坐在窗台发呆，眼睛里倒映着外面的世界。',
    color: '#F0F0F0',
  },
  {
    id: 'cat_012', name: '棉花糖', breed: '纯白短毛猫', rarity: 'N',
    trait: ['软萌', '爱撒娇'],
    story: '踩在你手上轻飘飘的，叫声又细又甜，是邻居公认的「最像棉花糖的猫」。',
    color: '#FAFAFA',
  },
  {
    id: 'cat_013', name: '小白云', breed: '纯白短毛猫', rarity: 'N',
    trait: ['飘逸', '自由'],
    story: '整天不知去哪，出现时总是悄无声息，消失时也不打招呼。像云一样来去自如。',
    color: '#F5F5F5',
  },
  {
    id: 'cat_014', name: '珍珠', breed: '白底虎斑猫', rarity: 'R',
    trait: ['聪明', '警觉'],
    story: '白底上有若隐若现的淡纹，像珍珠一样低调却珍贵。能记住每个喂过它的人的脸。',
    color: '#EEE8DC',
  },
  {
    id: 'cat_015', name: '豆腐', breed: '纯白短毛猫', rarity: 'N',
    trait: ['温和', '随遇而安'],
    story: '温温白白，软软的，对什么都不抗拒。你摸它，它就让你摸。你不理它，它就自己趴着。',
    color: '#F8F8F0',
  },
  {
    id: 'cat_016', name: '白月光', breed: '纯白长毛猫', rarity: 'SR',
    trait: ['神秘', '孤傲'],
    story: '只在傍晚才出现，白色的毛在月光下泛着银光。从不主动靠近人，但会静静地注视你很久。',
    color: '#E8E8FF',
  },
  {
    id: 'cat_017', name: '奶白小胖', breed: '纯白短毛猫', rarity: 'N',
    trait: ['贪吃', '懒散'],
    story: '因为太圆了，坐在地上几乎看不见脖子。不过它对此毫不在意，下一顿才是最重要的事。',
    color: '#FFF5E0',
  },
  {
    id: 'cat_018', name: '霜降', breed: '白底灰纹猫', rarity: 'R',
    trait: ['内敛', '温柔'],
    story: '白底上有淡淡的灰纹，像霜打过的叶子。靠近陌生人会躲，但熟了之后会悄悄蹭你的脚踝。',
    color: '#D8D8D8',
  },
  {
    id: 'cat_019', name: '白虎爷', breed: '白底虎斑猫', rarity: 'SR',
    trait: ['威猛', '重情义'],
    story: '白底黑纹，气势如虎。但见到自己喜欢的人会用力打呼噜，呼噜声能在整条走廊里回荡。',
    color: '#E0E0E0',
  },
  {
    id: 'cat_020', name: '初雪使者', breed: '纯白长毛猫', rarity: 'SSR',
    trait: ['纯洁', '祥瑞'],
    story: '传说每年第一场雪落下时，它就会出现。见过它的人都说，它的眼睛里有整个冬天的星空。',
    color: '#FFFFFF',
  },
]

// ─────────────────────────────────────────
// 花猫系 (cat_021 ~ cat_030)
// ─────────────────────────────────────────
const TABBY_CATS = [
  {
    id: 'cat_021', name: '花花', breed: '狸花猫', rarity: 'N',
    trait: ['活泼', '爱玩'],
    story: '满身的花纹是天然的保护色，在草丛里消失只需要0.5秒。',
    color: '#8B7355',
  },
  {
    id: 'cat_022', name: '幸运三花', breed: '三花猫', rarity: 'R',
    trait: ['招财', '温柔'],
    story: '三花猫极少是公猫，这只更是出了名的亲人。小区业主都说，摸到它会有好运气。',
    color: '#C8A882',
  },
  {
    id: 'cat_023', name: '虎纹将军', breed: '狸花猫', rarity: 'R',
    trait: ['强壮', '正直'],
    story: '纹路清晰如虎，体格壮实。从不欺负弱小，是附近流浪猫圈子里公认的「公正裁判」。',
    color: '#7B6B50',
  },
  {
    id: 'cat_024', name: '玳瑁公主', breed: '玳瑁猫', rarity: 'SR',
    trait: ['高冷', '个性'],
    story: '黑橙交错的毛色像贵重的玳瑁工艺品。性格鲜明，喜欢就是喜欢，不喜欢绝对不假装。',
    color: '#A0522D',
  },
  {
    id: 'cat_025', name: '小虎班', breed: '短毛虎斑猫', rarity: 'N',
    trait: ['胆大', '好奇'],
    story: '什么都要探索，什么都要亲自确认，没有任何东西能让它止步。',
    color: '#8B7355',
  },
  {
    id: 'cat_026', name: '花斑渔夫', breed: '三花猫', rarity: 'N',
    trait: ['专注', '耐心'],
    story: '最喜欢趴在水沟边看鱼，可以一动不动待上两个小时。钓鱼佬的精神在它身上完整体现。',
    color: '#C8A882',
  },
  {
    id: 'cat_027', name: '麻花卷', breed: '狸花猫', rarity: 'N',
    trait: ['懒', '可爱'],
    story: '特别喜欢把自己盘成一个麻花形状睡觉，完全不在意那样会不会不舒服。',
    color: '#9B8B6E',
  },
  {
    id: 'cat_028', name: '花蝴蝶', breed: '玳瑁猫', rarity: 'R',
    trait: ['轻盈', '活跃'],
    story: '跑起来毛色像蝴蝶翅膀一样在空气里展开。是附近跑得最快的猫，没有之一。',
    color: '#B8884A',
  },
  {
    id: 'cat_029', name: '九色鹿', breed: '三花长毛猫', rarity: 'SR',
    trait: ['罕见', '美丽'],
    story: '长毛三花，颜色渐变如同九色鹿的传说。每次出现都让人觉得是某种特别的相遇。',
    color: '#D4A87A',
  },
  {
    id: 'cat_030', name: '万花筒', breed: '玳瑁猫', rarity: 'SSR',
    trait: ['绝色', '传说'],
    story: '全身毛色超过七种，在不同角度呈现不同颜色。猫咪学者说它是基因突变的奇迹，而它只是慵懒地打了个哈欠。',
    color: '#C87A2A',
  },
]

// ─────────────────────────────────────────
// 名品系 (cat_031 ~ cat_040)
// ─────────────────────────────────────────
const BREED_CATS = [
  {
    id: 'cat_031', name: '蓝胖子', breed: '英国短毛猫', rarity: 'SR',
    trait: ['圆润', '淡定'],
    story: '圆圆的脸，圆圆的眼，圆圆的身子。对生活充满满足感，从不焦虑，是行走的「佛系」教材。',
    color: '#778899',
  },
  {
    id: 'cat_032', name: '月光布偶', breed: '布偶猫', rarity: 'SR',
    trait: ['温顺', '亲人'],
    story: '抱起来软绵绵地任你摆弄，眼神充满信任。是猫咪界公认最接近「玩偶」的存在。',
    color: '#C8B4A0',
  },
  {
    id: 'cat_033', name: '折耳小圆', breed: '苏格兰折耳猫', rarity: 'R',
    trait: ['萌', '聪明'],
    story: '折叠的耳朵让它看起来永远在思考人生。但其实大多数时候它只是在想：下一顿吃什么。',
    color: '#B0A090',
  },
  {
    id: 'cat_034', name: '大脸波斯', breed: '波斯猫', rarity: 'R',
    trait: ['慵懒', '高贵'],
    story: '扁脸上始终带着一种「你们都不懂我」的高傲神情，蓬松的毛发拖在地上也毫不在意。',
    color: '#D4C4A0',
  },
  {
    id: 'cat_035', name: '缅因巨人', breed: '缅因猫', rarity: 'SR',
    trait: ['温柔巨人', '护主'],
    story: '体型是普通猫的两倍，但性格比谁都温柔。喜欢用巨大的爪子轻轻踩你的手，像在做饼。',
    color: '#8B7355',
  },
  {
    id: 'cat_036', name: '拿破仑', breed: '金吉拉猫', rarity: 'R',
    trait: ['精致', '自恋'],
    story: '银白色的毛尖闪着光，它很清楚自己好看，每天会在窗户旁照影子。',
    color: '#D8D8C8',
  },
  {
    id: 'cat_037', name: '小王子', breed: '阿比西尼亚猫', rarity: 'R',
    trait: ['灵动', '话多'],
    story: '永远在动，永远在叫，好像有说不完的话。是附近最活跃的猫，朋友遍布整条街。',
    color: '#C8A050',
  },
  {
    id: 'cat_038', name: '蓝眼精灵', breed: '土耳其安哥拉猫', rarity: 'SR',
    trait: ['神秘', '独行'],
    story: '白毛蓝眼，像从童话里走出来。不属于任何人，也不依赖任何地方，永远只是路过。',
    color: '#F0ECFF',
  },
  {
    id: 'cat_039', name: '布丁曼奇金', breed: '曼基康猫', rarity: 'SR',
    trait: ['可爱', '努力'],
    story: '短短的腿，大大的眼睛，奔跑时用了别人三倍的努力，但脸上永远是满足的表情。',
    color: '#F0D080',
  },
  {
    id: 'cat_040', name: '皇家御猫', breed: '波斯猫', rarity: 'SSR',
    trait: ['尊贵', '传奇'],
    story: '据说它的祖先曾是某位皇帝的宠猫，这份气质被完整遗传下来。见过它的人都会不自觉地弯腰行礼。',
    color: '#FFD700',
  },
]

// ─────────────────────────────────────────
// 黑猫系 (cat_041 ~ cat_050)
// ─────────────────────────────────────────
const BLACK_CATS = [
  {
    id: 'cat_041', name: '小黑炭', breed: '纯黑短毛猫', rarity: 'N',
    trait: ['调皮', '夜行'],
    story: '晚上几乎隐形，只有两只发光的眼睛在黑暗中浮现。专门在你不注意时跳出来吓你一跳。',
    color: '#2C2C2C',
  },
  {
    id: 'cat_042', name: '宝藏黑猫', breed: '纯黑短毛猫', rarity: 'R',
    trait: ['招财', '亲人'],
    story: '在日本文化里黑猫是招财的象征，这只完全活出了这个人设。附近的店铺都抢着让它光顾。',
    color: '#1A1A1A',
  },
  {
    id: 'cat_043', name: '月夜使者', breed: '纯黑短毛猫', rarity: 'SR',
    trait: ['神秘', '古灵精怪'],
    story: '满月的夜晚才会出现，黑色的毛在月光下反着蓝光。没有人知道它白天在哪里。',
    color: '#0D0D2B',
  },
  {
    id: 'cat_044', name: '燕尾服', breed: '黑白猫', rarity: 'R',
    trait: ['绅士', '讲礼貌'],
    story: '黑白配色像一件精致的燕尾服。每次出现都昂首挺胸，仿佛正要出席一场重要的宴会。',
    color: '#2C2C2C',
  },
  {
    id: 'cat_045', name: '小熊猫猫', breed: '黑白猫', rarity: 'N',
    trait: ['呆萌', '随和'],
    story: '黑眼圈让它看起来像熊猫，这个绰号叫了三年，它从来不反对。',
    color: '#404040',
  },
  {
    id: 'cat_046', name: '黑珍珠', breed: '纯黑长毛猫', rarity: 'SR',
    trait: ['优雅', '冷艳'],
    story: '长毛黑猫，在阳光下毛色泛着紫色光泽。走路姿势比模特还端正，每一步都踩在节拍上。',
    color: '#1A0A2B',
  },
  {
    id: 'cat_047', name: '踏雪乌', breed: '黑白猫', rarity: 'N',
    trait: ['活泼', '冒险'],
    story: '四只白爪子踩在黑色身体上，像踏雪而来。热爱探索，是附近爬得最高的猫。',
    color: '#2C2C2C',
  },
  {
    id: 'cat_048', name: '暗影刺客', breed: '纯黑短毛猫', rarity: 'R',
    trait: ['敏捷', '专注'],
    story: '移动时几乎无声无息，出现在哪里都让人措手不及。猎鸟技术是附近公认第一。',
    color: '#111111',
  },
  {
    id: 'cat_049', name: '黑曜石', breed: '纯黑短毛猫', rarity: 'SR',
    trait: ['沉稳', '忠诚'],
    story: '像火山熔岩冷却后的黑曜石，外表冷硬，内心滚烫。认准一个人之后终生不变。',
    color: '#0A0A0A',
  },
  {
    id: 'cat_050', name: '永夜之王', breed: '纯黑长毛猫', rarity: 'SSR',
    trait: ['王者', '永恒'],
    story: '传说中见过它的人，会在梦里被无数只猫围绕。它不属于任何地方，只属于夜晚本身。',
    color: '#000020',
  },
]

// ─────────────────────────────────────────
// 传说系 (cat_051 ~ cat_060)
// ─────────────────────────────────────────
const LEGEND_CATS = [
  {
    id: 'cat_051', name: '光头强', breed: '无毛猫（斯芬克斯）', rarity: 'SR',
    trait: ['大胆', '热情'],
    story: '没有毛发，但热情超过所有有毛的猫。皮肤摸起来像热豆包，很多人因此成了无毛猫粉。',
    color: '#D4A882',
  },
  {
    id: 'cat_052', name: '暹罗刺客', breed: '暹罗猫', rarity: 'SR',
    trait: ['话多', '黏人'],
    story: '蓝眼睛、深色面具，叫声响亮如婴儿啼哭。一旦认定你是它的人，就会寸步不离地跟着。',
    color: '#C8B4A0',
  },
  {
    id: 'cat_053', name: '玻璃眼', breed: '异色瞳猫', rarity: 'SR',
    trait: ['神秘', '双面'],
    story: '一只眼睛蓝色，一只眼睛金色。据说两只眼睛看到的是不同的世界，它永远在两个世界之间游走。',
    color: '#F0E8D8',
  },
  {
    id: 'cat_054', name: '无尾刺猬', breed: '曼岛猫', rarity: 'R',
    trait: ['独特', '稳重'],
    story: '天生没有尾巴，走路时整个后半身轻轻晃动，反而走出了一种特别的节奏感。',
    color: '#A89070',
  },
  {
    id: 'cat_055', name: '卷耳精灵', breed: '美国卷耳猫', rarity: 'R',
    trait: ['精灵', '聪明'],
    story: '向后卷的耳朵像精灵的耳尖，眼神总是带着一点坏笑。非常擅长打开柜门和抽屉。',
    color: '#C8A878',
  },
  {
    id: 'cat_056', name: '蓝血贵族', breed: '俄罗斯蓝猫', rarity: 'SR',
    trait: ['高冷', '内敛'],
    story: '银蓝色的毛，翡翠绿的眼。外表清冷，但记住了每个对它好过的人，只是不习惯表达。',
    color: '#7090A8',
  },
  {
    id: 'cat_057', name: '沙漠王子', breed: '阿比西尼亚猫', rarity: 'R',
    trait: ['矫健', '独立'],
    story: '毛色如同沙漠的黄金色，行动敏捷，从不依赖任何人。但会在你悲伤时悄悄坐到你旁边。',
    color: '#C8A050',
  },
  {
    id: 'cat_058', name: '雪地猎手', breed: '西伯利亚猫', rarity: 'SR',
    trait: ['强壮', '勇敢'],
    story: '为严寒进化的猫，毛厚如大衣，爪大如掌。性格刚毅，据说曾经独自驱赶过一只浣熊。',
    color: '#B8A090',
  },
  {
    id: 'cat_059', name: '彩云之南', breed: '云猫（野生花纹）', rarity: 'SSR',
    trait: ['自由', '罕见'],
    story: '毛色如云彩，花纹如山水画。没有人真正驯养过它，它只是偶尔经过你的生命，留下一段难忘的相遇。',
    color: '#D4B8C0',
  },
  {
    id: 'cat_060', name: '混沌初开', breed: '未知品种', rarity: 'SSR',
    trait: ['无限', '起源'],
    story: '没有人知道它是什么品种，它的存在本身就是一个谜。据说拍到它的人，会开始重新审视自己与世界的关系。',
    color: '#8888FF',
  },
]

// ─────────────────────────────────────────
// 完整图鉴（60只猫）
// ─────────────────────────────────────────
const ALL_CATS = [
  ...ORANGE_CATS,
  ...WHITE_CATS,
  ...TABBY_CATS,
  ...BREED_CATS,
  ...BLACK_CATS,
  ...LEGEND_CATS,
]

/**
 * 按稀有度分组的 ID 列表，供抽卡逻辑使用
 */
const CATS_BY_RARITY = {
  N: ALL_CATS.filter(c => c.rarity === 'N').map(c => c.id),
  R: ALL_CATS.filter(c => c.rarity === 'R').map(c => c.id),
  SR: ALL_CATS.filter(c => c.rarity === 'SR').map(c => c.id),
  SSR: ALL_CATS.filter(c => c.rarity === 'SSR').map(c => c.id),
}

/**
 * 快速通过 ID 查找猫咪数据
 */
const CAT_MAP = ALL_CATS.reduce((map, cat) => {
  map[cat.id] = cat
  return map
}, {})

/**
 * 获取猫咪数据
 * @param {string} id
 * @returns {object|null}
 */
function getCatById(id) {
  return CAT_MAP[id] || null
}

/**
 * 获取某稀有度的所有猫
 * @param {'N'|'R'|'SR'|'SSR'} rarity
 * @returns {object[]}
 */
function getCatsByRarity(rarity) {
  return ALL_CATS.filter(c => c.rarity === rarity)
}

/**
 * 按视觉模型返回的品种标签筛选图鉴条目。
 * 品种标签是事实层，图鉴角色（name）是游戏层，两者不混用。
 */
function getCatsByBreed(breed) {
  return ALL_CATS.filter(c => c.breed === breed)
}

/**
 * 图鉴分类信息
 */
const CATEGORIES = [
  { key: 'orange', name: '橘猫系', ids: ORANGE_CATS.map(c => c.id) },
  { key: 'white',  name: '白猫系', ids: WHITE_CATS.map(c => c.id) },
  { key: 'tabby',  name: '花猫系', ids: TABBY_CATS.map(c => c.id) },
  { key: 'breed',  name: '名品系', ids: BREED_CATS.map(c => c.id) },
  { key: 'black',  name: '黑猫系', ids: BLACK_CATS.map(c => c.id) },
  { key: 'legend', name: '传说系', ids: LEGEND_CATS.map(c => c.id) },
]

module.exports = {
  ALL_CATS,
  CATS_BY_RARITY,
  CAT_MAP,
  CATEGORIES,
  getCatById,
  getCatsByRarity,
  getCatsByBreed,
}
