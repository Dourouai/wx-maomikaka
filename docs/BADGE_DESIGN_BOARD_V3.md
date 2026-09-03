# 猫咪咔咔 · 勋章设计板 SVG 使用说明

对应源文件：[BADGE_DESIGN_BOARD_V3.svg](./BADGE_DESIGN_BOARD_V3.svg)

## 设计板内容

- 12 枚首版勋章，按 `初遇 / 罐罐 / 图鉴 / 咪咔高光 / 连续 / 温柔观察` 分组。
- 画板尺寸：`1600 × 1080`，背景、徽章、标签和图标均为原生 SVG。
- 不依赖 PNG、远程资源或商业图标库；字体使用系统字体回退。
- SVG 内含 `<metadata>`，记录每枚勋章的稳定 `badgeId`、分类、条件和奖励。

## 可复用入口

共享外圈：`#badge-shell`

图标组：

```text
#icon-first-meow
#icon-archivist
#icon-three-cans
#icon-full-can
#icon-booklet
#icon-street-book
#icon-mika-glow
#icon-mika-sparkle
#icon-three-days
#icon-seven-days
#icon-gentle-observer
#icon-gentle-press
```

画板中展示的完整勋章组也有稳定 ID，例如 `#badge-first-capture`、`#badge-three-days` 和 `#badge-gentle-press`。拆分单枚素材时，保留对应的图标组、外圈和名称标签即可。

## 状态约定

当前画板展示的是“已解锁 / 主视觉”状态。后续实现勋章墙时建议沿用同一套路径，只改变状态层：

- 已解锁：保留分类色、完整图标和柔和阴影；
- 进行中：降低饱和度，保留图形轮廓，显示进度文字；
- 未开始：使用低对比剪影，不使用叉号、红色警告或“失败”文案。

勋章只是记录用户怎样遇见猫，不表达猫咪价值或竞技等级。
