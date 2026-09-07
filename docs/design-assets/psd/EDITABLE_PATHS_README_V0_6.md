# 猫咪咔咔卡片母版｜独立等级标签与可编辑路径说明 v0.6

## 本版确认内容

五套母版尺寸固定为 **720 × 1420 px**，R / C / U / SR / UR 所有元素坐标、尺寸和间距一致，只使用不同配色与等级字母。

- 顶部等级标签拆为独立的 **L4A｜等级标签** 组，位置与尺寸锁定，可单独替换或导出。
- 标签只保留等级字母，不再放中文等级文案。
- 五套母版均移除卡片底部内侧那条多余横线；外框结构、指标模块和照片窗口的必要边界保留。
- L2 背景图与 L3 猫主体仍是可替换图片；L5 的编号、宠物名、咪咔总分、文案和三项数值仍保留为可编辑文字层。

## 文件位置

- PSD 母版：`rarity-masters-v0-6/cat-card-*-master-v0-6-editable-paths.psd`
- 五套合成预览：`rarity-masters-v0-6/rarity-masters-v0-6-comparison.png`
- 五个独立标签预览：`rarity-masters-v0-6/rarity-labels-v0-6-board.png`
- 独立标签 PNG：`rarity-masters-v0-6/{R,C,U,SR,UR}/L4-rarity-label-{code}-standalone.png`
- 固定画布坐标版标签 PNG：`rarity-masters-v0-6/{R,C,U,SR,UR}/L4-rarity-label-{code}.png`
- 固定图形 SVG / JSON：`rarity-masters-v0-6/editable-vector-paths/*-fixed-artwork-*`
- 独立标签 SVG / JSON：`rarity-masters-v0-6/editable-vector-paths/*-rarity-label-*`
- Photoshop 路径导入源：`rarity-masters-v0-6/editable-vector-paths/vector-path-specs.jsxinc`

## Photoshop 中的图层结构

- **L1｜固定相框**：外框、纸面和信息面板底色。
- **L2｜背景图**：示例背景，生产时替换为生成的背景图。
- **L3｜猫主体**：占位猫，生产时替换为 AI 生成的透明 PNG。
- **L4A｜等级标签**：独立的 R / C / U / SR / UR 字母标签，坐标锁定。
- **L4｜固定装饰**：照片窗口、编号牌、咪咔分数牌、指标模块和图标。
- **L5｜动态字段**：示例显示层 + 默认隐藏的 Photoshop 文字层。

## 再次编辑与导出

1. 打开对应 PSD，选择 **窗口 → 路径** 查看以 `编辑路径｜` 开头的原始几何路径。
2. 选择 **L4A｜等级标签** 组即可单独移动、隐藏或替换顶部标签；不要改变其画布坐标。
3. L2 / L3 分别替换背景和透明猫 PNG；L5 内的隐藏文字层可用于校准 Canvas 的动态字段位置。
4. 路径是固定图形的可编辑几何源，当前 PNG 图层用于保持已确认的视觉成品。修改路径后，如需更新视觉素材，请同步修改 SVG/JSON 或重新执行生成脚本。

## 生成脚本

- `make_r_master_assets.py`：生成五套像素图层、独立标签与预览。
- `make_editable_vector_paths.py`：生成 SVG / JSON / JSX 路径源。
- `build-rarity-masters-v0-1.jsx`：将五套像素图层、独立 L4A 标签、文字层和路径写入 Photoshop PSD。
