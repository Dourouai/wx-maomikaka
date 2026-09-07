"""Generate the first C-card implementation from the v0.2 master contract.

The existing v0.10 drawing functions are reused for the approved C geometry,
palette, and fixed components. This wrapper changes the deliverable contract:
all dynamic text/data is also exported as one full-canvas transparent layer.
The Photoshop builder places that layer at the top of the document.
"""

from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "make_c_layered_assets_v0_10.py"
OUT = ROOT / "rarity-masters-v0-2" / "C"

# The first visual pass keeps every lower information anchor unchanged and
# gives the replaceable photo window a little more vertical presence.  The
# stretch is applied to the photo/content band only; the card canvas and all
# name, score, copy, and metric coordinates stay on the approved grid.
PHOTO_Y0 = 80
PHOTO_Y1_OLD = 914
PHOTO_Y1_NEW = 946
PHOTO_FRAME_Y0 = 70
PHOTO_FRAME_Y1_OLD = 930
PHOTO_FRAME_Y1_NEW = 962

# Core lines used in the first visual pass. The remaining generated component
# files stay available for later tuning but are hidden in the PSD by default.
CORE_L4 = {
    "L4-01-frame-primary-line-C.png",
    "L4-02-frame-gold-line-C.png",
    "L4-04-frame-highlight-line-C.png",
    "L4-07-photo-recess-deep-C.png",
    "L4-10-photo-aperture-primary-C.png",
    "L4-20-number-fill-C.png",
    "L4-21-number-primary-line-C.png",
    "L4-22-number-inner-gold-line-C.png",
    "L4-26-score-fill-C.png",
    "L4-27-score-primary-line-C.png",
    "L4-28-score-gold-line-C.png",
    "L4-32-name-divider-C.png",
    "L4-34-flower-name-left-C.png",
    "L4-34-flower-name-right-C.png",
    "L4-41-metric-module-fill-C.png",
    "L4-42-metric-cell-1-fill-C.png",
    "L4-43-metric-cell-2-fill-C.png",
    "L4-44-metric-cell-3-fill-C.png",
    "L4-45-metric-module-primary-line-C.png",
    "L4-46-metric-module-gold-line-C.png",
    "L4-57-metric-divider-1-deep-C.png",
    "L4-60-metric-divider-2-deep-C.png",
    "L4-64-icon-charm-C.png",
    "L4-65-icon-clever-C.png",
    "L4-66-icon-aura-C.png",
}

CORE_L4A = {
    "L4A-01-label-shadow-C.png",
    "L4A-02-label-fill-C.png",
    "L4A-03-label-primary-line-C.png",
    "L4A-04-label-inner-highlight-C.png",
}


def load_source():
    spec = importlib.util.spec_from_file_location("c_layers_v010", SOURCE)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load {SOURCE}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def natural_key(path: Path):
    return [
        (0, int(token)) if token.isdigit() else (1, token)
        for token in re.split(r"(\d+)", path.stem)
        if token
    ]


def stretch_photo_band(path: Path, y0: int, y1: int, new_y1: int) -> None:
    """Stretch a photo-only transparent asset without moving lower modules."""
    source = Image.open(path).convert("RGBA")
    width, height = source.size
    if source.size != (720, 1420):
        raise ValueError(f"Unexpected card asset size for {path.name}: {source.size}")

    resized_band = source.crop((0, y0, width, y1)).resize(
        (width, new_y1 - y0), Image.Resampling.BICUBIC
    )
    result = Image.new("RGBA", source.size, (0, 0, 0, 0))
    result.alpha_composite(source.crop((0, 0, width, y0)), dest=(0, 0))
    result.alpha_composite(resized_band, dest=(0, y0))
    # These are photo/content-only files.  Do not copy anything below the old
    # band: that would duplicate or move lower fixed modules into the gap.
    result.save(path, "PNG")
    source.close()


def stretch_photo_assets() -> None:
    """Increase the C master photo window while preserving the lower layout."""
    for name in (
        "L2-background-replaceable-C.png",
        "L2-demo-background-replaceable-C.png",
        "L3-cat-slot-placeholder-C.png",
        "L3-cat-slot-placeholder-replaceable-C.png",
    ):
        path = OUT / name
        if path.exists():
            stretch_photo_band(path, PHOTO_Y0, PHOTO_Y1_OLD, PHOTO_Y1_NEW)

    shadow = OUT / "L1-06-photo-shadow-C.png"
    if shadow.exists():
        stretch_photo_band(shadow, PHOTO_FRAME_Y0, PHOTO_FRAME_Y1_OLD, PHOTO_FRAME_Y1_NEW)

    for path in OUT.glob("L4-*-photo-*.png"):
        stretch_photo_band(path, PHOTO_FRAME_Y0, PHOTO_FRAME_Y1_OLD, PHOTO_FRAME_Y1_NEW)


def write_transformed_path_source() -> None:
    """Write a matching editable path source for the taller photo window."""
    original = ROOT / "rarity-masters-v0-9" / "C" / "editable-vector-paths" / "vector-path-specs.jsxinc"
    source = original.read_text(encoding="utf-8")
    match = re.search(r"=\s*(\{.*\})\s*;\s*$", source, re.DOTALL)
    if not match:
        raise ValueError(f"Unable to parse vector path source: {original}")
    specs = json.loads(match.group(1))
    factor = (PHOTO_FRAME_Y1_NEW - PHOTO_FRAME_Y0) / (PHOTO_FRAME_Y1_OLD - PHOTO_FRAME_Y0)
    for path_group in specs.values():
        for item in path_group:
            if "photo-" not in item.get("name", ""):
                continue
            item["points"] = [
                [x, round(PHOTO_FRAME_Y0 + (y - PHOTO_FRAME_Y0) * factor, 4)]
                for x, y in item["points"]
            ]

    target = OUT / "editable-vector-paths" / "vector-path-specs.jsxinc"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        "var VECTOR_PATH_SPECS = "
        + json.dumps(specs, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )


def composite(files: list[Path]) -> Image.Image:
    art = Image.new("RGBA", (720, 1420), (0, 0, 0, 0))
    for path in sorted(files, key=natural_key):
        with Image.open(path).convert("RGBA") as layer:
            art.alpha_composite(layer)
    return art


def save_composite(files: list[Path], filename: str) -> None:
    composite(files).save(OUT / filename, "PNG")


def main() -> None:
    source = load_source()
    source.OUT = OUT
    OUT.mkdir(parents=True, exist_ok=True)
    source.main()
    stretch_photo_assets()
    write_transformed_path_source()

    l1 = [p for p in OUT.glob("L1-*.png") if "composite" not in p.name]
    l2 = [p for p in OUT.glob("L2-*.png")]
    l3 = [p for p in OUT.glob("L3-*.png")]
    l4_all = [
        p for p in OUT.glob("L4-*.png")
        if "fixed-decor" not in p.name
        and "rarity-label" not in p.name
        and "standalone" not in p.name
        and p.name not in {"L4-24-number-prefix-C.png", "L4-31-score-title-C.png"}
    ]
    l4 = [p for p in l4_all if p.name in CORE_L4]
    l4a_all = [p for p in OUT.glob("L4A-*.png") if p.name != "L4A-08-label-letter-C.png"]
    l4a = [p for p in l4a_all if p.name in CORE_L4A]
    fixed_text = [
        OUT / "L4-24-number-prefix-C.png",
        OUT / "L4-31-score-title-C.png",
        OUT / "L4A-08-label-letter-C.png",
    ]
    l5 = [p for p in OUT.glob("L5-*.png") if re.match(r"^L5-\d{2}-.*\.png$", p.name)]

    save_composite(l5, "L5-demo-fields-100-placeholder-C-single-layer-v0-2.png")
    save_composite(l1 + l4 + l4a + fixed_text, "C-master-fixed-transparent-v0-2.png")
    save_composite(
        l1 + l2 + l3 + l4 + l4a + fixed_text + [OUT / "L5-demo-fields-100-placeholder-C-single-layer-v0-2.png"],
        "C-master-preview-v0-2-with-demo.png",
    )

    old_manifest_path = OUT / "C-layer-manifest-v0-10.json"
    manifest = json.loads(old_manifest_path.read_text(encoding="utf-8"))
    manifest["version"] = "0.2"
    manifest["groups"] = ["MASTER-L1", "CONTENT-L2", "CONTENT-L3", "MASTER-L4", "MASTER-L4A", "DEMO-L5"]
    manifest["group_contract"] = {
        "MASTER-L1": "固定相框底纸，堆栈最底部；主图孔透明",
        "CONTENT-L2": "无猫背景图，可替换并按主图窗口裁切",
        "CONTENT-L3": "透明猫主体，可替换并按主图窗口裁切",
        "MASTER-L4": "固定前景组件；编号牌、咪咔圆章、指标模块均为独立组件组，颜色、描边、高光、阴影和图标分开",
        "MASTER-L4A": "独立 C 等级标签；位置和尺寸固定",
        "DEMO-L5": "一个可见动态文字与数据层；Canvas 整层重绘",
    }
    manifest["dynamic_layer"] = {
        "file": "L5-demo-fields-100-placeholder-C-single-layer-v0-2.png",
        "fields": ["编号值", "猫名", "文案", "咪咔", "魅力", "机灵", "灵气"],
        "visible_layer_count": 1,
        "placeholder": "100",
    }
    manifest["fixed_geometry"]["photo"] = [54, PHOTO_Y0, 666, PHOTO_Y1_NEW]
    manifest["photo_window_revision"] = {
        "previous": [54, PHOTO_Y0, 666, PHOTO_Y1_OLD],
        "current": [54, PHOTO_Y0, 666, PHOTO_Y1_NEW],
        "delta_y": PHOTO_Y1_NEW - PHOTO_Y1_OLD,
        "lower_anchors_unchanged": True,
        "path_source": "editable-vector-paths/vector-path-specs.jsxinc",
    }
    manifest["optional_hidden_components"] = {
        "L4": sorted(p.name for p in l4_all if p.name not in CORE_L4),
        "L4A": sorted(p.name for p in l4a_all if p.name not in CORE_L4A),
    }
    manifest["notes"] = [
        "L5 的编号值、猫名、文案、咪咔和三个指标统一为一张顶部透明层。",
        "固定的 C、No.、MIKA 与三个指标图标属于 L4/L4A。",
        "编号牌、咪咔圆章、指标模块可单独开关/导出；指标模块内部再拆为容器、魅力图标、机灵图标、灵气图标四组。",
        "首版只显示核心轮廓；其他高光、角点和细线作为独立隐藏组件保留。",
        "L1、L4、L4A 的每个组件仍然保留独立素材与路径源。",
        "本版主图窗口下沿下移 32 px；名称区、圆章、文案区和指标模块保持原坐标。",
        "照片窗口内和卡片外部保持透明；底部多余内侧横线不导出。",
    ]
    (OUT / "C-card-manifest-v0-2.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(OUT / "C-master-preview-v0-2-with-demo.png")


if __name__ == "__main__":
    main()
