# 猫咪咔咔｜猫咪身份特征与视觉向量方案 v0.1

> 状态：方案草案
>
> 目标：在现有“GLM 视觉识别”之后，建立一条可迭代的猫咪个体识别链路，用于判断“这次拍到的猫，是否可能是之前遇见的同一只猫”。

## 0. 先定一个重要结论

**GLM 识别结果不能直接作为猫咪的唯一性生物特征，也不应该把 GLM 返回的文字描述再转成文本向量来冒充视觉身份向量。**

本项目需要拆成两种不同的数据：

| 数据 | 负责什么 | 是否用于判断同一只猫 |
| --- | --- | --- |
| GLM 视觉观察 `observation` | 判断是不是猫、猫的数量、可见花纹、脸部记号、姿态、遮挡和图片质量 | 作为辅助证据 |
| GLM 生成文案 `name` / `description` | 给当前卡片生成昵称与短描述 | 否，仅用于展示 |
| 视觉身份向量 `identityFeature` | 从猫咪主体裁剪图中提取视觉表征，计算图片之间的相似度 | 是，作为主要证据 |

因此，“唯一性”在产品里应该表述为：

> 在指定身份范围、指定模型版本和当前样本质量下，系统认为最可能属于同一只猫。

它是**概率性的视觉重识别**，不是数学意义上 100% 唯一、永久不变的生物指纹。猫咪换季、成长、剃毛、受伤、遮挡、光线和拍摄角度都会改变结果；长得相似的猫也可能被误合并。

## 1. 和现有项目的关系

当前项目已经有：

```text
拍照
  → 内容安全
  → miniprogram/cloudfunctions/cat-vision
  → GLM 返回 JSON
  → miniprogram/utils/identify.js 映射到 catData
  → 保存相遇记录
```

现在的 `catData.id`（例如 `cat_021`）是**固定图鉴角色 ID**，不是现实世界中某一只猫的身份 ID。`identify.js` 会按品种从固定图鉴里选择一个角色，这适合当前演示卡面，但不能解决真实猫的重复识别。

后续必须拆开：

```text
catId          = 现实猫咪档案 ID，例如 CAT-01K...
catalogCatId  = 卡面/图鉴角色 ID，例如 cat_021，可选
recordId       = 本地或服务端的一次相遇记录 ID
cardNo         = 用户看到的相遇卡编号
```

同一只现实猫再次出现时，复用 `catId`，生成新的 `recordId`、`imageId` 和 `cardNo`；卡面角色可以继续独立使用，不应反过来决定现实猫的身份。

## 2. 推荐的处理链路

```text
原始照片
  ↓
内容安全 + 图片质量检查
  ↓
GLM 视觉观察
  ├─ 是否有猫、猫的数量
  ├─ 目标猫位置 / 可见区域
  ├─ 稳定外观特征及其置信度
  └─ 姿态、视角、遮挡、光照等本次拍摄信息
  ↓
猫咪主体裁剪 / 对齐
  ↓
专用视觉 embedding / re-identification 编码器
  ↓
L2 归一化后的 identityFeature
  ↓
候选猫咪档案检索
  ↓
自动归档 / 待确认 / 新建临时档案
  ↓
仅在高置信匹配后更新猫咪档案原型
```

### 2.1 GLM 的职责

GLM 只负责“观察和解释”：

- `isCat`、`catCount`；
- 目标猫的 bounding box 或主体区域；
- 毛色、花纹、脸部记号、耳朵、尾巴、体型等可见特征；
- 视角、姿态、眼神、遮挡、光照和清晰度；
- 每个字段的置信度和是否足以进入身份特征提取。

GLM 不负责：

- 生成 `catId`；
- 决定与哪一只历史猫合并；
- 生成可用于检索的身份 embedding；
- 用品种、评分、地点或故事文案替代个体识别。

当前 GLM 视觉接口是图像输入、文本 JSON 输出，正适合承担观察层。智谱官方文档也将视觉理解模型与向量模型分开列出；文本 `Embedding-3` 的接口输入是字符串，不能把它当作猫咪图片的个体视觉向量。[GLM-5V-Turbo 视觉理解文档](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5v-turbo)、[Embedding-3 文档](https://docs.bigmodel.cn/cn/guide/models/embedding/embedding-3)

### 2.2 身份向量的职责

身份向量应由一个**固定的图片编码器**从猫咪主体图提取。编码器可以是后续评估过的多模态图像向量服务、猫咪重识别模型，或自部署视觉模型；具体供应商暂时不写死。

硬性要求：

1. 输入必须是猫咪主体裁剪图，而不是整张带地点、人物、建筑和文字的照片；
2. 同一个模型、同一个预处理和同一个版本，才可以直接比较向量；
3. 向量必须保存 `model`、`version`、`dimension`、`dtype`、`normalized` 等元信息；
4. 不能把 `catId` 做成向量哈希，哈希只能去重，不能判断两张图是否是同一只猫；
5. 没有真正的 embedding 服务时，宁可只保存 GLM 观察结果，也不生成随机向量、哈希伪向量或“特征分数拼接向量”。

## 3. GLM 观察结果建议结构

这是“每次图片观察”的结构，不是猫咪档案的最终结构：

```json
{
  "schemaVersion": "cat-observation.v0.1",
  "model": {
    "provider": "tokenhub",
    "name": "glm-5.3-flash",
    "version": "configured-model"
  },
  "isCat": true,
  "catCount": 1,
  "target": {
    "bbox": [120, 80, 880, 940],
    "subjectConfidence": 0.91,
    "visibility": 0.86
  },
  "quality": {
    "score": 0.82,
    "blur": 0.08,
    "lighting": 0.74,
    "occlusion": 0.12,
    "usableForIdentity": true
  },
  "breedOrType": {
    "label": "狸花猫",
    "confidence": 0.68
  },
  "stableTraits": {
    "furColor": [{ "value": "棕灰", "confidence": 0.88 }],
    "pattern": [{ "value": "额头M纹", "confidence": 0.81 }],
    "faceMarks": [{ "value": "右眼下方深色小斑", "confidence": 0.54 }],
    "earFeatures": [{ "value": "左耳尖有缺口", "confidence": 0.48 }],
    "tailFeatures": [{ "value": "尾巴环纹明显", "confidence": 0.72 }],
    "bodyFeatures": [{ "value": "中等体型", "confidence": 0.63 }]
  },
  "capture": {
    "view": "front_three_quarter",
    "pose": "sitting",
    "eyeContact": true,
    "sceneRelation": "near_wall",
    "locationUsedForIdentity": false
  }
}
```

### 3.1 观察层字段原则

- 看不清就返回 `null` 或空数组，不要猜；
- 稳定特征和本次状态分开保存；
- `pattern`、`faceMarks` 等是辅助证据，不是最终身份；
- `pose`、`eyeContact`、场景、评分、卡片文案不能进入身份原型；
- 每个观察都要带模型版本，便于以后重跑和比较；
- `usableForIdentity=false` 时可以生成相遇失败或普通记录，但不应写入身份图库。

## 4. 身份特征和猫咪档案结构

### 4.1 单次身份特征 `identityFeature`

```json
{
  "featureId": "CATF-01K6Q3JY8KQ9P2W7A4D6N1M8TZ",
  "imageId": "IMG-01K6Q3JY8KQ9P2W7A4D6N1M8TZ",
  "encoder": {
    "provider": "to-be-evaluated",
    "model": "cat-reid-v0",
    "version": "2026-09-01",
    "dimension": 512,
    "dtype": "float32",
    "metric": "cosine",
    "normalized": true
  },
  "vectorRef": "private://cat-features/CATF-...",
  "quality": {
    "score": 0.82,
    "usable": true,
    "cropBox": [120, 80, 880, 940]
  },
  "observationId": "OBS-01K...",
  "createdAt": "2026-09-03T08:00:00.000Z"
}
```

`vectorRef` 指向服务端私有存储或向量索引。向量原始数组不应下发到小程序，也不应展示在卡面、分享图或日志里。

### 4.2 猫咪档案 `catProfile`

```json
{
  "catId": "CAT-01K6Q3JY8KQ9P2W7A4D6N1M8TZ",
  "identityScope": "user",
  "status": "provisional",
  "featureSpace": {
    "model": "cat-reid-v0",
    "version": "2026-09-01",
    "dimension": 512,
    "metric": "cosine"
  },
  "galleryFeatureIds": ["CATF-01...", "CATF-02..."],
  "prototypeRef": "private://cat-prototypes/CAT-...",
  "galleryCount": 2,
  "catalogCatId": "cat_021",
  "firstSeenAt": "2026-09-03T08:00:00.000Z",
  "lastSeenAt": "2026-09-05T09:30:00.000Z",
  "observationSummary": {
    "stableTraits": ["棕灰毛色", "额头M纹", "尾巴环纹"]
  },
  "mergedInto": null
}
```

当前产品默认使用 `identityScope=user`：每个用户的个人图鉴里判断是否为同一只猫。未来如果要做跨用户的“全城同一只猫”，需要单独的授权、去重策略、地理范围和人工纠错机制，不能直接把所有用户的向量放在一个全局池里。

## 5. 匹配和建档策略

### 5.1 第一次遇见

第一次合格照片不应直接宣称“唯一识别成功”。流程为：

```text
GLM 确认是单猫且质量合格
  → 提取 identityFeature
  → 在当前身份范围搜索候选
  → 没有可靠候选：创建 provisional catProfile
```

`provisional` 不是错误，而是允许后续新照片把档案逐渐确认起来的状态。

### 5.2 后续遇见

候选检索返回 Top-K，并同时计算：

- `visualSimilarity`：向量余弦相似度，主指标；
- `traitAgreement`：GLM 稳定特征的一致程度，辅助指标；
- `qualityScore`：本次图片能否可靠比较；
- `top1Margin`：第一候选和第二候选之间的差距；
- 时间和地点：只能做很弱的候选先验，不能作为唯一依据。

初始工程参数可以沿用现有产品 Brief 的实验分段，但必须用真实标注样本校准，不能把它当作科学保证：

| 条件 | 处理 |
| --- | --- |
| 高相似度 + 图片质量合格 + Top-1 明显领先 + 历史图库不为空 | 自动归入候选猫咪档案 |
| 中间相似度、图库太少、遮挡明显或 Top-1/Top-2 接近 | 标记“可能是之前遇见的”，等待用户确认或后续样本 |
| 低相似度或没有合格候选 | 创建新的 provisional 档案 |

作为原型起点，可以记录 `0.88`、`0.75` 两个观测带，但不能只看一个固定阈值。上线前至少需要一组“同猫 / 不同猫”配对数据，测量误合并和误拆分，再决定阈值。

### 5.3 原型向量更新

不要每来一张图就无条件平均更新。建议：

- 只用高质量、已确认属于该档案的特征更新原型；
- 保留多张 gallery 特征，覆盖正面、侧面、站立、趴卧和不同光照；
- 初期使用质量加权平均或 medoid，而不是只保留最后一张图；
- `provisional` 档案在获得第二次独立、质量合格且一致的相遇后，才考虑升级为 `confirmed`；
- 一旦发生合并，保留审计记录，不能静默覆盖历史 `catId`。

## 6. 状态机

```text
                ┌──────────────────────────┐
                │  GLM / 质量检查未通过     │
                └────────────┬─────────────┘
                             │
                             ▼
                         不建身份档案

合格单猫 → 提取向量 → 无可靠候选 → provisional
                    │
                    ├─ 高置信匹配 → 复用已有 catId，追加相遇
                    │
                    ├─ 中间结果   → needs_review，暂不合并
                    │
                    └─ 低相似度   → 新建 provisional

provisional ──第二次独立一致样本──→ confirmed
confirmed ──人工纠错/后台任务──→ merged 或 rejected
```

## 7. 对现有代码的改造边界

### 第一阶段：现在可以做

1. 将 `cat-vision` 的 JSON 扩展为 `observation.v0.1`，加入 `target`、`quality` 和稳定特征分组；
2. 给每次观察保存 `observationId`、模型名和 `featureVersion`；
3. 在 `storage.saveRecord` 中预留 `catProfileId`、`observationId`、`identityFeatureId`、`identityStatus` 字段；
4. 将 `catData.id` 改名为概念上的 `catalogCatId`，避免继续把固定角色 ID 当现实猫 ID；
5. 新建 `cat-identity` 云函数接口，但在没有真实 embedding provider 前只返回“未配置”，不做伪向量兜底。

### 第二阶段：接入真实模型后做

1. 在服务端对猫咪主体图做裁剪和一致化预处理；
2. 调用专用视觉 embedding / re-identification 编码器；
3. 将向量写入私有向量存储，并按 `model + version + dimension` 建索引；
4. 实现 Top-K 候选搜索、阈值和 Top-1 margin；
5. 将档案从固定 `ALL_CATS` 改为动态 `cat_profiles`，图鉴角色只作为可选装饰映射。

### 第三阶段：真实样本校准

至少准备以下标注对：

- 同一只猫：正面 / 侧面 / 远近 / 不同光线 / 不同姿态；
- 不同猫：同小区、同品种、同花色、相似脸型；
- 低质量样本：遮挡、模糊、夜间、主体太小、多猫；
- 时间跨度样本：换季、成长和外观变化。

重点指标不是“平均相似度”，而是：

- 误合并率：把两只猫合成一只；
- 误拆分率：把同一只猫拆成多个档案；
- 在不同视角和低质量条件下的召回率；
- 用户确认后修正成本。

## 8. 隐私与安全底线

- API Key、原始向量和候选搜索都只在云端进行；
- 小程序端只拿到 `catId`、匹配状态和用户可读的结论，不下发向量数组；
- 不把精确 GPS、人物、建筑背景带入身份向量；
- 地点只用于可选的弱候选排序，不作为“就是同一只”的证明；
- 用户删除照片或档案时，应定义原图、裁剪图、观察结果、向量和索引的级联删除策略；
- 模型升级后不能直接混用旧向量，必须通过版本隔离或批量重算；
- 分享卡只展示 `cardNo` 和用户可见的猫咪档案信息，不展示向量、检索分数和精确位置。

## 9. 本版最终决策

```text
GLM = 可解释观察层
专用视觉模型 = 身份向量层
catId = 服务端生成的猫咪档案 ID
catData.id = 固定图鉴角色 ID，不再承担现实个体身份
相似度 = 概率判断，不承诺绝对唯一
默认范围 = 用户自己的图鉴
不具备真实 embedding 服务 = 不生成伪向量
```
