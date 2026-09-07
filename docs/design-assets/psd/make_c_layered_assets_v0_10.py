"""Build a genuinely granular C-card master for Photoshop.

v0.9 proved the palette and geometry. v0.10 changes the PSD contract so the
fixed master is a real stack instead of a handful of composite raster layers:
each major fill, line family, highlight, ornament, icon, and demo field gets
its own full-canvas transparent asset.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "make_c_layered_assets_v0_9.py"
OUT = ROOT / "rarity-masters-v0-10" / "C"


def load_source():
    spec = importlib.util.spec_from_file_location("c_layered_v09_for_v10", SOURCE)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load {SOURCE}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


v09 = load_source()
base = v09.base
v09.OUT = OUT
OUT.mkdir(parents=True, exist_ok=True)


def blank():
    return Image.new("RGBA", (base.SW, base.SH), (0, 0, 0, 0))


def clip_card(layer):
    return base.clip_alpha(layer, base.card_clip())


def save_layer(layer, filename, kind="card"):
    image = layer.resize((base.W, base.H), Image.Resampling.LANCZOS)
    base.final_clip(image, kind)
    image.save(OUT / filename, "PNG")


def semi(color, alpha):
    return (*color[:3], alpha)


def rounded(d, bounds, radius, fill=None, outline=None, width=1):
    d.rounded_rectangle(base.box(bounds), radius=base.xy(radius), fill=fill, outline=outline, width=base.xy(width))


def ellipse(d, bounds, fill=None, outline=None, width=1):
    d.ellipse(base.box(bounds), fill=fill, outline=outline, width=base.xy(width))


def line(d, coords, color, width=1):
    base.line(d, coords, color, width)


def polygon(d, coords, fill=None, outline=None, width=1):
    d.polygon(base.points(coords), fill=fill, outline=outline, width=base.xy(width))


def register(components, group, slug, display_name, layer, role, kind="card", visible=True):
    filename = f"{slug}.png"
    save_layer(layer, filename, kind=kind)
    components.append({
        "group": group,
        "slug": slug,
        "file": filename,
        "name": display_name,
        "role": role,
        "kind": kind,
        "visible_by_default": visible,
        "layer_contract": "single-editable-raster-component",
        "path_source": "editable-vector-paths/vector-path-specs.jsxinc" if group in {"MASTER-L1", "MASTER-L4", "MASTER-L4A"} else None,
        "layer": layer,
    })


def l4_frame_primary():
    layer = blank()
    rounded(ImageDraw.Draw(layer), (10, 6, 710, 1414), 34, outline=base.R_LINE, width=2.2)
    return clip_card(layer)


def l4_frame_gold():
    layer = blank()
    rounded(ImageDraw.Draw(layer), (18, 14, 702, 1406), 29, outline=base.R_GOLD, width=1.4)
    return clip_card(layer)


def l4_frame_inner_rail():
    layer = blank()
    base.draw_rounded_outline_without_bottom(ImageDraw.Draw(layer), (41, 37, 679, 1383), 18, semi(base.R_GOLD, 210), 1)
    return clip_card(layer)


def l4_frame_highlight():
    layer = blank()
    rounded(ImageDraw.Draw(layer), (29, 25, 691, 1395), 22, outline=base.R_HIGHLIGHT, width=2)
    return clip_card(layer)


def l4_frame_top_left_catch():
    layer = blank()
    d = ImageDraw.Draw(layer)
    line(d, [(61, 31), (650, 31)], (255, 255, 244, 150), 2.2)
    line(d, [(31, 78), (31, 1335)], (255, 255, 244, 120), 2.0)
    return clip_card(layer)


def l4_frame_right_deep():
    layer = blank()
    line(ImageDraw.Draw(layer), [(689, 82), (689, 1335)], base.R_DEEP, 1.5)
    return clip_card(layer)


def photo_recess_deep():
    layer = blank()
    rounded(ImageDraw.Draw(layer), (47, 72, 673, 923), 37, outline=base.R_DEEP, width=4)
    return clip_card(layer)


def photo_bevel_highlight():
    layer = blank()
    rounded(ImageDraw.Draw(layer), (49, 74, 671, 921), 36, outline=base.R_HIGHLIGHT, width=3)
    return clip_card(layer)


def photo_mount_gold():
    layer = blank()
    rounded(ImageDraw.Draw(layer), (50, 75, 670, 925), 35, outline=base.R_GOLD, width=1.4)
    return clip_card(layer)


def photo_aperture_primary():
    layer = blank()
    rounded(ImageDraw.Draw(layer), (54, 80, 666, 914), 31, outline=base.R_LINE, width=2.2)
    return clip_card(layer)


def photo_inner_lip_highlight():
    layer = blank()
    rounded(ImageDraw.Draw(layer), (59, 85, 661, 909), 27, outline=(255, 255, 249, 118), width=1.2)
    return clip_card(layer)


def photo_top_highlight():
    layer = blank()
    line(ImageDraw.Draw(layer), [(78, 84), (626, 84)], (255, 255, 247, 155), 2.0)
    return clip_card(layer)


def photo_left_highlight():
    layer = blank()
    line(ImageDraw.Draw(layer), [(60, 116), (60, 858)], (255, 255, 247, 125), 1.6)
    return clip_card(layer)


def photo_bottom_deep():
    layer = blank()
    line(ImageDraw.Draw(layer), [(79, 910), (626, 910)], base.R_DEEP, 1.1)
    return clip_card(layer)


def photo_right_deep():
    layer = blank()
    line(ImageDraw.Draw(layer), [(660, 116), (660, 858)], base.R_DEEP, 1.1)
    return clip_card(layer)


def photo_corner_highlights():
    layer = blank()
    d = ImageDraw.Draw(layer)
    for x, y, sx, sy in [(69, 94, 1, 1), (651, 94, -1, 1), (69, 900, 1, -1), (651, 900, -1, -1)]:
        line(d, [(x + sx * 5, y), (x + sx * 43, y)], (255, 255, 249, 155), 2.0)
        line(d, [(x, y + sy * 5), (x, y + sy * 43)], (255, 255, 249, 155), 2.0)
        line(d, [(x + sx * 10, y + sy * 7), (x + sx * 34, y + sy * 7)], (255, 255, 249, 155), 2.0)
        line(d, [(x + sx * 7, y + sy * 10), (x + sx * 7, y + sy * 34)], (255, 255, 249, 155), 1.5)
    return clip_card(layer)


def photo_corner_deep():
    layer = blank()
    d = ImageDraw.Draw(layer)
    for x, y, sx, sy in [(69, 94, 1, 1), (651, 94, -1, 1), (69, 900, 1, -1), (651, 900, -1, -1)]:
        line(d, [(x + sx * 10, y + sy * 7), (x + sx * 34, y + sy * 7)], base.R_DEEP, 1.0)
        line(d, [(x + sx * 7, y + sy * 10), (x + sx * 7, y + sy * 34)], base.R_DEEP, 1.0)
    return clip_card(layer)


def photo_corner_gold():
    layer = blank()
    d = ImageDraw.Draw(layer)
    for x, y, sx, sy in [(69, 94, 1, 1), (651, 94, -1, 1), (69, 900, 1, -1), (651, 900, -1, -1)]:
        polygon(d, [(x + sx * 2, y), (x + sx * 6, y + sy * 4), (x + sx * 2, y + sy * 8), (x - sx * 2, y + sy * 4)], fill=base.R_GOLD)
    return clip_card(layer)


def frame_decor_flower(which):
    layer = blank()
    d = ImageDraw.Draw(layer)
    positions = {
        "top": (206, 50, 1.05),
        "name-left": (68, 971, 0.72),
        "name-right": (653, 971, -0.72),
        "metrics-left": (71, 1176, 0.62),
        "metrics-right": (651, 1176, -0.62),
    }
    base.draw_flower(d, *positions[which])
    return clip_card(layer)


def frame_decor_motif():
    layer = blank()
    base.draw_micro_motif(ImageDraw.Draw(layer))
    return clip_card(layer)


def number_shadow():
    layer = blank()
    layer.alpha_composite(base.soft_shape_shadow(
        lambda sd, ox, oy, c: sd.rounded_rectangle(base.box((385 + ox, 80 + oy, 663 + ox, 159 + oy)), radius=base.xy(18), fill=c),
        offset=(3, 5), blur=6, color=base.R_SHADOW,
    ))
    return clip_card(layer)


def number_fill():
    layer = blank()
    rounded(ImageDraw.Draw(layer), (385, 80, 663, 159), 18, fill=base.R_LIGHT)
    return clip_card(layer)


def number_primary_line():
    layer = blank()
    rounded(ImageDraw.Draw(layer), (385, 80, 663, 159), 18, outline=base.R_LINE, width=2)
    return clip_card(layer)


def number_inner_gold_line():
    layer = blank()
    rounded(ImageDraw.Draw(layer), (394, 89, 654, 150), 12, outline=base.R_GOLD, width=1)
    return clip_card(layer)


def number_highlight():
    layer = blank()
    d = ImageDraw.Draw(layer)
    line(d, [(409, 91), (618, 91)], (255, 255, 250, 155), 1.5)
    return clip_card(layer)


def score_shadow():
    layer = blank()
    layer.alpha_composite(base.soft_shape_shadow(
        lambda sd, ox, oy, c: sd.ellipse(base.box((540 + ox, 945 + oy, 668 + ox, 1073 + oy)), fill=c),
        offset=(4, 6), blur=7, color=base.R_SHADOW,
    ))
    return clip_card(layer)


def score_fill():
    layer = blank()
    ellipse(ImageDraw.Draw(layer), (540, 945, 668, 1073), fill=base.R_PANEL)
    return clip_card(layer)


def score_primary_line():
    layer = blank()
    ellipse(ImageDraw.Draw(layer), (540, 945, 668, 1073), outline=base.R_LINE, width=2)
    return clip_card(layer)


def score_gold_line():
    layer = blank()
    ellipse(ImageDraw.Draw(layer), (548, 953, 660, 1065), outline=base.R_GOLD, width=2)
    return clip_card(layer)


def score_highlight_line():
    layer = blank()
    d = ImageDraw.Draw(layer)
    ellipse(d, (556, 961, 652, 1057), outline=base.R_HIGHLIGHT, width=2)
    d.arc(base.box((548, 953, 660, 1065)), start=195, end=305, fill=(255, 255, 250, 185), width=base.xy(2))
    return clip_card(layer)


def score_sparkle():
    layer = blank()
    base.sparkle(ImageDraw.Draw(layer), 647, 977, 4, (255, 255, 247, 145), 0.9)
    return clip_card(layer)


def name_divider():
    layer = blank()
    line(ImageDraw.Draw(layer), [(104, 1057), (519, 1057)], base.R_GOLD, 1.2)
    return clip_card(layer)


def name_divider_stud():
    layer = blank()
    ellipse(ImageDraw.Draw(layer), (355, 1053, 365, 1063), fill=base.R_PANEL, outline=base.R_GOLD, width=1)
    return clip_card(layer)


def metric_shadow():
    layer = blank()
    layer.alpha_composite(base.soft_shape_shadow(
        lambda sd, ox, oy, c: sd.rounded_rectangle(base.box((55 + ox, 1195 + oy, 665 + ox, 1365 + oy)), radius=base.xy(15), fill=c),
        offset=(3, 5), blur=7, color=base.R_SHADOW,
    ))
    return clip_card(layer)


def metric_module_fill():
    layer = blank()
    rounded(ImageDraw.Draw(layer), (55, 1195, 665, 1365), 15, fill=base.R_METRIC_FILL)
    return clip_card(layer)


def metric_cell_fill(index):
    layer = blank()
    d = ImageDraw.Draw(layer)
    bounds = [(69, 1212, 250, 1349), (272, 1212, 453, 1349), (475, 1212, 656, 1349)][index]
    rounded(d, bounds, 8, fill=base.R_METRIC_CELL)
    return clip_card(layer)


def metric_module_primary_line():
    layer = blank()
    rounded(ImageDraw.Draw(layer), (55, 1195, 665, 1365), 15, outline=base.R_LINE, width=2)
    return clip_card(layer)


def metric_module_gold_line():
    layer = blank()
    rounded(ImageDraw.Draw(layer), (63, 1203, 657, 1357), 10, outline=base.R_GOLD, width=1.4)
    return clip_card(layer)


def metric_module_lip_highlight():
    layer = blank()
    rounded(ImageDraw.Draw(layer), (67, 1207, 653, 1353), 7, outline=(255, 255, 248, 105), width=1)
    return clip_card(layer)


def metric_cell_border(index):
    layer = blank()
    d = ImageDraw.Draw(layer)
    bounds = [(69, 1212, 250, 1349), (272, 1212, 453, 1349), (475, 1212, 656, 1349)][index]
    rounded(d, bounds, 8, outline=base.R_HIGHLIGHT, width=1.1)
    return clip_card(layer)


def metric_cell_top(index):
    layer = blank()
    d = ImageDraw.Draw(layer)
    x0, _, x1, _ = [(69, 1212, 250, 1349), (272, 1212, 453, 1349), (475, 1212, 656, 1349)][index]
    line(d, [(x0 + 12, 1218), (x1 - 12, 1218)], (255, 255, 247, 145), 1.3)
    return clip_card(layer)


def metric_cell_bottom(index):
    layer = blank()
    d = ImageDraw.Draw(layer)
    x0, _, x1, _ = [(69, 1212, 250, 1349), (272, 1212, 453, 1349), (475, 1212, 656, 1349)][index]
    line(d, [(x0 + 13, 1343), (x1 - 13, 1343)], base.R_DEEP, 0.9)
    return clip_card(layer)


def metric_divider(index, highlight=False):
    layer = blank()
    x = [258, 461][index]
    d = ImageDraw.Draw(layer)
    line(d, [(x + 2, 1210), (x + 2, 1352)] if highlight else [(x, 1210), (x, 1352)], (255, 255, 249, 135) if highlight else base.R_DEEP, 1.0 if highlight else 1.2)
    return clip_card(layer)


def metric_divider_studs(index):
    layer = blank()
    x = [258, 461][index]
    d = ImageDraw.Draw(layer)
    ellipse(d, (x - 3, 1205, x + 5, 1213), fill=base.R_PANEL, outline=base.R_GOLD, width=1)
    ellipse(d, (x - 2, 1349, x + 4, 1355), fill=base.R_PANEL, outline=base.R_GOLD, width=1)
    return clip_card(layer)


def metric_corner_points():
    layer = blank()
    d = ImageDraw.Draw(layer)
    for cx, cy, r in [(67, 1214, 4), (653, 1214, 4), (67, 1347, 3), (653, 1347, 3)]:
        base.sparkle(d, cx, cy, r, (255, 255, 246, 135), 0.8)
    for x0, x1 in [(69, 250), (272, 453), (475, 656)]:
        ellipse(d, (x0 + 8, 1220, x0 + 12, 1224), fill=base.R_GOLD)
        ellipse(d, (x1 - 12, 1220, x1 - 8, 1224), fill=base.R_GOLD)
    return clip_card(layer)


def icon_layer(kind):
    layer = blank()
    d = ImageDraw.Draw(layer)
    if kind == "cat":
        base.draw_cat_icon(d, 103, 1284, base.R_ICON)
    elif kind == "eye":
        base.draw_eye_icon(d, 306, 1284, base.R_ICON)
    else:
        base.draw_moon_icon(d, 509, 1284, base.R_ICON)
    return clip_card(layer)


def label_shadow():
    layer = blank()
    layer.alpha_composite(base.soft_shape_shadow(
        lambda sd, ox, oy, c: sd.polygon(base.points([(x + ox, y + oy) for x, y in v09.BADGE]), fill=c),
        offset=(4, 6), blur=7, color=base.R_SHADOW,
    ))
    return clip_card(layer)


def label_fill():
    layer = blank()
    base.polygon_gradient(layer, v09.BADGE, base.R_HIGHLIGHT, base.R_PANEL)
    return clip_card(layer)


def label_primary_line():
    layer = blank()
    polygon(ImageDraw.Draw(layer), v09.BADGE, outline=base.R_LINE, width=2)
    return clip_card(layer)


def label_inner_highlight():
    layer = blank()
    polygon(ImageDraw.Draw(layer), v09.INNER_BADGE, outline=base.R_HIGHLIGHT, width=3)
    return clip_card(layer)


def label_top_left_highlight():
    layer = blank()
    d = ImageDraw.Draw(layer)
    line(d, [(65, 59), (148, 59)], (255, 255, 249, 155), 2.0)
    line(d, [(58, 76), (58, 157)], (255, 255, 249, 120), 1.5)
    return clip_card(layer)


def label_gold_detail():
    layer = blank()
    d = ImageDraw.Draw(layer)
    line(d, [(76, 193), (153, 193)], base.R_GOLD, 1.0)
    base.sparkle(d, 70, 184, 2.5, base.R_GOLD, 0.7)
    return clip_card(layer)


def label_top_sparkle():
    layer = blank()
    base.sparkle(ImageDraw.Draw(layer), 157, 61, 4, (255, 255, 247, 150), 0.9)
    return clip_card(layer)


def label_letter():
    layer = blank()
    base.centered(ImageDraw.Draw(layer), (115, 117), "C", base.font(base.BASKERVILLE, 64), base.R_INK)
    return clip_card(layer)


def static_number_prefix():
    layer = blank()
    base.centered(ImageDraw.Draw(layer), (420, 119), "No.", base.font(base.BASKERVILLE, 18), base.R_INK)
    return clip_card(layer)


def static_score_title():
    layer = blank()
    base.centered(ImageDraw.Draw(layer), (604, 982), "MIKA", base.font(base.BASKERVILLE, 16), base.R_INK)
    return clip_card(layer)


def text_component(draw_fn):
    layer = blank()
    draw_fn(ImageDraw.Draw(layer))
    return clip_card(layer)


def demo_number():
    return text_component(lambda d: base.centered(d, (537, 119), "MK-260903-000013", base.font(base.BASKERVILLE, 23), base.R_INK))


def demo_name():
    return text_component(lambda d: base.left_aligned(d, 104, 978, "桃桃晒太阳", base.font(base.SONGTI, 45), base.R_INK))


def demo_copy_one():
    return text_component(lambda d: base.left_aligned(d, 104, 1097, "午后的阳光刚刚好，", base.font(base.SONGTI, 22), base.R_INK))


def demo_copy_two():
    return text_component(lambda d: base.left_aligned(d, 104, 1136, "遇见一只安静的猫。", base.font(base.SONGTI, 22), base.R_INK))


def demo_score():
    return text_component(lambda d: base.centered(d, (604, 1026), "100", base.font(base.BASKERVILLE, 45), base.R_INK))


def demo_metric(x):
    return text_component(lambda d: base.centered(d, (x, 1284), "100", base.font(base.BASKERVILLE, 32), base.R_INK))


def composite(components, groups):
    layer = blank()
    for item in components:
        if item["group"] in groups:
            layer.alpha_composite(item["layer"])
    return layer


def main():
    components = []

    # L1: every fixed color treatment is a separate bottom-layer component.
    register(components, "MASTER-L1", "L1-01-outer-gradient-C", "MASTER-L1-01｜外框渐变底色｜最底层", v09.l1_outer_gradient(), "outer gradient color")
    register(components, "MASTER-L1", "L1-02-shell-inner-C", "MASTER-L1-02｜内壳底色｜最底层", v09.l1_shell_inner_color(), "shell color")
    register(components, "MASTER-L1", "L1-03-surface-C", "MASTER-L1-03｜内侧纸面底色｜最底层", v09.l1_surface_color(), "surface color")
    register(components, "MASTER-L1", "L1-04-panel-C", "MASTER-L1-04｜信息区底色｜最底层", v09.l1_panel_color(), "panel color")
    register(components, "MASTER-L1", "L1-05-panel-inner-C", "MASTER-L1-05｜信息区内底色｜最底层", v09.l1_panel_inner_color(), "panel inner color")
    register(components, "MASTER-L1", "L1-06-photo-shadow-C", "MASTER-L1-06｜主图槽位阴影｜最底层", v09.l1_photo_shadow(), "photo recess shadow")
    register(components, "MASTER-L1", "L1-07-paper-highlight-C", "MASTER-L1-07｜纸张高光与纹理｜最底层", v09.l1_paper_highlight(), "paper highlight")

    register(components, "CONTENT-L2", "L2-background-replaceable-C", "CONTENT-L2｜示例背景图｜可替换", base.make_l2(), "replaceable background", kind="photo")
    register(components, "CONTENT-L3", "L3-cat-slot-placeholder-C", "CONTENT-L3｜猫主体占位｜可替换透明 PNG", base.make_l3(), "replaceable cat subject", kind="photo")

    # L4: one named component for each fixed object/color/line treatment.
    fixed_specs = [
        ("L4-01-frame-primary-line-C", "MASTER-L4-01｜外框主边线｜线稿", l4_frame_primary, "frame primary line"),
        ("L4-02-frame-gold-line-C", "MASTER-L4-02｜外框金线｜线稿", l4_frame_gold, "frame gold line"),
        ("L4-03-frame-inner-rail-C", "MASTER-L4-03｜外框内侧金色轨道｜线稿", l4_frame_inner_rail, "frame inner rail"),
        ("L4-04-frame-highlight-line-C", "MASTER-L4-04｜外框高光线｜线稿", l4_frame_highlight, "frame highlight line"),
        ("L4-05-frame-top-left-catch-C", "MASTER-L4-05｜外框上左高光｜线稿", l4_frame_top_left_catch, "frame catch light"),
        ("L4-06-frame-right-deep-line-C", "MASTER-L4-06｜外框右侧深线｜线稿", l4_frame_right_deep, "frame deep line"),
        ("L4-07-photo-recess-deep-C", "MASTER-L4-07｜照片槽外凹深线｜线稿", photo_recess_deep, "photo recess line"),
        ("L4-08-photo-bevel-highlight-C", "MASTER-L4-08｜照片槽外沿高光｜线稿", photo_bevel_highlight, "photo bevel highlight"),
        ("L4-09-photo-mount-gold-C", "MASTER-L4-09｜照片槽安装金线｜线稿", photo_mount_gold, "photo mount line"),
        ("L4-10-photo-aperture-primary-C", "MASTER-L4-10｜照片窗口主边线｜线稿", photo_aperture_primary, "photo aperture line"),
        ("L4-11-photo-inner-lip-C", "MASTER-L4-11｜照片窗口内沿高光｜线稿", photo_inner_lip_highlight, "photo inner lip"),
        ("L4-12-photo-top-catch-C", "MASTER-L4-12｜照片窗口顶部高光｜线稿", photo_top_highlight, "photo top catch"),
        ("L4-13-photo-left-catch-C", "MASTER-L4-13｜照片窗口左侧高光｜线稿", photo_left_highlight, "photo left catch"),
        ("L4-14-photo-bottom-seam-C", "MASTER-L4-14｜照片窗口底部深线｜线稿", photo_bottom_deep, "photo bottom seam"),
        ("L4-15-photo-right-seam-C", "MASTER-L4-15｜照片窗口右侧深线｜线稿", photo_right_deep, "photo right seam"),
        ("L4-16-photo-corners-highlight-C", "MASTER-L4-16｜照片窗口四角高光｜线稿", photo_corner_highlights, "photo corner highlight"),
        ("L4-17-photo-corners-deep-C", "MASTER-L4-17｜照片窗口四角深线｜线稿", photo_corner_deep, "photo corner deep line"),
        ("L4-18-photo-corners-gold-C", "MASTER-L4-18｜照片窗口四角金点｜颜色", photo_corner_gold, "photo corner gold points"),
        ("L4-19-number-shadow-C", "MASTER-L4-19｜编号牌阴影｜颜色", number_shadow, "number plaque shadow"),
        ("L4-20-number-fill-C", "MASTER-L4-20｜编号牌底色｜颜色", number_fill, "number plaque fill"),
        ("L4-21-number-primary-line-C", "MASTER-L4-21｜编号牌主边线｜线稿", number_primary_line, "number plaque line"),
        ("L4-22-number-inner-gold-line-C", "MASTER-L4-22｜编号牌内金线｜线稿", number_inner_gold_line, "number plaque inner line"),
        ("L4-23-number-highlight-C", "MASTER-L4-23｜编号牌顶部高光｜线稿", number_highlight, "number plaque highlight"),
        ("L4-24-number-prefix-C", "MASTER-L4-24｜固定文字 No.｜示例母版", static_number_prefix, "number prefix"),
        ("L4-25-score-shadow-C", "MASTER-L4-25｜咪咔徽章阴影｜颜色", score_shadow, "score seal shadow"),
        ("L4-26-score-fill-C", "MASTER-L4-26｜咪咔徽章底色｜颜色", score_fill, "score seal fill"),
        ("L4-27-score-primary-line-C", "MASTER-L4-27｜咪咔徽章主边线｜线稿", score_primary_line, "score seal line"),
        ("L4-28-score-gold-line-C", "MASTER-L4-28｜咪咔徽章金线｜线稿", score_gold_line, "score seal gold line"),
        ("L4-29-score-highlight-line-C", "MASTER-L4-29｜咪咔徽章内高光｜线稿", score_highlight_line, "score seal highlight"),
        ("L4-30-score-sparkle-C", "MASTER-L4-30｜咪咔徽章高光点｜颜色", score_sparkle, "score seal sparkle"),
        ("L4-31-score-title-C", "MASTER-L4-31｜固定文字 MIKA｜示例母版", static_score_title, "score title"),
        ("L4-32-name-divider-C", "MASTER-L4-32｜名称分隔线｜线稿", name_divider, "name divider"),
        ("L4-33-name-divider-stud-C", "MASTER-L4-33｜名称分隔铆点｜颜色", name_divider_stud, "name divider stud"),
    ]
    for slug, display_name, factory, role in fixed_specs:
        register(components, "MASTER-L4", slug, display_name, factory(), role)

    for motif in ["top", "name-left", "name-right", "metrics-left", "metrics-right"]:
        register(components, "MASTER-L4", f"L4-34-flower-{motif}-C", f"MASTER-L4-34｜叶片装饰｜{motif}｜颜色", frame_decor_flower(motif), "decorative flower")
    register(components, "MASTER-L4", "L4-39-foil-motif-C", "MASTER-L4-39｜C版微型叶片箔饰｜颜色", frame_decor_motif(), "decorative foil motif")

    metric_specs = [
        ("L4-40-metric-shadow-C", "MASTER-L4-40｜指标模块阴影｜颜色", metric_shadow(), "metric shadow"),
        ("L4-41-metric-module-fill-C", "MASTER-L4-41｜指标模块底色｜颜色", metric_module_fill(), "metric module fill"),
    ]
    for index, name in enumerate(["一", "二", "三"]):
        metric_specs.append((f"L4-{42 + index:02d}-metric-cell-{index + 1}-fill-C", f"MASTER-L4-{42 + index:02d}｜指标格{name}底色｜颜色", metric_cell_fill(index), f"metric cell {index + 1} fill"))
    metric_specs.extend([
        ("L4-45-metric-module-primary-line-C", "MASTER-L4-45｜指标模块主边线｜线稿", metric_module_primary_line(), "metric module line"),
        ("L4-46-metric-module-gold-line-C", "MASTER-L4-46｜指标模块内金线｜线稿", metric_module_gold_line(), "metric module gold line"),
        ("L4-47-metric-module-lip-C", "MASTER-L4-47｜指标模块内沿高光｜线稿", metric_module_lip_highlight(), "metric module highlight"),
    ])
    for index, name in enumerate(["一", "二", "三"]):
        metric_specs.append((f"L4-{48 + index:02d}-metric-cell-{index + 1}-border-C", f"MASTER-L4-{48 + index:02d}｜指标格{name}边线｜线稿", metric_cell_border(index), f"metric cell {index + 1} border"))
    for index, name in enumerate(["一", "二", "三"]):
        metric_specs.append((f"L4-{51 + index:02d}-metric-cell-{index + 1}-top-C", f"MASTER-L4-{51 + index:02d}｜指标格{name}顶部高光｜线稿", metric_cell_top(index), f"metric cell {index + 1} top highlight"))
    for index, name in enumerate(["一", "二", "三"]):
        metric_specs.append((f"L4-{54 + index:02d}-metric-cell-{index + 1}-bottom-C", f"MASTER-L4-{54 + index:02d}｜指标格{name}底部深线｜线稿", metric_cell_bottom(index), f"metric cell {index + 1} bottom line"))
    metric_specs.extend([
        ("L4-57-metric-divider-1-deep-C", "MASTER-L4-57｜指标分隔线一｜深线", metric_divider(0), "metric divider 1"),
        ("L4-58-metric-divider-1-highlight-C", "MASTER-L4-58｜指标分隔线一｜高光", metric_divider(0, True), "metric divider 1 highlight"),
        ("L4-59-metric-divider-1-studs-C", "MASTER-L4-59｜指标分隔线一｜铆点", metric_divider_studs(0), "metric divider 1 studs"),
        ("L4-60-metric-divider-2-deep-C", "MASTER-L4-60｜指标分隔线二｜深线", metric_divider(1), "metric divider 2"),
        ("L4-61-metric-divider-2-highlight-C", "MASTER-L4-61｜指标分隔线二｜高光", metric_divider(1, True), "metric divider 2 highlight"),
        ("L4-62-metric-divider-2-studs-C", "MASTER-L4-62｜指标分隔线二｜铆点", metric_divider_studs(1), "metric divider 2 studs"),
        ("L4-63-metric-corner-points-C", "MASTER-L4-63｜指标模块角点与金点｜颜色", metric_corner_points(), "metric corner details"),
        ("L4-64-icon-charm-C", "MASTER-L4-64｜魅力图标线｜独立图标", icon_layer("cat"), "charm icon"),
        ("L4-65-icon-clever-C", "MASTER-L4-65｜机灵图标线｜独立图标", icon_layer("eye"), "clever icon"),
        ("L4-66-icon-aura-C", "MASTER-L4-66｜灵气图标线｜独立图标", icon_layer("moon"), "aura icon"),
    ])
    for slug, display_name, layer, role in metric_specs:
        register(components, "MASTER-L4", slug, display_name, layer, role)

    # L4A is a separately replaceable label, but its colors/lines are also split.
    label_specs = [
        ("L4A-01-label-shadow-C", "MASTER-L4A-01｜等级标签阴影｜颜色", label_shadow(), "label shadow"),
        ("L4A-02-label-fill-C", "MASTER-L4A-02｜等级标签渐变底色｜颜色", label_fill(), "label fill"),
        ("L4A-03-label-primary-line-C", "MASTER-L4A-03｜等级标签主边线｜线稿", label_primary_line(), "label primary line"),
        ("L4A-04-label-inner-highlight-C", "MASTER-L4A-04｜等级标签内框高光｜线稿", label_inner_highlight(), "label inner line"),
        ("L4A-05-label-top-left-highlight-C", "MASTER-L4A-05｜等级标签上左高光｜线稿", label_top_left_highlight(), "label highlight"),
        ("L4A-06-label-gold-detail-C", "MASTER-L4A-06｜等级标签金色细节｜线稿", label_gold_detail(), "label gold detail"),
        ("L4A-07-label-top-sparkle-C", "MASTER-L4A-07｜等级标签顶部高光点｜颜色", label_top_sparkle(), "label sparkle"),
        ("L4A-08-label-letter-C", "MASTER-L4A-08｜等级字母 C｜独立颜色层", label_letter(), "label letter"),
    ]
    for slug, display_name, layer, role in label_specs:
        register(components, "MASTER-L4A", slug, display_name, layer, role)

    # Demo values are deliberately at the very top and each field is isolated.
    demo_specs = [
        ("L5-01-number-value-C", "DEMO-L5-01｜示例编号值｜顶部", demo_number(), "demo number"),
        ("L5-02-pet-name-C", "DEMO-L5-02｜示例宠物名｜顶部｜左对齐", demo_name(), "demo pet name"),
        ("L5-03-copy-line-one-C", "DEMO-L5-03｜示例文案第一行｜顶部｜左对齐", demo_copy_one(), "demo copy line 1"),
        ("L5-04-copy-line-two-C", "DEMO-L5-04｜示例文案第二行｜顶部｜左对齐", demo_copy_two(), "demo copy line 2"),
        ("L5-05-score-C", "DEMO-L5-05｜示例咪咔分数 100｜顶部", demo_score(), "demo score"),
        ("L5-06-charm-C", "DEMO-L5-06｜示例魅力分数 100｜顶部", demo_metric(194), "demo charm"),
        ("L5-07-clever-C", "DEMO-L5-07｜示例机灵分数 100｜顶部", demo_metric(397), "demo clever"),
        ("L5-08-aura-C", "DEMO-L5-08｜示例灵气分数 100｜顶部", demo_metric(600), "demo aura"),
    ]
    for slug, display_name, layer, role in demo_specs:
        register(components, "DEMO-L5", slug, display_name, layer, role)

    # The export order is bottom-to-top. Photoshop builder reverses each group
    # for its visible panel order, while group order is set explicitly there.
    fixed = composite(components, {"MASTER-L1", "MASTER-L4", "MASTER-L4A"})
    save_layer(fixed, "C-master-fixed-transparent-v0-10.png")
    with_demo = composite(components, {"MASTER-L1", "CONTENT-L2", "CONTENT-L3", "MASTER-L4", "MASTER-L4A", "DEMO-L5"})
    save_layer(with_demo, "C-master-preview-v0-10-granular-with-demo.png")

    manifest = {
        "version": "0.10",
        "rarity": "C",
        "canvas": {"width": base.W, "height": base.H, "color": "RGBA"},
        "layer_order": "bottom_to_top",
        "groups": ["MASTER-L1", "CONTENT-L2", "CONTENT-L3", "MASTER-L4", "MASTER-L4A", "DEMO-L5"],
        "group_contract": {
            "MASTER-L1": "固定相框底纸，堆栈最底部",
            "CONTENT-L2": "背景图，可替换",
            "CONTENT-L3": "透明猫主体，可替换",
            "MASTER-L4": "固定线稿、装饰、编号牌、分数牌、指标模块与图标，压在内容上",
            "MASTER-L4A": "独立等级标签，压在固定线稿和内容上",
            "DEMO-L5": "示例文字与示例数字，堆栈最顶部，可整体隐藏",
        },
        "fixed_geometry": {
            "card": [10, 6, 710, 1414],
            "photo": [54, 80, 666, 914],
            "number_plaque": [385, 80, 663, 159],
            "information_panel": [55, 914, 665, 1385],
            "score_seal_center": [604, 1009],
            "metrics": [55, 1195, 665, 1365],
        },
        "components": [{key: value for key, value in item.items() if key != "layer"} for item in components],
        "notes": [
            "示例文字不再烘焙进固定母版，DEMO-L5 内每个字段单独一层。",
            "所有主色、金线、深线、高光和装饰不再合并为一张 L4 图。",
            "照片窗口内保持透明；不导出底部多余内侧横线。",
            "固定几何对应的路径源在 editable-vector-paths/vector-path-specs.jsxinc。",
        ],
    }
    (OUT / "C-layer-manifest-v0-10.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(OUT / "C-master-preview-v0-10-granular-with-demo.png")


if __name__ == "__main__":
    main()
