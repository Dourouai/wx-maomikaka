# 猫咪咔咔｜用户身份与猫咪档案数据链路 v0.1

> 状态：账号同步、猫咪档案、GLM 128 维结构化特征和分享链路已落地；奖励流水代码已补齐，待在 CloudBase 创建 `user_reward_ledger` 后重新部署 `sync-guest-data`。
>
> 本版目标：支持未登录时本地使用，用户主动绑定当前微信账号后，将本机相遇记录导入云端；同时允许用户把单只猫生成公开分享档案，并为后续多设备同步和真实猫咪重识别预留字段。

## 1. 身份结论

本项目使用微信小程序 CloudBase 的云函数身份链路，不在小程序端自建账号、密码、token，也不把 `openid` 传给客户端。

云函数通过 `cloud.getWXContext().OPENID` 获取当前微信用户，客户端只拿到“是否已绑定”、同步结果和用户主动选择的头像档案。服务端另外为每个用户生成一个随机 `accountBindingKey`，客户端只用它检测同一设备是否切换了微信账号，不把它当作登录凭证。`traceUser: true` 只负责 CloudBase 用户追踪，不代表业务数据已经完成同步。

产品上的“未登录”定义为：当前设备还没有把本地数据绑定到云端；不是把本地记录丢弃，也不是要求用户先完成账号注册。

## 2. 本地状态

`miniprogram/utils/storage.js` 保留原有本地记录结构，并新增：

| 字段 | 作用 |
| --- | --- |
| `clientRecordId` | 本地记录的幂等编号，旧数据回退使用 `recordId` |
| `syncState` | `pending` 或 `synced` |
| `serverEncounterId` | 云端相遇记录 ID |
| `catProfileId` | 云端猫咪档案 ID，当前为图鉴角色档案 |
| `captureId` | 一次拍摄上下文编号，用于把拍照页的可选位置结果带到揭示页 |
| `location` / `locationStatus` | 本次拍照记录的模糊位置及状态；位置只在用户明确选择后产生 |
| `syncError` | 最近一次同步失败原因，限制长度后仅用于本地提示 |

本地同步状态保存在 `maomikaka_sync_state`，设备编号保存在 `maomikaka_device_id`。设备编号只用于幂等键和调试，不作为用户身份，也不作为权限凭证。

## 3. 云端集合

### `users`

文档 `_id` 使用云函数取得的当前用户身份，客户端不能指定或查询其他用户。

```json
{
  "schemaVersion": 1,
  "clientBindingKey": "server-generated random value",
  "status": "active",
  "stats": {
    "totalPhotos": 0,
    "unlockedCount": 0,
    "pawGrowth": 0,
    "pointBalance": 0
  },
  "profile": {
    "avatarFileID": "cloud fileID，用户主动选择头像后保存"
  },
  "createdAt": "server date",
  "updatedAt": "server date",
  "lastSeenAt": "server date"
}
```

首版不保存手机号和精确位置。位置采用微信 `wx.getFuzzyLocation`，仅在拍照完成后用户明确选择“记录大概位置”时读取，并按约百米级精度写入对应拍照记录；头像只在用户主动选择后保存在当前设备，完成登录后再关联为用户档案的一部分；本版不保存微信昵称。

`users.profile` 仅保存用户主动选择的头像云文件编号，用于在“我的”页面展示；客户端不把微信头像用于猫咪识别，也不把它加入猫咪特征数据。

### `cat_profiles`

当前按用户 + 固定图鉴角色建立 `catalog-role` 档案，避免把 `cat_021` 误当成现实世界中某一只猫的唯一身份。

```json
{
  "ownerOpenId": "server only",
  "profileKind": "catalog-role",
  "identityStatus": "catalog-role",
  "catalogCatId": "cat_021",
  "displayName": "猫咪名称",
  "displayDescription": "猫咪描述",
  "displayPosterCopy": "适合后续海报排版的约 20 字短句",
  "encounterCount": 1,
  "locationSummary": {
    "firstLocation": {
      "source": "wx.getFuzzyLocation",
      "coordinateSystem": "wgs84",
      "latitude": 31.230,
      "longitude": 121.473,
      "capturedAt": "date"
    },
    "latestLocation": null,
    "locationCount": 1
  },
  "glmCatFeatureProfile": "最新一次白名单后的 glm-cat-feature.v0.2",
  "glmFeatureVector": "最新一次 glm-cat-vector.v0.2，固定 128 个 float 数值",
  "glmFeatureVectorVersion": "glm-cat-vector.v0.2",
  "glmFeatureVectorDimension": 128,
  "featureObservedAt": "date",
  "status": "active",
  "firstSeenAt": "date",
  "lastSeenAt": "date"
}
```

以后接入真正的猫咪重识别模型时，再把 `catProfileId` 升级为 `provisional / confirmed` 的现实猫咪档案；`catalogCatId` 继续只负责图鉴角色和视觉展示。

### `encounters`

每次成功完成当前收录流程生成一条记录。大图不放进数据库，只保存云存储 `fileID` 和模型结果元数据。

```json
{
  "ownerOpenId": "server only",
  "clientDeviceId": "device id",
  "clientRecordId": "rec_local_id",
  "clientRecordKey": "device id:rec_local_id",
  "catProfileId": "cloud profile id",
  "catalogCatId": "cat_021",
  "status": "active",
  "settlementState": "legacy-client-sync",
  "display": {
    "name": "猫咪名称",
    "description": "猫咪描述",
    "posterCopy": "适合后续海报排版的约 20 字短句",
    "copyVersion": "cat-copy.v0.5"
  },
  "media": {
    "originalFileID": "cloud fileID",
    "cutoutFileID": "cloud fileID",
    "coverFileID": "cloud fileID",
    "coverPromptVersion": "cat-cover-prompt.v0.3",
    "posterResult": {
      "schemaVersion": 1,
      "status": "ready",
      "posterJobId": "poster_fixed_xxx",
      "templateVersion": "cat-archive-poster-v0.9",
      "posterCacheVersion": "cat-poster-cache.v0.7",
      "sourceArchiveId": "cat_021",
      "sourceRecordId": "rec_local_id",
      "archiveCode": "202609071234AB",
      "name": "猫咪名称",
      "copy": "可复现海报排版所需的短句",
      "scores": {},
      "sourceImage": { "kind": "cover", "fileID": "cloud fileID" },
      "coverImage": { "fileID": "cloud fileID", "status": "ready" },
      "posterImage": {
        "mode": "cover-crop",
        "width": 718,
        "height": 1074,
        "fileID": ""
      },
      "generatedAt": "ISO string"
    }
  },
  "observation": {
    "glmCatFeatureProfile": "白名单后的 glm-cat-feature.v0.2",
    "glmFeatureVector": "由服务端从结构化特征重算的 128 维数组",
    "glmFeatureVectorVersion": "glm-cat-vector.v0.2",
    "glmFeatureVectorDimension": 128
  },
  "score": {},
  "location": {
    "source": "wx.getFuzzyLocation",
    "coordinateSystem": "wgs84",
    "latitude": 31.230,
    "longitude": 121.473,
    "capturedAt": "ISO string"
  },
  "locationStatus": "captured",
  "createdAt": "date",
  "capturedAt": "ISO string",
  "importedAt": "server date"
}
```

首版同步不会重新扣罐罐或重复发奖励，`settlementState` 明确标记为旧客户端同步。后续新拍摄的扣罐、评分、奖励需要迁移到服务端任务结算后，再改为正式结算状态。

`glmCatFeatureProfile` 是后续身份候选匹配的观察证据，不是现实猫咪的唯一 `catId`。当前 128 维向量由 `101` 个 one-hot 特征、`19` 个字段置信度和 `8` 个质量维度组成，由 `sync-guest-data` 服务端按版本重算后写入数据库。它是 GLM 结构化观察向量，不是图像 embedding；公开分享数据不包含特征档案或向量。

`display.posterCopy` 是 GLM 根据照片可见内容生成的约 20 字海报短句，服务端限制为 16–36 个字符，和用于猫档案阅读的 `display.description` 分开保存。它是展示文案，不属于猫咪身份特征。

`media.posterResult` 是挂在对应 `encounters` 上的派生海报快照。完整 PNG 上传云存储，`posterImage.fileID` 存入数据库，临时路径仅用于本地预览。打开海报先读取云端成品；公开主页优先展示成品，分享档案按分享所属用户与相遇记录查询最新结果。已有成品时复用，读取失败提示重试，不自动重新生成；已取消进入生成页时自动清理历史产物。删除海报数据后才允许重新生成，未来主动重新生成入口尚未开放。

### `user_reward_ledger`

每一次相遇奖励对应一条云端流水，使用 `encounterId` 派生的文档 ID 做幂等键。`users.stats` 是当前用户的汇总缓存，流水是奖励变动的可核对明细；放归猫咪只软删除档案和相遇记录，不删除奖励流水，因此累计猫爪成长值不会倒退。

```json
{
  "schemaVersion": 1,
  "ownerOpenId": "server only",
  "rewardType": "encounter-reward",
  "settlementState": "legacy-client-sync",
  "source": "guest-import",
  "status": "active",
  "encounterId": "cloud encounter id",
  "clientRecordId": "rec_local_id",
  "catProfileId": "cloud profile id",
  "catalogCatId": "cat_021",
  "delta": {
    "pawGrowth": 115,
    "points": 8
  },
  "occurredAt": "date",
  "createdAt": "server date",
  "updatedAt": "server date"
}
```

当前咔咔分余额由所有有效流水的 `delta.points` 求和，成长值由所有有效流水的 `delta.pawGrowth` 求和。客户端不能直接写流水；同步云函数会为历史相遇补建流水，并在重复导入、重试和拉取时保持幂等。

### `cat_shares`

用户主动分享某只猫时生成一个随机 `shareId`，云端保存经过清理的档案快照。分享链接只携带 `shareId`，不携带 `openid`、设备编号或本地文件路径；接收者通过 `cat-archive-share` 只读公开快照。

```json
{
  "schemaVersion": 1,
  "ownerOpenId": "server only",
  "catalogCatId": "cat_021",
  "archive": {
    "featuredRecordId": "rec_local_id",
    "profile": {},
    "records": []
  },
  "status": "active",
  "createdAt": "server date",
  "updatedAt": "server date",
  "lastSharedAt": "server date"
}
```

## 4. 已实现的云函数

### `auth-bootstrap`

- 从 `cloud.getWXContext()` 取得当前用户身份；
- `action: check` 只检查当前账号指纹，不创建业务用户文档；
- 幂等创建或更新 `users` 文档；
- 不把 `openid` 返回给小程序。

### `sync-guest-data`

- `action: import`：导入本地待同步记录；
- `action: pull`：只返回当前用户自己的档案、相遇记录、奖励流水和统计汇总；
- `action: save-poster-result`：只更新当前用户所属 `encounters.media.posterResult`，不改动猫咪原始档案字段；
- `action: delete-catalog-archive`：按当前用户和图鉴角色软删除云端档案及相遇记录；
- 使用 `clientRecordKey` 去重，重复点击和网络重试不会重复写入同一条本地记录；
- 使用 `encounterId` 派生的流水 ID 去重，历史相遇会在拉取时自动补建奖励流水；
- 每次导入或拉取后重算 `users.stats.totalPhotos`、`unlockedCount`、`pawGrowth` 和 `pointBalance`；
- 所有展示文本、分数、文件 ID 都经过长度和范围清理。

### `cat-archive-share`

- `action: create`：由分享者创建或更新当前猫咪的公开快照；
- `action: get`：接收者凭随机 `shareId` 读取单只猫的公开档案，并由云函数把档案图片的 `fileID` 换成临时 URL；
- 不向客户端返回 `ownerOpenId`，接收者不需要拥有这条猫咪档案的本地记录。
- 临时 URL 只在接口返回时动态生成，不写入 `cat_shares`，过期后重新打开页面即可刷新。

## 5. 用户流程

```text
首次打开
  → 本地使用，不触发数据导入
  → 拍摄结果写入本机，syncState = pending

拍照权限与位置权限
  → 进入拍摄页时由 `<camera>` 组件申请相机权限；相机是必要能力，已授权后不会每次重复申请
  → 拍照成功后先展示自定义位置说明
  → 用户选择“记录大概位置”后，才触发微信模糊位置授权；选择“暂不记录”或授权失败，仍继续识别和入档
  → `encounters.location` 保存本次记录；`cat_profiles.locationSummary` 保存该猫卡位置的首次、最近一次和采样次数

我的 → 绑定当前微信账号
  → 显示本机记录数量
  → 用户确认导入
  → auth-bootstrap
  → sync-guest-data/import
  → sync-guest-data/pull
  → 本地记录标记 synced，云端记录回填本机

已绑定用户再次拍摄
  → 先正常展示结果
  → 后台提交 pending 记录
  → 失败继续保留 pending，下一次同步重试

猫档案页点击微信右上角分享
  → 后台准备/更新 cat_shares 快照
  → 分享路径携带 shareId
  → 接收者打开详情页
  → cat-archive-share/get 返回公开档案和云存储 fileID
  → 详情页换取临时图片地址并以只读方式展示

检测到微信账号切换
  → 暂停自动同步并将本机记录重新标为 pending
  → 用户确认后按新账号重新导入，不复用旧账号的云端 ID
```

## 6. CloudBase 部署检查

本地代码已经覆盖以下三个云函数；线上是否为最新版本需要以 CloudBase 控制台为准。本次 GLM 128 维特征和奖励流水代码完成后，必须重新上传并部署 `sync-guest-data`：

- `auth-bootstrap`
- `sync-guest-data`
- `cat-archive-share`

先在 CloudBase 文档数据库中创建 `users`、`cat_profiles`、`encounters`、`cat_shares`、`user_reward_ledger` 五个集合；代码会把没有记录的集合查询当作空结果，但首次写入仍需要集合已存在。

如果当前环境的云函数执行上限仍是 3 秒，请在 CloudBase 函数配置中把这三个数据函数的超时时间调到至少 30 秒；客户端已经按 20 条记录分批，避免一次导入过大。

建议在数据库中建立以下索引：

- `cat_profiles`: `ownerOpenId + catalogCatId + profileKind + status`；
- `encounters`: `ownerOpenId + clientRecordKey + status`；
- `encounters`: `ownerOpenId + status`；
- `encounters`: `ownerOpenId + catalogCatId + status`。
- `cat_shares`: `status + updatedAt`；
- `user_reward_ledger`: `ownerOpenId + status + occurredAt`；

数据库权限建议关闭小程序端直接读写，只允许云函数访问。云函数内部始终以 `cloud.getWXContext().OPENID` 作为 owner，不信任事件参数中的用户 ID。

云存储继续只在数据库和分享快照中保存 `fileID`；分享读取由云函数生成临时图片地址，因此不要求接收方拥有原图的本地记录。若后续收紧云存储规则，需同时确认云函数具备读取这些分享图片的权限。

## 7. 当前边界

1. 本版实现的是“数据绑定、档案同步与奖励流水”，不是完整的服务端拍摄结算系统。
2. 当前 `catProfileId` 是用户维度的图鉴角色档案，不宣称识别出了现实中的同一只猫。
3. 当前奖励流水沿用旧客户端计算结果，`settlementState` 为 `legacy-client-sync`；`daily_usage`、服务端扣罐、正式奖励结算和处理任务恢复仍应作为下一阶段服务端化工作。
4. 删除目前采用云端软删除，原图和主体图的实际清理需要结合保存期限和用户删除政策另行执行；公开分享快照的撤回策略还需要下一版补充。

## 8. 验收清单

- 新设备无本地记录，绑定后能创建用户并拉取空快照；
- 有本地记录时，绑定前会展示数量并要求确认；
- 同一记录重复同步不会产生两条 `encounters`；
- 同一相遇重复同步不会产生两条 `user_reward_ledger`，用户统计中的猫爪和咔咔分不会重复累计；
- 历史相遇拉取后能补建奖励流水，并返回 `stats.pointBalance` 与 `stats.pawGrowth`；
- 云函数失败时本地记录仍存在且保持 `pending`；
- 已绑定用户新拍后会后台同步；
- 云端已有记录的新设备拉取后能进入本地图鉴；
- 猫档案分享后，未拥有本地记录的接收者能通过 `shareId` 打开只读档案；
- 放归已绑定档案时，云端软删除成功后才删除本地档案；
- 客户端日志和接口返回中不出现 `openid`。
