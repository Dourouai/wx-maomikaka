"""Build the C-card prototype from the locked R geometry.

This is intentionally a C-only pass. It keeps the shared coordinates, checks
the left-aligned information block, and lets the C palette be approved before
the other four rarity skins are regenerated.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
BASE_SCRIPT = ROOT / "make_r_master_assets.py"
OUT = ROOT / "rarity-masters-v0-8" / "C"


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
    spec = importlib.util.spec_from_file_location("r_master_base", BASE_SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load {BASE_SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    base = load_base()
    OUT.mkdir(parents=True, exist_ok=True)
    base.OUT = OUT
    base.set_palette(C_THEME)

    l1 = base.make_l1()
    l2 = base.make_l2()
    l3 = base.make_l3()
    l4 = base.make_l4()
    l5 = base.make_l5()
    label = base.make_rarity_label()

    base.save(l1, "L1-fixed-frame-C.png")
    base.save(l2, "L2-demo-background-replaceable-C.png")
    base.save(l3, "L3-cat-slot-placeholder-replaceable-C.png")
    base.save(l4, "L4-fixed-decor-C.png")
    base.save(l5, "L5-demo-fields-100-placeholder-C.png")
    base.save(label, "L4-rarity-label-C.png")

    label_full = Image.open(OUT / "L4-rarity-label-C.png").convert("RGBA")
    label_full.crop((34, 32, 199, 215)).save(OUT / "L4-rarity-label-C-standalone.png", "PNG")

    base.make_preview([l1, label, l4, l5], "C-master-preview-v0-8-transparent.png", checkerboard=True)
    base.make_preview([l1, l2, l3, label, l4, l5], "C-master-preview-v0-8-with-demo.png")
    print(OUT / "C-master-preview-v0-8-with-demo.png")


if __name__ == "__main__":
    main()
