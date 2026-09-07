from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops


ROOT = Path(__file__).resolve().parent
ASSET_ROOT = ROOT.parent
BG_PATH = ASSET_ROOT / "card-template-v5" / "backgrounds" / "r-street-teashop-bg-v1.png"
OUT = ROOT / "r-master-layers-v0-8"
OUT.mkdir(parents=True, exist_ok=True)

W, H = 720, 1420
S = 3
SW, SH = W * S, H * S

R_INK = (112, 57, 17, 255)
R_LINE = (193, 112, 26, 255)
R_GOLD = (238, 176, 72, 255)
R_LIGHT = (255, 247, 224, 255)
R_PANEL = (255, 242, 207, 255)
R_HIGHLIGHT = (255, 252, 238, 255)
R_OUTER_TOP = (251, 225, 162, 255)
R_OUTER_BOTTOM = (244, 187, 72, 255)
R_SHELL_INNER = (255, 232, 171, 255)
R_SURFACE = (255, 246, 215, 255)
R_PANEL_INNER = (255, 245, 217, 255)
R_METRIC_FILL = (255, 247, 224, 92)
R_METRIC_CELL = (255, 255, 255, 28)
R_ICON = R_LINE
R_FLOWER = (206, 139, 50, 145)
R_DEEP = (180, 94, 19, 120)
R_SHADOW = (99, 48, 10, 55)
R_PHOTO_SHADOW = (111, 55, 13, 42)
R_OVERLAY = (255, 215, 142, 26)
R_LETTER = "R"
R_MOTIF = "spark"

SONGTI = "/System/Library/Fonts/Supplemental/Songti.ttc"
HEITI = "/System/Library/Fonts/STHeiti Medium.ttc"
BASKERVILLE = "/System/Library/Fonts/Supplemental/Baskerville.ttc"


def set_palette(palette):
    """Switch the shared geometry to one rarity skin without changing layout."""
    global R_INK, R_LINE, R_GOLD, R_LIGHT, R_PANEL, R_HIGHLIGHT
    global R_OUTER_TOP, R_OUTER_BOTTOM, R_SHELL_INNER, R_SURFACE, R_PANEL_INNER
    global R_METRIC_FILL, R_METRIC_CELL, R_ICON, R_FLOWER, R_DEEP, R_SHADOW, R_PHOTO_SHADOW, R_OVERLAY, R_LETTER, R_MOTIF
    R_INK = palette["ink"]
    R_LINE = palette["line"]
    R_GOLD = palette["gold"]
    R_LIGHT = palette["light"]
    R_PANEL = palette["panel"]
    R_HIGHLIGHT = palette["highlight"]
    R_OUTER_TOP = palette["outer_top"]
    R_OUTER_BOTTOM = palette["outer_bottom"]
    R_SHELL_INNER = palette["shell_inner"]
    R_SURFACE = palette["surface"]
    R_PANEL_INNER = palette["panel_inner"]
    R_METRIC_FILL = palette["metric_fill"]
    R_METRIC_CELL = palette.get("metric_cell", (255, 255, 255, 28))
    R_ICON = palette.get("icon", R_LINE)
    R_FLOWER = palette["flower"]
    R_DEEP = palette["deep"]
    R_SHADOW = palette["shadow"]
    R_PHOTO_SHADOW = palette["photo_shadow"]
    R_OVERLAY = palette["overlay"]
    R_LETTER = palette.get("letter", "R")
    R_MOTIF = palette.get("motif", "spark")


def font(path: str, size: int, index: int = 0):
    return ImageFont.truetype(path, max(1, int(size * S)), index=index)


def xy(v):
    return int(round(v * S))


def box(b):
    return tuple(xy(v) for v in b)


def points(ps):
    return [(xy(x), xy(y)) for x, y in ps]


def rgba_gradient(size, top, bottom):
    image = Image.new("RGBA", size)
    px = image.load()
    for y in range(size[1]):
        t = y / max(1, size[1] - 1)
        c = tuple(round(top[i] * (1 - t) + bottom[i] * t) for i in range(4))
        for x in range(size[0]):
            px[x, y] = c
    return image


def rounded_mask(b, radius):
    m = Image.new("L", (SW, SH), 0)
    ImageDraw.Draw(m).rounded_rectangle(box(b), radius=xy(radius), fill=255)
    return m


def rounded_gradient(b, radius, top, bottom):
    layer = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    fill = rgba_gradient((SW, SH), top, bottom)
    layer.paste(fill, (0, 0), rounded_mask(b, radius))
    return layer


def polygon_gradient(layer, polygon, top, bottom):
    """Fill a polygon with a restrained vertical gradient on the large canvas."""
    mask = Image.new("L", (SW, SH), 0)
    ImageDraw.Draw(mask).polygon(points(polygon), fill=255)
    layer.paste(rgba_gradient((SW, SH), top, bottom), (0, 0), mask)


def clip_alpha(layer, mask):
    """Hard-clip a generated layer to its contract boundary."""
    alpha = ImageChops.multiply(layer.getchannel("A"), mask)
    layer.putalpha(alpha)
    return layer


def card_clip():
    return rounded_mask((10, 6, 710, 1414), 34)


def photo_clip():
    return rounded_mask((54, 80, 666, 914), 31)


def final_mask(kind):
    """Final-size hard contract used after downsampling to stop edge bleed."""
    m = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(m)
    if kind == "photo":
        d.rounded_rectangle((54, 80, 666, 914), radius=31, fill=255)
    else:
        d.rounded_rectangle((10, 6, 710, 1414), radius=34, fill=255)
    return m


def final_clip(image, kind="card"):
    image.putalpha(ImageChops.multiply(image.getchannel("A"), final_mask(kind)))
    return image


def line(draw, coords, fill=R_LINE, width=2):
    draw.line(points(coords), fill=fill, width=xy(width), joint="curve")


def centered(draw, xy_center, text, fnt, fill=R_INK):
    b = draw.textbbox((0, 0), text, font=fnt)
    x = xy(xy_center[0]) - (b[2] - b[0]) // 2
    y = xy(xy_center[1]) - (b[3] - b[1]) // 2 - b[1]
    draw.text((x, y), text, font=fnt, fill=fill)


def left_aligned(draw, x_left, y_center, text, fnt, fill=R_INK):
    """Draw text from a locked left edge while keeping its vertical center."""
    b = draw.textbbox((0, 0), text, font=fnt)
    x = xy(x_left) - b[0]
    y = xy(y_center) - (b[3] - b[1]) // 2 - b[1]
    draw.text((x, y), text, font=fnt, fill=fill)


def sparkle(draw, cx, cy, radius=7, color=R_HIGHLIGHT, width=1.5):
    """Small foil-like four-point glint used sparingly on the fixed master."""
    line(draw, [(cx, cy - radius), (cx, cy + radius)], color, width)
    line(draw, [(cx - radius, cy), (cx + radius, cy)], color, width)
    line(draw, [(cx - radius * 0.55, cy - radius * 0.55), (cx + radius * 0.55, cy + radius * 0.55)], color, width * 0.7)
    line(draw, [(cx + radius * 0.55, cy - radius * 0.55), (cx - radius * 0.55, cy + radius * 0.55)], color, width * 0.7)
    draw.ellipse(box((cx - 1.5, cy - 1.5, cx + 1.5, cy + 1.5)), fill=color)


def soft_highlight(b, radius, color=(255, 255, 255, 42)):
    """A feathered highlight wash for paper/foil depth, kept inside a rounded region."""
    glow = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.rounded_rectangle(box(b), radius=xy(radius), fill=color)
    glow = glow.filter(ImageFilter.GaussianBlur(xy(10)))
    mask = rounded_mask(b, radius)
    glow.putalpha(Image.composite(glow.getchannel("A"), Image.new("L", (SW, SH), 0), mask))
    return glow


def soft_shape_shadow(draw_fn, offset=(4, 6), blur=8, color=(99, 48, 10, 55)):
    """Render a soft offset shadow for a raised fixed ornament."""
    shadow = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    draw_fn(sd, offset[0], offset[1], color)
    shadow = shadow.filter(ImageFilter.GaussianBlur(xy(blur)))
    return shadow


def make_l1():
    layer = rounded_gradient((10, 6, 710, 1414), 34, R_OUTER_TOP, R_OUTER_BOTTOM)
    d = ImageDraw.Draw(layer)

    # Large light inner surface leaves a warm R edge visible on all four sides.
    d.rounded_rectangle(box((22, 18, 698, 1402)), radius=xy(28), fill=R_SHELL_INNER)
    d.rounded_rectangle(box((34, 30, 686, 1390)), radius=xy(22), fill=R_SURFACE)

    # The information panel is part of the fixed frame, not part of the photo.
    d.rectangle(box((55, 914, 665, 1385)), fill=R_PANEL)
    d.rectangle(box((58, 925, 662, 1383)), fill=R_PANEL_INNER)

    # Subtle paper/foil sheen: broad enough to read at mobile size, quiet enough
    # to keep the generated cat and background as the visual focus.
    layer.alpha_composite(soft_highlight((24, 20, 696, 1398), 25, (255, 255, 244, 30)))
    panel_glow = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    pg = ImageDraw.Draw(panel_glow)
    pg.rounded_rectangle(box((58, 925, 662, 1095)), radius=xy(12), fill=(255, 255, 247, 18))
    pg.line(points([(74, 934), (646, 934)]), fill=(255, 255, 255, 82), width=xy(2))
    panel_glow = panel_glow.filter(ImageFilter.GaussianBlur(xy(3)))
    layer.alpha_composite(panel_glow)

    # Soft paper wash; clipped to the card shell.
    wash = Image.new("RGBA", (SW, SH), (255, 255, 255, 0))
    wd = ImageDraw.Draw(wash)
    for y in range(xy(30), xy(1390), xy(14)):
        alpha = int(6 + 5 * ((y / SH) % 1))
        wd.line([(xy(30), y), (xy(690), y)], fill=(255, 255, 255, alpha), width=xy(5))
    layer.alpha_composite(wash)

    # A faint warm shadow below the photo window makes the later image layer sit in the frame.
    shadow = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle(box((47, 73, 673, 925)), radius=xy(34), fill=R_PHOTO_SHADOW)
    shadow = shadow.filter(ImageFilter.GaussianBlur(xy(7)))
    layer.alpha_composite(shadow)

    # 主图窗口必须是真透明：背景图由 L2 单独提供，不能把米色底误烘焙进固定相框。
    photo_cutout = rounded_mask((54, 80, 666, 914), 31)
    layer.paste((0, 0, 0, 0), (0, 0), photo_cutout)

    return clip_alpha(layer, card_clip())


def make_l2():
    source = Image.open(BG_PATH).convert("RGB")
    iw, ih = xy(612), xy(834)
    scale = max(iw / source.width, ih / source.height)
    nw, nh = round(source.width * scale), round(source.height * scale)
    image = source.resize((nw, nh), Image.Resampling.LANCZOS)
    left = max(0, (nw - iw) // 2)
    top = max(0, (nh - ih) // 2)
    image = image.crop((left, top, left + iw, top + ih)).convert("RGBA")

    # Warm overlay keeps the photograph compatible with the cream/gold frame.
    overlay = Image.new("RGBA", image.size, R_OVERLAY)
    image = Image.alpha_composite(image, overlay)
    layer = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    m = Image.new("L", (SW, SH), 0)
    ImageDraw.Draw(m).rounded_rectangle(box((54, 80, 666, 914)), radius=xy(31), fill=255)
    layer.paste(image, (xy(54), xy(80)), m.crop((xy(54), xy(80), xy(666), xy(914))))
    return clip_alpha(layer, photo_clip())


def make_l3():
    # A deliberately quiet silhouette marks the replaceable transparent-cat slot.
    # It is a design placeholder only; production replaces this whole layer with the AI cat PNG.
    layer = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    fill = (255, 248, 226, 24)
    stroke = (255, 248, 226, 72)
    # Body, head, ears, paws, and tail are simple vector-like guide shapes.
    d.ellipse(box((300, 480, 520, 835)), fill=fill, outline=stroke, width=xy(4))
    d.ellipse(box((315, 350, 490, 535)), fill=fill, outline=stroke, width=xy(4))
    d.polygon(points([(326, 385), (310, 310), (365, 354), (440, 354), (492, 307), (480, 395)]), fill=fill, outline=stroke)
    d.rounded_rectangle(box((335, 748, 392, 862)), radius=xy(18), fill=fill, outline=stroke, width=xy(4))
    d.rounded_rectangle(box((430, 748, 487, 862)), radius=xy(18), fill=fill, outline=stroke, width=xy(4))
    d.arc(box((445, 680, 628, 890)), start=205, end=342, fill=stroke, width=xy(7))
    d.ellipse(box((355, 412, 374, 431)), outline=stroke, width=xy(3))
    d.ellipse(box((431, 412, 450, 431)), outline=stroke, width=xy(3))
    line(d, [(402, 438), (402, 452)], stroke, 3)
    line(d, [(402, 452), (389, 459)], stroke, 3)
    line(d, [(402, 452), (415, 459)], stroke, 3)
    return clip_alpha(layer, photo_clip())


def draw_flower(d, ox, oy, scale=1.0):
    c = R_FLOWER
    mirror = -1 if scale < 0 else 1
    scale = abs(scale)
    def p(x, y): return (ox + mirror * x * scale, oy + y * scale)
    def rect(x0, y0, x1, y1):
        p0, p1 = p(x0, y0), p(x1, y1)
        return (min(p0[0], p1[0]), min(p0[1], p1[1]), max(p0[0], p1[0]), max(p0[1], p1[1]))
    line(d, [p(0, 42), p(18, 22), p(26, 0)], c, 1.4)
    line(d, [p(11, 30), p(-3, 20)], c, 1.2)
    line(d, [p(18, 22), p(38, 18)], c, 1.2)
    d.ellipse(box(rect(22, -8, 32, 2)), outline=c, width=xy(1))
    d.ellipse(box(rect(-10, 13, 1, 27)), outline=c, width=xy(1))


def draw_micro_motif(d):
    """Add a restrained rarity-specific foil detail without changing geometry."""
    if R_MOTIF == "leaf":
        draw_flower(d, 650, 58, -0.82)
        draw_flower(d, 70, 1328, 0.68)
    elif R_MOTIF == "dot":
        for cx, cy, r in [(640, 52, 3), (652, 64, 2), (632, 68, 1.5), (73, 1328, 2.5), (86, 1340, 1.5)]:
            d.ellipse(box((cx - r, cy - r, cx + r, cy + r)), fill=R_FLOWER)
        line(d, [(634, 58), (646, 61), (653, 70)], R_FLOWER, 1)
    elif R_MOTIF == "star":
        sparkle(d, 644, 54, 6, R_GOLD, 1.0)
        sparkle(d, 75, 1328, 4, R_FLOWER, 0.9)
        sparkle(d, 652, 1337, 3, R_FLOWER, 0.8)
    else:  # night / celestial
        for cx, cy, r in [(642, 48, 2), (656, 64, 1.5), (628, 71, 1.2), (76, 1328, 1.8), (88, 1340, 1.2)]:
            d.ellipse(box((cx - r, cy - r, cx + r, cy + r)), fill=R_GOLD)
        d.arc(box((58, 1309, 86, 1337)), start=70, end=295, fill=R_GOLD, width=xy(1.3))
        line(d, [(643, 48), (632, 69), (656, 64)], R_FLOWER, 0.9)


def draw_photo_corner(d, x, y, sx, sy):
    """A restrained double-line fitting mark for the transparent photo slot."""
    # The mark is deliberately inset from the aperture edge so it survives
    # export at small sizes without looking like an extra divider.
    light = (255, 255, 249, 155)
    deep = R_DEEP
    line(d, [(x + sx * 5, y), (x + sx * 43, y)], light, 2.0)
    line(d, [(x, y + sy * 5), (x, y + sy * 43)], light, 2.0)
    line(d, [(x + sx * 10, y + sy * 7), (x + sx * 34, y + sy * 7)], deep, 1.0)
    line(d, [(x + sx * 7, y + sy * 10), (x + sx * 7, y + sy * 34)], deep, 1.0)
    # A tiny diamond/rivet makes the corner feel mechanically seated.
    d.polygon(points([
        (x + sx * 2, y),
        (x + sx * 6, y + sy * 4),
        (x + sx * 2, y + sy * 8),
        (x - sx * 2, y + sy * 4),
    ]), fill=R_GOLD)


def draw_rounded_outline_without_bottom(d, b, radius, fill, width):
    """Draw a rounded outline while intentionally leaving its bottom edge open."""
    x0, y0, x1, y1 = b
    stroke = xy(width)
    d.line(points([(x0 + radius, y0), (x1 - radius, y0)]), fill=fill, width=stroke)
    d.arc(box((x0, y0, x0 + radius * 2, y0 + radius * 2)), 180, 270, fill=fill, width=stroke)
    d.arc(box((x1 - radius * 2, y0, x1, y0 + radius * 2)), 270, 360, fill=fill, width=stroke)
    d.line(points([(x1, y0 + radius), (x1, y1 - radius)]), fill=fill, width=stroke)
    d.arc(box((x1 - radius * 2, y1 - radius * 2, x1, y1)), 0, 90, fill=fill, width=stroke)
    d.arc(box((x0, y1 - radius * 2, x0 + radius * 2, y1)), 90, 180, fill=fill, width=stroke)
    d.line(points([(x0, y1 - radius), (x0, y0 + radius)]), fill=fill, width=stroke)


def draw_rarity_label(layer):
    """Draw the fixed top rarity label as a separately exportable element."""
    d = ImageDraw.Draw(layer)
    badge = [(44, 42), (160, 42), (186, 68), (186, 174), (160, 202), (70, 202), (44, 174), (44, 68)]
    layer.alpha_composite(soft_shape_shadow(
        lambda sd, ox, oy, c: sd.polygon(points([(x + ox, y + oy) for x, y in badge]), fill=c),
        offset=(4, 6), blur=7, color=R_SHADOW
    ))
    polygon_gradient(layer, badge, R_HIGHLIGHT, R_PANEL)
    d.polygon(points(badge), outline=R_LINE, width=xy(2))

    inner = [(52, 51), (153, 51), (176, 75), (176, 168), (153, 193), (76, 193), (52, 168), (52, 75)]
    d.polygon(points(inner), outline=R_HIGHLIGHT, width=xy(3))
    line(d, [(65, 59), (148, 59)], (255, 255, 249, 155), 2.0)
    line(d, [(58, 76), (58, 157)], (255, 255, 249, 120), 1.5)
    line(d, [(76, 193), (153, 193)], R_GOLD, 1.0)
    sparkle(d, 157, 61, 4, (255, 255, 247, 150), 0.9)
    sparkle(d, 70, 184, 2.5, R_GOLD, 0.7)

    letter_size = 52 if len(R_LETTER) > 1 else 64
    centered(d, (115, 117), R_LETTER, font(BASKERVILLE, letter_size), R_INK)


def make_rarity_label():
    layer = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    draw_rarity_label(layer)
    return clip_alpha(layer, card_clip())


def draw_metric_separator(d, x):
    """Raised, two-tone divider shared by all three metric cells."""
    line(d, [(x, 1210), (x, 1352)], R_DEEP, 1.2)
    line(d, [(x + 2, 1210), (x + 2, 1352)], (255, 255, 249, 135), 1.0)
    d.ellipse(box((x - 3, 1205, x + 5, 1213)), fill=R_PANEL, outline=R_GOLD, width=xy(1))
    d.ellipse(box((x - 2, 1349, x + 4, 1355)), fill=R_PANEL, outline=R_GOLD, width=xy(1))


def draw_cat_icon(d, cx, cy, color):
    # 圆润猫脸：耳朵、眼睛、鼻子和胡须统一为同一线宽。
    d.rounded_rectangle(box((cx - 22, cy - 12, cx + 22, cy + 24)), radius=xy(11), outline=color, width=xy(2))
    d.polygon(points([(cx - 22, cy - 4), (cx - 18, cy - 24), (cx - 6, cy - 13)]), outline=color, fill=None, width=xy(2))
    d.polygon(points([(cx + 22, cy - 4), (cx + 18, cy - 24), (cx + 6, cy - 13)]), outline=color, fill=None, width=xy(2))
    d.ellipse(box((cx - 12, cy - 5, cx - 6, cy + 1)), fill=color)
    d.ellipse(box((cx + 6, cy - 5, cx + 12, cy + 1)), fill=color)
    d.polygon(points([(cx, cy + 5), (cx - 4, cy + 2), (cx + 4, cy + 2)]), fill=color)
    line(d, [(cx, cy + 6), (cx - 3, cy + 10)], color, 1.5)
    line(d, [(cx, cy + 6), (cx + 3, cy + 10)], color, 1.5)
    line(d, [(cx - 20, cy + 5), (cx - 37, cy + 1)], color, 1.6)
    line(d, [(cx - 20, cy + 11), (cx - 36, cy + 15)], color, 1.6)
    line(d, [(cx + 20, cy + 5), (cx + 37, cy + 1)], color, 1.6)
    line(d, [(cx + 20, cy + 11), (cx + 36, cy + 15)], color, 1.6)


def draw_eye_icon(d, cx, cy, color):
    upper = [(cx - 35, cy), (cx - 25, cy - 10), (cx - 10, cy - 16), (cx, cy - 18), (cx + 12, cy - 14), (cx + 26, cy - 8), (cx + 35, cy)]
    lower = [(cx - 35, cy), (cx - 25, cy + 10), (cx - 10, cy + 16), (cx, cy + 18), (cx + 12, cy + 14), (cx + 26, cy + 8), (cx + 35, cy)]
    line(d, upper, color, 2)
    line(d, lower, color, 2)
    d.ellipse(box((cx - 13, cy - 13, cx + 13, cy + 13)), outline=color, width=xy(2))
    d.ellipse(box((cx - 4, cy - 4, cx + 4, cy + 4)), fill=color)
    for dx, dy in [(-25, -17), (-14, -22), (14, -22), (25, -17)]:
        line(d, [(cx + dx, cy + dy), (cx + dx + (-3 if dx < 0 else 3), cy + dy - 7)], color, 1.5)


def draw_moon_icon(d, cx, cy, color):
    # 完整月牙与两枚星点，避免月牙尾部压到旁边的分数。
    d.arc(box((cx - 25, cy - 25, cx + 25, cy + 25)), start=48, end=312, fill=color, width=xy(3))
    d.arc(box((cx - 3, cy - 25, cx + 35, cy + 23)), start=98, end=262, fill=color, width=xy(2))
    d.ellipse(box((cx + 29, cy - 20, cx + 33, cy - 16)), fill=color)
    d.ellipse(box((cx + 37, cy - 5, cx + 41, cy - 1)), fill=color)
    line(d, [(cx + 27, cy + 16), (cx + 27, cy + 26)], color, 1.4)
    line(d, [(cx + 22, cy + 21), (cx + 32, cy + 21)], color, 1.4)


def make_l4():
    layer = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    # Shared R frame lines.
    for b, r, color, width in [
        ((10, 6, 710, 1414), 34, R_LINE, 2.2),
        ((18, 14, 702, 1406), 29, R_GOLD, 1.4),
        ((29, 25, 691, 1395), 22, R_HIGHLIGHT, 2),
    ]:
        d.rounded_rectangle(box(b), radius=xy(r), outline=color, width=xy(width))
    # The fourth inner rail stops before the bottom edge by design; this is the
    # line that previously appeared as an unwanted extra bar in the master.
    draw_rounded_outline_without_bottom(d, (41, 37, 679, 1383), 18, (218, 147, 43, 210), 1)

    # Bevel highlights: the upper/left edges catch light; the lower/right edges
    # retain a warmer, slightly deeper line so the frame reads as a physical card.
    line(d, [(61, 31), (650, 31)], (255, 255, 244, 150), 2.2)
    line(d, [(31, 78), (31, 1335)], (255, 255, 244, 120), 2.0)
    line(d, [(689, 82), (689, 1335)], R_DEEP, 1.5)
    sparkle(d, 235, 43, 7, (255, 255, 242, 145), 1.1)
    sparkle(d, 676, 50, 5, (255, 255, 242, 125), 1.0)

    # Photo window border and the seam to the information panel. The slot is
    # transparent, so these are the fixed mounting layers that remain visible
    # after L2/L3 are replaced by the generated background and cat.
    d.rounded_rectangle(box((47, 72, 673, 923)), radius=xy(37), outline=R_DEEP, width=xy(4))
    d.rounded_rectangle(box((49, 74, 671, 921)), radius=xy(36), outline=R_HIGHLIGHT, width=xy(3))
    d.rounded_rectangle(box((50, 75, 670, 925)), radius=xy(35), outline=R_GOLD, width=xy(1.4))
    d.rounded_rectangle(box((54, 80, 666, 914)), radius=xy(31), outline=R_LINE, width=xy(2.2))
    d.rounded_rectangle(box((59, 85, 661, 909)), radius=xy(27), outline=(255, 255, 249, 118), width=xy(1.2))

    # Two narrow bevel highlights make the generated image read as an inserted
    # print rather than a flat rectangle, while preserving the transparent hole.
    line(d, [(78, 84), (626, 84)], (255, 255, 247, 155), 2.0)
    line(d, [(60, 116), (60, 858)], (255, 255, 247, 125), 1.6)
    line(d, [(79, 910), (626, 910)], R_DEEP, 1.1)
    line(d, [(660, 116), (660, 858)], R_DEEP, 1.1)

    # Matching fitted corners: these replace the loose L-shaped marks with a
    # consistent four-corner mounting detail.
    draw_photo_corner(d, 69, 94, 1, 1)
    draw_photo_corner(d, 651, 94, -1, 1)
    draw_photo_corner(d, 69, 900, 1, -1)
    draw_photo_corner(d, 651, 900, -1, -1)
    sparkle(d, 646, 116, 3.5, (255, 255, 247, 135), 0.8)
    # 不额外绘制横向分隔线；主图区自己的多层圆角边框就是唯一边界。

    # The rarity label is exported as its own fixed layer so it can be reused
    # independently without changing the locked card coordinates.
    draw_flower(d, 206, 50, 1.05)
    draw_micro_motif(d)

    # Number plaque base.
    layer.alpha_composite(soft_shape_shadow(
        lambda sd, ox, oy, c: sd.rounded_rectangle(box((385 + ox, 80 + oy, 663 + ox, 159 + oy)), radius=xy(18), fill=c),
        offset=(3, 5), blur=6, color=R_SHADOW
    ))
    d.rounded_rectangle(box((385, 80, 663, 159)), radius=xy(18), fill=R_LIGHT, outline=R_LINE, width=xy(2))
    d.rounded_rectangle(box((394, 89, 654, 150)), radius=xy(12), outline=R_GOLD, width=xy(1))
    line(d, [(409, 91), (618, 91)], (255, 255, 250, 155), 1.5)
    sparkle(d, 645, 100, 3.5, (255, 255, 245, 135), 0.8)
    centered(d, (420, 119), "No.", font(BASKERVILLE, 18), R_INK)

    # MIKA score base.
    layer.alpha_composite(soft_shape_shadow(
        lambda sd, ox, oy, c: sd.ellipse(box((540 + ox, 945 + oy, 668 + ox, 1073 + oy)), fill=c),
        offset=(4, 6), blur=7, color=R_SHADOW
    ))
    d.ellipse(box((540, 945, 668, 1073)), fill=R_PANEL, outline=R_LINE, width=xy(2))
    d.ellipse(box((548, 953, 660, 1065)), outline=R_GOLD, width=xy(2))
    d.ellipse(box((556, 961, 652, 1057)), outline=R_HIGHLIGHT, width=xy(2))
    d.arc(box((548, 953, 660, 1065)), start=195, end=305, fill=(255, 255, 250, 185), width=xy(2))
    sparkle(d, 647, 977, 4, (255, 255, 247, 145), 0.9)
    centered(d, (604, 982), "MIKA", font(BASKERVILLE, 16), R_INK)

    # Decorative name/copy dividers.
    line(d, [(104, 1057), (519, 1057)], R_GOLD, 1.2)
    d.ellipse(box((355, 1053, 365, 1063)), fill=R_PANEL, outline=R_GOLD, width=xy(1))
    draw_flower(d, 68, 971, 0.72)
    draw_flower(d, 653, 971, -0.72)
    draw_flower(d, 71, 1176, 0.62)
    draw_flower(d, 651, 1176, -0.62)

    # Three metric cells; identical geometry is used by every rarity skin later.
    layer.alpha_composite(soft_shape_shadow(
        lambda sd, ox, oy, c: sd.rounded_rectangle(box((55 + ox, 1195 + oy, 665 + ox, 1365 + oy)), radius=xy(15), fill=c),
        offset=(3, 5), blur=7, color=R_SHADOW
    ))
    d.rounded_rectangle(box((55, 1195, 665, 1365)), radius=xy(15), fill=R_METRIC_FILL, outline=R_LINE, width=xy(2))
    d.rounded_rectangle(box((63, 1203, 657, 1357)), radius=xy(10), outline=R_GOLD, width=xy(1.4))
    d.rounded_rectangle(box((67, 1207, 653, 1353)), radius=xy(7), outline=(255, 255, 248, 105), width=xy(1))
    for x0, x1 in [(69, 250), (272, 453), (475, 656)]:
        # Each cell has its own inset, top foil catch and lower grounding line.
        d.rounded_rectangle(box((x0, 1212, x1, 1349)), radius=xy(8), fill=R_METRIC_CELL, outline=R_HIGHLIGHT, width=xy(1.1))
        line(d, [(x0 + 12, 1218), (x1 - 12, 1218)], (255, 255, 247, 145), 1.3)
        line(d, [(x0 + 13, 1343), (x1 - 13, 1343)], R_DEEP, 0.9)
        d.ellipse(box((x0 + 8, 1220, x0 + 12, 1224)), fill=R_GOLD)
        d.ellipse(box((x1 - 12, 1220, x1 - 8, 1224)), fill=R_GOLD)
    line(d, [(77, 1208), (242, 1208)], (255, 255, 247, 150), 1.6)
    line(d, [(280, 1208), (445, 1208)], (255, 255, 247, 150), 1.6)
    line(d, [(483, 1208), (648, 1208)], (255, 255, 247, 150), 1.6)
    draw_metric_separator(d, 258)
    draw_metric_separator(d, 461)
    # Tiny corner foil points make the lower module feel pressed into the card,
    # without adding any dynamic content to the fixed master.
    for cx, cy, r in [(67, 1214, 4), (653, 1214, 4), (67, 1347, 3), (653, 1347, 3)]:
        sparkle(d, cx, cy, r, (255, 255, 246, 135), 0.8)
    # 图标与数值横向排列，三格统一垂直基线，避免任何重叠。
    draw_cat_icon(d, 103, 1284, R_ICON)
    draw_eye_icon(d, 306, 1284, R_ICON)
    draw_moon_icon(d, 509, 1284, R_ICON)
    return clip_alpha(layer, card_clip())


def make_l5():
    layer = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    title = font(SONGTI, 45)
    copy = font(SONGTI, 22)
    small = font(SONGTI, 16)
    number = font(BASKERVILLE, 23)
    score = font(BASKERVILLE, 45)
    mika = font(BASKERVILLE, 16)
    value = font(BASKERVILLE, 32)
    centered(d, (537, 119), "MK-260903-000013", number, R_INK)
    # The name and copy share one left edge so the information block reads as
    # a stable text column beside the score seal. The x-coordinate matches the
    # left end of the decorative name divider and is fixed for Canvas output.
    left_aligned(d, 104, 978, "桃桃晒太阳", title, R_INK)
    centered(d, (604, 1026), "100", score, R_INK)
    left_aligned(d, 104, 1097, "午后的阳光刚刚好，", copy, R_INK)
    left_aligned(d, 104, 1136, "遇见一只安静的猫。", copy, R_INK)
    centered(d, (194, 1284), "100", value, R_INK)
    centered(d, (397, 1284), "100", value, R_INK)
    centered(d, (600, 1284), "100", value, R_INK)

    return clip_alpha(layer, card_clip())


def save(layer, name):
    image = layer.resize((W, H), Image.Resampling.LANCZOS)
    kind = "photo" if name.startswith("L2-") or name.startswith("L3-") else "card"
    final_clip(image, kind)
    image.save(OUT / name, "PNG")


def make_preview(layers, filename, checkerboard=False):
    art = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    for layer in layers:
        art.alpha_composite(layer)
    art = final_clip(art.resize((W, H), Image.Resampling.LANCZOS), "card")
    if checkerboard:
        out = Image.new("RGBA", (W, H), (247, 247, 247, 255))
        cd = ImageDraw.Draw(out)
        step = 18
        for yy in range(0, H, step):
            for xx in range(0, W, step):
                if ((xx // step) + (yy // step)) % 2:
                    cd.rectangle((xx, yy, xx + step, yy + step), fill=(232, 232, 232, 255))
        out.alpha_composite(art)
    else:
        out = art
    out.save(OUT / filename, "PNG")


if __name__ == "__main__":
    l1 = make_l1()
    l2 = make_l2()
    l3 = make_l3()
    l4 = make_l4()
    l5 = make_l5()
    for layer, name in [
        (l1, "L1-fixed-frame-R.png"),
        (l2, "L2-demo-background-replaceable.png"),
        (l3, "L3-cat-slot-placeholder-replaceable.png"),
        (l4, "L4-fixed-decor-R.png"),
        (l5, "L5-demo-fields-100-placeholder.png"),
    ]:
        save(layer, name)
    make_preview([l1, l4, l5], "r-master-preview-v0-8-transparent.png", checkerboard=True)
    make_preview([l1, l2, l3, l4, l5], "r-master-preview-v0-8-with-demo.png")
    print(OUT / "r-master-preview-v0-8-transparent.png")
