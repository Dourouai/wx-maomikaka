# 猫咪咔咔｜罐罐充值与微信虚拟支付接入说明 v0.4

> 状态：充值入口、服务端发货到账、幂等入账和每日赠送优先扣减已落地；正式支付前仍需完成微信后台商品、发货回调地址和云函数环境配置。
> 更新时间：2026-09-08

## 1. 套餐口径

| 套餐 ID | 用户价格 | 购买罐罐 | 微信商品类型 |
| --- | ---: | ---: | --- |
| `can_1` | 1 元 | 1 个 | 道具直购 |
| `can_10` | 9 元 | 10 个 | 道具直购 |
| `can_30` | 29 元 | 30 个 | 道具直购 |
| `can_001` | 0.01 元 | 1 个 | 仅测试开关打开时展示 |

`can_001` 是内测套餐，不属于正式套餐。生产环境只有云函数环境变量
`VIRTUAL_PAYMENT_TEST_PLAN_ENABLED=1`（也接受 `true` / `yes` / `on`）时，前端才会展示，服务端才会接受下单；设为 `0` 时前后端同时关闭。沙盒环境在未配置该变量时默认开启，若要在沙盒中隐藏测试套餐，显式设为 `0`。

每日赠送 3 个罐罐仍由本地相遇记录计算，购买余额单独写入 `stats.purchasedCanBalance`。用户中心总可用量为：

```text
今日赠送剩余 + 已购买且未使用余额
```

首页仍只展示固定的 3 个每日罐罐图标，不把购买余额追加到首页图标中。

每次相遇按以下顺序扣减：

```text
今日赠送剩余 > 0  → 扣 1 个每日赠送
今日赠送已用完    → 扣 1 个已购买余额
```

本地记录会保存 `canUsageSource=daily-gift|purchased`，已绑定用户同步到云端时，购买罐罐的扣减由 `can_usage_ledger` 幂等结算。

## 2. 为什么不是直接调用 `query_user_balance`

`query_user_balance` 查询的是微信虚拟支付侧的代币余额，不能直接把余额当作猫咪咔咔的业务罐罐库存。

本产品的三个套餐是“购买一件业务道具后发放 1 / 10 / 30 个罐罐”，因此采用 `short_series_goods` 道具直购模式：

```text
用户选择套餐
  → 云函数创建业务订单并生成 signData / paySig / signature
  → 小程序调用 wx.requestVirtualPayment
  → 微信发送 xpay_goods_deliver_notify
  → 服务端幂等确认订单并增加 purchasedCanBalance
```

只有最后一步完成后，客户端才可以展示充值到账；不能在前端 `success` 回调里直接给用户加余额。

## 3. 当前代码职责

- `miniprogram/pages/my/my.wxml`：罐罐卡片中的充值入口和套餐弹层；
- `miniprogram/pages/my/my.js`：套餐选择、登录 code 获取、发起虚拟支付和失败提示；
- `miniprogram/pages/can-history/can-history.js`：合并展示本地相遇使用记录和服务端充值订单；
- `miniprogram/utils/virtualPayment.js`：调用 `virtual-payment` 云函数，不保存密钥；
- `miniprogram/cloudfunctions/virtual-payment/index.js`：校验固定套餐、按沙箱/现网选择 AppKey、换取 `session_key`、创建订单并生成支付签名；同时处理 `xpay_goods_deliver_notify` 发货回调、自动入账和余额查询；
- `stats.purchasedCanBalance`：业务侧购买库存，不能由客户端直接修改。

`virtual-payment` 云函数已经包含 HTTP 发货回调处理：支持微信公众平台“消息推送”的明文 JSON 格式，也保留旧的内部回调格式；会校验消息推送 Token、订单归属、商品、金额、环境和用户后，在数据库事务中把购买数量加到 `users.stats.purchasedCanBalance`，并把订单标记为 `delivered`。同一 `outTradeNo` 重复通知只返回成功，不重复增加余额。

正式环境仍需把微信虚拟支付后台的发货推送地址绑定到该云函数的 HTTP 触发器；只有回调真正到达并完成服务端确认后，购买罐罐才显示为已到账。

## 4. 微信后台配置清单

1. 开通小程序虚拟支付能力；
2. 创建并发布三个正式道具，分别对应 `can_1`、`can_10` 和 `can_30`，价格为 100 分、900 分和 2900 分；如需内测，再额外创建 `can_001`，价格为 1 分；
3. 在微信公众平台进入【开发 → 开发管理 → 消息推送】并配置：
   - URL：`https://yangxi-studio-d4g3upcho8753fb42-1253356561.ap-shanghai.app.tcloudbase.com/virtual-payment/deliver`；
   - 消息加密方式：**明文模式**；
   - 数据格式：**JSON**；
   - Token 和 EncodingAESKey 只填写到云函数环境变量，不写入仓库；
4. 在虚拟支付后台开启道具发货推送，并验收 `xpay_goods_deliver_notify` 的订单校验和成功响应；
5. 在 `virtual-payment` 云函数配置以下环境变量：

```text
WX_APP_SECRET=小程序 AppSecret
VIRTUAL_PAYMENT_APP_KEY=现网 AppKey
VIRTUAL_PAYMENT_APP_KEY_SANDBOX=沙箱 AppKey
VIRTUAL_PAYMENT_OFFER_ID=虚拟支付 OfferId
VIRTUAL_PAYMENT_CURRENCY_TYPE=CNY
VIRTUAL_PAYMENT_ENV=0
VIRTUAL_PAYMENT_PLATFORM=ios 或 android
VIRTUAL_PAYMENT_PRODUCT_ID_1=1 个罐罐商品 ID
VIRTUAL_PAYMENT_PRODUCT_ID_10=10 个罐罐商品 ID
VIRTUAL_PAYMENT_PRODUCT_ID_30=30 个罐罐商品 ID
VIRTUAL_PAYMENT_PRODUCT_ID_TEST=0.01 元内测商品 ID
VIRTUAL_PAYMENT_TEST_PLAN_ENABLED=0
WECHAT_MESSAGE_PUSH_TOKEN=消息推送 Token
WECHAT_MESSAGE_PUSH_ENCODING_AES_KEY=消息推送 EncodingAESKey
```

如果沙箱和现网的商品 ID 不同，可分别使用同名的 `_SANDBOX` / `_PROD` 后缀；未配置后缀时回退到上面的通用商品 ID。

`WX_APP_SECRET`、`VIRTUAL_PAYMENT_APP_KEY`、`VIRTUAL_PAYMENT_APP_KEY_SANDBOX` 不能写进小程序前端、Git 或文档示例中。`VIRTUAL_PAYMENT_ENV=0` 使用现网 AppKey，`VIRTUAL_PAYMENT_ENV=1` 使用沙箱 AppKey。

支付原串中的 `mode` 固定为 `goods`；小程序前端调用 `wx.requestVirtualPayment` 时，外层 `mode` 固定为 `short_series_goods`。两者都要保留，且签名必须使用服务端实际下发的完整 `signData` 原文。

微信 iOS 虚拟支付不支持 `env=1` 沙箱环境。沙箱测试使用安卓等支持平台；iOS 测试必须使用 `env=0` 现网配置，可能产生真实扣款，不能把现网测试当作普通沙箱测试。

当前代码使用明文 JSON 模式，因此 `WECHAT_MESSAGE_PUSH_ENCODING_AES_KEY` 先作为配置留存，不参与明文校验。若切换到兼容模式或安全模式，需要同时实现微信消息体 AES 解密后再切换后台配置。

## 5. 关键安全规则

- 套餐金额、购买数量和商品 ID 由服务端固定映射，不能信任前端传来的价格；
- `signData` 的原始字符串必须和签名、实际支付调用完全一致；
- `paySig` 与用户态 `signature` 都只在云函数生成；
- 支付取消、失败、重复通知不能增加罐罐；
- 发货通知必须校验订单号、用户、商品、金额、环境和当前订单状态；
- 订单处理使用幂等键 `outTradeNo`，已发货订单再次通知只返回成功，不重复加库存；
- 购买罐罐消费使用 `can_usage_ledger` 幂等键，不能因为同步重试重复扣减；
- 首页的 3 枚图标只代表每日赠送额度，不能用总可用余额替换这组图标。

参考：

- 微信虚拟支付查询用户余额：[query_user_balance](https://developers.weixin.qq.com/miniprogram/dev/server/API/VirtualPayment/api_query_user_balance.html)
- 虚拟支付接口说明：[腾讯云虚拟支付 API](https://intl.cloud.tencent.com/zh/document/product/1219/69527)
- 小程序虚拟支付流程：[小程序虚拟支付实践教程](https://intl.cloud.tencent.com/zh/document/product/1219/74868)
