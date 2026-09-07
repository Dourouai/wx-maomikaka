"""Generate the first four rarity skins from the confirmed R-card geometry.

The script deliberately reuses the R master drawing functions. Only palette
tokens and the fixed letter change; all coordinates, transparent slots and
dynamic-field positions remain identical across skins.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
BASE_SCRIPT = ROOT / "make_r_master_assets.py"
OUT_ROOT = ROOT / "rarity-masters-v0-7"


def load_base():
    spec = importlib.util.spec_from_file_location("r_master_base", BASE_SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load {BASE_SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


THEMES = {
    "R": {
        "letter": "R",
        "ink": (112, 57, 17, 255),
        "line": (193, 112, 26, 255),
        "gold": (238, 176, 72, 255),
        "light": (255, 247, 224, 255),
        "panel": (255, 242, 207, 255),
        "highlight": (255, 252, 238, 255),
        "outer_top": (251, 225, 162, 255),
        "outer_bottom": (244, 187, 72, 255),
        "shell_inner": (255, 232, 171, 255),
        "surface": (255, 246, 215, 255),
        "panel_inner": (255, 245, 217, 255),
        "metric_fill": (255, 247, 224, 92),
        "metric_cell": (255, 255, 255, 28),
        "icon": (193, 112, 26, 255),
        "flower": (206, 139, 50, 145),
        "deep": (180, 94, 19, 120),
        "shadow": (99, 48, 10, 55),
        "photo_shadow": (111, 55, 13, 42),
        "overlay": (255, 215, 142, 26),
        "motif": "spark",
    },
    "C": {
        "letter": "C",
        "ink": (66, 82, 59, 255),
        "line": (112, 143, 103, 255),
        "gold": (183, 199, 143, 255),
        "light": (249, 252, 239, 255),
        "panel": (239, 247, 227, 255),
        "highlight": (253, 255, 246, 255),
        "outer_top": (215, 229, 203, 255),
        "outer_bottom": (157, 183, 145, 255),
        "shell_inner": (232, 242, 220, 255),
        "surface": (248, 251, 236, 255),
        "panel_inner": (245, 249, 232, 255),
        "metric_fill": (250, 252, 240, 190),
        "metric_cell": (255, 255, 255, 38),
        "icon": (94, 128, 86, 255),
        "flower": (133, 165, 121, 150),
        "deep": (80, 112, 72, 130),
        "shadow": (55, 77, 51, 52),
        "photo_shadow": (61, 86, 52, 38),
        "overlay": (201, 225, 177, 24),
        "motif": "leaf",
    },
    "U": {
        "letter": "U",
        "ink": (69, 64, 99, 255),
        "line": (128, 117, 175, 255),
        "gold": (185, 175, 212, 255),
        "light": (249, 247, 255, 255),
        "panel": (241, 238, 250, 255),
        "highlight": (255, 253, 255, 255),
        "outer_top": (220, 216, 239, 255),
        "outer_bottom": (166, 153, 204, 255),
        "shell_inner": (234, 231, 247, 255),
        "surface": (249, 247, 253, 255),
        "panel_inner": (245, 242, 250, 255),
        "metric_fill": (252, 249, 255, 190),
        "metric_cell": (255, 255, 255, 40),
        "icon": (111, 100, 164, 255),
        "flower": (148, 135, 190, 150),
        "deep": (87, 71, 137, 128),
        "shadow": (67, 56, 100, 52),
        "photo_shadow": (74, 61, 110, 38),
        "overlay": (203, 193, 234, 24),
        "motif": "dot",
    },
    "SR": {
        "letter": "SR",
        "ink": (126, 63, 57, 255),
        "line": (211, 106, 94, 255),
        "gold": (238, 163, 133, 255),
        "light": (255, 247, 238, 255),
        "panel": (255, 236, 227, 255),
        "highlight": (255, 253, 246, 255),
        "outer_top": (252, 200, 180, 255),
        "outer_bottom": (224, 123, 106, 255),
        "shell_inner": (248, 218, 202, 255),
        "surface": (255, 241, 231, 255),
        "panel_inner": (255, 239, 230, 255),
        "metric_fill": (255, 247, 238, 195),
        "metric_cell": (255, 255, 255, 38),
        "icon": (189, 83, 75, 255),
        "flower": (221, 122, 107, 150),
        "deep": (153, 67, 56, 130),
        "shadow": (112, 49, 45, 55),
        "photo_shadow": (118, 53, 43, 42),
        "overlay": (250, 171, 145, 24),
        "motif": "star",
    },
    "UR": {
        "letter": "UR",
        "ink": (74, 52, 77, 255),
        "line": (106, 84, 151, 255),
        "gold": (218, 174, 74, 255),
        "light": (247, 241, 221, 255),
        "panel": (246, 236, 211, 255),
        "highlight": (255, 248, 221, 255),
        "outer_top": (96, 84, 143, 255),
        "outer_bottom": (43, 35, 82, 255),
        "shell_inner": (73, 64, 118, 255),
        "surface": (50, 44, 91, 255),
        "panel_inner": (250, 239, 213, 255),
        "metric_fill": (250, 241, 218, 220),
        "metric_cell": (255, 247, 218, 34),
        "icon": (92, 72, 151, 255),
        "flower": (215, 170, 81, 165),
        "deep": (31, 27, 61, 165),
        "shadow": (25, 22, 50, 75),
        "photo_shadow": (25, 22, 54, 65),
        "overlay": (105, 93, 170, 18),
        "motif": "night",
    },
}


def build_variant(base, code, palette):
    out = OUT_ROOT / code
    out.mkdir(parents=True, exist_ok=True)
    base.OUT = out
    base.set_palette(palette)

    l1 = base.make_l1()
    l2 = base.make_l2()
    l3 = base.make_l3()
    l4 = base.make_l4()
    l5 = base.make_l5()
    label = base.make_rarity_label()

    base.save(l1, f"L1-fixed-frame-{code}.png")
    base.save(l2, f"L2-demo-background-replaceable-{code}.png")
    base.save(l3, f"L3-cat-slot-placeholder-replaceable-{code}.png")
    base.save(l4, f"L4-fixed-decor-{code}.png")
    base.save(l5, f"L5-demo-fields-100-placeholder-{code}.png")
    base.save(label, f"L4-rarity-label-{code}.png")

    # Cropped copy for independent handoff/editing; the full-canvas PNG above
    # keeps the locked card coordinates for Photoshop and Canvas composition.
    label_full = Image.open(out / f"L4-rarity-label-{code}.png").convert("RGBA")
    label_crop = label_full.crop((34, 32, 199, 215))
    label_crop.save(out / f"L4-rarity-label-{code}-standalone.png", "PNG")

    transparent_name = f"{code}-master-preview-v0-7-transparent.png"
    demo_name = f"{code}-master-preview-v0-7-with-demo.png"
    base.make_preview([l1, label, l4, l5], transparent_name, checkerboard=True)
    base.make_preview([l1, l2, l3, label, l4, l5], demo_name)
    return out / transparent_name


def make_comparison(base, paths):
    """Create a compact comparison sheet while retaining equal card geometry."""
    all_paths = paths
    labels = ["R", "C", "U", "SR", "UR"]
    card_w, card_h = 216, 426
    gap = 18
    top = 50
    sheet = Image.new("RGBA", (gap + len(all_paths) * (card_w + gap), top + card_h + 24), (250, 244, 229, 255))
    draw = ImageDraw.Draw(sheet)
    label_font = ImageFont.truetype(base.BASKERVILLE, 17)
    for idx, (path, label) in enumerate(zip(all_paths, labels)):
        x = gap + idx * (card_w + gap)
        image = Image.open(path).convert("RGBA").resize((card_w, card_h), Image.Resampling.LANCZOS)
        sheet.alpha_composite(image, (x, top))
        bb = draw.textbbox((0, 0), label, font=label_font)
        draw.text((x + (card_w - (bb[2] - bb[0])) // 2, 17), label, font=label_font, fill=(100, 67, 39, 255))
    comparison = OUT_ROOT / "rarity-masters-v0-7-comparison.png"
    sheet.save(comparison, "PNG")
    return comparison


def make_label_board(base):
    """Show the five independently extracted labels at the same visual scale."""
    codes = list(THEMES)
    crops = []
    for code in codes:
        crop_path = OUT_ROOT / code / f"L4-rarity-label-{code}-standalone.png"
        crops.append(Image.open(crop_path).convert("RGBA"))

    tile_w, tile_h = 190, 216
    gap = 22
    board = Image.new("RGBA", (gap + len(crops) * (tile_w + gap), tile_h + 58), (250, 244, 229, 255))
    draw = ImageDraw.Draw(board)
    label_font = ImageFont.truetype(base.BASKERVILLE, 18)
    for idx, (code, crop) in enumerate(zip(codes, crops)):
        x = gap + idx * (tile_w + gap)
        y = 48
        # Keep all five extracted assets centered without changing their own bounds.
        px = x + (tile_w - crop.width) // 2
        py = y + (tile_h - crop.height) // 2
        board.alpha_composite(crop, (px, py))
        bbox = draw.textbbox((0, 0), code, font=label_font)
        draw.text((x + (tile_w - (bbox[2] - bbox[0])) // 2, 16), code, font=label_font, fill=(100, 67, 39, 255))
    board.save(OUT_ROOT / "rarity-labels-v0-7-board.png", "PNG")
    return OUT_ROOT / "rarity-labels-v0-7-board.png"


if __name__ == "__main__":
    base = load_base()
    previews = [build_variant(base, code, palette) for code, palette in THEMES.items()]
    comparison = make_comparison(base, previews)
    label_board = make_label_board(base)
    print(comparison)
    print(label_board)
