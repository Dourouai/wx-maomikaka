# 猫咪咔咔 — 开发调试记录

> 用途：记录已经验证过的现象、结论和当前方案，后续排查先查本文件，避免重复调试已经确认不可行的路线。
>
> 最近更新：2026-09-03

## 当前结论

1. 猫咪识别使用 TokenHub 的 `glm-5.3-flash` 多模态模型。
2. 主体图只保留照片中的猫，不生成卡片文案、故事、标签或装饰。
3. 模型主体图生成后不再做二次图片安全复核；原始照片仍按现有流程先做内容安全检测。
4. CloudBase `hunyuan-image` 生图即使不传 `footnote`，历史测试中仍出现过“AI生成”标识；该标识属于服务侧结果，不能靠空水印文字稳定关闭。
5. 2026-09-03 按用户要求，主体处理先切回项目原来的 CloudBase `hunyuan-image` 图生图链路，便于继续验证主体风格；原生 `aiart.ImageToImage` 暂停使用。
6. 图鉴、揭示页和详情页的主体容器统一使用暖白色；之前看到的 R 级浅蓝色来自容器 CSS，不是图鉴等级必须使用的背景。
7. 2026-09-03 最新测试确认：AI 标识已消失，但主体图仍被默认风格重绘成带文字/画框的海报；根因是原生 `ImageToImage` 未传 `Styles` 时默认使用日系动漫风格。
8. 2026-09-03 第二次测试确认：无风格重绘已经改善，但树枝和地面仍有残留；这是主体分割不充分，不是页面容器背景。
9. 2026-09-03 已将主体处理提示词重写为“主体抠图/前景分离”任务，升级为 `cat-subject-only-v8-matting-prompt`；v8 尚待用新照片验证。
10. 2026-09-03 用户明确主体图要求为透明背景 PNG；已将提示词升级为 `cat-subject-only-v9-transparent-png`，但原生 `ImageToImage` 没有透明 alpha 输出参数，v9 仍需验证实际返回格式。

## 已验证问题与处理

### 1. 猫咪识别服务不可用

现象：小程序日志显示：

```text
猫咪识别服务暂时不可用
```

原因：`cat-vision` 原先调用 TokenHub 的 `/v1/responses`，但当前 GLM 5.3 的可用调用示例和多模态输入格式是 `/v1/chat/completions`。

处理：

- 改为 `POST /v1/chat/completions`；
- `system` 消息承载识别规则；
- `user.content` 使用 `text` + `image_url`，图片通过 Base64 Data URI 传入；
- 保留 `TOKENHUB_API_KEY` 只从云函数环境变量读取。

代码位置：`miniprogram/cloudfunctions/cat-vision/index.js`。

### 2. CloudBase 生图带 AI 标识

现象：将 CloudBase 生图参数设置为：

```js
footnote: ''
```

返回图片仍出现“AI生成”。

结论：这是图片服务侧的强制标识，不是小程序容器背景，也不是我们页面文案。空 `footnote` 只代表没有自定义水印文字，不能视为关闭平台标识。

处理：已记录该方案的限制。当前不再把空 `footnote` 当成去除平台标识的方案，但主体链路按用户要求先恢复 CloudBase 图生图。

不要重复尝试：

- 不要把空字符串、改 `footnote` 文案或提示词当成稳定隐藏平台标识的方法；
- 不要通过裁切、覆盖或图像编辑去除已嵌入的 AI 标识。

### 3. 原生图生图无权限（历史方案）

现象：`cat-transform` 返回：

```text
NATIVE_IMAGE_API_ERROR
You are not authorized to perform this operation
```

结论：原生 `ImageToImage` 请求、签名和接口地址已经走通；失败点是请求所使用的腾讯云身份没有 `aiart:ImageToImage` 权限，或该身份不是已开通混元生图服务的账号。

处理：代码不再继续调整水印参数。需要在 CAM 中给实际使用的 `AIART_SECRET_ID` 对应账号/子账号，或对应云函数角色，授权 `aiart:ImageToImage`。官方快速入门建议子账号关联 `QcloudAIARTFullAccess`；生产环境也可以改为只允许 `aiart:ImageToImage` 的最小权限策略。

验证信息：本次请求 ID 为 `70ce1ebe-c883-4a87-aa66-f53d185a64a2`。

不要重复尝试：

- 不要更换 `Prompt`、`NegativePrompt` 或 `LogoAdd` 来解决 CAM 无权限；
- 不要把腾讯云密钥写入小程序端；
- 不要在权限未补齐时切回带平台标识的 CloudBase 生图。

### 4. R 级主体图出现蓝色背景

结论：截图中的蓝色来自主体容器 CSS：

```css
.cat-portrait-R { background-color: #eaf2f5; }
```

同时，揭示页和详情页也按等级设置了不同背景色。已统一为 `#fffdf9`，保留点阵和卡片结构。

涉及文件：

- `miniprogram/pages/collection/collection.wxss`；
- `miniprogram/pages/reveal/reveal.wxss`；
- `miniprogram/pages/card-detail/card-detail.wxss`。

### 5. 主体图风格偏离原照片

现象：最新主体图已经没有 AI 标识，但猫的外观被重新绘制，图片中出现画框、乱码/文案和海报感，不符合“只保留猫咪主体”的要求。

原因：腾讯云原生 `ImageToImage` 是生成式图生图接口；官方文档说明，`Styles` 不传时默认使用 `201（日系动漫）`，而 `Strength` 越大，生成自由度越高、结果越容易偏离原图。

处理：初次修正版为 `cat-subject-only-v6-original-style`，随后针对残留背景又升级为 `cat-subject-only-v7-clean-background`：

- 显式传入空 `Styles`，避免服务端注入默认日系动漫风格；
- `Strength` 先从 `0.8` 降为 `0.4`，确认风格重绘改善后，v7 再调整为 `0.6` 以清理环境残留；
- 正向约束改为“真实照片主体分离、完整猫咪、纯白背景”；
- 反向约束增加海报、画框、卡片、版式、乱码、插画、动漫、卡通、重绘等；
- 继续保持顶层 `LogoAdd: 0`，不恢复模型结果二次复核。

涉及文件：

- `miniprogram/cloudfunctions/cat-transform/index.js`；
- 本记录文件。

### 6. 主体轮廓边缘残留环境

现象：风格已接近真实照片，但猫咪两侧和底部仍出现树枝、树干或地面残留。

处理：版本升级为 `cat-subject-only-v9-transparent-png`，保留 `Strength=0.6`，将正向提示词重写为主体抠图/前景分离和透明 alpha PNG 任务，并在反向约束中明确列出树枝、树干、叶子、植物、地面、墙面、白底和棋盘格；继续传入空 `Styles`，不恢复默认日系动漫风格。

### 7. 按用户要求切回项目原来的 CloudBase 图生图

2026-09-03 已确认并执行：`cat-transform` 不再调用原生 `aiart.ImageToImage`，改回 `wx-server-sdk@4.0.2` 的 `cloud.ai().createImageModel('hunyuan-image')`。

- 模型固定为 `HY-Image-v3.0-I2I-ToB-v1.0.1`；
- 输入使用 CloudBase 官方图生图字段 `images: [base64]`，最多传 1 张、沿用 10 MB 原图限制；
- 固定使用 `images/ar/generations`，关闭 prompt 改写，不传 `footnote`；
- 保留“只保留完整猫咪主体、不要文字/卡片/装饰、猫以外透明”的主体约束；
- 保留服务端对模型返回图片的下载、云存储落盘和烘焙棋盘格清理；不增加模型结果二次安全复核；
- 本次先只修改本地代码并提交 GitHub；随后于 2026-09-03 14:53:58 通过 CloudBase 控制台上传并部署 `cat-transform` ZIP 到 `$LATEST`，页面显示“正常”且“与已部署代码一致”。控制台另提示云调用接口权限仍需微信开发者工具同步，该权限同步是独立步骤。

## 当前实现清单

### `cat-vision`

- 模型：`glm-5.3-flash`；
- 默认地址：`https://tokenhub.tencentmaas.com/v1`；
- 接口：`/chat/completions`；
- 返回：是否为猫、猫数量、品种、置信度、外观特征和相遇评分；
- 必要环境变量：`TOKENHUB_API_KEY`；
- 可选环境变量：`CAT_VISION_BASE_URL`、`CAT_VISION_MODEL`。

### `cat-transform`

- 服务：`wx-server-sdk@4.0.2` 的 `cloud.ai().createImageModel('hunyuan-image')`；
- 模型：`HY-Image-v3.0-I2I-ToB-v1.0.1`；
- 请求：按 CloudBase 图生图接口传入 `images: [base64]`，固定使用 `images/ar/generations` 路径，不传 `footnote`；
- 提示词：明确作为主体抠图/前景分离任务，只保留完整猫咪，猫以外要求为透明 alpha 背景 PNG，不生成文字或装饰；关闭 prompt 改写，避免模型把主体抠图改成海报/插画创作；
- 模型输出：不做二次图片安全复核，直接保存主体图；服务端只清理可识别的烘焙棋盘格，CloudBase 模型是否返回真正 alpha 透明及是否保留平台标识仍以实际结果为准；
- 不需要额外的 `AIART_SECRET_ID` / `AIART_SECRET_KEY`，使用当前 CloudBase 云函数环境的 AI 能力配置。

### `text-to-image`（测试入口）

- 入口：`我的` 页的“文字生图实验室”，页面路径为 `pages/text-image/text-image`；
- 服务：独立云函数 `text-to-image`，服务端使用 `wx-server-sdk@4.0.2` 的 `cloud.ai().createImageModel('hunyuan-image')`；
- 默认模型：`HY-Image-3.0-Plus-4090-Tob-v1.0`，服务端可用 `TEXT_IMAGE_MODEL` 覆盖；
- 页面支持输入最多 200 字、预设描述、生成中状态、结果预览和异常弹窗；
- 生成结果上传到云存储后再由小程序换取临时地址，只用于当前测试页，不写入猫咪图鉴；
- 已关闭 prompt 改写（`revise: { value: false }`），不向模型追加猫咪图鉴文案；
- 文生图请求顶层传入 `LogoAdd: 0`，不主动添加显式平台标识；
- 该页面不保存或发布用户输入，默认不调用当前不可用的文字安全检测；如需恢复，可给云函数设置 `TEXT_IMAGE_CHECK_PROMPT=true`；模型输出不做二次图片复核；
- 文生图请求不再传 `footnote`；如果服务侧仍返回平台 AI 标识，说明该模型/账号策略强制保留，测试页已明确提示。

## 部署与验证状态

- `cat-vision`：已在微信开发者工具发起并完成上传流程，上传包显示约 5.1 KB、3 个文件，未显示失败提示；
- `cat-transform`：2026-09-03 已切回 CloudBase 图生图，版本为 `cat-subject-only-cloudbase-i2i-v1`；已于 14:53:58 通过 CloudBase 控制台上传并部署到 `$LATEST`，函数状态正常，需用新照片验证；
- `text-to-image`：已上传包含顶层 `LogoAdd: 0` 且不传 `footnote` 的版本；真实生成已成功，但返回图片仍带平台 AI 标识；云函数执行超时已配置为 900 秒；
- 需要用一张新照片重新测试，旧图鉴记录中的 CloudBase 图片不会自动改变；
- 若新测试返回 `CLOUDBASE_IMAGE_NOT_CONFIGURED` 或 `CLOUDBASE_IMAGE_API_ERROR`，优先检查 CloudBase AI 模型开通、云函数依赖和图生图参数；
- 若结果再次带平台 AI 标识，记录为 CloudBase 服务侧限制，不要重复调 `footnote` 或接入 `watermarks-remover`。

## 后续唯一测试路径

1. 确认 `cat-vision` 云函数环境变量存在且已部署；
2. 确认 CloudBase AI 中 `HY-Image-v3.0-I2I-ToB-v1.0.1` 已开通，且 `cat-transform` 依赖已安装；
3. 重新编译小程序并拍摄一张新猫照片；
4. 先确认 GLM 识别成功，再确认主体图无文字/画框且猫咪外观接近原照片，同时记录是否出现平台 AI 标识；
5. 若 CloudBase 图生图仍无法满足无标识或透明主体要求，再评估非生成式主体抠图服务，不重复已经确认过的水印参数实验。
