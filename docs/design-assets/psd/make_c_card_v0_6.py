"""Generate the C-card v0.6 layout assets.

This pass keeps the same 720 x 1420 master contract while making the photo
window taller, compressing the lower score/information band, reducing the C
badge, and preparing a clean PSD import set. The source library still keeps
every fine treatment, but the PSD builder imports only the active components.
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

PHOTO_Y0 = 80
PHOTO_Y1_OLD = 914
PHOTO_Y1_NEW = 974
PHOTO_FRAME_Y0 = 70
PHOTO_FRAME_Y1_OLD = 930
PHOTO_FRAME_Y1_NEW = 990

NAME_DY = 31
NUMBER_TEXT_DX = 4
METRIC_DY = -17
SCORE_SCALE = 0.90
SCORE_PIVOT = (604.0, 1009.0)
SCORE_DY = 39.0
LABEL_SCALE = 0.72
LABEL_PIVOT = (44.0, 42.0)

# Core lines used in the first visual pass. The remaining generated component
# files stay available for later tuning but are hidden in the PSD by default.
CORE_L4 = {
    "L4-01-frame-primary-line-C.png",
    "L4-04-frame-highlight-line-C.png",
    "L4-07-photo-recess-deep-C.png",
    "L4-10-photo-aperture-primary-C.png",
    "L4-20-number-fill-C.png",
    "L4-21-number-primary-line-C.png",
    "L4-26-score-fill-C.png",
    "L4-27-score-primary-line-C.png",
    "L4-32-name-divider-C.png",
    "L4-41-metric-module-fill-C.png",
    "L4-42-metric-cell-1-fill-C.png",
    "L4-43-metric-cell-2-fill-C.png",
    "L4-44-metric-cell-3-fill-C.png",
    "L4-45-metric-module-primary-line-C.png",
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

L1_CORE = [
    "L1-01-outer-gradient-C.png",
    "L1-02-shell-inner-C.png",
    "L1-03-surface-C.png",
    "L1-04-panel-C.png",
    "L1-05-panel-inner-C.png",
    "L1-06-photo-shadow-C.png",
    "L1-07-paper-highlight-C.png",
]

L4A_SMALL = [
    "L4A-small-02-label-fill-C.png",
    "L4A-small-03-label-primary-line-C.png",
    "L4A-small-04-label-inner-highlight-C.png",
]

FIXED_TEXT = [
    "L4-24-number-prefix-C.png",
    "L4-31-score-title-C.png",
    "L4A-small-08-label-letter-C.png",
]

L5_FIELDS = [
    "L5-01-number-value-C.png",
    "L5-02-pet-name-C.png",
    "L5-03-copy-line-one-C.png",
    "L5-04-copy-line-two-C.png",
    "L5-05-score-C.png",
    "L5-06-charm-C.png",
    "L5-07-clever-C.png",
    "L5-08-aura-C.png",
]


def load_source():
    spec = importlib.util.spec_from_file_location("c_layers_v010", SOURCE)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load {SOURCE}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def natural_key(path: Path):
    path = Path(path)
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


def affine_component(source_path: Path, target_path: Path, scale=1.0,
                     pivot=(0.0, 0.0), dx=0.0, dy=0.0) -> None:
    """Transform one full-canvas component without flattening its alpha."""
    source = Image.open(source_path).convert("RGBA")
    width, height = source.size
    if source.size != (720, 1420):
        raise ValueError(f"Unexpected card asset size for {source_path.name}: {source.size}")
    px, py = pivot
    if scale == 1.0:
        result = Image.new("RGBA", source.size, (0, 0, 0, 0))
        result.alpha_composite(source, dest=(round(dx), round(dy)))
    else:
        # output -> input inverse for: p' = pivot + scale * (p - pivot) + delta
        inverse = (
            1.0 / scale,
            0.0,
            px - (px + dx) / scale,
            0.0,
            1.0 / scale,
            py - (py + dy) / scale,
        )
        result = source.transform(
            (width, height),
            Image.Transform.AFFINE,
            inverse,
            resample=Image.Resampling.BICUBIC,
            fillcolor=(0, 0, 0, 0),
        )
    result.save(target_path, "PNG")
    source.close()


def transform_layout_assets() -> None:
    """Apply v0.6 layout transforms to regenerated source components."""
    # Keep the original label source art, and create the smaller active label
    # components used by the PSD.
    label_sources = sorted(
        [p for p in OUT.glob("L4A-*.png") if re.match(r"^L4A-0[1-8]-", p.name)],
        key=natural_key,
    )
    for source in label_sources:
        target = OUT / ("L4A-small-" + source.name[len("L4A-"):])
        affine_component(source, target, LABEL_SCALE, LABEL_PIVOT)

    # Compact the lower information band while leaving the outer card size
    # fixed. Name/copy elements move down to follow the taller photo; the
    # metric row moves up to shorten the scoring band.
    translated_names = [
        "L4-32-name-divider-C.png",
        "L4-33-name-divider-stud-C.png",
        "L4-34-flower-name-left-C.png",
        "L4-34-flower-name-right-C.png",
        "L5-02-pet-name-C.png",
        "L5-03-copy-line-one-C.png",
        "L5-04-copy-line-two-C.png",
    ]
    for name in translated_names:
        source = OUT / name
        if source.exists():
            affine_component(source, source, 1.0, (0.0, 0.0), 0.0, NAME_DY)

    # The plaque has 9 px geometry on both sides of its inner frame. Shift
    # the combined No./value text block 4 px right to equalize visual ink
    # padding after the different glyph widths are rasterized.
    for name in ["L4-24-number-prefix-C.png", "L5-01-number-value-C.png"]:
        source = OUT / name
        if source.exists():
            affine_component(source, source, 1.0, (0.0, 0.0), NUMBER_TEXT_DX, 0.0)

    score_names = [
        "L4-26-score-fill-C.png",
        "L4-27-score-primary-line-C.png",
        "L4-28-score-gold-line-C.png",
        "L4-31-score-title-C.png",
        "L5-05-score-C.png",
    ]
    for name in score_names:
        source = OUT / name
        if not source.exists():
            continue
        pivot = SCORE_PIVOT
        if name.startswith("L4-31"):
            pivot = (604.0, 982.0)
        elif name.startswith("L5-05"):
            pivot = (604.0, 1026.0)
        temporary = OUT / (".v06-" + name)
        affine_component(source, temporary, SCORE_SCALE, pivot, 0.0, SCORE_DY)
        temporary.replace(source)

    metric_names = [
        "L4-40-metric-shadow-C.png",
        "L4-41-metric-module-fill-C.png",
        "L4-42-metric-cell-1-fill-C.png",
        "L4-43-metric-cell-2-fill-C.png",
        "L4-44-metric-cell-3-fill-C.png",
        "L4-45-metric-module-primary-line-C.png",
        "L4-46-metric-module-gold-line-C.png",
        "L4-47-metric-module-lip-C.png",
        "L4-48-metric-cell-1-border-C.png",
        "L4-49-metric-cell-2-border-C.png",
        "L4-50-metric-cell-3-border-C.png",
        "L4-51-metric-cell-1-top-C.png",
        "L4-52-metric-cell-2-top-C.png",
        "L4-53-metric-cell-3-top-C.png",
        "L4-54-metric-cell-1-bottom-C.png",
        "L4-55-metric-cell-2-bottom-C.png",
        "L4-56-metric-cell-3-bottom-C.png",
        "L4-57-metric-divider-1-deep-C.png",
        "L4-58-metric-divider-1-highlight-C.png",
        "L4-59-metric-divider-1-studs-C.png",
        "L4-60-metric-divider-2-deep-C.png",
        "L4-61-metric-divider-2-highlight-C.png",
        "L4-62-metric-divider-2-studs-C.png",
        "L4-63-metric-corner-points-C.png",
        "L4-64-icon-charm-C.png",
        "L4-65-icon-clever-C.png",
        "L4-66-icon-aura-C.png",
        "L5-06-charm-C.png",
        "L5-07-clever-C.png",
        "L5-08-aura-C.png",
    ]
    for name in metric_names:
        source = OUT / name
        if source.exists():
            affine_component(source, source, 1.0, (0.0, 0.0), 0.0, METRIC_DY)


def write_transformed_path_source() -> None:
    """Write editable paths matching the v0.6 component transforms."""
    original = ROOT / "rarity-masters-v0-9" / "C" / "editable-vector-paths" / "vector-path-specs.jsxinc"
    source = original.read_text(encoding="utf-8")
    match = re.search(r"=\s*(\{.*\})\s*;\s*$", source, re.DOTALL)
    if not match:
        raise ValueError(f"Unable to parse vector path source: {original}")
    specs = json.loads(match.group(1))
    factor = (PHOTO_FRAME_Y1_NEW - PHOTO_FRAME_Y0) / (PHOTO_FRAME_Y1_OLD - PHOTO_FRAME_Y0)
    for path_group in specs.values():
        for item in path_group:
            name = item.get("name", "")
            points = item["points"]
            if "photo-" in name:
                item["points"] = [
                    [x, round(PHOTO_FRAME_Y0 + (y - PHOTO_FRAME_Y0) * factor, 4)]
                    for x, y in points
                ]
            elif "label-" in name:
                px, py = LABEL_PIVOT
                item["points"] = [
                    [round(px + LABEL_SCALE * (x - px), 4), round(py + LABEL_SCALE * (y - py), 4)]
                    for x, y in points
                ]
            elif "score-seal" in name:
                px, py = SCORE_PIVOT
                item["points"] = [
                    [round(px + SCORE_SCALE * (x - px), 4), round(py + SCORE_DY + SCORE_SCALE * (y - py), 4)]
                    for x, y in points
                ]
            elif "name-divider" in name:
                item["points"] = [[x, round(y + NAME_DY, 4)] for x, y in points]
            elif "metric-" in name or "icon-" in name:
                item["points"] = [[x, round(y + METRIC_DY, 4)] for x, y in points]

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
    transform_layout_assets()
    write_transformed_path_source()

    l1 = [OUT / name for name in L1_CORE]
    l2 = [OUT / "L2-background-replaceable-C.png"]
    l3 = [OUT / "L3-cat-slot-placeholder-C.png"]
    l4 = [OUT / name for name in sorted(CORE_L4, key=natural_key)]
    l4a = [OUT / name for name in L4A_SMALL]
    fixed_text = [OUT / name for name in FIXED_TEXT]
    l5 = [OUT / name for name in L5_FIELDS]

    active_files = l1 + l2 + l3 + l4 + l4a + fixed_text
    dynamic_preview = OUT / "L5-demo-fields-100-placeholder-C-single-layer-v0-6.png"
    save_composite(l5, dynamic_preview.name)
    save_composite(active_files, "C-master-fixed-transparent-v0-6.png")
    save_composite(
        active_files + [dynamic_preview],
        "C-master-preview-v0-6-layout.png",
    )

    old_manifest_path = OUT / "C-layer-manifest-v0-10.json"
    manifest = json.loads(old_manifest_path.read_text(encoding="utf-8"))
    manifest["version"] = "0.6"
    manifest["rarity"] = "C"
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
        "file": dynamic_preview.name,
        "fields": ["编号值", "猫名", "文案", "咪咔", "魅力", "机灵", "灵气"],
        "visible_layer_count": 1,
        "placeholder": "100",
        "psd_contract": "L5_SOURCE 转为一个智能对象；双击后仍可编辑全部文字与数据",
    }
    manifest["fixed_geometry"] = {
        "card": [10, 6, 710, 1414],
        "photo": [54, PHOTO_Y0, 666, PHOTO_Y1_NEW],
        "photo_frame": [47, PHOTO_FRAME_Y0, 673, PHOTO_FRAME_Y1_NEW],
        "number_plaque": [385, 80, 663, 159],
        "number_plaque_inner": [394, 89, 654, 150],
        "information_panel": [55, PHOTO_Y1_NEW, 665, 1365],
        "score_seal_center": [604, SCORE_PIVOT[1] + SCORE_DY],
        "score_seal_bounds": [
            round(SCORE_PIVOT[0] - 64 * SCORE_SCALE, 2),
            round(SCORE_PIVOT[1] + SCORE_DY - 64 * SCORE_SCALE, 2),
            round(SCORE_PIVOT[0] + 64 * SCORE_SCALE, 2),
            round(SCORE_PIVOT[1] + SCORE_DY + 64 * SCORE_SCALE, 2),
        ],
        "metrics": [55, 1195 + METRIC_DY, 665, 1365 + METRIC_DY],
    }
    manifest["photo_window_revision"] = {
        "previous": [54, PHOTO_Y0, 666, PHOTO_Y1_OLD],
        "current": [54, PHOTO_Y0, 666, PHOTO_Y1_NEW],
        "delta_y": PHOTO_Y1_NEW - PHOTO_Y1_OLD,
        "lower_anchors_unchanged": False,
        "path_source": "editable-vector-paths/vector-path-specs.jsxinc",
    }
    source_components = {
        item["file"]: item for item in manifest.get("components", [])
    }
    active_names = [path.name for path in active_files] + [dynamic_preview.name]
    active_components = []
    for filename in active_names:
        source_name = filename
        if filename.startswith("L4A-small-"):
            source_name = "L4A-" + filename[len("L4A-small-"):]
        if source_name in source_components:
            item = dict(source_components[source_name])
            item["file"] = filename
            if filename.startswith("L4A-small-"):
                item["name"] = item["name"] + "｜v0.6 缩小版"
            active_components.append(item)
        elif filename == dynamic_preview.name:
            active_components.append({
                "group": "DEMO-L5",
                "slug": "L5-demo-fields-100-placeholder-C-single-layer-v0-6",
                "file": filename,
                "name": "DEMO-L5｜示例文字与数据｜单一智能对象内容预览",
                "role": "dynamic fields preview",
                "kind": "text",
                "visible_by_default": True,
                "layer_contract": "single-full-canvas-transparent-layer",
                "path_source": None,
            })
    manifest["components"] = active_components
    manifest["active_psd_layers"] = {
        "unused_layers_removed": True,
        "imported_component_count": len(active_components),
        "groups_removed": ["00｜参考与辅助线｜隐藏不导出", "99｜可选高光细节｜默认隐藏"],
        "source_library_retained": True,
    }
    manifest["removed_from_psd"] = {
        "description": "源素材库保留，但未使用的细节不再导入 v0.6 PSD。",
        "L4": sorted(
            p.name for p in OUT.glob("L4-*.png")
            if p.name not in CORE_L4
            and p.name not in {"L4-24-number-prefix-C.png", "L4-31-score-title-C.png"}
        ),
        "L4A": sorted(
            p.name for p in OUT.glob("L4A-*.png")
            if p.name not in CORE_L4A
        ),
    }
    manifest["notes"] = [
        "L5 的编号值、猫名、文案、咪咔和三个指标统一为一张顶部透明层。",
        "固定的 C、No.、MIKA 与三个指标图标属于 L4/L4A；C 标签已缩小为 72% 独立组件。",
        "编号牌、咪咔圆章、指标模块可单独开关/导出；指标模块内部再拆为容器、魅力图标、机灵图标、灵气图标四组。",
        "PSD 只导入实际使用的核心组件；未使用的高光、角点和细线不再生成隐藏图层。",
        "L1、L4、L4A 的有效组件仍然保留独立素材与路径源。",
        "本版主图窗口下沿下移 60 px；名称区下移 31 px，评分章缩小至 90% 并下移 39 px，指标模块上移 17 px。",
        "右上编号牌沿用 385–663 的固定牌体，No. 与编号值共用一条基线；文字整体右移 4 px 后左右内边距约 14 px。",
        "照片窗口内和卡片外部保持透明；底部多余内侧横线不导出。",
    ]
    (OUT / "C-card-manifest-v0-6.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(OUT / "C-master-preview-v0-6-layout.png")


if __name__ == "__main__":
    main()
