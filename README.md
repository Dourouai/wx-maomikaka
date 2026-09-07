# 猫咪咔咔 🐱📸

> 拍一只，收一张。把生活里遇见的每只猫，变成你独一无二的收藏卡。

---

## 工作区结构

```
maomi-kaka/
├── docs/                    ← 📋 需求 & 设计文档
│   └── GAME_DESIGN.md       ← 游戏设计文档 (GDD)
│
├── miniprogram/             ← 📱 微信小程序代码
│   ├── app.js
│   ├── app.json
│   ├── app.wxss
│   ├── project.config.json  ← 微信开发者工具从此目录打开
│   ├── pages/
│   │   ├── index/           ← 首页
│   │   ├── camera/          ← 拍照页（待建）
│   │   ├── reveal/          ← 卡片揭示页（待建）
│   │   ├── collection/      ← 图鉴页（待建）
│   │   └── card-detail/     ← 卡片详情页（待建）
│   ├── components/
│   │   ├── navigation-bar/  ← 自定义导航栏
│   │   ├── cat-card/        ← 猫咪卡片组件（待建）
│   │   └── rarity-badge/    ← 稀有度徽章（待建）
│   └── utils/
│       ├── catData.js       ← 60只猫数据（待建）
│       ├── storage.js       ← 存储封装（待建）
│       └── gacha.js         ← 抽卡逻辑（待建）
│
└── README.md                ← 本文件
```

## 快速开始

1. 用**微信开发者工具**打开 `miniprogram/` 目录（不是根目录）
2. AppID：`wxb0ae5833afe07b1d`

## 文档

- [页面功能说明与媒体字段契约 v1.2](./docs/PAGE_FUNCTION_SPEC_V1.md)
- [游戏设计文档 (GDD)](./docs/GAME_DESIGN.md)
- [首页说明](./docs/HOME_PAGE_SPEC.md)
- [罐罐扣减规则](./docs/CAN_CONSUMPTION_RULES_V0_1.md)
- [用户成长会员等级规则 v0.1](./docs/MEMBER_LEVEL_RULES_V0_1.md)
- [设计元素](./docs/DESIGN_ELEMENTS_V0_1.md)
- [小猫评分与等级规则 v0.2](./docs/CAT_SCORING_RULES_V0_2.md)
- [猫咪身份特征与视觉向量方案](./docs/CAT_IDENTITY_FEATURES_V0_1.md)
- [相遇卡基础规则与五级卡面样式 v0.2](./docs/CARD_SYSTEM_V0_1.md)
- [五级相遇卡 Canvas 分层与版式规则](./docs/CARD_CANVAS_LAYOUT_V0_1.md)
- [猫档案 Canvas 海报生成规则 v0.1](./docs/MINIPROGRAM_CAT_ARCHIVE_POSTER_RULES_V0_1.md)
- [五级卡面样式对照板 V15](./docs/CARD_STYLES_BOARD_V15.png)
- [五级卡面样式对照板 V11](./docs/CARD_STYLES_BOARD_V11.png)
- [五级卡面样式对照板 V10](./docs/CARD_STYLES_BOARD_V10.png)
- [五级卡面样式对照板 V9](./docs/CARD_STYLES_BOARD_V9.png)
- [五级卡面样式对照板 V8](./docs/CARD_STYLES_BOARD_V8.png)
- [五级卡面样式对照板 V7](./docs/CARD_STYLES_BOARD_V7.png)
- [五级卡面样式对照板 V6](./docs/CARD_STYLES_BOARD_V6.png)
- [图片与相遇卡编号规则](./docs/ID_RULES_V0_1.md)
- [勋章体系](./docs/BADGE_SYSTEM_V0_1.md)
- [首页视觉稿](./docs/HOME_PAGE_DESIGN_V1.svg)
- [软萌相机 UI 风格定义 v2](./docs/UI_STYLE_GUIDE_V2.md)
- [软萌相机风格板 v2](./docs/UI_STYLE_BOARD_V2.svg)
- [首页 / 图鉴 / 我的三页 UI 设计图 v2](./docs/UI_PAGES_V2.svg)
- [相机页设计说明](./docs/CAMERA_PAGE_DESIGN_V1.md)
- [相机页视觉稿](./docs/CAMERA_PAGE_DESIGN_V1.svg)
- [相机页优化说明](./docs/CAMERA_PAGE_DESIGN_V2.md)
- [相机页优化视觉稿](./docs/CAMERA_PAGE_DESIGN_V2.svg)
