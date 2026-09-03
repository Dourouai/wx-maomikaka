# 内容安全接入说明

## 已覆盖的图片流程

拍照后的流程现在是：

```text
拍照 → 压缩到微信图片安全接口限制内
     → 临时上传云存储
     → content-security 云函数调用 security.imgSecCheck
     → 删除临时文件
     → cat-vision 判断猫咪、品种和相遇评分
     → cat-transform 使用混元图生图处理猫咪主体
     → 处理结果再次经过图片安全检测
     → 保存和分享
```

内容安全通过后，照片还要经过 `cat-vision` 判断是否为猫、猫咪数量、品种和相遇评分，再交给 `cat-transform` 做主体图处理。主体处理只用于保留猫咪主体，不生成卡片文案、故事或装饰；页面不展示模型生成说明。安全检测返回风险、检测服务不可用、图片不符合要求，或视觉识别确认不是单猫时，均不会写入本地拍摄记录，也不会进入主体处理流程。检测服务不可用时采用失败关闭，避免通过异常流程绕过审核。

## 云函数部署

1. 在微信开发者工具中打开 `miniprogram/`，为小程序开通云开发并选择云环境。
2. 确认 `miniprogram/project.config.json` 中的 `cloudfunctionRoot` 为 `cloudfunctions/`。
3. 右键 `miniprogram/cloudfunctions/content-security`，选择上传并部署：云端安装依赖。
4. 确认云函数的 `config.json` 已授权 `security.imgSecCheck` 和 `security.msgSecCheck`。
5. 用一张正常图片测试通过流程，再用微信内容安全接口提供的测试内容测试风险流程，并保留调用结果截图作为审核材料。

小程序端不会保存 `access_token` 或 `appsecret`，凭证和开放接口调用都在云函数内完成。

## 文本发布预留

`content-security` 云函数同时实现了 `security.msgSecCheck`。后续增加昵称、备注或其他用户可发布文本时，必须先调用 `miniprogram/utils/contentSafety.js` 的 `checkText`，通过后再保存或展示。

风险结果在小程序端只提示：`你发布的内容含违规信息`。不会把微信接口的详细风险标签直接展示给用户。

参考接口：

- [security.msgSecCheck](https://developers.weixin.qq.com/miniprogram/dev/api-backend/open-api/sec-check/security.msgSecCheck.html)
- [security.imgSecCheck](https://developers.weixin.qq.com/miniprogram/dev/api-backend/open-api/sec-check/security.imgSecCheck.html)
