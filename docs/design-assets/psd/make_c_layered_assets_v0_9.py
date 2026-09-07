"""Build the C-card as separately editable color, line, text, and image layers.

The v0.8 preview is kept intact as a visual snapshot. This pass changes the
asset contract only: every fixed color/line family is exported separately so
the Photoshop master can be edited without repainting a composite layer.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parent
BASE_SCRIPT = ROOT / "make_r_master_assets.py"
OUT = ROOT / "rarity-masters-v0-9" / "C"


C_THEME = {
    "letter": "C",
    "ink": (61, 82, 65, 255),
    "line": (108, 143, 104, 255),
    "gold": (188, 205, 151, 255),
    "light": (249, 253, 239, 255),
    "panel": (239, 248, 227, 255),
    "highlight": (255, 255, 247, 255),
    "outer_top": (228, 239, 216, 255),
    "outer_bottom": (169, 197, 153, 255),
    "shell_inner": (235, 246, 226, 255),
    "surface": (249, 252, 237, 255),
    "panel_inner": (247, 251, 234, 255),
    "metric_fill": (249, 252, 239, 200),
    "metric_cell": (255, 255, 255, 52),
    "icon": (82, 124, 86, 255),
    "flower": (128, 160, 112, 145),
    "deep": (74, 107, 71, 125),
    "shadow": (55, 78, 50, 46),
    "photo_shadow": (61, 86, 52, 34),
    "overlay": (211, 231, 190, 20),
    "motif": "leaf",
}


def load_base():
    spec = importlib.util.spec_from_file_location("r_master_base_layered", BASE_SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load {BASE_SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


base = load_base()
base.set_palette(C_THEME)
OUT.mkdir(parents=True, exist_ok=True)


def blank():
    return Image.new("RGBA", (base.SW, base.SH), (0, 0, 0, 0))


def clip_card(layer):
    return base.clip_alpha(layer, base.card_clip())


def clip_photo(layer):
    return base.clip_alpha(layer, base.photo_clip())


def cut_photo_hole(layer):
    """Keep a fixed-frame layer transparent inside the replaceable photo slot."""
    mask = ImageChops.subtract(base.card_clip(), base.photo_clip())
    layer.putalpha(ImageChops.multiply(layer.getchannel("A"), mask))
    return layer


def semi(color, alpha):
    return (*color[:3], alpha)


def save_layer(layer, filename, kind="card"):
    image = layer.resize((base.W, base.H), Image.Resampling.LANCZOS)
    base.final_clip(image, kind)
    image.save(OUT / filename, "PNG")


def crop_label_standalone(layer, filename):
    image = layer.resize((base.W, base.H), Image.Resampling.LANCZOS)
    base.final_clip(image, "card")
    image.crop((34, 32, 199, 215)).save(OUT / filename, "PNG")


def l1_outer_gradient():
    return cut_photo_hole(base.rounded_gradient((10, 6, 710, 1414), 34, base.R_OUTER_TOP, base.R_OUTER_BOTTOM))


def l1_shell_inner_color():
    layer = blank()
    ImageDraw.Draw(layer).rounded_rectangle(base.box((22, 18, 698, 1402)), radius=base.xy(28), fill=base.R_SHELL_INNER)
    return cut_photo_hole(layer)


def l1_surface_color():
    layer = blank()
    ImageDraw.Draw(layer).rounded_rectangle(base.box((34, 30, 686, 1390)), radius=base.xy(22), fill=base.R_SURFACE)
    return cut_photo_hole(layer)


def l1_panel_color():
    layer = blank()
    ImageDraw.Draw(layer).rectangle(base.box((55, 914, 665, 1385)), fill=base.R_PANEL)
    return clip_card(layer)


def l1_panel_inner_color():
    layer = blank()
    ImageDraw.Draw(layer).rectangle(base.box((58, 925, 662, 1383)), fill=base.R_PANEL_INNER)
    return clip_card(layer)


def l1_photo_shadow():
    layer = blank()
    shadow = Image.new("RGBA", (base.SW, base.SH), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle(base.box((47, 73, 673, 925)), radius=base.xy(34), fill=base.R_PHOTO_SHADOW)
    shadow = shadow.filter(ImageFilter.GaussianBlur(base.xy(7)))
    layer.alpha_composite(shadow)
    return cut_photo_hole(layer)


def l1_paper_highlight():
    layer = blank()
    layer.alpha_composite(base.soft_highlight((24, 20, 696, 1398), 25, (255, 255, 244, 30)))

    panel_glow = Image.new("RGBA", (base.SW, base.SH), (0, 0, 0, 0))
    pg = ImageDraw.Draw(panel_glow)
    pg.rounded_rectangle(base.box((58, 925, 662, 1095)), radius=base.xy(12), fill=(255, 255, 247, 18))
    pg.line(base.points([(74, 934), (646, 934)]), fill=(255, 255, 255, 82), width=base.xy(2))
    layer.alpha_composite(panel_glow.filter(ImageFilter.GaussianBlur(base.xy(3))))

    wash = Image.new("RGBA", (base.SW, base.SH), (255, 255, 255, 0))
    wd = ImageDraw.Draw(wash)
    for y in range(base.xy(30), base.xy(1390), base.xy(14)):
        alpha = int(6 + 5 * ((y / base.SH) % 1))
        wd.line([(base.xy(30), y), (base.xy(690), y)], fill=(255, 255, 255, alpha), width=base.xy(5))
    layer.alpha_composite(wash)
    return cut_photo_hole(layer)


BADGE = [(44, 42), (160, 42), (186, 68), (186, 174), (160, 202), (70, 202), (44, 174), (44, 68)]
INNER_BADGE = [(52, 51), (153, 51), (176, 75), (176, 168), (153, 193), (76, 193), (52, 168), (52, 75)]


def label_shadow():
    layer = blank()
    layer.alpha_composite(base.soft_shape_shadow(
        lambda sd, ox, oy, c: sd.polygon(base.points([(x + ox, y + oy) for x, y in BADGE]), fill=c),
        offset=(4, 6), blur=7, color=base.R_SHADOW,
    ))
    return clip_card(layer)


def label_fill():
    layer = blank()
    base.polygon_gradient(layer, BADGE, base.R_HIGHLIGHT, base.R_PANEL)
    return clip_card(layer)


def label_primary_line():
    layer = blank()
    ImageDraw.Draw(layer).polygon(base.points(BADGE), outline=base.R_LINE, width=base.xy(2))
    return clip_card(layer)


def label_highlight_line():
    layer = blank()
    d = ImageDraw.Draw(layer)
    d.polygon(base.points(INNER_BADGE), outline=base.R_HIGHLIGHT, width=base.xy(3))
    base.line(d, [(65, 59), (148, 59)], (255, 255, 249, 155), 2.0)
    base.line(d, [(58, 76), (58, 157)], (255, 255, 249, 120), 1.5)
    return clip_card(layer)


def label_gold_detail():
    layer = blank()
    d = ImageDraw.Draw(layer)
    base.line(d, [(76, 193), (153, 193)], base.R_GOLD, 1.0)
    base.sparkle(d, 70, 184, 2.5, base.R_GOLD, 0.7)
    return clip_card(layer)


def label_letter():
    layer = blank()
    base.centered(ImageDraw.Draw(layer), (115, 117), "C", base.font(base.BASKERVILLE, 64), base.R_INK)
    return clip_card(layer)


def l4_shadows():
    layer = blank()
    layer.alpha_composite(base.soft_shape_shadow(
        lambda sd, ox, oy, c: sd.rounded_rectangle(base.box((385 + ox, 80 + oy, 663 + ox, 159 + oy)), radius=base.xy(18), fill=c),
        offset=(3, 5), blur=6, color=base.R_SHADOW,
    ))
    layer.alpha_composite(base.soft_shape_shadow(
        lambda sd, ox, oy, c: sd.ellipse(base.box((540 + ox, 945 + oy, 668 + ox, 1073 + oy)), fill=c),
        offset=(4, 6), blur=7, color=base.R_SHADOW,
    ))
    layer.alpha_composite(base.soft_shape_shadow(
        lambda sd, ox, oy, c: sd.rounded_rectangle(base.box((55 + ox, 1195 + oy, 665 + ox, 1365 + oy)), radius=base.xy(15), fill=c),
        offset=(3, 5), blur=7, color=base.R_SHADOW,
    ))
    return clip_card(layer)


def l4_number_fill():
    layer = blank()
    ImageDraw.Draw(layer).rounded_rectangle(base.box((385, 80, 663, 159)), radius=base.xy(18), fill=base.R_LIGHT)
    return clip_card(layer)


def l4_score_fill():
    layer = blank()
    ImageDraw.Draw(layer).ellipse(base.box((540, 945, 668, 1073)), fill=base.R_PANEL)
    return clip_card(layer)


def l4_metric_fill():
    layer = blank()
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle(base.box((55, 1195, 665, 1365)), radius=base.xy(15), fill=base.R_METRIC_FILL)
    for x0, x1 in [(69, 250), (272, 453), (475, 656)]:
        d.rounded_rectangle(base.box((x0, 1212, x1, 1349)), radius=base.xy(8), fill=base.R_METRIC_CELL)
    return clip_card(layer)


def l4_primary_lines():
    layer = blank()
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle(base.box((10, 6, 710, 1414)), radius=base.xy(34), outline=base.R_LINE, width=base.xy(2.2))
    d.rounded_rectangle(base.box((54, 80, 666, 914)), radius=base.xy(31), outline=base.R_LINE, width=base.xy(2.2))
    d.rounded_rectangle(base.box((385, 80, 663, 159)), radius=base.xy(18), outline=base.R_LINE, width=base.xy(2))
    d.ellipse(base.box((540, 945, 668, 1073)), outline=base.R_LINE, width=base.xy(2))
    d.rounded_rectangle(base.box((55, 1195, 665, 1365)), radius=base.xy(15), outline=base.R_LINE, width=base.xy(2))
    d.rounded_rectangle(base.box((47, 72, 673, 923)), radius=base.xy(37), outline=base.R_DEEP, width=base.xy(4))
    return clip_card(layer)


def l4_gold_lines():
    layer = blank()
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle(base.box((18, 14, 702, 1406)), radius=base.xy(29), outline=base.R_GOLD, width=base.xy(1.4))
    base.draw_rounded_outline_without_bottom(d, (41, 37, 679, 1383), 18, semi(base.R_GOLD, 210), 1)
    d.rounded_rectangle(base.box((50, 75, 670, 925)), radius=base.xy(35), outline=base.R_GOLD, width=base.xy(1.4))
    d.rounded_rectangle(base.box((394, 89, 654, 150)), radius=base.xy(12), outline=base.R_GOLD, width=base.xy(1))
    d.ellipse(base.box((548, 953, 660, 1065)), outline=base.R_GOLD, width=base.xy(2))
    base.line(d, [(104, 1057), (519, 1057)], base.R_GOLD, 1.2)
    d.ellipse(base.box((355, 1053, 365, 1063)), fill=base.R_PANEL, outline=base.R_GOLD, width=base.xy(1))
    d.rounded_rectangle(base.box((63, 1203, 657, 1357)), radius=base.xy(10), outline=base.R_GOLD, width=base.xy(1.4))
    for x in (258, 461):
        d.ellipse(base.box((x - 3, 1205, x + 5, 1213)), fill=base.R_PANEL, outline=base.R_GOLD, width=base.xy(1))
        d.ellipse(base.box((x - 2, 1349, x + 4, 1355)), fill=base.R_PANEL, outline=base.R_GOLD, width=base.xy(1))
    for x0, x1 in [(69, 250), (272, 453), (475, 656)]:
        d.ellipse(base.box((x0 + 8, 1220, x0 + 12, 1224)), fill=base.R_GOLD)
        d.ellipse(base.box((x1 - 12, 1220, x1 - 8, 1224)), fill=base.R_GOLD)
    return clip_card(layer)


def l4_deep_lines():
    layer = blank()
    d = ImageDraw.Draw(layer)
    base.line(d, [(689, 82), (689, 1335)], base.R_DEEP, 1.5)
    base.line(d, [(79, 910), (626, 910)], base.R_DEEP, 1.1)
    base.line(d, [(660, 116), (660, 858)], base.R_DEEP, 1.1)
    for x0, x1 in [(69, 250), (272, 453), (475, 656)]:
        base.line(d, [(x0 + 13, 1343), (x1 - 13, 1343)], base.R_DEEP, 0.9)
    for x in (258, 461):
        base.line(d, [(x, 1210), (x, 1352)], base.R_DEEP, 1.2)
    # Window-corner inset shadow strokes, kept separate from the pale catches.
    for x, y, sx, sy in [(69, 94, 1, 1), (651, 94, -1, 1), (69, 900, 1, -1), (651, 900, -1, -1)]:
        base.line(d, [(x + sx * 10, y + sy * 7), (x + sx * 34, y + sy * 7)], base.R_DEEP, 1.0)
        base.line(d, [(x + sx * 7, y + sy * 10), (x + sx * 7, y + sy * 34)], base.R_DEEP, 1.0)
    return clip_card(layer)


def l4_highlight_lines():
    layer = blank()
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle(base.box((29, 25, 691, 1395)), radius=base.xy(22), outline=base.R_HIGHLIGHT, width=base.xy(2))
    base.line(d, [(61, 31), (650, 31)], (255, 255, 244, 150), 2.2)
    base.line(d, [(31, 78), (31, 1335)], (255, 255, 244, 120), 2.0)
    d.rounded_rectangle(base.box((49, 74, 671, 921)), radius=base.xy(36), outline=base.R_HIGHLIGHT, width=base.xy(3))
    d.rounded_rectangle(base.box((59, 85, 661, 909)), radius=base.xy(27), outline=(255, 255, 249, 118), width=base.xy(1.2))
    base.line(d, [(78, 84), (626, 84)], (255, 255, 247, 155), 2.0)
    base.line(d, [(60, 116), (60, 858)], (255, 255, 247, 125), 1.6)
    base.line(d, [(409, 91), (618, 91)], (255, 255, 250, 155), 1.5)
    d.ellipse(base.box((556, 961, 652, 1057)), outline=base.R_HIGHLIGHT, width=base.xy(2))
    d.arc(base.box((548, 953, 660, 1065)), start=195, end=305, fill=(255, 255, 250, 185), width=base.xy(2))
    d.rounded_rectangle(base.box((67, 1207, 653, 1353)), radius=base.xy(7), outline=(255, 255, 248, 105), width=base.xy(1))
    for x0, x1 in [(69, 250), (272, 453), (475, 656)]:
        d.rounded_rectangle(base.box((x0, 1212, x1, 1349)), radius=base.xy(8), outline=base.R_HIGHLIGHT, width=base.xy(1.1))
        base.line(d, [(x0 + 12, 1218), (x1 - 12, 1218)], (255, 255, 247, 145), 1.3)
    for x in (258, 461):
        base.line(d, [(x + 2, 1210), (x + 2, 1352)], (255, 255, 249, 135), 1.0)
    # Pale half of each photo-corner fitting mark.
    for x, y, sx, sy in [(69, 94, 1, 1), (651, 94, -1, 1), (69, 900, 1, -1), (651, 900, -1, -1)]:
        base.line(d, [(x + sx * 5, y), (x + sx * 43, y)], (255, 255, 249, 155), 2.0)
        base.line(d, [(x, y + sy * 5), (x, y + sy * 43)], (255, 255, 249, 155), 2.0)
        base.line(d, [(x + sx * 10, y + sy * 7), (x + sx * 34, y + sy * 7)], (255, 255, 249, 155), 2.0)
        base.line(d, [(x + sx * 7, y + sy * 10), (x + sx * 7, y + sy * 34)], (255, 255, 249, 155), 1.5)
    for cx, cy, r in [(67, 1214, 4), (653, 1214, 4), (67, 1347, 3), (653, 1347, 3)]:
        base.sparkle(d, cx, cy, r, (255, 255, 246, 135), 0.8)
    base.sparkle(d, 235, 43, 7, (255, 255, 242, 145), 1.1)
    base.sparkle(d, 676, 50, 5, (255, 255, 242, 125), 1.0)
    base.sparkle(d, 646, 116, 3.5, (255, 255, 247, 135), 0.8)
    return clip_card(layer)


def l4_gold_corner_points():
    layer = blank()
    d = ImageDraw.Draw(layer)
    for x, y, sx, sy in [(69, 94, 1, 1), (651, 94, -1, 1), (69, 900, 1, -1), (651, 900, -1, -1)]:
        d.polygon(base.points([
            (x + sx * 2, y),
            (x + sx * 6, y + sy * 4),
            (x + sx * 2, y + sy * 8),
            (x - sx * 2, y + sy * 4),
        ]), fill=base.R_GOLD)
    return clip_card(layer)


def l4_decor_color():
    layer = blank()
    d = ImageDraw.Draw(layer)
    base.draw_flower(d, 206, 50, 1.05)
    base.draw_flower(d, 68, 971, 0.72)
    base.draw_flower(d, 653, 971, -0.72)
    base.draw_flower(d, 71, 1176, 0.62)
    base.draw_flower(d, 651, 1176, -0.62)
    base.draw_micro_motif(d)
    return clip_card(layer)


def l4_icons():
    layer = blank()
    d = ImageDraw.Draw(layer)
    base.draw_cat_icon(d, 103, 1284, base.R_ICON)
    base.draw_eye_icon(d, 306, 1284, base.R_ICON)
    base.draw_moon_icon(d, 509, 1284, base.R_ICON)
    return clip_card(layer)


def l4_static_number_prefix():
    layer = blank()
    base.centered(ImageDraw.Draw(layer), (420, 119), "No.", base.font(base.BASKERVILLE, 18), base.R_INK)
    return clip_card(layer)


def l4_static_score_title():
    layer = blank()
    base.centered(ImageDraw.Draw(layer), (604, 982), "MIKA", base.font(base.BASKERVILLE, 16), base.R_INK)
    return clip_card(layer)


def text_component(draw_fn):
    layer = blank()
    draw_fn(ImageDraw.Draw(layer))
    return clip_card(layer)


def l5_number_value():
    return text_component(lambda d: base.centered(d, (537, 119), "MK-260903-000013", base.font(base.BASKERVILLE, 23), base.R_INK))


def l5_pet_name():
    return text_component(lambda d: base.left_aligned(d, 104, 978, "桃桃晒太阳", base.font(base.SONGTI, 45), base.R_INK))


def l5_copy_line_one():
    return text_component(lambda d: base.left_aligned(d, 104, 1097, "午后的阳光刚刚好，", base.font(base.SONGTI, 22), base.R_INK))


def l5_copy_line_two():
    return text_component(lambda d: base.left_aligned(d, 104, 1136, "遇见一只安静的猫。", base.font(base.SONGTI, 22), base.R_INK))


def l5_score():
    return text_component(lambda d: base.centered(d, (604, 1026), "100", base.font(base.BASKERVILLE, 45), base.R_INK))


def l5_metric_value(x):
    return text_component(lambda d: base.centered(d, (x, 1284), "100", base.font(base.BASKERVILLE, 32), base.R_INK))


def register(components, group, slug, display_name, layer, role, kind="card"):
    filename = f"{slug}.png"
    save_layer(layer, filename, kind=kind)
    item = {
        "group": group,
        "slug": slug,
        "file": filename,
        "name": display_name,
        "role": role,
        "kind": kind,
        "visible_by_default": True,
        "layer_contract": "editable-raster-component",
        "path_source": "editable-vector-paths/vector-path-specs.jsxinc" if group in {"L1", "L4A", "L4"} else None,
        "layer": layer,
    }
    components.append(item)
    return item


def main():
    components = []

    # Components are registered bottom-to-top. The Photoshop builder reverses
    # each group when placing them so the visible layer stack is explicit.
    register(components, "L1", "L1-01-outer-gradient-C", "L1-01｜外框渐变底色｜C", l1_outer_gradient(), "outer frame color")
    register(components, "L1", "L1-02-shell-inner-C", "L1-02｜内壳底色｜C", l1_shell_inner_color(), "inner shell color")
    register(components, "L1", "L1-03-surface-C", "L1-03｜内侧纸面底色｜C", l1_surface_color(), "paper surface color")
    register(components, "L1", "L1-04-panel-C", "L1-04｜信息区底色｜C", l1_panel_color(), "information panel color")
    register(components, "L1", "L1-05-panel-inner-C", "L1-05｜信息区内底色｜C", l1_panel_inner_color(), "information panel inner color")
    register(components, "L1", "L1-06-photo-shadow-C", "L1-06｜主图槽位阴影｜C", l1_photo_shadow(), "photo recess shadow")
    register(components, "L1", "L1-07-paper-highlight-C", "L1-07｜纸张高光与纹理｜C", l1_paper_highlight(), "paper highlight")

    l2 = base.make_l2()
    register(components, "L2", "L2-background-replaceable-C", "L2｜背景图｜可替换", l2, "replaceable background", kind="photo")
    l3 = base.make_l3()
    register(components, "L3", "L3-cat-slot-placeholder-C", "L3｜猫主体占位｜可替换透明 PNG", l3, "replaceable cat subject", kind="photo")

    register(components, "L4", "L4-01-shadows-C", "L4-01｜浮雕阴影色｜固定", l4_shadows(), "fixed shadow color")
    register(components, "L4", "L4-02-number-fill-C", "L4-02｜编号牌底色｜固定", l4_number_fill(), "number plaque fill")
    register(components, "L4", "L4-03-score-fill-C", "L4-03｜咪咔徽章底色｜固定", l4_score_fill(), "score seal fill")
    register(components, "L4", "L4-04-metric-fill-C", "L4-04｜指标模块底色｜固定", l4_metric_fill(), "metric module fill")
    register(components, "L4", "L4-05-primary-lines-C", "L4-05｜主边线｜C色", l4_primary_lines(), "primary line color")
    register(components, "L4", "L4-06-gold-lines-C", "L4-06｜金色线与铆点｜C色", l4_gold_lines(), "gold line color")
    register(components, "L4", "L4-07-deep-lines-C", "L4-07｜内侧深线｜C色", l4_deep_lines(), "deep line color")
    register(components, "L4", "L4-08-highlight-lines-C", "L4-08｜高光线｜固定", l4_highlight_lines(), "highlight line color")
    register(components, "L4", "L4-09-gold-corner-points-C", "L4-09｜窗口金色定位点｜固定", l4_gold_corner_points(), "window fitting points")
    register(components, "L4", "L4-10-decor-color-C", "L4-10｜叶片装饰色｜C色", l4_decor_color(), "fixed decorative color")
    register(components, "L4", "L4-11-icons-C", "L4-11｜三项指标图标线｜C色", l4_icons(), "metric icon lines")
    register(components, "L4", "L4-12-number-prefix-C", "L4-12｜固定文字 No.｜可替换编号值", l4_static_number_prefix(), "static number prefix")
    register(components, "L4", "L4-13-score-title-C", "L4-13｜固定文字 MIKA｜固定", l4_static_score_title(), "static score title")

    register(components, "L4A", "L4A-01-label-shadow-C", "L4A-01｜等级标签阴影色｜C", label_shadow(), "label shadow")
    register(components, "L4A", "L4A-02-label-fill-C", "L4A-02｜等级标签底色渐变｜C", label_fill(), "label fill")
    register(components, "L4A", "L4A-03-label-primary-line-C", "L4A-03｜等级标签主边线｜C", label_primary_line(), "label primary line")
    register(components, "L4A", "L4A-04-label-highlight-line-C", "L4A-04｜等级标签内高光线｜C", label_highlight_line(), "label highlight line")
    register(components, "L4A", "L4A-05-label-gold-detail-C", "L4A-05｜等级标签金色细节｜C", label_gold_detail(), "label gold detail")
    register(components, "L4A", "L4A-06-label-letter-C", "L4A-06｜等级字母 C｜可替换", label_letter(), "label letter")

    register(components, "L5", "L5-01-number-value-C", "L5-01｜动态编号值｜Canvas 替换", l5_number_value(), "dynamic number value")
    register(components, "L5", "L5-02-pet-name-C", "L5-02｜动态宠物名｜最多5字｜左对齐", l5_pet_name(), "dynamic pet name")
    register(components, "L5", "L5-03-copy-line-one-C", "L5-03｜动态文案第一行｜左对齐", l5_copy_line_one(), "dynamic copy line 1")
    register(components, "L5", "L5-04-copy-line-two-C", "L5-04｜动态文案第二行｜左对齐", l5_copy_line_two(), "dynamic copy line 2")
    register(components, "L5", "L5-05-score-C", "L5-05｜动态咪咔分数｜0-100", l5_score(), "dynamic score")
    register(components, "L5", "L5-06-charm-C", "L5-06｜动态魅力分数｜0-100", l5_metric_value(194), "dynamic charm")
    register(components, "L5", "L5-07-clever-C", "L5-07｜动态机灵分数｜0-100", l5_metric_value(397), "dynamic clever")
    register(components, "L5", "L5-08-aura-C", "L5-08｜动态灵气分数｜0-100", l5_metric_value(600), "dynamic aura")

    by_group = {group: [] for group in ["L1", "L2", "L3", "L4", "L4A", "L5"]}
    for item in components:
        by_group[item["group"]].append(item)

    # Composite fallbacks remain available, but the PSD imports only the
    # individual components above.
    for group, filename in [("L1", "L1-fixed-frame-C-composite.png"), ("L4", "L4-fixed-decor-C-composite.png"), ("L4A", "L4-rarity-label-C-composite.png"), ("L5", "L5-demo-fields-100-placeholder-C-composite.png")]:
        composite = blank()
        for item in by_group[group]:
            composite.alpha_composite(item["layer"])
        save_layer(composite, filename)

    label_composite = blank()
    for item in by_group["L4A"]:
        label_composite.alpha_composite(item["layer"])
    crop_label_standalone(label_composite, "L4-rarity-label-C-standalone.png")

    fixed = blank()
    for item in components:
        if item["group"] in {"L1", "L4", "L4A"}:
            fixed.alpha_composite(item["layer"])
    save_layer(fixed, "C-master-fixed-transparent-v0-9.png")

    with_demo = blank()
    for item in components:
        if item["group"] in {"L1", "L2", "L3", "L4", "L4A", "L5"}:
            with_demo.alpha_composite(item["layer"])
    save_layer(with_demo, "C-master-preview-v0-9-layered-with-demo.png")

    manifest = {
        "version": "0.9",
        "rarity": "C",
        "canvas": {"width": base.W, "height": base.H, "color": "RGBA"},
        "layer_order": "bottom_to_top",
        "groups": ["L1", "L2", "L3", "L4", "L4A", "L5"],
        "fixed_geometry": {
            "card": [10, 6, 710, 1414],
            "photo": [54, 80, 666, 914],
            "number_plaque": [385, 80, 663, 159],
            "information_panel": [55, 914, 665, 1385],
            "score_seal_center": [604, 1009],
            "metrics": [55, 1195, 665, 1365],
        },
        "components": [
            {key: value for key, value in item.items() if key != "layer"}
            for item in components
        ],
        "notes": [
            "L1 fixed colors are transparent through the photo aperture.",
            "L2 and L3 are replaceable image layers and are clipped to the photo aperture.",
            "L4A is independently replaceable and stays above L4 fixed decor.",
            "No extra inner bottom rail is exported.",
            "L5 text is split by field; Photoshop also receives editable text layers.",
        ],
    }
    (OUT / "C-layer-manifest-v0-9.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(OUT / "C-master-preview-v0-9-layered-with-demo.png")


if __name__ == "__main__":
    main()
