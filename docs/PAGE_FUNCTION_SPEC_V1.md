# 猫咪咔咔｜页面功能说明与媒体字段契约 v1.2

> 状态：维护主说明（当前实现基线）
> 版本：v1.2
> 更新时间：2026-09-07
> 适用范围：`miniprogram/pages`、猫档案媒体字段、海报生成与个人主页公开图片
> 目的：以后修改页面或图片链路时，先按本说明确认职责和字段，不再靠截图猜“这张图是什么”。

## 1. 先定四类图片

页面里出现的“猫图”不是同一个东西。视觉上都可能是一只猫，但数据来源和使用场景完全不同。

| 业务名称 | 代码角色 | 内容定义 | 主要字段 | 可以出现在哪里 |
| --- | --- | --- | --- | --- |
| 用户原图 | `original` | 用户在相遇页拍到、并通过安全检查的原始照片；保留现场背景和原始构图 | `originalPhotoPath`、`originalFileID`；兼容字段 `photoPath`、`photo` | AI 重处理输入、无其他图片时的兼容回退 |
| 透明猫主体图 | `cutout` / `subject` | 只保留猫咪主体的透明 PNG，不含原场景、标题、编号、评分和海报边框 | `cutoutPhotoPath`、`cutoutFileID` | 猫卡列表、猫档案详情、主体处理、海报无原图时的回退 |
| 猫生图封面原图 | `cover` / `poster-cover` | 为海报主图生成的干净猫咪场景图；可以有新的场景背景，但不能有海报文字、编号、评分、边框或完整卡片版式 | `coverPhotoPath`、`coverFileID`、`posterResult.coverImage.fileID` | 我的主页、海报 Canvas 主图；其他页面只作兼容回退 |
| 完整海报 | `poster` | Canvas 组合后的最终海报，包含标题、猫名、等级、编号、评分、文案和版式 | `posterPath`、`posterResult.posterImage.fileID` | 海报预览、分享、保存到系统相册 |

### 1.1 关键命名规则

用户或设计稿可以把图片统称为“猫主体图”，但代码和数据不能继续使用这个模糊称呼。必须根据生成链路使用上表四个角色。

特别注意：

- “猫生图封面原图”是**海报里的主图原图**，不是完整海报，也不是用户拍摄的原图；我的主页展示它，海报 Canvas 也使用它。
- “透明猫主体图”是猫卡列表和档案详情的默认主图；如果图片带有场景背景，它在数据层应归为 `cover`，不能写入 `cutout`。
- 完整海报永远不能反向当作列表主图，否则列表会出现标题、分数、编号重复嵌套的问题。
- 截图只用于确认视觉效果，不能用截图里看到的内容推断字段；字段以生成链路和 `kind` 为准。

## 2. 产品页面地图

### 2.1 Tab 页面

| 页面 | 路由 | 入口 | 页面责任 | 页面不负责 |
| --- | --- | --- | --- | --- |
| 相遇首页 | `/pages/index/index` | Tab「相遇」 | 展示罐罐、最近相遇、入口状态；打开相机 | 不创建猫档案、不生成海报 |
| 猫卡图鉴 | `/pages/collection/collection` | Tab「猫卡」 | 展示本机猫卡列表、筛选、进入档案详情 | 不把完整海报当列表图 |
| 我的 | `/pages/my/my` | Tab「我的」 | 账号绑定、同步、设置、个人主页等入口 | 不直接修改猫卡媒体字段 |

### 2.2 非 Tab 页面

| 页面 | 路由 | 页面责任 | 主要副作用 |
| --- | --- | --- | --- |
| 相机 | `/pages/camera/camera` | 拍照或选择照片，创建一次待处理相遇 | 写入 `pending capture`，不写正式猫档案 |
| 揭示结果 | `/pages/reveal/reveal` | 做安全检查、识别猫、整理主体、展示评分结果 | 通过全部校验后写入猫档案 |
| 猫档案详情 | `/pages/card-detail/card-detail` | 查看单条猫档案、进入海报流程、分享档案 | 不改变原图和主体图 |
| 海报生成中 | `/pages/poster-loading/poster-loading` | 复用或生成封面，渲染 Canvas 完整海报 | 写入 `cover*` 和 `posterResult` |
| 海报预览 | `/pages/poster-preview/poster-preview` | 展示最终海报、准备分享、保存海报 | 只消费完整海报 `posterPath` |
| 个人主页 | `/pages/profile/profile` | 展示自己的猫卡或他人的公开猫卡 | 自己读本地数据；他人读公开快照 |
| 猫图生图测试 | `/pages/image-image/image-image` | 开发验收主体处理能力 | 只使用用户原图作为处理输入，不写猫档案 |
| 文生图测试 | `/pages/text-image/text-image` | 开发验收文本生图能力 | 不参与猫档案和列表链路 |
| 开发模式 | `/pages/dev-mode/dev-mode` | 进入测试入口、异常页和能力验收 | 不参与正式用户数据 |
| 关于 | `/pages/about/about` | 展示产品说明和版本信息 | 无 |
| 隐私 | `/pages/privacy/privacy` | 展示隐私和权限说明 | 无 |

## 3. 各页面功能契约

### 3.1 相遇首页 `index`

**展示：**

- 当前罐罐数量、可相遇状态、最近一次相遇摘要；
- 最近猫卡图片只能按“透明主体 → 用户原图 → 封面”回退；
- 点击相机进入 `/pages/camera/camera`；点击猫卡进入 `/pages/collection/collection`。

**数据规则：**

- 只读 `storage` 和统计数据；不在首页创建记录；
- 临时图片地址失效时重新换取对应 `fileID` 的临时地址；
- 首页不读取 `posterResult.posterImage.fileID` 作为猫图。
- 首页提供“选择图片处理”入口，进入 `/pages/image-image/image-image`；该入口只处理用户选择的图片并生成透明猫咪主体，不消耗罐罐、不识别、不评分、不写入猫卡。

### 3.2 相机 `camera`

**流程：**

```text
拍照 / 从相册选择
  → 保存 pending capture
  → 进入 reveal
```

**数据规则：**

- `photoPath` 在这个阶段代表本次用户输入；
- 待处理数据包含 `captureId`、拍摄时间、位置状态和本地图片路径；
- 位置是可选能力：首次拍摄时询问一次；用户选择“不记录位置”后写入本机偏好，后续拍摄静默跳过，不重复打扰；用户仍可在微信设置中重新开启位置权限；
- 相机和位置授权状态先通过 `wx.getSetting` 判断，只有实际需要时才调用对应接口；
- 失败或用户返回时可以清理 pending capture，但不能扣除正式奖励；
- 这一页不调用猫识别、不生成透明主体、不写 `records`。

### 3.3 揭示结果 `reveal`

**职责：**把一次拍照转换成一条可保存的猫档案。

```text
用户原图
  → 内容安全检查
  → 猫咪识别 + 透明主体处理（并行）
  → 单猫确认 / 结果整理
  → 写入猫档案
```

**等待态：**

- 拍照后先展示“AI 正在识别中”，说明识别与透明主体整理通常需要约 20–30 秒；
- 等待页使用循环动画和不定进度条表达处理中，不展示虚假的精确百分比；
- 等待期间轮播猫咪小知识，识别、主体处理和知识请求互不改变正式入档条件。

**保存条件：**

- 原图通过内容安全检查；
- 识别结果满足单猫业务要求；
- 主体处理失败时必须明确记录失败状态，不能把失败响应伪装成透明 PNG；
- 正式写入时，`originalPhotoPath` / `originalFileID` 和 `cutoutPhotoPath` / `cutoutFileID` 分开保存；
- 不能把 `cutout` 或后续 `cover` 覆盖到 `photo`、`photoPath` 的原图语义上。

**失败处理：**

- 识别接口未配置、授权失败、不可用或返回非预期结构时，明确说明是接口侧异常，引导用户前往“我的 → 功能建议及问题反馈”联系，并记录错误码；
- 只要输入图中可见猫咪主体、局部、截图/海报中的猫或透明背景猫，就按“有猫”继续识别；无法确认时使用低置信度结果，不直接当作无猫；
- 任何一个并行任务失败，都要保留用户可重试的入口；
- 失败不创建一条“看似成功但没有可靠图片”的档案。

### 3.4 猫卡图鉴 `collection`

**职责：**展示本机已保存的猫档案，不展示完整海报。

**列表图唯一优先级：**

```text
ready 的 cover
  → cutout
  → original
```

实现上统一调用 `storage.getRecordDisplayPath(record)` 及对应的 `cutoutFileID` / `originalFileID` / `coverFileID` 换取临时地址。不要在页面里重新拼一套优先级。

**禁止：**

- 禁止使用 `posterResult.posterImage.fileID`；
- 禁止为了列表“有图”而把完整海报裁一块出来；
- 禁止把重新生成海报的结果写回 `originalPhotoPath` 或 `cutoutPhotoPath`。

### 3.5 猫档案详情 `card-detail`

**展示：**

- 猫名、档案编号、等级、评分、文案、相遇信息；
- 主图和图鉴保持同一优先级：`cutout → original → cover`；
- 海报入口、单猫档案分享入口。

**数据规则：**

- 详情页只负责消费当前档案快照；
- 分享快照必须带清晰的媒体角色，不允许把 `photoPath` 重新解释成完整海报；
- 进入海报流程时传 `catId`、`recordId` 或分享标识，不把完整图片内容塞进 URL。

### 3.6 海报生成中 `poster-loading`

**职责：**生成“完整海报”，同时维护海报所需的封面图。

**生成顺序：**

```text
读取已保存完整海报
  → 没有时读取本地固定缓存
  → 没有时读取已验收 cover（coverFileID 或 posterResult.coverImage.fileID）
  → 没有 cover 时以 original 为首选输入生成 poster-cover
  → cover 失败时用 original / cutout 完成海报回退
  → Canvas 绘制完整 poster
  → 持久化 cover* + posterResult
```

**重要区分：**

- `poster-cover` 生成的是海报主图中的干净图片，不带海报标题、编号、评分和边框；
- Canvas 生成的 `poster` 才是完整海报；
- 封面生成失败可以回退并完成海报，但必须把 `coverStatus` 标记为 `rejected`，不能伪装成 `ready`；
- 只要已有完整海报，或已有 `coverStatus = ready` 且保存了 `coverFileID` / `posterResult.coverImage.fileID`，后续生成海报都必须复用，不重复调用 AI；
- 封面临时地址失效时，先用 `fileID` 重新换取临时地址，再复用封面；不能因为地址失效就再次调用 `poster-cover`；
- 只有“没有完整海报、没有可用封面”的首次生成，才允许调用一次 AI 封面接口；后续流程只重绘 Canvas；
- 海报缓存命中时只重绘或复用结果，不隐式重新生成新的猫生图。

### 3.7 海报预览 `poster-preview`

**职责：**只展示完整海报并提供分享、保存。

- 页面主图使用 `posterPath`；
- 分享图使用完整海报或既定分享快照；
- “保存到相册”当前保存的是完整海报 PNG，不应把它写回猫卡列表图片字段；
- 相册权限只在用户点击“保存海报”时申请；用户拒绝后不自动打开设置页，而是弹窗引导用户主动前往微信设置；
- 如果产品要求“同时保存完整海报和猫生图封面原图”，应新增明确的双文件保存动作，不能复用单文件 `savePoster()` 偷换字段语义。

### 3.8 个人主页 `profile`

**自己的主页：**

- 读取本地猫卡和本地统计；
- 猫卡列表使用猫生图封面原图：`cover → cutout → original`；
- 只准备分享主页所需的 `profileShareId`，不把 `openid`、本地路径或精确位置放进分享路径。

**他人的主页：**

- 读取 `profile-social` 返回的公开快照；
- 公开图片优先使用 `coverFileID`，其次使用 `posterResult.coverImage.fileID`，再回退主体图；
- 不允许返回完整海报作为列表缩略图；
- 不新增原图 fileID 的公开暴露。当前旧数据若没有封面和主体，可临时回退原图，但新链路必须优先补齐封面/主体，不能依赖原图公开。

## 4. 媒体字段契约

### 4.1 字段归属

| 字段 | 唯一含义 | 允许写入的内容 | 不能写入 |
| --- | --- | --- | --- |
| `originalPhotoPath` | 用户原图本地路径或临时路径 | 用户拍摄原图 | 封面、主体、完整海报 |
| `originalFileID` | 用户原图云文件 | 用户拍摄原图 | 封面、主体、完整海报 |
| `cutoutPhotoPath` | 透明主体本地路径或临时路径 | 透明 PNG | 带场景背景的生图、完整海报 |
| `cutoutFileID` | 透明主体云文件 | 透明 PNG | 用户原图、封面、完整海报 |
| `coverPhotoPath` | 猫生图封面本地路径或临时路径 | 无文字干净封面图 | 完整海报、用户原图 |
| `coverFileID` | 猫生图封面云文件 | 通过验收的 `poster-cover` | 失败结果、完整海报 |
| `posterResult.coverImage.fileID` | 海报结果关联的封面云文件 | 与 `coverFileID` 同一角色的元数据 | 完整海报 |
| `posterPath` | 完整海报本地临时路径 | Canvas 生成的最终 PNG | 列表主图、原图字段 |
| `posterResult.posterImage.fileID` | 完整海报云文件 | Canvas 生成的最终海报 | 列表主图、封面字段 |

### 4.2 统一辅助函数

页面不要直接读取字段并自行判断，统一从 `miniprogram/utils/storage.js` 取值：

| 函数 | 用途 |
| --- | --- |
| `getRecordDisplayPath(record)` | 猫卡列表、首页、档案详情的 UI 主图；优先 `cutout → original → cover` |
| `getRecordPosterSourcePath(record)` | 获取海报主图封面原图 |
| `getRecordPosterSourceFileID(record)` | 获取封面云文件 ID |
| `getRecordSubjectPath(record)` | 获取透明猫主体 |
| `getRecordSubjectFileID(record)` | 获取透明猫主体云文件 ID，兼容旧海报快照里的 `sourceImage.cutoutFileID` |
| `getRecordOriginalPath(record)` | 获取用户原图；图生图重处理只能用这个 |

`posterData.getImagePathCandidates(record)` 是“海报生成输入”的选择器，不是“列表展示图片”的选择器。当前海报生成输入规则为：

```text
ready 的 cover → original → cutout
```

这条规则与列表展示的规则不同，修改其中一条时必须同时检查另一条，不能把两个选择器合并。

## 5. 页面与图片来源矩阵

| 页面 / 动作 | 应使用的图片 | 优先级或固定来源 |
| --- | --- | --- |
| 首页最近猫卡 | 列表展示图 | `cutout → original → cover` |
| 猫卡图鉴列表 | 列表展示图 | `cutout → original → cover` |
| 猫档案详情主图 | 列表展示图 | `cutout → original → cover` |
| 自己的个人主页猫卡 | 猫生图封面原图 | `cover → cutout → original` |
| 他人的个人主页猫卡 | 公开封面图 | `cover → coverImage → cutout → original` |
| 主体重新处理 | 用户原图 | `original` 固定 |
| `poster-cover` 生成输入 | 可靠输入图 | `original` 首选；旧记录按海报生成选择器回退 |
| Canvas 海报主图 | 猫生图封面或回退图 | `cover`；失败时 `original / cutout` |
| 海报预览 | 完整海报 | `posterPath` 固定 |
| 分享 / 保存海报 | 完整海报 | `posterPath` / `posterImage` 固定 |

## 6. 状态流转与持久化

```text
camera
  → pending capture
  → reveal
      ├─ content safety
      ├─ cat vision
      └─ cutout / subject
  → saveRecord(original + cutout)
  → collection / card-detail
  → poster-loading
      ├─ reuse cover
      ├─ generate poster-cover
      └─ render Canvas poster
  → updateRecordCover(cover)
  → savePosterResult(posterResult)
  → poster-preview
      ├─ share poster
      └─ save poster
```

### 6.1 记录生命周期

1. **刚完成相遇：**至少保存原图；有主体处理结果则另外保存主体图。
2. **首次生成海报：**生成并验收 `cover` 后，写入 `cover*`；无论封面是否成功，完整海报都写入 `posterResult`。
3. **再次打开档案：**列表消费 `cover`，海报流程复用已有 `cover`，不重新生成。
4. **封面失败：**保留原图和主体图，`coverStatus = rejected`，列表按回退优先级展示，不把失败结果当成封面。
5. **同步或公开：**保留四种媒体的角色字段，公开接口只选择允许公开的媒体，不把字段压扁成一个不明含义的 `photo`。

## 7. 不可违反的产品不变量

- `original`、`cutout`、`cover`、`poster` 四类图片必须可独立追溯。
- 任何页面都不能把完整海报当成猫卡列表图。
- 任何 AI 生成或重处理都不能覆盖用户原图。
- 列表和详情必须调用统一展示选择器，不能各自维护优先级。
- 图生图测试页必须使用 `getRecordOriginalPath()`，不能误用列表展示图；否则已有封面会被再次作为输入，产生链路污染。
- `coverStatus !== ready` 时，`coverFileID` 不能作为可用封面使用。
- 海报文字、评分、编号、边框只由 Canvas 负责，不能进入 `cover`。
- 公开主页不能暴露 `openid`、本地文件路径、精确位置或未授权的原图地址。
- 旧字段 `photoPath` / `photo` 在新记录中保持“用户原图”语义；兼容旧数据时可以读取，但不得继续扩大歧义。

## 8. 修改页面前的维护流程

### 8.1 修改前

- 先在本文件确认目标页面的责任和图片来源；
- 若要改变图片优先级，先修改“媒体字段契约”和“页面与图片来源矩阵”；
- 若新增页面，必须补充：入口、读写数据、图片角色、失败回退、是否允许公开。

### 8.2 修改后

- 检查有主体记录：列表和详情应显示透明主体，不显示封面或完整海报；
- 检查无主体记录：列表按原图回退，最后才使用封面，不显示完整海报；
- 检查海报失败：原图和主体仍存在，列表不出现伪造成功图；
- 检查再次生成：复用 `cover`，不重复调用图生图；
- 检查图生图测试：输入仍是原图，不是列表当前显示图；
- 检查公开主页：不返回完整海报作为卡片图，不新增原图暴露；
- 运行 `git diff --check`；
- 对修改过的 JS 运行 `node --check`；
- 在微信开发者工具至少验收“无封面 / 有封面 / 封面失败”三种数据状态。

### 8.3 云函数修改

涉及 `cat-vision`、`poster-cover`、`profile-social` 或文件上传字段时，除了本地检查，还要确认：

- 返回字段仍按 `original / cutout / cover / poster` 分组；
- 非预期响应不能被当成成功图片；
- 云函数部署完成后再做真机或开发者工具验收；
- 文档中的版本号、操作名和回退行为同步更新。

## 9. 相关实现文件

| 文件 | 作用 |
| --- | --- |
| `miniprogram/utils/storage.js` | 本地记录、媒体字段归一化、图片角色选择器 |
| `miniprogram/utils/posterData.js` | 海报数据快照、海报输入选择、封面持久化 |
| `miniprogram/utils/posterResult.js` | 海报结果结构和持久化字段 |
| `miniprogram/pages/reveal/reveal.js` | 相遇处理和正式记录写入 |
| `miniprogram/pages/collection/collection.js` | 猫卡列表展示 |
| `miniprogram/pages/card-detail/card-detail.js` | 猫档案详情和海报入口 |
| `miniprogram/pages/poster-loading/poster-loading.js` | 封面生成、Canvas 海报生成和结果保存 |
| `miniprogram/pages/poster-preview/poster-preview.js` | 完整海报预览、分享和保存 |
| `miniprogram/pages/profile/profile.js` | 自己 / 他人主页 |
| `miniprogram/cloudfunctions/profile-social/index.js` | 公开主页快照和公开图片选择 |
| `miniprogram/pages/image-image/image-image.js` | 原图到主体图的开发验收入口 |

## 10. 版本记录

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| v1.0 | 2026-09-07 | 固化页面职责；明确原图、透明主体、猫生图封面原图、完整海报四种角色；统一列表展示优先级；补充海报生成、公开主页和维护验收规则。 |
| v1.1 | 2026-09-07 | 明确页面差异：猫卡列表和猫档案使用透明主体图；我的主页使用猫生图封面原图；海报生成继续独立使用封面图。 |
| v1.2 | 2026-09-07 | 固化海报复用顺序：完整海报、固定缓存、已有封面优先；封面临时地址失效时通过 fileID 续取，不重复调用 AI。 |
