# C 卡杂志封面风格 · 精修提示词

生成方式：内置 imagegen，基于已确认的第三款图片进行编辑；不是分层 PSD。

第二轮针对性修订：第一轮外框偏宽，文案下方留白较多。以第一轮生成图为参考，仅细化边框并压缩信息区空白，完整提示词见文末。

参考图：`../c-card-concepts-v10/03-editorial-cover.png`

用户追加要求：用边框区分等级。C 采用单圈鼠尾草绿细边，后续各等级复用边框几何，仅调整等级色与字母。

```text
Use case: precise-object-edit
Asset type: refined front design of one collectible cat card, editorial-cover concept.
Input images: Image 1 is the approved card to EDIT, not merely a loose inspiration.

Primary request: Polish the approved minimalist full-bleed photographic card. Keep its identity and visual direction. Make the typography quieter, the total score less oversized, the footer more compact, and all margins and icons more consistent. Output ONE complete flat front-facing card, portrait 1:2, preferably 1024 x 2048. The card itself fills the entire image; no surrounding mockup background, captions, comparison sheet, or perspective.

Preserve: the same calico cat, facial markings, amber eyes, white chest and paws, seated pose, cafe background, green door, warm natural light, realistic photography, and overall camera angle from Image 1. Do not replace the cat with another cat. Retain full visible ears and front paws. Retain a full-bleed photograph meeting a plain warm-white footer in a single clean horizontal boundary. Add ONLY the single thin rarity-colored outer frame specified below; no ornate frame.

Refinements:
0. NEW USER REQUIREMENT — add one simple continuous rarity-color border around the OUTERMOST perimeter of the ENTIRE card, enclosing both photograph and footer. For this C card use muted sage green, approximately #8FA783. Border thickness about 0.6% of card width (6 px at 1024 width), visibly precise but not thick. Draw the entire stroke inside the canvas so none of it is clipped. Very small corner rounding is allowed, not pill-like corners. The photograph and footer touch the inside of this border without any extra mat, gap or secondary outline. This is the ONLY border on the card. Keep the C label and serial present: rarity must not depend on color alone. Future rarity variants can reuse this exact border geometry and change only the border color and rarity letter; create ONLY the C card now.
1. Give the photograph approximately the upper 75% of the finished card, slightly taller than the reference, gently reframing/extending the cafe setting only if needed without stretching the cat. Keep the cat the focal point.
2. A small warm-white SQUARE C label sits at the photo's upper left, side about 6% of card width, about 4% inset from top and left. Center the dark serif C optically with even padding; do not make a shield, large badge, or outline. Upper-right serial is one neat line of warm-white text, noticeably smaller than in the reference, about 2.6% of card width in font size. Its right inset equals the C label's left inset and it vertically centers with the C label. No background box behind the serial. It must remain clearly readable against the dark cafe.
3. The lower 25% is a clean warm-white information area, no texture, no lines, no borders. Use roughly 5.2% card-width left and right padding, and balanced top/bottom padding. Name and description share exactly the same left edge. Make the Chinese name a confident but moderate semibold sans-serif, approximately 6.3% of card width in font size, about one third smaller than the reference; do not make it heavy poster type or stretch it. Position the total score at the right within its own clear column: a small letterspaced MIKA over a medium-weight sans-serif 100. The 100 should be about 7% of card width in font size, substantially smaller and calmer than the reference. This title/score row is optically balanced. No circle or medallion.
4. Beneath the name on the left, the exact two-line story uses clean regular sans-serif, about 3.1% of card width, comfortable 1.45 line-height, dark warm gray. Keep enough clearance from the score column. Tighten the excess blank gap between story and attributes, while maintaining calm readable breathing room.
5. At the footer bottom, exactly three evenly spaced attribute groups arranged in ONE horizontal row. Each group has a small outline icon, its Chinese label, and 100 to the right. The icons are a simple friendly cat face, an eye, and a crescent moon. All THREE icons must use the same restrained muted olive color, the same delicate stroke weight and the same optical size (approximately 4% card width), smaller than in the reference. All labels share one font and baseline; all three values use the same size and medium sans-serif weight. No dividers, boxes, underlines, extra dots or ornaments. Equal internal gaps and generous safe bottom margin. Never overlap icon, label and number.

Text, each exactly once in the indicated location:
C
No. MK-260903-000013
桃桃晒太阳
MIKA
100 [total score]
午后的阳光刚刚好，
遇见一只安静的猫。
[cat icon] 魅力 100
[eye icon] 机灵 100
[crescent icon] 灵气 100
The bracketed descriptions are instructions, NOT printed text. There are FOUR 100 values in total: one total and three attributes.

Style: polished restrained contemporary editorial layout, content first, warm and approachable, clear Chinese typography and precise alignment. Maintain the reference's simple black/white/photography identity. Small olive icon accents only.
Avoid: new slogans, added labels, extra elements, thick or multiple card borders, repeated outlines, shiny bevels, gradients in the footer, drop shadows, frames around metrics, giant title, giant total score, ghost cat silhouette, cropped paws, misaligned number rows, replacing the photograph, accidental gibberish, watermark.
```
