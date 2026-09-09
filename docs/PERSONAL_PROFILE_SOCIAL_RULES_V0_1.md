# 猫咪咔咔｜个人主页与关注链路 v0.1

> 状态：个人主页首版设计与接口规则
>
> 本版新增用户主页分享，不改动现有 `cat-archive-share` 单只猫档案分享链路。

## 1. 产品入口

个人主页是用户猫卡的公开索引页，可以通过以下入口打开：

- `我的` 页面点击“个人主页”进入自己的主页；
- 进入自己的主页后，后台自动准备一个只包含随机 `profileShareId` 的小程序分享路径；用户点击“分享主页”直接打开微信分享面板，不再展示“生成分享链接”步骤；
- 他人打开分享路径后，进入对方的公开主页；
- 后续小程序码只需要把 scene 绑定到同一个 `profileShareId`，页面规则不变。

分享路径示例：

```text
/pages/profile/profile?shareId=profileshare_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

客户端和分享路径都不能出现 `openid`、设备编号、手机号、精确位置或本地文件路径。

## 2. 两种视角

### 自己查看

页面标题使用“个人主页”，保留账号自己的成长信息和编辑入口：

- 头像、昵称、个人身份短句；
- `LV` 会员等级、已收录猫卡数、相遇次数；
- “编辑资料”预留入口；
- “分享主页”入口；
- 我的猫卡列表，可以进入本地猫档案详情；
- 空状态引导继续去相遇。

猫卡的 `visibility=private` 只对主人自己的页面保留；个人主页的公开猫卡列表必须过滤私密猫卡。

### 查看他人

页面标题使用“TA 的主页”，只展示公开信息：

- 头像、昵称、公开身份短句；
- 猫卡数、相遇次数、关注数；
- “关注 / 已关注”按钮；
- 对方主动公开的猫卡摘要：等级、分数、封面图、相遇次数、海报短句；
- 不展示会员成长值、累计咔咔分、位置、原图文件地址、奖励明细、删除/放归入口；
- 他人的猫卡第一版只做公开列表，不允许直接修改对方档案。

自己的页面和他人的页面使用同一套米白纸张、赤陶色印章、等级色边框，但操作按钮和信息权限明确区分。

## 3. 公开数据边界

主页公开快照只返回以下字段：

```json
{
  "profile": {
    "name": "猫咪观察员",
    "avatarTempURL": "短期头像地址"
  },
  "stats": {
    "catCount": 3,
    "recordCount": 8,
    "followerCount": 2,
    "followingCount": 5,
    "isFollowing": false
  },
  "cats": [
    {
      "catalogCatId": "cat_021",
      "displayName": "花花",
      "levelCode": "R",
      "levelLabel": "稀遇",
      "overallScore": 73,
      "recordCount": 2,
      "posterCopy": "在街角安静地看着你。",
      "description": "它总是在午后的窗边安静地晒太阳。",
      "photoTempURL": "短期图片地址"
    }
  ]
}
```

默认只使用封面图，封面不存在时才回退到主体图；不把原始照片、原始图片 fileID、位置和模型特征返回给主页。

所有分数字段都遵循猫卡规则：缺失或 `null` 统一按 `0` 展示，不能渲染为空白。等级缺失按 `C / 街角` 展示。

## 4. CloudBase 集合

### `profile_shares`

保存用户主动创建的主页分享入口：

```json
{
  "schemaVersion": 1,
  "ownerOpenId": "server only",
  "profileShareId": "profileshare_xxx",
  "status": "active",
  "createdAt": "server date",
  "updatedAt": "server date",
  "lastSharedAt": "server date"
}
```

### `user_follows`

保存关注关系，使用“关注者 + 被关注者”的哈希作为文档 ID，支持重复点击幂等：

```json
{
  "schemaVersion": 1,
  "followerOpenId": "server only",
  "followingOpenId": "server only",
  "status": "active",
  "createdAt": "server date",
  "updatedAt": "server date"
}
```

取消关注采用软删除 `status: removed`，不暴露关系双方的 openid。

### 上线初始化要求

CloudBase 不会因为云函数第一次写入而自动创建集合。上线前必须在当前环境创建
`profile_shares` 和 `user_follows`，并将权限设置为 `无权限[ADMINONLY]`；这两个集合只由
`profile-social` 云函数使用，客户端不应直接读写。若集合未创建，服务端会返回
`PROFILE_SOCIAL_NOT_CONFIGURED`，页面只提示“主页分享服务还在准备中”，不展示 CloudBase
底层错误。

## 5. `profile-social` 接口

| action | 调用者 | 作用 |
|---|---|---|
| `create` | 当前用户（后台自动） | 创建或复用自己的 `profileShareId` |
| `get` | 任意访问者 | 根据 `profileShareId` 读取公开主页 |
| `follow` | 已登录访问者 | 关注主页对应用户，禁止关注自己 |
| `unfollow` | 已登录访问者 | 取消关注 |

服务端从 `cloud.getWXContext().OPENID` 获取当前调用者身份。`get` 返回的 `isFollowing` 只针对当前调用者计算，不能由客户端传入或伪造。

## 6. 状态与异常

- 未登录打开自己的主页：显示登录引导，本地猫卡仍不上传、不公开；
- 他人主页加载中：显示“正在整理这份猫档案”；
- 分享码失效：显示“这份个人主页已失效”，提供返回自己的主页入口；
- `profile-social` 尚未部署：页面显示“主页分享服务还在准备中”，不伪造关注成功；
- 关注失败：按钮恢复原状态，提示“关注没有完成，请稍后再试”；
- 重复关注/取消关注：以服务端最终状态为准，操作必须幂等。

## 7. 本版不做

- 用户搜索；
- 私信、评论、点赞；
- 关注列表详情页；
- 他人猫卡的编辑、删除、放归；
- 主页独立海报生成；
- 把主页小程序码图片直接保存到用户相册。

这些能力可以建立在 `profileShareId` 上继续扩展，但不能复用单猫 `shareId` 的权限语义。
