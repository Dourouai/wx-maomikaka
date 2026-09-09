# 猫咪咔咔｜四类图片与页面默认图规则 v1.0

> 状态：当前维护准则
>
> 更新时间：2026-09-09
>
> 适用范围：相遇记录、猫卡图鉴、猫档案、个人主页、猫生图和海报链路
>
> 目的：明确每一张图片的业务身份和页面优先级，禁止用“猫图”“图生图原图”等模糊称呼代替字段语义。

## 0. 先记住一句话

项目里有四类图片：

```text
用户原图 original
透明猫主体图 cutout / subject
猫生图封面原图 cover / poster-cover
完整海报 poster
```

它们都可能出现一只猫，但不是同一张图，也不能互相覆盖字段。

## 1. 四类图片的定义

| 业务名称 | 代码角色 | 内容定义 | 主要字段 | 生成链路 |
| --- | --- | --- | --- | --- |
| 用户原图 | `original` | 用户拍照或从相册上传、通过内容安全检查的真实照片，保留现场背景和原始构图 | `originalPhotoPath`、`originalFileID`；旧字段 `photoPath`、`photo` 只按原图理解 | 用户输入 → 内容安全 |
| 透明猫主体图 | `cutout` / `subject` | 只保留原照片里的猫咪主体，目标是透明 PNG；不含现场背景、标题、编号、评分、边框和完整卡片 | `cutoutPhotoPath`、`cutoutFileID` | `cat-transform` / 主体处理 |
| 猫生图封面原图 | `cover` / `poster-cover` | 根据当前猫咪生成的干净场景图，可以有新的背景；不能有海报文字、编号、评分、边框或完整卡片版式 | `coverPhotoPath`、`coverFileID`；兼容 `posterResult.coverImage.fileID` | `poster-cover` / 猫生图 |
| 完整海报 | `poster` | Canvas 合成的最终成品，包含猫名、等级、编号、评分、文案和版式 | `posterPath`；云端为 `posterResult.posterImage.fileID` | Canvas 排版 |

### 1.1 容易混淆的两张生成图

- `cat-transform` 产物的业务身份是**透明猫主体图**，即 `cutout`，不是 `cover`。
- `poster-cover` 产物的业务身份是**猫生图封面原图**，即 `cover`，不是用户原图，也不是完整海报。
- “猫生图的原图”只能指 `cover` 的无文字原图；不能把 `originalPhotoPath` 称为猫生图。
- 完整海报永远不能作为猫卡列表或个人主页的猫咪缩略图，否则会出现标题、分数、编号重复嵌套。

## 2. 字段与有效性

### 2.1 字段归属

| 角色 | 允许写入 | 禁止写入 |
| --- | --- | --- |
| `original` | 用户通过安全检查的原始照片 | 透明主体、猫生图、完整海报 |
| `cutout` | 透明猫主体 PNG | 原图、带场景的猫生图、完整海报 |
| `cover` | 通过验收的 `poster-cover` 无文字场景图 | 原图、透明主体、完整海报、失败结果 |
| `poster` | Canvas 最终海报 PNG | 原图字段、主体字段、封面字段、列表猫图字段 |

### 2.2 什么算“有猫生图”

只有满足以下条件才允许按 `cover` 展示：

1. `coverStatus === 'ready'`；历史记录缺少状态字段时，只要存在有效封面 `fileID`，按 `ready` 兼容读取；
2. 有 `coverFileID`，或有 `posterResult.coverImage.fileID`；
3. 文件可以成功换取临时地址并通过图片尺寸检查。

只有 `coverPhotoPath` 没有可靠 `fileID` 时，临时地址失效后应重新取同一张封面，不能直接把另一类图片写进 `cover`。

`coverStatus` 明确为 `pending` 或 `rejected`，或没有状态且没有有效封面 `fileID`，或封面文件不可用时，才视为没有可用猫生图。

### 2.3 旧字段兼容

- `photoPath`、`photo` 在新链路中永远表示 `original`。
- 旧数据可能没有四类字段，读取时可以按回退规则兼容；修复旧数据不能把原图改写成主体图或封面图。
- `posterResult.sourceImage` 只有 `kind === 'cover'` 时才是猫生图；`kind === 'cutout'` 时仍是透明主体图。

## 3. 先选“当前记录”，再选图片

同一只猫可能有多次遇见记录。图片、评分、猫名、等级和海报必须先绑定到同一条记录，再执行图片优先级。

### 3.1 当前记录规则

- 默认当前记录是该 `catId` 下按 `createdAt` 倒序的最新记录。
- 生成海报时使用当前记录，不使用 `featuredRecordId` 或历史精选记录替代当前记录。
- 海报的猫生图、透明主体、评分、猫名、等级和文案必须全部来自同一条当前记录，不能出现“图片取精选、评分取最新”。
- 如果某个页面明确要展示“精选记录”，必须在页面名称和数据字段中显式标注；不能把精选记录当成默认当前记录。

## 4. 各页面的默认图和优先级

### 4.1 页面来源矩阵

| 页面 / 动作 | 默认展示目标 | 图片优先级或固定来源 | 说明 |
| --- | --- | --- | --- |
| 相遇首页最近相遇 | 透明猫主体 | `cutout → original` | 不展示完整海报；封面不是首页正常主图 |
| 猫卡图鉴列表 | 透明猫主体 | `cutout → original` | 透明小猫是默认视觉；主体不可用时才回退原图或占位 |
| 猫档案详情主图 | 透明猫主体 | `cutout → original` | 不把带场景的猫生图误当透明主体 |
| **自己的个人主页列表** | **猫生图优先** | **`cover → cutout → original`** | 有可用猫生图就展示猫生图；没有才展示透明小猫 |
| 他人的公开主页列表 | 公开猫生图 | `cover → cutout → original` | 只能使用公开快照允许的文件，不暴露原图 fileID |
| **猫友图鉴公共列表** | **只展示猫生图** | **`ready cover` 固定** | 仅展示公开猫卡中可以换取临时地址的猫生图；不回退到 cutout、original 或 poster |
| 主体重新处理 | 用户原图 | `original` 固定 | 不能把当前列表展示图作为输入 |
| 猫生图生成输入 | 用户原图 | `original` 首选 | 防止用旧猫生图反复作为新输入造成链路污染 |
| Canvas 海报主图 | 猫生图封面 | `cover → original → cutout` | 猫生图失败时才回退 |
| 海报预览 | 完整海报 | `posterPath` 固定 | 只展示最终 Canvas 成品 |
| 分享 / 保存海报 | 完整海报 | `posterPath` / `posterImage` 固定 | 不能使用 `cover` 或 `cutout` 代替成品 |

### 4.2 本次明确的主页规则

“主页列表优先展示图生图的原图”在代码中必须写成：

```text
自己的个人主页：ready 的 cover → 可用的 cutout → original
```

这里的“图生图的原图”是 `cover` 生成结果，不是用户拍摄的 `original`。

主页不能把 `original` 放在 `cover` 前面，也不能直接调用只支持 `cutout → original` 的通用列表选择器来决定主页图片。

## 5. 图片生命周期

```text
拍照 / 相册上传
  → 内容安全
  → 保存 original
  → cat-transform
  → 保存 cutout
  → 写入相遇记录

进入海报流程
  → 读取当前记录
  → 使用 original 作为猫生图输入
  → 保存 cover
  → Canvas 合成 poster
  → 预览 / 分享 / 保存 poster
```

规则：

- 相遇完成时，`original` 和 `cutout` 分开保存；任何一张缺失都不能用另一张覆盖字段。
- `poster-cover` 生成失败时保留 `original` 和 `cutout`，写入 `coverStatus = 'rejected'`，海报按回退规则继续或提示重试。
- 海报重新打开时优先复用已有 `cover` 和缓存；除非明确要求重新生成，不重复调用猫生图。
- 猫生图封面生成成功后先写入对应 `encounters.media.coverFileID`；最终海报 PNG 的排版和上传失败，不能影响封面成品的复用。
- 临时地址失效时，只通过对应角色的 `fileID` 续取，不改变图片角色顺序。
- 删除记录时按 `originalFileID`、`cutoutFileID`、`coverFileID`、`posterImage.fileID` 分别处理，不能只删一个字段或误删其他记录的文件。

## 6. 代码维护约束

### 6.1 统一取值

页面不要自己拼字段或重新发明优先级，统一使用角色明确的辅助函数：

| 辅助函数 | 只能表示什么 |
| --- | --- |
| `storage.getRecordOriginalPath(record)` | 用户原图 |
| `storage.getRecordSubjectPath(record)` / `getRecordSubjectFileID(record)` | 透明猫主体 |
| `storage.getRecordPosterSourcePath(record)` / `getRecordPosterSourceFileID(record)` | 猫生图封面 |
| `storage.getRecordDisplayPath(record)` | 仅用于透明主体优先的首页 / 图鉴 / 详情场景 |
| `posterData` 内部 `resolveRecordImage(record)` | 海报输入，按 `cover → original → cutout`；页面不直接调用内部函数 |

自己的个人主页必须单独实现或调用 `cover → cutout → original` 的选择逻辑，不能用 `getRecordDisplayPath()` 代替。

### 6.2 绝对不能做的事

- 不能把 `photoPath` 当成“当前展示图”后再写回记录；它只表示原图兼容字段。
- 不能把 `coverPhotoPath` 写进 `cutoutPhotoPath`。
- 不能把 `posterPath` 或 `posterResult.posterImage.fileID` 当作列表猫图。
- 不能因为原图临时地址有效，就跳过已经生成的 `cover`。
- 不能因为封面生成失败，就伪造 `coverStatus = 'ready'`。
- 不能跨记录组合媒体和评分。

### 6.3 海报成品持久化与重复生成防护

- 海报完成后必须先上传最终 PNG，再把 `posterResult.posterImage.fileID` 写入对应 `encounters.media`；没有成品 `fileID` 的结果不得标记为已保存。
- 数据库写入 `media` 时替换完整对象，不能对 `media.posterResult` 做空对象上的深层字段更新；这样可以兼容历史 `posterResult: null`，避免 `-502001` 结构冲突。
- 只有海报模板、当前记录、评分/等级、猫名/文案和猫生图引用都相同的快照才可以复用；评分或内容变化时重绘 Canvas，并替换旧成品 fileID。
- 已存在 `coverStatus = ready` 且有 `coverFileID`（或可靠封面引用）时，即使临时地址换取失败，也只能回退到原图/主体图完成排版，禁止再次调用猫生图接口。
- `poster-cover` 收到同一 `ownerOpenId + catalogCatId + sourceRecordId` 时先查询已有封面；命中后只返回原 `fileID`，不调用图生图模型。历史数据只有封面 `fileID`、缺少状态字段时按 ready 兼容读取，明确 `pending/rejected` 除外。
- 公共“猫友图鉴”只读取已落库的 `coverFileID` 并换取临时 URL；刷新临时 URL 不等于重新生成，也不应调用 `poster-cover`。
- 规则迁移的清理标记必须幂等。云端清理或旧文件删除失败时保留待清理 fileID，但不能在下一次启动再次清空新生成的 `posterResult`。

## 7. 修改前验收清单

每次改图片展示或海报逻辑前，至少验证以下数据状态：

1. 只有 `original`：各页面按自己的回退规则显示原图或占位；
2. 有 `original + cutout`：图鉴和详情显示透明小猫；
3. 有 `original + cutout + cover(ready)`：自己的主页显示猫生图，图鉴和详情仍按页面规则显示透明小猫；
4. `coverStatus = rejected`：主页回退透明小猫，不显示失败封面；
5. 临时地址过期但 `fileID` 有效：续取同一角色的地址；
6. 同一猫有多条记录：海报图片、评分、猫名和等级来自同一条最新当前记录；
7. 完整海报存在：只在海报预览、分享和保存区域使用，不进入任何猫卡列表。

修改优先级时，必须先更新本文件的“页面来源矩阵”，再改代码和测试；如果代码与本文件冲突，以本文件和最新产品确认结果为准。

## 8. 相关实现文件

| 文件 | 作用 |
| --- | --- |
| `miniprogram/utils/storage.js` | 四类媒体字段归一化和基础角色读取 |
| `miniprogram/utils/posterData.js` | 海报当前记录、封面和海报输入选择 |
| `miniprogram/utils/posterResult.js` | 海报结果快照结构 |
| `miniprogram/pages/profile/profile.js` | 自己 / 他人主页列表展示 |
| `miniprogram/pages/collection/collection.js` | 猫卡图鉴列表 |
| `miniprogram/pages/card-detail/card-detail.js` | 猫档案详情 |
| `miniprogram/pages/poster-loading/poster-loading.js` | 猫生图封面和完整海报生成 |
| `miniprogram/pages/poster-preview/poster-preview.js` | 完整海报预览、分享和保存 |
| `miniprogram/cloudfunctions/cat-transform/` | 透明猫主体图处理 |
| `miniprogram/cloudfunctions/poster-cover/` | 猫生图封面生成 |

## 9. 版本记录

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| v1.0 | 2026-09-08 | 固化四类图片定义、字段归属、当前记录选择、主页猫生图优先规则、页面来源矩阵和维护验收清单。 |
| v1.1 | 2026-09-08 | 补充海报成品持久化、`media` 结构冲突防护、评分快照失效和猫生图重复调用防护规则。 |
