# 猫咪咔咔｜用户授权与数据处理流程审计 v0.5

> 审计日期：2026-09-09
> 审计范围：`miniprogram/`、相关云函数、当前隐私页和账号/分享/支付文档
> 文档状态：已补充授权节点与“条款引导”判定；登录、记录同步、资料设置已拆成三条链路，微信后台配置、临时数据清理任务和真机验证仍是发布前事项
> 目的：把所有“需要用户同意、授权或主动确认”的流程统一成一套可执行规则，作为后续代码修改、隐私文案和上线检查的基线。

这不是法律意见，也不能替代微信公众平台的隐私指引、第三方 AI 服务协议和正式法务审核。本文记录的是当前代码真实行为，以及上线前必须补齐的处理方案。

## 0. 结论先行

当前代码中没有直接调用 `wx.authorize`。但小程序存在以下真实的授权或确认边界：

1. 登录：用户点击登录时只建立当前微信账号身份，不读取头像和昵称，也不打开资料填写弹窗。
2. 微信昵称和头像：登录后只有用户主动点击资料卡上的“设置”按钮，才打开资料弹窗，通过 `button open-type="chooseAvatar"` 和 `input type="nickname"` 取得；昵称和头像分别通过微信内容安全接口审核后，才写入用户档案。
3. 记录同步：用户点击“继续同步”只同步本机相遇记录，不再采集微信头像和昵称。
4. 摄像头：进入并实际使用 `<camera>` 组件时，由微信处理相机权限。
5. 用户选中的照片：选图前调用 `wx.getPrivacySetting` / `wx.requirePrivacyAuthorize`，然后调用 `wx.chooseMedia` 或 `wx.chooseImage`。
6. 模糊位置：拍照完成后，用户先在页面选择“记录大概位置”，再调用 `wx.getFuzzyLocation`。
7. 保存海报到相册：用户点击“保存海报”后调用 `wx.saveImageToPhotosAlbum`，需要 `scope.writePhotosAlbum`。

另外还有四类不是系统权限弹窗、但必须有清晰的用户主动操作和数据边界：

- 绑定微信账号并把本机记录导入账号；
- 将猫卡、头像或个人主页公开分享；
- 发起虚拟支付并确认扣款；
- 用户主动提交图片后，允许图片进入内容安全和第三方 AI 处理链路。

### 当前最重要的审计结论

- **功能链路基本齐全**：拒绝位置不会阻断拍照；拒绝相册写入不会影响海报生成；内容安全失败会阻断 AI 处理和入档；绑定导入有二次确认。
- **P0 上线门槛**：微信后台必须完成相机、选中照片/视频、模糊位置、相册仅写入四项隐私指引，并同步到实际测试/体验版本。 `app.json` 的描述不能替代后台隐私指引。
- **P1 数据披露已按方案 A 收敛**：未绑定时记录仍会暂存到 `guest_encounters`，海报 PNG 也可能先上传云存储；隐私页已经明确说明匿名临时存储、约 30 天保留和绑定认领。云端物理清理仍需配置任务或 TTL。
- **P1 选图已改为 fail-closed**：API 存在但 `getPrivacySetting` 查询失败时返回 `PHOTO_PRIVACY_UNAVAILABLE`，不打开选择器、不上传、不进入 AI；只有不支持隐私 API 的旧基础库保留兼容路径。
- **P1 隐私版本已统一到 V0.2**：客户端页面、选图授权记录和 guest 临时记录都带当前版本信息；微信公众平台后台必须同步发布同一版本的隐私指引。
- **P1 设置返回已补齐复核**：相机、选图和保存海报从 `wx.openSetting` 返回后会重新读取状态；已授权只恢复入口，仍未授权则保留引导，不自动执行原操作。
- **P1 登录资料链路已拆成三条**：登录只建立账号身份；记录同步只同步记录；资料卡“设置”按钮才使用 `chooseAvatar` / `type="nickname"`，并在服务端完成昵称和头像审核后保存。

## 1. 授权模型：不要把几个概念混在一起

| 层级 | 典型例子 | 用户是否看到系统弹窗 | 处理原则 |
| --- | --- | --- | --- |
| 微信系统权限 | 摄像头、模糊位置、写入相册 | 通常会 | 只在实际需要时申请；拒绝后给替代路径，不循环弹窗 |
| 微信隐私协议同意 | 用户选中的照片/视频 | 可能出现隐私同意页 | 只用于相册选图等被微信纳入隐私指引的能力；登录资料弹窗不重复触发这一层 |
| 产品级数据处理同意 | AI 识别、绑定导入、公开分享 | 通常不是系统弹窗 | 在用户点击动作前说明数据会怎么用，成功后才写入对应范围 |
| CloudBase 身份认证 | `cloud.getWXContext().OPENID`、`wx.login` | 不一定 | 只在云函数服务端取身份；不把 `openid`、登录凭证返回或保存到客户端 |
| 交易确认 | `wx.requestVirtualPayment` | 微信支付界面 | 以服务端订单和到账通知为准；客户端不能自行增加余额 |

原则：系统权限解决“能不能调用能力”，产品确认解决“用户是否知道并同意数据用途”，服务端身份解决“数据归属哪个账号”。三者必须分别处理。

## 1.1 授权节点与“条款引导”判定

这里把“条款引导”限定为微信运行时隐私指引（`wx.requirePrivacyAuthorize`）或可阅读的隐私说明页；头像昵称填写弹窗、位置确认和导入确认都属于产品交互，不应被误称为同一类授权。

| 节点 | 用户触发 | 是否有条款引导 | 是否重复出现 | 拒绝/取消后的处理 | 实际数据边界 |
| --- | --- | --- | --- | --- | --- |
| 登录身份 | 点击“登录并绑定微信账号” | **无条款引导、无资料弹窗** | 只在用户主动点击登录时执行；账号已绑定后不重复创建 | 登录失败不显示已登录；本机记录继续保留 | 只建立 CloudBase 当前微信身份，不读取头像和昵称 |
| 设置微信资料 | 登录后点击资料卡“设置” | **无独立条款引导**；直接打开头像+昵称填写控件 | 只在用户主动设置时出现；已保存资料可再次进入设置 | 关闭、昵称为空、未选头像或审核失败：不写入新资料，账号仍保持已登录 | 仅提交用户在官方填写控件中主动选择/填写的头像和昵称；写入前走文本/图片内容安全 |
| 同步相遇记录 | 登录后点击“继续同步” | **无条款引导**；不打开资料填写控件 | 只在存在待同步记录时出现 | 取消导入则保留本机 pending，不影响登录和资料 | 仅同步用户确认范围内的本机记录及关联媒体 |
| 相册选图 | 点击“选择图片上传” | **有**：按需调用 `wx.requirePrivacyAuthorize` | 微信已记录同意后不再重复；撤回后下次实际选图可再次出现 | 不同意或隐私状态无法确认：不打开选择器、不上传、不进 AI | 只读取用户主动选中的图片；不读取相册其他内容 |
| 现场拍照 | 点击拍照并实际使用 `<camera>` | **无自定义条款弹窗**；由微信在组件实际使用时处理相机权限 | 系统已允许后不重复；拒绝后只在用户再次实际拍照时处理 | 普通拒绝可去设置；后台未声明隐私指引时显示配置错误，不能误导去设置 | 只在拍摄动作发生时取得相机画面和照片 |
| 记录大概位置 | 拍照完成后选择“记录位置” | **有产品确认**“记录这次相遇的位置？”；不是法律条款页 | 选择“不记录”后保存跳过偏好，不反复打扰；系统授权状态由微信维护 | 不记录、拒绝或读取失败都继续识别和入档 | 仅保存本次约百米级位置，不传给图片 AI |
| 保存海报 | 点击“保存海报” | **无运行时条款引导**；这是明确的写入动作 | 已授权后不重复；拒绝后用户再次点击才引导设置 | 不写入相册；保留当前海报供用户稍后重试 | 只写入当前已生成的海报 PNG |
| 内容安全与 AI | 用户主动提交拍照/选中的图片 | **无单独 AI 条款弹窗**；依赖静态隐私说明和提交前的主动动作 | 每次提交不重复弹条款；隐私页可随时查看 | 内容安全或 AI 失败：不入正式档案、不显示成功 | 用户主动提交的图片、识别结果和必要的 AI 处理元数据 |
| 未绑定临时存储 | 用户主动完成一次相遇处理 | **无额外运行时条款弹窗**；隐私页披露云端临时存储和保留期 | 不重复弹；绑定导入另有产品确认 | 仍按临时数据规则保存/清理，不自动归属账号 | 匿名 `guest_encounters` 及必要媒体，待绑定认领 |
| 绑定和导入 | 点击绑定并确认同步本机记录 | **无系统条款弹窗**；有数量、范围和账号归属确认 | 每个账号/设备关系只在需要导入时确认 | 取消则保留本机，不认领到云端账号 | 本机记录、媒体 fileID、评分和允许同步的字段 |
| 公开分享 | 点击分享猫卡/主页 | **无系统条款弹窗**；属于主动公开行为 | 当前未做每次分享条款确认 | 分享准备失败不公开；撤回能力仍需补齐 | 仅公开快照允许字段，不含 openid、位置和本地路径 |
| 虚拟支付 | 点击充值并确认套餐 | **无隐私条款引导**；有产品订单确认和微信交易界面 | 每笔订单确认一次 | 取消/失败不增加余额 | 订单、套餐、支付结果和服务端余额流水 |
| 隐私说明页 | 从“关于猫咪咔咔”进入 `/pages/privacy/privacy` | **有可阅读说明**，但它不是运行时同意事件 | 用户主动查看，不应被当成已授权记录 | 返回上一页，不改变系统权限状态 | 展示处理目的、范围、第三方 AI、临时存储和用户权利 |

### 当前结论

- 登录不读取微信头像和昵称，也不打开资料弹窗；只有用户主动点击资料卡“设置”时，才进入头像+昵称填写控件。
- 资料设置弹窗不调用 `wx.getPrivacySetting` / `wx.requirePrivacyAuthorize`；这两个 API 只保留给相册选图等实际需要微信隐私指引的能力。
- 资料设置的昵称和头像审核在 `auth-bootstrap` 服务端调用微信 `msgSecCheck` / `imgSecCheck` 完成；审核失败不写入用户档案。
- 运行时微信隐私引导目前只保留在相册选图链路；它不等于登录资料弹窗，也不等于位置确认。
- `/pages/privacy/privacy` 是可阅读的隐私说明入口，不会自动把用户变成“已同意”，也不会替代微信后台隐私指引。
- 相机、相册写入和模糊位置仍按实际使用节点处理；AI 和未绑定临时存储当前没有独立运行时条款弹窗，必须依靠隐私页披露和主动操作边界。

## 2. 全量授权/确认清单

| 编号 | 场景 | 当前入口与调用 | 数据范围 | 拒绝/失败后的现状 | 审计结论 |
| --- | --- | --- | --- | --- | --- |
| A1 | 登录并建立账号身份 | `pages/my/my.js` → `auth-bootstrap(action=bootstrap)`，不带资料 | CloudBase 当前微信身份和绑定状态 | 登录失败不显示已登录；本机记录继续保留 | 登录不读取头像和昵称 |
| A2 | 拍照 | `pages/camera/camera.wxml` 的 `<camera>` | 相机实时画面，仅在拍摄时产生照片 | 相机错误卡片；普通拒绝可去设置 | 依赖后台隐私指引；设置返回后需重新校验 |
| A3 | 相册选图 | `utils/photoPicker.js` → 隐私同意 → `wx.chooseMedia` / `wx.chooseImage` | 用户主动选中的一张图片 | 取消静默返回；未同意提示先同意；权限拒绝可去设置 | 主链路正确；查询失败不应继续放行 |
| A4 | 拍照后记录大概位置 | `utils/location.js` → `wx.getFuzzyLocation` | 约百米级经纬度、时间、来源 | “不记录”、拒绝、读取失败均继续识别和入档 | 设计正确；位置不能阻断核心功能 |
| A5 | 保存海报 | `utils/posterShare.js` → `wx.saveImageToPhotosAlbum` | 当前已生成的海报 PNG，仅写入相册 | 弹窗引导去设置；未声明时提示管理员 | 主流程正确；需验证后台声明和设置回访 |
| A6 | 隐私协议确认 | `wx.getPrivacySetting` / `wx.requirePrivacyAuthorize` | 选择照片前的隐私同意状态 | 未同意不打开选图器 | 需要和隐私页、微信后台声明保持一致 |
| A7 | AI 图片处理 | 用户点击拍照/上传后 → `content-security` → `cat-vision`、`cat-transform` | 用户选中的图片、必要参数、识别结果 | 内容安全失败或服务不可用时不进入 AI/不写正式记录 | 不是系统权限，但必须有用途披露和失败关闭 |
| A8 | 设置微信资料 | 登录后点击资料卡设置 → `chooseAvatar` / `type="nickname"` → `auth-bootstrap(nicknameSource=settings)` | 用户主动选择的微信头像和昵称 | 关闭、取消或审核失败不写入新资料；账号保持已登录 | 服务端审核通过后才保存；不依赖记录同步 |
| A9 | 记录同步与导入 | 登录后点击继续同步 → 用户确认导入 → `sync-guest-data` | 本机记录、媒体 fileID、评分和可选位置 | 不同意导入则保留本机；登录状态和微信资料不受影响 | 不采集头像和昵称 |
| A10 | 公开分享 | 海报/猫卡/个人主页的微信分享按钮 | 分享快照、猫卡媒体、公开昵称头像 | 分享准备失败只提示重试 | 无系统权限，但必须按“主动公开”处理 |
| A11 | 虚拟支付 | 用户点击确认充值 → `wx.requestVirtualPayment` | 订单、套餐、支付结果、服务端余额 | 用户取消不报错；失败不增加客户端余额 | 是交易确认，不是隐私授权；必须以服务端通知发货 |

## 3. 各条链路的现状和落地方案

### 3.1 登录、记录同步和头像昵称设置

当前链路：

```text
用户点击“登录并绑定微信账号”
  → auth-bootstrap(action=bootstrap，不带 profile)
  → 服务端用 OPENID 创建/更新 users
  → 登录完成；本机记录仍保持 pending
  → 有 pending 时显示“继续同步”入口

用户点击资料卡“设置”
  → 打开一次资料弹窗
  → 用户选择微信头像、从微信建议中填写昵称
  → 头像上传为候选 avatarFileID
  → auth-bootstrap(action=bootstrap, nicknameSource=settings)
  → 服务端调用 msgSecCheck / imgSecCheck
  → 审核通过后写入 users.profile

用户点击“继续同步”（仅存在待同步记录时展示）
  → 用户确认导入范围
  → sync-guest-data/import（不带新的头像昵称采集）
  → 本机记录同步完成
```

代码依据：[`my.js`](../miniprogram/pages/my/my.js#L250)、[`my.js`](../miniprogram/pages/my/my.js#L347)、[`userData.js`](../miniprogram/utils/userData.js#L187)、[`auth-bootstrap`](../miniprogram/cloudfunctions/auth-bootstrap/index.js#L243)。

当前产品规则：

- 登录阶段不调用 `wx.getUserProfile` / `wx.getUserInfo`，也不打开 `chooseAvatar` 或 `type="nickname"`；只建立 CloudBase 当前微信账号身份。
- 登录成功后本机记录仍未同步；只有存在 pending 记录时才显示“继续同步”。
- 资料卡“设置”按钮使用微信官方的 `open-type="chooseAvatar"` 和 `input type="nickname"`；这不是登录授权，也不依赖记录同步。
- 资料保存前由 `auth-bootstrap` 服务端调用微信文本/图片内容安全接口；任一审核不可用或命中风险，都不更新 `users.profile`。
- 设置弹窗取消、昵称为空、头像上传失败或审核失败，只取消本次资料保存，不影响已经完成的登录和本机记录。
- 记录同步只处理本机记录导入，不再打开头像昵称资料弹窗。
- `openid` 只在云函数通过 `cloud.getWXContext()` 获取，不返回客户端。

头像填写能力返回临时头像文件，客户端在资料设置阶段先上传为候选 `avatarFileID`，服务端审核通过后才写入用户资料；展示时仍优先使用云端临时地址，失败时回退猫咪咔咔 Logo。

拒绝和异常处理方案：

| 情况 | 处理 |
| --- | --- |
| 登录失败 | 不显示“已登录”，保留本机待同步状态，提示稍后重试 |
| 用户关闭资料设置弹窗 | 账号保持已登录；不覆盖已有微信资料 |
| 设置时昵称为空或未拿到头像 | 不执行本次资料保存，提示补充资料；账号保持已登录 |
| 资料设置头像上传失败 | 不执行本次资料保存，不覆盖已有头像；账号保持已登录 |
| 昵称或头像内容安全失败 | 不写入新资料，提示更换内容或稍后重试；账号保持已登录 |
| `auth-bootstrap` 失败 | 不显示当前步骤成功，保留本机待同步状态，提示稍后重试 |
| 检测到账号变化 | 清理本地旧账号资料，重新要求用户确认本机记录归属 |
| 自定义昵称审核失败 | 不更新昵称，明确提示风险或审核服务暂不可用 |

需要落地的修正：

1. 真机首次登录不出现头像昵称填写弹窗，登录成功后本机记录仍保持待同步。
2. 点击资料卡“设置”才出现资料弹窗；点击“继续同步”只导入记录，不再采集资料。
3. 将“登录失败”“关闭资料弹窗”“昵称为空”“头像上传失败”“内容审核失败”“导入确认取消”和“云端同步失败”区分为不同日志码，避免把所有问题都显示成授权失败。
4. 如果未来恢复自定义昵称入口，必须另行增加用途说明、审核失败分支和隐私页说明；当前小程序不开放该入口。

### 3.2 拍照和摄像头

当前 `<camera>` 由微信负责申请相机权限，代码没有直接 `wx.authorize`。拍照成功后只生成一次本地 pending capture，再进入统一识别流程。

代码依据：[`camera.js`](../miniprogram/pages/camera/camera.js#L78)、[`camera.wxml`](../miniprogram/pages/camera/camera.wxml#L13)、[`camera.js`](../miniprogram/pages/camera/camera.js#L238)。

处理规则：

- 相机是拍照必要能力，但不在后台持续访问。
- 不在进入拍摄页时额外弹一层自定义隐私卡；由微信在组件实际使用时处理系统权限。
- `errno 112` 或 `api scope is not declared in the privacy agreement` 是后台隐私指引缺失，不是普通系统权限拒绝，不能用 `wx.openSetting` 代替配置。
- 普通相机拒绝显示“打开设置”；用户返回后要重新检查授权状态并重新创建/确认 camera context。
- 相机失败不能创建相遇记录，也不能消耗成功处理所需的业务额度。

#### 当前缺口

当前已按下面的方式处理 `openCameraSettings()`：

```text
打开设置
  → 用户返回
  → wx.getSetting 检查相机状态
  → 已授权：清除错误并重新创建 camera context
  → 仍拒绝：保留错误卡片
  → 未知/接口失败：提示稍后重试，不假设已授权
```

相机页不会在设置返回后自动拍照；用户仍需主动点击快门。系统权限已批准时，后续拍照直接调用相机能力，不再重复申请。

### 3.3 相册选图和隐私同意

当前首页正式入口是“选择图片上传”，只允许从相册选择一张图片；`image-image` 是开发测试页，当前允许 `album` 和 `camera` 两种来源。两者都复用 `photoPicker`。

代码依据：[`photoPicker.js`](../miniprogram/utils/photoPicker.js#L23)、[`index.js`](../miniprogram/pages/index/index.js#L151)、[`image-image.js`](../miniprogram/pages/image-image/image-image.js#L86)。

正式链路：

```text
用户点击选择图片
  → 读取隐私同意状态
  → needAuthorization=true：调用 wx.requirePrivacyAuthorize
  → 用户同意后调用 wx.chooseMedia / wx.chooseImage
  → 只取 tempFiles[0]
  → 内容安全检查
  → GLM 识别 + 主体图处理 + 评分 + 入档
```

必须保持的边界：

- `scope.writePhotosAlbum` 不能代替选图隐私同意；选图和写入相册是两种不同能力。
- 不读取用户没有主动选中的其他照片或视频。
- 用户取消选择不应弹错误、不应上传、不应消耗额度。
- 隐私同意被拒绝时，不应打开选择器，也不应调用内容安全或 AI 接口。
- 选图成功后，原图先过 `content-security`；通过后的 fileID 才能进入识别和主体处理。

#### 已落地：隐私状态查询失败改为 fail-closed

当前 `requestPhotoSelectionAuthorization()` 在隐私 API 存在、但 `wx.getPrivacySetting` 调用失败时返回 `PHOTO_PRIVACY_UNAVAILABLE`，不会继续打开选择器。这样“无法确认用户是否同意”不会被当成“已经同意”。

当前执行规则：

- API 不存在：保留旧基础库兼容路径，由微信选择器自行处理；
- API 存在但查询失败：返回 `PHOTO_PRIVACY_UNAVAILABLE`，不打开选择器，提示“隐私状态暂时无法确认，请稍后重试”；
- `requirePrivacyAuthorize` 被拒绝：返回 `PHOTO_PRIVACY_DENIED`，不上传、不进入识别；
- 后台未声明“选中的照片或视频”：返回管理员配置错误，不引导用户去系统设置。

客户端在确认成功后记录 `privacyPolicyVersion = V0.2` 和 `photoConsentAt`，只保存版本与时间，不保存隐私文本或照片内容。

### 3.3.1 微信后台隐私指引同步清单

代码和页面文案不能替代微信公众平台后台配置。当前发布阻断项如下，四项都要在开发、体验和正式发布版本同步：

| 代码能力 | 微信后台隐私项 | 用户可见用途 | 当前状态 |
| --- | --- | --- | --- |
| `<camera>` 拍照 | 摄像头 | 拍摄猫咪照片并进入识别流程 | 待后台确认 |
| `wx.chooseMedia` / `wx.chooseImage` | 选中的照片或视频 | 读取用户主动选中的一张猫咪照片，做内容安全、识别和主体处理 | 待后台确认 |
| `wx.getFuzzyLocation` | 模糊位置信息 | 拍照后按用户选择记录约百米级位置 | 待后台确认 |
| `wx.saveImageToPhotosAlbum` | 相册（仅写入） | 用户主动点击保存海报时写入当前海报 | 待后台确认 |

同步步骤：

1. 在微信公众平台补齐上述四项用途、处理场景和用户撤回方式，提交并发布隐私指引版本 `V0.2`。
2. 将同一隐私指引同步到当前开发/体验/正式版本；不要只修改 `app.json` 或本地隐私页。
3. 在开发者工具“详情—域名信息/隐私设置”刷新项目配置，清理授权缓存后重新编译。
4. 用新用户分别验证首次拍照、首次选图、位置选择和保存海报；后台未声明时要显示配置问题，而不是引导用户反复授权。

### 3.4 模糊位置

位置是可选能力，只对现场拍照生效；相册上传明确写入 `locationStatus: unavailable`，不反推位置。

代码依据：[`location.js`](../miniprogram/utils/location.js#L1)、[`camera.js`](../miniprogram/pages/camera/camera.js#L141)、[`app.json`](../miniprogram/app.json#L45)。

当前链路：

```text
拍照完成
  → 检查 scope.userFuzzyLocation
  → 尚未决定：页面说明“记录大概位置？”
  → 用户选择记录：调用 wx.getFuzzyLocation
  → 用户选择不记录：保存 skipped 偏好
  → 拒绝/失败：保存 denied 或 unavailable
  → 上述所有分支都继续识别、评分和入档
```

数据处理规则：

- 坐标保留到小数点后三位，约百米级，不保存不必要的精度。
- 只写入本次 `encounters.location`，不传给 GLM、HY3 或其他 AI 图片接口。
- 公开猫卡分享快照不包含 `location`；公开主页只返回产品允许公开的字段。
- 用户拒绝位置不影响拍照和入档；后续可在微信设置中重新开启。
- `getSetting` 失败按 `unavailable` 处理，不阻断核心流程。

建议验收：新设备第一次拍照必须看到自定义说明；选择不记录后后续拍照不重复打扰；系统设置重新授权后下一次拍照可以重新获取位置。

### 3.5 保存海报到相册

这是“用户主动把生成结果写入设备”的动作，不应在生成海报或打开预览时自动申请。

代码依据：[`posterShare.js`](../miniprogram/utils/posterShare.js#L66)、[`poster-preview.js`](../miniprogram/pages/poster-preview/poster-preview.js#L78)。

处理规则：

1. 用户点击“保存海报”。
2. 读取 `scope.writePhotosAlbum` 状态。
3. 已授权才保存；明确拒绝则弹窗询问是否去微信设置。
4. 用户进入设置后，回到页面再次点击保存，不自动重复写入。
5. 成功才显示“已保存到相册”；失败不能显示成功状态。

错误必须区分：

| 错误 | 含义 | 用户提示 |
| --- | --- | --- |
| `POSTER_SAVE_DENIED` | 用户未授权或已撤回相册写入 | 去微信设置开启后再试 |
| `POSTER_PRIVACY_NOT_DECLARED` | 微信后台隐私指引没有声明相册仅写入 | 管理员补充后台配置 |
| `POSTER_SAVE_UNSUPPORTED` | 当前环境不支持保存 | 使用支持该能力的微信客户端 |
| 其他保存失败 | 文件或系统暂时异常 | 保留海报，稍后重试 |

必须在微信后台声明“相册（仅写入）”，并在体验版/正式版分别确认隐私指引已同步。 `app.json` 中的描述仅是代码侧声明，不足以解除微信侧拦截。

### 3.6 内容安全、识别和第三方 AI

这不是系统权限，但属于明确的数据处理行为，授权边界是用户主动点击“拍照”或“选择图片”并提交处理。

代码依据：[`contentSafety.js`](../miniprogram/utils/contentSafety.js#L152)、[`content-security`](../miniprogram/cloudfunctions/content-security/index.js#L57)、[`reveal.js`](../miniprogram/pages/reveal/reveal.js#L176)。

当前流程：

```text
用户主动提交照片
  → 读取文件信息并压缩
  → 上传内容安全临时文件
  → security.imgSecCheck
  → 通过后复用安全 fileID
  → cat-vision：识别、评分、结构化结果
  → cat-transform：生成透明主体图
  → 两条链路完成后保存记录
```

处理原则：

- 内容安全失败或服务不可用采用失败关闭：不进入 AI、不创建正式记录、不显示半成品。
- 安全检查临时文件在失败分支清理；通过后的媒体由调用方按记录生命周期管理。
- 隐私页必须列出实际使用的 AI 服务、用途、传输数据、服务商保存/训练/跨境规则；当前页面的服务商和协议信息仍需按真实生产配置复核。
- 后续任何用户自定义昵称、备注、公开文案都必须先走 `checkText`；微信昵称来源不走自定义文本审核链路。
- AI 返回的识别结果不能直接当作用户授权，也不能因为模型成功就扩大图片、位置或个人资料的使用范围。

### 3.7 未绑定账号、临时云端记录和绑定导入

这是当前最容易被文案误导的部分。

当前真实行为不是“未绑定时完全不写数据库”：

```text
未绑定用户完成一次识别
  → 本机保存记录
  → stageLocalData
  → sync-guest-data(action=stage-guest-records)
  → guest_encounters 临时记录
  → 记录带 guestTokenHash、clientDeviceId、媒体/评分/位置等必要字段
  → expiresAt 默认约 30 天

用户登录并确认同步
  → auth-bootstrap 创建/更新 users
  → claim-guest-records 认领临时记录
  → import 到当前用户 encounters/cat_profiles
  → 标记 guest 记录 claimed
```

代码依据：[`userData.js`](../miniprogram/utils/userData.js#L302)、[`reveal.js`](../miniprogram/pages/reveal/reveal.js#L360)、[`sync-guest-data`](../miniprogram/cloudfunctions/sync-guest-data/index.js#L383)、[`sync-guest-data`](../miniprogram/cloudfunctions/sync-guest-data/index.js#L1262)。

补充：未绑定时生成海报，`userData.savePosterResult()` 也可能先上传 PNG 到云存储，再把 fileID 放入待认领数据。临时记录没有 `ownerOpenId` 正式归属，但这仍然属于云端处理，不应继续写成“只在本机”。

#### 当前落地政策：方案 A（临时云端记录）

- 隐私页已说明：未绑定期间，为了处理过程恢复、海报保存和后续绑定，必要媒体和元数据可能暂存云端。
- `guest_encounters` 只保存匿名临时记录，不写 `ownerOpenId`；记录带 `storageScope: guest-temporary`、`retentionDays: 30`、`expiresAt` 和客户端/服务端隐私版本。
- 绑定确认弹窗继续保留，确认后才认领到正式账号。
- 临时记录默认按最后一次暂存更新保留约 30 天；认领成功后标记 `claimed`，过期后不再认领。
- `guest_encounters`、原图/主体图/海报等相关云文件必须纳入物理删除或 TTL/定时清理任务；当前代码的认领流程只会标记本次查询到的过期记录，不能替代全量清理任务。

方案 B（绑定前完全本地化）当前不采用；如未来切换，必须同时删除 `stageLocalData` 云端写入和未绑定海报上传，并重新设计绑定前恢复能力。

因此产品对外不能再写“未绑定时完全不写云端”；实际规则是“未绑定时本机保存，并可能有匿名临时云端记录，绑定确认后认领”。

### 3.8 公开分享和个人主页

分享没有额外的系统授权弹窗，但“点击分享”本身是用户主动公开行为，必须把公开范围控制在快照字段内。

当前边界：

- 猫卡分享链接只携带 `shareId`，不携带 `openid`、设备编号或本地文件路径。
- `cat-archive-share` 的规范化记录包含显示信息、媒体角色、观察结果、评分和时间，不包含位置字段。
- 个人主页公开昵称、头像和公开猫卡；关注操作要求当前用户已绑定账号。
- 公开图片由云函数换取临时 URL；不把本地路径直接暴露给接收者。
- 海报已有成品时直接读取对应记录的成品，不能因为用户点击分享而重新调用生成接口。

代码依据：[`cat-archive-share`](../miniprogram/cloudfunctions/cat-archive-share/index.js#L447)、[`cat-archive-share`](../miniprogram/cloudfunctions/cat-archive-share/index.js#L569)、[`profile-social`](../miniprogram/cloudfunctions/profile-social/index.js#L271)。

建议补齐：首次公开分享前，用轻量提示说明“分享后，接收者可看到这只猫的公开档案、图片和评分”；提供可撤回分享或使分享码失效的产品路径；分享回归测试必须确认不返回 `openid`、位置、原始本地路径和未授权的原图地址。

### 3.9 虚拟支付

支付不是隐私授权，但必须作为用户主动确认的高风险操作审计。

当前链路：

```text
用户选择套餐并点击确认充值
  → wx.login 获取一次性 code
  → virtual-payment 创建服务端订单和签名
  → wx.requestVirtualPayment 展示微信支付
  → 支付成功只标记“已提交”
  → 客户端轮询服务端余额/发货订单
  → 服务端通知或对账成功后才增加购买罐罐
```

规则：

- `AppKey`、签名、订单和发货逻辑只在云函数处理；客户端不保存密钥。
- 用户取消支付不报业务错误、不扣本地额度。
- 支付接口返回成功不能直接当作到账；到账以服务端通知/对账为准。
- 沙盒商品、生产商品、价格和环境必须分别配置，测试套餐必须由变量控制并能在生产关闭。
- 生产发布前必须验证重复通知、网络中断、支付成功但轮询失败、支付失败和重复点击的幂等性。

## 4. 统一拒绝、失败和重试规范

所有需要授权的入口都按下面的状态机处理：

```text
用户主动点击
  → 读取当前状态/隐私声明
  → 需要时展示最小用途说明
  → 调用微信能力
      ├─ 成功：只处理本次必要数据
      ├─ 用户取消：安静返回，不写数据，不重复弹窗
      ├─ 用户拒绝：解释影响，给“去设置”或替代路径
      ├─ 隐私指引未声明：提示管理员配置，不让用户去系统设置
      ├─ 当前环境不支持：明确说明设备/环境限制
      └─ 网络/云端失败：不显示成功，保留可恢复的本地状态并允许重试
```

### 错误码建议

| 领域 | 错误码 | 统一处理 |
| --- | --- | --- |
| 用户动作 | `USER_CANCELLED` | 静默结束当前动作 |
| 选图隐私 | `PHOTO_PRIVACY_DENIED` | 提示先同意照片使用说明，不调用选择器/上传 |
| 选图隐私 | `PHOTO_PRIVACY_UNAVAILABLE` | 暂停选图，提示稍后重试 |
| 后台配置 | `PRIVACY_NOT_DECLARED`、相机/相册专用码 | 告知管理员补齐微信后台隐私指引 |
| 系统权限 | `CAMERA_PERMISSION_DENIED`、`POSTER_SAVE_DENIED` | 说明影响，用户确认后才打开设置 |
| 位置 | `LOCATION_DENIED`、`LOCATION_UNAVAILABLE`、`LOCATION_REQUEST_FAILED` | 不记录位置，但继续核心流程 |
| 内容安全 | `RISKY_CONTENT` | 阻断识别/保存，提示图片不适合处理 |
| 内容安全 | `CHECK_UNAVAILABLE` | 阻断后续 AI，提示稍后重试 |
| 身份 | `IDENTITY_UNAVAILABLE`、`USER_NOT_BOUND` | 不显示绑定成功，保留本机待同步状态 |
| 昵称 | `NICKNAME_RISKY`、`NICKNAME_CHECK_UNAVAILABLE` | 不更新自定义昵称 |
| 支付 | `PAYMENT_*` | 不改客户端余额，显示可行动的支付/环境提示 |

### 设置页回访规范

凡是调用 `wx.openSetting` 的流程，都必须遵守：

1. 只有用户明确点击“去设置”才打开设置页。
2. 回调或页面重新显示时重新读取对应 `authSetting`。
3. 已授权才恢复入口；仍拒绝则保留引导，不假设成功。
4. 不因回访自动重复上传、扣额度、识别或保存海报。

## 5. 数据边界和去向

| 数据 | 产生时机 | 当前保存位置 | 是否进入 AI | 是否公开 | 生命周期/处理要求 |
| --- | --- | --- | --- | --- | --- |
| 微信昵称 | 用户登录后主动点击资料卡设置，并在资料弹窗中填写 | 本地 `userProfile`、绑定后 `users.profile.nickName` | 否 | 仅用户主动分享个人主页时 | 仅支持微信官方填写控件；保存前走文本内容安全审核 |
| 微信头像 | 用户登录后主动点击资料卡设置，并在资料弹窗中选择 | 本地临时地址、绑定后云存储 fileID | 否 | 仅公开个人主页 | 保存前走图片内容安全审核；上传/审核失败不影响已完成的登录 |
| 原始照片 | 用户拍照或选择图片 | 本地临时路径、云存储 fileID/记录媒体 | 是，按已披露用途 | 默认不公开 | 需纳入删除、过期和服务商规则 |
| 透明主体图 | AI 主体处理完成 | 云存储和记录媒体 | 由原图处理产生 | 按猫卡/分享范围 | 不能误当原图；删除策略需明确 |
| 完整海报 PNG | 用户生成海报 | 本地预览，必要时云存储 `posterImage.fileID` | 否 | 仅用户主动分享时 | 已存在成品直接读取，不重复生成 |
| 模糊位置 | 拍照后用户选择记录 | 本次记录、猫卡摘要 | 否 | 不进入公开快照 | 三位小数；拒绝仍可继续使用 |
| 评分/识别结果 | 图片处理完成 | 本地记录、绑定后云端 encounters | 否 | 作为公开猫卡的一部分时 | 模型结果不能扩大授权范围 |
| 未绑定临时记录 | 识别/海报保存期间 | `guest_encounters`、相关云文件 | 已在前置流程处理 | 否 | 当前默认约 30 天；需文案和清理任务一致 |
| 分享快照 | 用户主动创建分享 | `cat_shares` / `profile_shares` | 否 | 是 | 不包含 openid、本地路径、位置 |
| 支付订单 | 用户点击充值 | 服务端支付集合/流水 | 否 | 否 | 服务端通知、幂等和对账为准 |

## 6. 审计发现与待办

| 优先级 | 问题 | 证据 | 处理方案 | 验收标准 |
| --- | --- | --- | --- | --- |
| P0 | 微信后台隐私指引未必与代码同步 | `app.json`、开发日志中的 errno 112/相册拦截记录 | 在后台声明相机、选中的照片/视频、模糊位置、相册仅写入；同步体验/正式版本 | 真机新授权状态下四项能力均可完成；未声明时能得到明确配置错误 |
| P0 | AI 服务实际协议和数据流未完成生产核验 | `privacy.wxml` 的服务商说明和原型脚注 | 核对真实服务商、SDK/API、存储地、保存期、模型训练、删除和跨境规则 | 隐私页内容与生产配置、后台清单一致 |
| P1 | 未绑定云端临时写入与隐私页文案不一致 | `userData.js#L302`、`sync-guest-data#L418`、`privacy.wxml#L66` | 已按方案 A 更新隐私文案和临时记录元数据；仍需上线前配置云文件/guest 记录清理任务 | 用户能在处理前知道数据会暂存云端；过期记录和临时文件可清理 |
| P1 | 选图隐私状态查询失败时 fail-open | `photoPicker.js#L23-L82` | 已改为 API 存在但查询失败返回 `PHOTO_PRIVACY_UNAVAILABLE`；只有不支持 API 的旧基础库兼容放行 | 模拟查询失败时不打开选择器、不上传、不调用 AI |
| P1 | 相机设置回访不复核授权 | `camera.js`、`utils/permissions.js` | 已完成：`openSetting` 返回后重新读状态并恢复 camera context；已授权后不重复申请 | 用户拒绝设置后仍显示错误；授权后可正常拍照 |
| P1 | 登录与资料采集边界容易混淆 | `my.js` 登录按钮、同步卡和资料弹窗 | 登录只创建账号；资料卡设置时才验证头像昵称并写入资料，资料设置失败不影响登录和记录同步 | 首次登录不出现资料弹窗；设置按钮出现资料弹窗；同步卡只处理记录 |
| P1 | 产品确认缺少统一版本记录 | 原先只有 `importConsentAt` | 已增加 `privacyPolicyVersion`、`photoConsentAt`，与 `importConsentAt` 同存于本地同步状态；guest 记录同时保存客户端/服务端版本 | 可追溯用户在何时确认哪个版本，版本变更可重新提示 |
| P2 | 公开分享前缺少轻量范围提示和撤回路径 | `cat-archive-share`、`profile-social` | 首次分享提示公开字段；增加失效/撤回分享入口和回归检查 | 分享后只看到允许公开的数据；撤回后旧链接失效 |
| P2 | 授权错误映射分散在页面 | `index.js`、`poster-preview.js`、`my.js`、`camera.js` 各自判断字符串 | 统一错误码和用户提示映射，保留原始错误仅用于日志 | 同一类错误在不同页面提示一致 |
| P2 | 临时云文件清理范围不完整 | 内容安全文件、主体图、海报和 guest 记录分散管理 | 建立 fileID 生命周期表和定时清理任务；删除/放归时明确哪些文件同步删除 | 过期、拒绝、放归和撤回场景均没有孤儿文件 |

## 7. 发布前测试矩阵

### 权限和隐私

- [ ] 新用户首次使用相机：微信系统权限允许、拒绝、再次去设置允许，三条路径均可恢复。
- [ ] 未配置相机隐私指引：显示管理员配置错误，不显示“去设置”误导用户。
- [ ] 新用户首次从相册选图：隐私说明同意、拒绝、取消、查询失败分别验证。
- [ ] 相册权限拒绝后进入设置：返回后重新读取状态，不自动重复选图/上传。
- [ ] 位置首次提示：选择记录、选择不记录、系统拒绝、接口失败都继续识别。
- [ ] 已经授权位置后再次拍照：可以读取并按三位小数保存；相册上传不带位置。
- [ ] 海报保存：首次允许、拒绝、去设置后允许、后台未声明、文件失效分别验证。
- [ ] 已授权相机、照片隐私和相册写入后重复使用：不再次弹出授权/同意页；撤回后下一次实际使用能重新提示或引导。
- [ ] 清理开发者工具授权缓存，并至少用一台真实 iOS 和一台真实 Android 测试；相册选图仍应按需触发微信隐私引导，登录资料不应重复触发。

### 账号和数据

- [ ] 首次登录不弹头像昵称资料面板，`auth-bootstrap` 不带 `profile` 也能创建账号；本机记录保持待同步。
- [ ] 登录成功后点击资料卡“设置”才打开资料面板；头像和昵称经 `msgSecCheck` / `imgSecCheck` 后写入 `users.profile`。
- [ ] 关闭资料面板、昵称为空或未选头像：账号保持已登录，不覆盖已有资料。
- [ ] 资料设置头像上传或内容审核失败：不覆盖已有资料；重新点击设置后可重试。
- [ ] 点击“继续同步”只导入本机记录，不打开微信资料面板，也不触发资料审核。
- [ ] 有本机记录时绑定：先显示数量和导入确认；取消后记录仍在本机。
- [ ] 未绑定完成识别：确认写入 `guest_encounters` 的是匿名临时记录，包含 `expiresAt`/保留期和 `storageScope`，不包含 `ownerOpenId`；隐私页表述一致。
- [ ] 临时记录过期、账号绑定认领、重复认领和账号切换分别验证幂等性。
- [ ] 隐私版本：选图成功后本地同步状态记录 `V0.2` 和 `photoConsentAt`；guest 临时记录的客户端/服务端版本可核对。
- [ ] 公开分享：接收方看不到 `openid`、位置、本地路径和未授权原图。

### AI 和支付

- [ ] 图片内容安全通过后才会调用识别和主体处理。
- [ ] 内容安全拒绝/不可用时不进入 AI、不写记录、不显示成功。
- [ ] 识别成功但评分不完整时，页面显示待评分，不伪造分数；补评分成功后再同步。
- [ ] 支付取消、支付失败、支付成功未到账、重复通知、轮询超时分别验证。
- [ ] 沙盒 `0.01` 套餐只能在测试变量打开时展示，生产环境关闭后前端和云函数均不可购买。

## 8. 推荐实施顺序

1. 完成微信后台四项隐私指引、隐私版本 `V0.2` 发布和真实 AI 服务数据流核验，这是发布阻断项。
2. 为 `guest_encounters` 及其原图/主体图/海报配置 TTL 或定时清理，并验证过期数据不可认领。
3. 完成真机头像昵称填写能力和隐私指引回归测试。
4. 统一错误码、设置回访和授权事件日志；日志不记录昵称、头像 URL、原图内容或完整 fileID。
5. 按本文测试矩阵做真机回归，再部署涉及的云函数和小程序版本。

## 9. 相关实现与文档

- [`miniprogram/app.json`](../miniprogram/app.json)：位置和相册权限描述、`requiredPrivateInfos`
- [`miniprogram/app.js`](../miniprogram/app.js)：CloudBase 初始化和账号状态检查
- [`miniprogram/pages/my/my.js`](../miniprogram/pages/my/my.js)：微信资料填写、绑定、昵称扩展
- [`miniprogram/utils/photoPicker.js`](../miniprogram/utils/photoPicker.js)：选图隐私同意和选择器
- [`miniprogram/utils/permissions.js`](../miniprogram/utils/permissions.js)：微信系统权限只读状态和设置页回访
- [`miniprogram/utils/privacy.js`](../miniprogram/utils/privacy.js)：隐私说明版本常量
- [`miniprogram/pages/camera/camera.js`](../miniprogram/pages/camera/camera.js)：相机错误和位置提示
- [`miniprogram/utils/location.js`](../miniprogram/utils/location.js)：模糊位置授权和精度处理
- [`miniprogram/utils/posterShare.js`](../miniprogram/utils/posterShare.js)：海报保存和相册权限
- [`miniprogram/utils/contentSafety.js`](../miniprogram/utils/contentSafety.js)：图片/文本安全检查
- [`miniprogram/utils/userData.js`](../miniprogram/utils/userData.js)：绑定、同步、guest staging、海报保存
- [`miniprogram/cloudfunctions/auth-bootstrap/index.js`](../miniprogram/cloudfunctions/auth-bootstrap/index.js)：账号和昵称来源处理
- [`miniprogram/cloudfunctions/sync-guest-data/index.js`](../miniprogram/cloudfunctions/sync-guest-data/index.js)：临时记录、认领和正式同步
- [`miniprogram/cloudfunctions/content-security/index.js`](../miniprogram/cloudfunctions/content-security/index.js)：图片/文本内容安全
- [`miniprogram/cloudfunctions/cat-archive-share/index.js`](../miniprogram/cloudfunctions/cat-archive-share/index.js)：猫卡公开快照
- [`miniprogram/cloudfunctions/profile-social/index.js`](../miniprogram/cloudfunctions/profile-social/index.js)：个人主页公开数据
- [`miniprogram/pages/privacy/privacy.wxml`](../miniprogram/pages/privacy/privacy.wxml)：当前用户可见隐私说明和临时云端存储披露
- [`docs/CONTENT_SAFETY.md`](./CONTENT_SAFETY.md)：内容安全部署和失败关闭规则
- [`docs/USER_ACCOUNT_DATA_ARCHITECTURE_V0_1.md`](./USER_ACCOUNT_DATA_ARCHITECTURE_V0_1.md)：账号、猫卡和数据归属
- [`docs/PAGE_FUNCTION_SPEC_V1.md`](./PAGE_FUNCTION_SPEC_V1.md)：页面流程和数据边界
- [`docs/DEVELOPMENT_DEBUG_LOG.md`](./DEVELOPMENT_DEBUG_LOG.md)：相机/相册隐私指引的历史问题和部署记录

> 本次 v0.5 已将登录、记录同步、微信资料设置拆成三条链路：登录不读取头像昵称；记录同步不采集资料；资料卡“设置”才调用微信头像/昵称填写控件，并由服务端完成昵称和头像内容安全审核后保存。微信官方填写能力说明见[用户信息](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/userProfile.html)。选图 fail-closed、隐私页临时云端存储披露、隐私版本记录和 guest 临时记录元数据仍按 v0.2 保持。微信后台配置、云文件/临时记录清理任务和真机回归仍需按本文发布清单完成。
