# 猫咪咔咔卡片母版｜信息区左对齐与可编辑路径说明 v0.7

## 本版确认内容

五套母版尺寸固定为 **720 × 1420 px**，R / C / U / SR / UR 所有元素坐标、尺寸和间距一致，只使用不同配色与等级字母。

- 红框信息区内的宠物名与文案统一左对齐，共用同一个固定左边缘 `x=104`。
- 顶部等级标签仍为独立的 **L4A｜等级标签** 组，位置与尺寸锁定，只保留等级字母。
- 五套母版继续移除卡片底部内侧那条多余横线；外框结构和指标模块边界保留。
- L2 背景图与 L3 猫主体仍是可替换图片；L5 的动态字段仍保留为可编辑文字层。

## 文件位置

- PSD 母版：`rarity-masters-v0-7/cat-card-*-master-v0-7-editable-paths.psd`
- 五套合成预览：`rarity-masters-v0-7/rarity-masters-v0-7-comparison.png`
- 五个独立标签预览：`rarity-masters-v0-7/rarity-labels-v0-7-board.png`
- 独立标签 PNG：`rarity-masters-v0-7/{R,C,U,SR,UR}/L4-rarity-label-{code}-standalone.png`
- 固定画布坐标版标签 PNG：`rarity-masters-v0-7/{R,C,U,SR,UR}/L4-rarity-label-{code}.png`
- 固定图形 SVG / JSON：`rarity-masters-v0-7/editable-vector-paths/*-fixed-artwork-*`
- Photoshop 路径导入源：`rarity-masters-v0-7/editable-vector-paths/vector-path-specs.jsxinc`

## Photoshop 图层结构

- **L1｜固定相框**：外框、纸面和信息面板底色。
- **L2｜背景图**：示例背景，生产时替换为生成的背景图。
- **L3｜猫主体**：占位猫，生产时替换为 AI 生成的透明 PNG。
- **L4A｜等级标签**：独立的 R / C / U / SR / UR 字母标签，坐标锁定。
- **L4｜固定装饰**：照片窗口、编号牌、咪咔分数牌、指标模块和图标。
- **L5｜动态字段**：示例显示层 + 默认隐藏的 Photoshop 文字层；宠物名和文案左对齐。

打开 PSD 后可在 **窗口 → 路径** 中编辑固定图形的原始路径；L2 / L3 替换图片，L5 修改文字。路径是几何源，PNG 是当前视觉成品，修改路径后需要同步更新 SVG/JSON 或重新生成素材。
