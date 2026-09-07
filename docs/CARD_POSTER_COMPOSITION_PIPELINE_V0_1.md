# 猫咪咔咔｜猫卡拆层与合成方案 v0.1

> 状态：已被 `CARD_POSTER_COMPOSITION_PIPELINE_V0_2.md` 替代。v0.1 使用的是偏宽的旧几何，不能作为当前卡片拆层和合成依据。

## 1. 这次先确定什么

本方案把猫卡固定为“一套尺寸、五种配色皮肤”。C、U、R、SR、UR 的几何位置、图片窗口、字号层级和信息顺序完全一致，只切换相框与固定装饰的颜色。

卡面顶部只展示等级字母：`C / U / R / SR / UR`。不再叠加中文等级名，也不再使用顶部等级图标。底部三个图标属于猫咪属性指标，继续保留。

本阶段只处理设计资产和合成规范，不改小程序业务代码。

## 2. 五个可渲染图层

| 层级 | 名称 | 内容 | 来源 | 是否动态 |
| --- | --- | --- | --- | --- |
| L1 | 固定相框 | 原确认稿的粗边、内边、纸张肌理、下半区承托区和统一圆角 | `card-shells-v3/card-shell-{level}.png` | 否，仅按等级换皮肤 |
| L2 | 背景图 | 本次猫咪相遇的无主体环境图 | `card-backgrounds-v1/{backgroundId}.png` | 是 |
| L3 | 猫咪主体 | AI 单独生成的透明 PNG，保留耳朵、爪子、尾巴和毛发边缘 | `cat-assets/{catAssetId}.png` | 是 |
| L4 | 固定元素 | 顶部字母、编号牌底、咪咔圆章底、分隔线、底部三个属性格和属性图标 | `fixed-elements-v2/fixed-elements-{level}.png` | 否，仅按等级换颜色 |
| L5 | 动态文字与数值 | 编号、猫名、文案、咪咔、魅力、机灵、灵气 | Canvas 2D 绘制 | 是 |

`L0` 只保存数据和版本信息，不作为图片图层。合成器只负责排版，不在绘制阶段重新计算评分。

## 3. 当前已经拆出的资产

### 固定相框层（当前使用 v3）

| 等级 | 文件 |
| --- | --- |
| C | [`card-shell-c.png`](design-assets/card-frames-v1/card-shells-v3/card-shell-c.png) |
| U | [`card-shell-u.png`](design-assets/card-frames-v1/card-shells-v3/card-shell-u.png) |
| R | [`card-shell-r.png`](design-assets/card-frames-v1/card-shells-v3/card-shell-r.png) |
| SR | [`card-shell-sr.png`](design-assets/card-frames-v1/card-shells-v3/card-shell-sr.png) |
| UR | [`card-shell-ur.png`](design-assets/card-frames-v1/card-shells-v3/card-shell-ur.png) |

尺寸全部为 `1060 × 1484`。相框的图片窗口已经挖空，但保留确认稿中的粗色边框、内边线和下方信息承托区；窗口内不再作为成品内容使用示例猫或示例场景。

单独查看透明相框时，图片窗口会显示为空白，这是拆层后的正常状态。视觉验收应查看[`五档合成预览`](design-assets/card-frames-v1/card-shells-v3/card-layer-stack-v3-preview-no-cat.png)，而不是只看空白相框 PNG。

### 固定元素层

| 等级 | 文件 |
| --- | --- |
| C | [`fixed-elements-c.png`](design-assets/card-frames-v1/fixed-elements-v2/fixed-elements-c.png) |
| U | [`fixed-elements-u.png`](design-assets/card-frames-v1/fixed-elements-v2/fixed-elements-u.png) |
| R | [`fixed-elements-r.png`](design-assets/card-frames-v1/fixed-elements-v2/fixed-elements-r.png) |
| SR | [`fixed-elements-sr.png`](design-assets/card-frames-v1/fixed-elements-v2/fixed-elements-sr.png) |
| UR | [`fixed-elements-ur.png`](design-assets/card-frames-v1/fixed-elements-v2/fixed-elements-ur.png) |

固定元素层为透明 PNG。顶部只保留字母，编号牌、咪咔圆章和底部指标数字位置留给 L5。

### R 背景样例

[`r-street-teashop-bg-v1.png`](design-assets/card-backgrounds-v1/r-street-teashop-bg-v1.png) 是一张不含猫、不含文字、不含卡框的街边茶铺背景板，后续可作为 R 卡的背景输入。它只验证“背景板 + 猫主体 + 相框”的工作方式，当前没有独立透明猫 PNG，因此暂不伪造完整 R 卡成品。

## 4. 统一画布与坐标

所有坐标以 `1060 × 1484` 为设计基准。页面预览可以缩小显示，但合成、导出和分享使用同一套坐标，不为五档分别写布局。

### 图片窗口

相框的窗口边界用于保持视觉统一；真正绘制图片时使用内缩后的安全裁切区，避免背景覆盖内边框。

```text
photoFrameBounds: x=82, y=78, width=897, height=941, radius=56
photoContentClip: x=90, y=86, width=882, height=926, radius=51
```

### 动态内容安全区

| 内容 | x | y | width | height | 规则 |
| --- | ---: | ---: | ---: | ---: | --- |
| 编号文字 | 630 | 147 | 315 | 30 | 右对齐，例：`No. MK-260903-000013` |
| 猫名 | 165 | 1028 | 583 | 102 | 居中，最多 5 个汉字 |
| 咪咔数字 | 798 | 1100 | 104 | 72 | 居中，整数 0–100 |
| 相遇文案 | 165 | 1152 | 583 | 116 | 居中，最多 50 个中文字符 |
| 底部指标区 | 94 | 1285 | 878 | 149 | 三格等宽，数字为整数 0–100 |

五档切换时只替换 L1 和 L4 的文件，以上坐标不动。

## 5. L0 数据结构

合成器接收一份已经完成识别、评分和文案生成的数据：

```json
{
  "templateVersion": "card-poster-v0.1",
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

说明：`100` 只是在设计与接口联调阶段的占位值，生产态由评分服务返回实际分数。`mika` 是综合分；合成器不根据三个属性再次推导，避免前后端显示不一致。

## 6. 背景图生成规则

猫已经由 AI 单独生成，所以背景图也要作为独立资产生成，不把猫重新画进背景。

### 背景生成输入

由猫咪主体资产提取或人工确认：

- 猫的姿态：站、坐、趴、回头等；
- 猫的朝向：正面、左看、右看；
- 主体落脚位置：地面、窗台、屋顶、台阶；
- 光线方向和色温：例如右后方暖色夕阳；
- 希望出现的场景关键词：街角、茶铺、花店、屋顶、庭院等。

### 背景生成硬约束

- 不出现猫、人物、动物或明显主体；
- 不出现文字、招牌文案、水印和 UI；
- 主体将要站立的区域保持干净，留出猫的轮廓空间；
- 地面或接触面必须连续，方便后续加猫的接触阴影；
- 透视高度、光线方向和景深要能托住猫主体；
- 生成后允许 `cover` 裁切，但不能裁掉主要落脚区域；
- 保存原图、裁切参数和生成版本，不覆盖旧背景。

### 生成顺序

```text
读取猫 PNG → 判断姿态 / 朝向 / 光线
→ 生成无猫背景板
→ 人工或规则检查落脚区与留白
→ 保存 backgroundId 和版本
→ 进入 Canvas 合成
```

背景生成服务放在云端，密钥和提示词模板不下发到小程序。小程序只接收背景图临时地址和合成所需的元数据。

## 7. Canvas 合成顺序

推荐用小程序 Canvas 2D 做统一渲染器；Canvas 负责绘制图片、裁切、文字和最终导出，页面预览与分享图共用同一份 `templateVersion` 和坐标配置。新版 Canvas 2D 的图片对象应由当前 Canvas 自己创建，避免图片对象和渲染上下文混用；可参考[腾讯云小程序平台 Canvas 文档](https://main.qcloudimg.com/raw/document/intl/product/pdf/tencent-cloud_1219_57657_zh.pdf)。

伪代码如下：

```text
renderCard(data):
  canvas = createOffscreenCanvas(1060, 1484)
  clear(canvas)

  drawImage(L1 card-shell-{level})

  save()
  roundedClip(photoContentClip)
  drawCover(L2 background, photoContentClip)
  drawCatShadow(data.catPlacement)
  drawContain(L3 cat, data.catPlacement)
  restore()

  drawImage(L4 fixed-elements-{level})
  drawCardNo(data.cardNo)
  drawName(data.name)
  drawCopy(data.copy)
  drawMika(data.scores.mika)
  drawMetric("charm", data.scores.charm)
  drawMetric("cleverness", data.scores.cleverness)
  drawMetric("aura", data.scores.aura)

  validateCanvas()
  exportPng()
```

### 为什么猫要单独一层

这样同一只猫可以更换不同场景，也可以在五档卡框之间复用；背景生成失败时不必重新生成猫；后续还可以调整猫的大小、左右位置和落脚点。猫 PNG 的边缘、耳朵、爪子和尾巴必须保持透明，不要把白底或背景色抠进来。

### 猫的摆放参数

不要把每只猫写死成像素坐标，保存归一化参数：

- `anchorX`：猫主体中心相对于图片窗口宽度的比例；
- `baseY`：猫脚底相对于图片窗口高度的比例；
- `scale`：猫主体相对于图片窗口高度的比例；
- 可选 `flipX`：只有生成主体方向与背景构图冲突时使用；
- 可选 `shadowOpacity`：用于匹配不同光线的接触阴影强度。

## 8. 小程序侧的技术分工

### 云端负责

- AI 猫主体生成与透明抠图；
- 背景图生成；
- HY3 特征识别、三项属性评分和咪咔综合分；
- 生成唯一卡号；
- 保存 `cardData`、素材版本和 `templateVersion`；
- 可选：缓存最终 PNG，保证历史卡片可复现。

### 小程序负责

- 下载并预加载 L1–L4 图片；
- 通过同一渲染器显示预览；
- 处理文字换行、超长校验和绘制；
- 导出临时 PNG，预览、保存或分享；
- 将 `cardData + assetVersion + renderVersion` 回传，便于复现。

### 预览与最终图

建议“本地即时预览 + 云端保存数据”：用户拍完后先在本地 Canvas 立即看到卡片；点击保存或分享时导出 PNG，并把渲染版本一并记录。若后续需要跨设备完全一致，再增加云端批量渲染，不改变这五层输入。

## 9. 校验规则

导出前必须全部通过：

- 五档画布尺寸都是 `1060 × 1484`；
- L1、L4、背景和猫全部加载完成；
- 顶部仅出现等级字母，不出现中文等级名和等级图标；
- 猫名长度不超过 5 个字；文案长度不超过 50 个中文字符；
- 咪咔、魅力、机灵、灵气都存在且为 0–100 的整数；
- 猫的耳朵、爪子、尾巴没有被图片窗口外的元素错误遮挡；
- 编号牌内文字不溢出；
- 背景没有文字、水印或第二只猫；
- 不能误加载旧版 `fixed-elements-v1`，因为旧版包含已经取消的等级图标。

## 10. 下一步落地顺序

1. 收到一张独立透明猫 PNG，按本规范补齐 `catAssetId` 和摆放参数。
2. 用 R 相框 + R 背景 + 猫 PNG 合成第一张完整样卡。
3. 只调 R 的窗口裁切、猫大小、落脚点和文字对齐。
4. R 确认后，将同一组坐标反向复用到 C/U/SR/UR，只替换颜色皮肤。
5. 最后再把这套规范接入小程序渲染器，不在五档之间复制五套布局代码。
