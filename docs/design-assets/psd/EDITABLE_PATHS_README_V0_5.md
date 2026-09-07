# 猫咪咔咔卡片母版｜可编辑路径说明 v0.5

## 已保留的可编辑内容

每套母版尺寸固定为 **720 × 1420 px**，R / C / U / SR / UR 使用同一套坐标。

- **L1 固定相框**：外框、内框、纸面边缘、信息区轮廓等固定图形路径。
- **L4 固定装饰**：照片窗口边线与高光、字母牌、编号牌、咪咔分数牌、底部指标格、分隔线和三个指标图标路径。
- **L5 动态字段**：编号、宠物名、咪咔总分、文案、魅力 / 机灵 / 灵气，均保留为 Photoshop 文字层，默认隐藏，避免和示例字段重复。
- **L2 背景图**：AI 生成的背景 PNG，可替换。
- **L3 猫主体**：AI 生成的透明 PNG，可替换。

## 文件位置

- PSD 母版：`rarity-masters-v0-5/cat-card-*-master-v0-5-editable-paths.psd`
- SVG 路径源：`rarity-masters-v0-5/editable-vector-paths/*-fixed-artwork-editable.svg`
- JSON 几何源：`rarity-masters-v0-5/editable-vector-paths/*-fixed-artwork-path-spec.json`
- Photoshop 路径导入源：`rarity-masters-v0-5/editable-vector-paths/vector-path-specs.jsxinc`

## 在 Photoshop 中再次编辑

1. 打开对应 PSD。
2. 选择菜单 **窗口 → 路径**，打开 Paths 面板。
3. 选择以 `编辑路径｜` 开头的路径，再使用钢笔工具或直接选择工具修改锚点。
4. 文字修改在 **L5｜动态字段** 组内完成；猫和背景分别在 L3、L2 组内替换。

每个 PSD 已写入 72 条带有 L1 / L4 结构名称的路径。路径只负责保留固定图形的几何，不覆盖当前像素显示层，因此不会重新引入边线溢出问题；如需批量调整五套母版，修改 SVG/JSON 源后重新生成即可。

## 生成脚本

- `make_editable_vector_paths.py`：生成 SVG / JSON / JSX 路径源。
- `build-rarity-masters-v0-1.jsx`：将五套像素图层、文字层和路径写入 Photoshop PSD。
