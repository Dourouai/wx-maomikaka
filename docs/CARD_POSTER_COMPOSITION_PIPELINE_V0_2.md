# 猫咪咔咔｜猫卡拆层与合成方案 v0.2

> 状态：未验收、已作废。本文及 `card-template-v5` 是一次错误的过程稿，不得导入开发。后续必须以确认的单张 R 卡母版重新测量和拆层。

## 1. 当前唯一视觉母版

本版以已确认的窄长 R 卡为母版。C、U、R、SR、UR 使用同一张卡的尺寸、图片窗口、顶部字母牌、编号牌、下方信息区和间距，只替换颜色皮肤。

当前确定的规则：

- 顶部只显示 `C / U / R / SR / UR`，不显示中文等级名；
- 顶部不使用等级图标；
- 底部三个图标是魅力、机灵、灵气指标图标，继续保留；
- 猫名最多 5 个字，文案最多 50 个中文字符；
- 咪咔、魅力、机灵、灵气都是 0–100 的整数；设计稿暂时统一使用 `100` 占位；
- 五种卡的几何和上下间距不能随等级变化。

上一版偏宽的 `1060 × 1484` 拆层稿已经废弃。当前以本目录的 `card-template-v5` 为准。

## 2. 五个渲染图层

这是五个真正参与绘制的图层；数据本身不算图片层。

| 层 | 名称 | 放什么 | 由谁提供 |
| --- | --- | --- | --- |
| L1 | 固定相框底 | 外框、粗色渐变、内边、纸张底、下半区底纸和外侧装饰 | 设计资产 |
| L2 | 背景板 | 不含猫、不含人物、不含文字的场景图 | 背景生成服务 |
| L3 | 猫咪主体 | AI 单独生成的透明 PNG | 猫主体生成服务 |
| L4 | 固定 UI 元素 | 顶部字母牌、编号牌底、咪咔圆章底、分隔线、指标格和三个指标图标 | 设计资产 |
| L5 | 动态文字/数值 | 编号、猫名、文案、咪咔、魅力、机灵、灵气 | Canvas 2D |

关键点：L2 不是整张卡的背景，L2 只负责图片窗口。卡片上下的底纸、边框和间距全部由 L1/L4 固定下来。

## 3. 当前 v5 素材包

### R 母版与五档相框

[`R 母版参考裁切`](design-assets/card-template-v5/reference/r-card-master-crop.png) 用于核对几何，不参与生产合成。

| 等级 | 相框底 L1 | 固定元素 L4 |
| --- | --- | --- |
| C | [`card-shell-c.png`](design-assets/card-template-v5/shells/card-shell-c.png) | [`fixed-elements-c.png`](design-assets/card-template-v5/fixed-elements/fixed-elements-c.png) |
| U | [`card-shell-u.png`](design-assets/card-template-v5/shells/card-shell-u.png) | [`fixed-elements-u.png`](design-assets/card-template-v5/fixed-elements/fixed-elements-u.png) |
| R | [`card-shell-r.png`](design-assets/card-template-v5/shells/card-shell-r.png) | [`fixed-elements-r.png`](design-assets/card-template-v5/fixed-elements/fixed-elements-r.png) |
| SR | [`card-shell-sr.png`](design-assets/card-template-v5/shells/card-shell-sr.png) | [`fixed-elements-sr.png`](design-assets/card-template-v5/fixed-elements/fixed-elements-sr.png) |
| UR | [`card-shell-ur.png`](design-assets/card-template-v5/shells/card-shell-ur.png) | [`fixed-elements-ur.png`](design-assets/card-template-v5/fixed-elements/fixed-elements-ur.png) |

五档合成的无猫验收图：[`card-layer-stack-v5-preview-no-cat.png`](design-assets/card-template-v5/reference/card-layer-stack-v5-preview-no-cat.png)。它用同一张背景验证了上下间距；实际接入时只替换 L3 猫 PNG，不改变 L1/L2/L4/L5 的坐标。

### R 背景样例

[`r-street-teashop-bg-v1.png`](design-assets/card-template-v5/backgrounds/r-street-teashop-bg-v1.png) 是背景板样例。它不含卡框、猫、文字或水印，只会被裁切到图片窗口。

## 4. 统一画布与安全区

设计母版画布固定为 `720 × 1420`，比例约为 `0.507`。页面上可以按设备宽度缩放显示，但不能为了适应屏幕重新拉伸某一档卡。

### 图片窗口

```text
photoContentClip:
  x = 56
  y = 81
  width = 607
  height = 833
  radius = 43
```

L2 和 L3 必须使用同一个裁切区。背景和猫都不能越过这块窗口，窗口外的内边线由 L1 保留。

### 动态内容区

| 内容 | x | y | width | height | 规则 |
| --- | ---: | ---: | ---: | ---: | --- |
| 编号文字 | 390 | 105 | 270 | 40 | 右对齐，例：`No. MK-260903-000013` |
| 猫名 | 155 | 945 | 390 | 104 | 居中，最多 5 字；不要压到咪咔圆章 |
| 咪咔数字 | 553 | 975 | 100 | 66 | 居中，0–100 |
| 相遇文案 | 155 | 1092 | 390 | 110 | 居中，最多 50 字，可自动分两行 |
| 左指标数字 | 108 | 1308 | 84 | 52 | 0–100 |
| 中指标数字 | 318 | 1308 | 84 | 52 | 0–100 |
| 右指标数字 | 528 | 1308 | 84 | 52 | 0–100 |

固定元素的大致锚点：顶部字母牌 `(44,45)–(199,224)`，编号牌 `(376,88)–(669,166)`，咪咔圆章中心 `(603,1007)`、半径 `58`，底部指标板 `(48,1212)–(672,1384)`。

## 5. L0 数据契约

合成器只接收已经识别、评分和生成文案的数据；它不在绘制时修改业务数据：

```json
{
  "templateVersion": "card-poster-v0.2",
  "levelCode": "R",
  "cardNo": "MK-260903-000013",
  "catAssetId": "cat_20260904_000013",
  "backgroundId": "r-street-teashop-bg-v1",
  "name": "桃桃晒太阳",
  "copy": "午后的阳光刚刚好，懒洋洋的日子最是舒心。",
  "scores": {
    "mika": 100,
    "charm": 100,
    "cleverness": 100,
    "aura": 100
  },
  "catPlacement": {
    "anchorX": 0.52,
    "baseY": 0.94,
    "scale": 0.82
  }
}
```

`mika` 的具体评分规则由评分服务负责；合成器只渲染返回值，避免前后端出现两套综合分。

## 6. 猫 PNG 规范

猫咪由 AI 单独生成，输入合成器前必须是透明背景 PNG：

- RGBA，长边建议至少 1024 px；
- 不带地面、窗户、阴影或第二只动物；
- 保留耳朵、胡须、爪子、尾巴和毛发透明边缘；
- 主体底部要能明确判断落脚点；
- 记录主体边界框、朝向和光线方向；
- 用 `anchorX / baseY / scale` 记录摆放，不把每只猫写死成像素坐标。

当前工作区没有找到用户所说的独立透明猫 PNG，所以 v5 只先完成“无猫背景 + 正确卡框”的验收。拿到真实 `catAssetId` 后，直接填 L3，不需要改相框。

## 7. 背景图生成规范

背景图应根据猫的姿态、朝向、落脚点和光线方向生成，但不能把猫再次生成到背景里。

输入提示信息：猫是坐、站还是趴；朝左还是朝右；准备落在地面、窗台还是屋顶；光从哪边来；希望使用街角、茶铺、花店、庭院等哪种环境。

硬约束：

- 无猫、无人、无文字、无水印、无 UI；
- 猫将要落脚的位置留出连续的地面或承托面；
- 透视高度和光线方向与猫一致；
- 背景可以被 `cover` 裁切，但不能裁掉落脚区；
- 背景按版本保存，不能覆盖历史素材。

## 8. Canvas 合成顺序

推荐小程序侧使用 Canvas 2D；预览和最终分享图调用同一个 `renderCard(data, manifest)`。离屏 Canvas 2D、图片对象和导出接口按当前小程序基础库适配，图片应在当前 Canvas 上完成加载后再绘制。

```text
创建 720×1420 画布
→ 绘制 L1 card-shell-{level}
→ save，按 photoContentClip 裁切
→ L2 背景图 cover 到窗口
→ 猫的接触阴影
→ L3 猫 PNG，按归一化锚点 contain/scale
→ restore
→ 绘制 L4 fixed-elements-{level}
→ L5 绘制编号、猫名、文案、咪咔和三个指标数值
→ 校验文字、分数和图片加载状态
→ 导出 PNG
```

切换等级时只替换 `card-shell-{level}` 和 `fixed-elements-{level}`；背景、猫、文字、坐标不变。这样不会出现五套布局逐渐漂移的问题。

## 9. 云端与小程序分工

### 云端

- 生成并存储猫 PNG 和背景板；
- 调用 HY3 识别与评分；
- 生成唯一卡号；
- 保存 `cardData`、素材版本和 `templateVersion`；
- 可选地缓存最终 PNG，保证历史卡片可复现。

### 小程序

- 将云端素材下载为 Canvas 可读取的本地/临时路径；
- 预加载 L1–L4 后再绘制；
- 处理动态文字换行、长度校验和导出；
- 预览、保存、分享，并回传本次渲染版本。

## 10. 导出前验收

- 五档都是 `720 × 1420`，图片窗口位置完全相同；
- L2/L3 的上下边界都落在同一个 `photoContentClip`；
- 顶部只有等级字母，不出现中文等级名或顶部等级图标；
- 猫名不超过 5 字，文案不超过 50 字；
- 咪咔、魅力、机灵、灵气都是整数且在 0–100；
- 不允许加载旧的 `fixed-elements-v1`、v2 或 v3 试验稿；
- 所有图片完成加载、文字没有溢出、猫脸和爪子没有被 UI 遮住后才导出。

## 11. 下一步

先把真实的独立透明猫 PNG 放入 L3，完成一张 R 卡。R 只调三件事：猫的大小、落脚点、背景裁切。R 确认后，其他四档不再动布局，只替换 L1/L4 的配色资产。
