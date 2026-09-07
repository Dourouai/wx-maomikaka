"""Export editable vector source files for the fixed card artwork.

The card preview is still rendered by make_r_master_assets.py so its pixels stay
stable. This companion file keeps the geometry of the fixed artwork as SVG
paths and as point-based Photoshop PathItems for the PSD builder.
"""

from __future__ import annotations

import json
import math
from pathlib import Path


ROOT = Path(__file__).resolve().parent
OUT = ROOT / "rarity-masters-v0-7" / "editable-vector-paths"
W, H = 720, 1420


THEMES = {
    "R": {"line": "#c1701a", "gold": "#eeb048", "light": "#fff7e0", "panel": "#fff2cf", "ink": "#703911"},
    "C": {"line": "#708f67", "gold": "#b7c78f", "light": "#f9fcef", "panel": "#eff7e3", "ink": "#42523b"},
    "U": {"line": "#8075af", "gold": "#b9afd4", "light": "#f9f7ff", "panel": "#f1eefb", "ink": "#454063"},
    "SR": {"line": "#d36a5e", "gold": "#eea385", "light": "#fff7ee", "panel": "#ffece3", "ink": "#7e3f39"},
    "UR": {"line": "#6a5497", "gold": "#daae4a", "light": "#f7f1dd", "panel": "#f6ecd3", "ink": "#4a344d"},
}


def rounded_rect(x0: float, y0: float, x1: float, y1: float, r: float, steps: int = 6):
    """Return a clockwise polygonal approximation of a rounded rectangle."""
    points = []
    corners = [
        (x1 - r, y0 + r, -math.pi / 2, 0),
        (x1 - r, y1 - r, 0, math.pi / 2),
        (x0 + r, y1 - r, math.pi / 2, math.pi),
        (x0 + r, y0 + r, math.pi, math.pi * 1.5),
    ]
    for cx, cy, start, end in corners:
        for i in range(steps + 1):
            angle = start + (end - start) * i / steps
            points.append([round(cx + r * math.cos(angle), 2), round(cy + r * math.sin(angle), 2)])
    return points


def add(items, name, points, closed=True, stroke=None, fill="none", width=1.0):
    items.append({
        "name": name,
        "points": points,
        "closed": closed,
        "stroke": stroke,
        "fill": fill,
        "width": width,
    })


def add_line(items, name, x0, y0, x1, y1, stroke, width=1.0):
    add(items, name, [[x0, y0], [x1, y1]], False, stroke, "none", width)


def add_ellipse(items, name, cx, cy, rx, ry, stroke, fill="none", width=1.0, steps=32):
    points = []
    for i in range(steps):
        angle = math.pi * 2 * i / steps
        points.append([round(cx + rx * math.cos(angle), 2), round(cy + ry * math.sin(angle), 2)])
    add(items, name, points, True, stroke, fill, width)


def add_photo_corner(items, name, x, y, sx, sy, light, deep, gold):
    add_line(items, name + "-highlight-x", x + sx * 5, y, x + sx * 43, y, light, 2.0)
    add_line(items, name + "-highlight-y", x, y + sy * 5, x, y + sy * 43, light, 2.0)
    add_line(items, name + "-shadow-x", x + sx * 10, y + sy * 7, x + sx * 34, y + sy * 7, deep, 1.0)
    add_line(items, name + "-shadow-y", x + sx * 7, y + sy * 10, x + sx * 7, y + sy * 34, deep, 1.0)
    add(items, name + "-rivet", [[x + sx * 2, y], [x + sx * 6, y + sy * 4], [x + sx * 2, y + sy * 8], [x - sx * 2, y + sy * 4]], True, gold, gold, 1.0)


def build_paths(code):
    t = THEMES[code]
    line, gold, light, panel, ink = t["line"], t["gold"], t["light"], t["panel"], t["ink"]
    items = []

    # L1: fixed shell and information panel geometry.
    add(items, f"{code}-L1-outer-shell", rounded_rect(10, 6, 710, 1414, 34), True, line, "none", 2.2)
    add(items, f"{code}-L1-shell-inner", rounded_rect(22, 18, 698, 1402, 28), True, gold, "none", 1.4)
    add(items, f"{code}-L1-surface", rounded_rect(34, 30, 686, 1390, 22), True, light, "none", 2.0)
    add(items, f"{code}-L1-information-panel", [[55, 914], [665, 914], [665, 1385], [55, 1385]], True, line, panel, 1.0)
    add(items, f"{code}-L1-information-panel-inner", [[58, 925], [662, 925], [662, 1383], [58, 1383]], True, gold, "none", 1.0)

    # L4: photo mount, plaques, score seal and metric module.
    add(items, f"{code}-L4-photo-recess", rounded_rect(47, 72, 673, 923, 37), True, line, "none", 4.0)
    add(items, f"{code}-L4-photo-bevel-light", rounded_rect(49, 74, 671, 921, 36), True, light, "none", 3.0)
    add(items, f"{code}-L4-photo-mount", rounded_rect(50, 75, 670, 925, 35), True, gold, "none", 1.4)
    add(items, f"{code}-L4-photo-aperture", rounded_rect(54, 80, 666, 914, 31), True, line, "none", 2.2)
    add(items, f"{code}-L4-photo-inner-lip", rounded_rect(59, 85, 661, 909, 27), True, light, "none", 1.2)
    add_line(items, f"{code}-L4-photo-top-catch", 78, 84, 626, 84, light, 2.0)
    add_line(items, f"{code}-L4-photo-left-catch", 60, 116, 60, 858, light, 1.6)
    add_line(items, f"{code}-L4-photo-bottom-seam", 79, 910, 626, 910, line, 1.1)
    add_line(items, f"{code}-L4-photo-right-seam", 660, 116, 660, 858, line, 1.1)
    add_photo_corner(items, f"{code}-L4-photo-corner-tl", 69, 94, 1, 1, light, line, gold)
    add_photo_corner(items, f"{code}-L4-photo-corner-tr", 651, 94, -1, 1, light, line, gold)
    add_photo_corner(items, f"{code}-L4-photo-corner-bl", 69, 900, 1, -1, light, line, gold)
    add_photo_corner(items, f"{code}-L4-photo-corner-br", 651, 900, -1, -1, light, line, gold)

    badge = [[44, 42], [160, 42], [186, 68], [186, 174], [160, 202], [70, 202], [44, 174], [44, 68]]
    add(items, f"{code}-L4-label-plate", badge, True, line, panel, 1.4)
    inner_badge = [[52, 51], [153, 51], [176, 75], [176, 168], [153, 193], [76, 193], [52, 168], [52, 75]]
    add(items, f"{code}-L4-label-plate-inner", inner_badge, True, light, "none", 3.0)
    add_line(items, f"{code}-L4-label-highlight-top", 65, 59, 148, 59, light, 2.0)
    add_line(items, f"{code}-L4-label-highlight-left", 58, 76, 58, 157, light, 1.5)
    add_line(items, f"{code}-L4-label-accent-bottom", 76, 193, 153, 193, gold, 1.0)
    add(items, f"{code}-L4-label-rivet-top", [[153, 61], [157, 57], [161, 61], [157, 65]], True, light, light, 0.9)
    add(items, f"{code}-L4-label-rivet-bottom", [[70, 184], [72.5, 181.5], [75, 184], [72.5, 186.5]], True, gold, gold, 0.7)

    add(items, f"{code}-L4-number-plate", rounded_rect(385, 80, 663, 159, 18), True, line, light, 2.0)
    add(items, f"{code}-L4-number-plate-inner", rounded_rect(394, 89, 654, 150, 12), True, gold, "none", 1.0)

    add_ellipse(items, f"{code}-L4-score-seal", 604, 1009, 64, 64, line, panel, 2.0)
    add_ellipse(items, f"{code}-L4-score-seal-gold", 604, 1009, 56, 56, gold, "none", 2.0)
    add_ellipse(items, f"{code}-L4-score-seal-light", 604, 1009, 48, 48, light, "none", 2.0)

    add_line(items, f"{code}-L4-name-divider", 104, 1057, 519, 1057, gold, 1.2)
    add_ellipse(items, f"{code}-L4-name-divider-stud", 360, 1058, 5, 5, gold, panel, 1.0)

    add(items, f"{code}-L4-metric-module", rounded_rect(55, 1195, 665, 1365, 15), True, line, panel, 2.0)
    add(items, f"{code}-L4-metric-module-inner", rounded_rect(63, 1203, 657, 1357, 10), True, gold, "none", 1.4)
    add(items, f"{code}-L4-metric-module-lip", rounded_rect(67, 1207, 653, 1353, 7), True, light, "none", 1.0)
    for idx, (x0, x1) in enumerate([(69, 250), (272, 453), (475, 656)], start=1):
        add(items, f"{code}-L4-metric-cell-{idx}", rounded_rect(x0, 1212, x1, 1349, 8), True, light, "none", 1.1)
        add_line(items, f"{code}-L4-metric-cell-{idx}-top", x0 + 12, 1218, x1 - 12, 1218, light, 1.3)
        add_line(items, f"{code}-L4-metric-cell-{idx}-bottom", x0 + 13, 1343, x1 - 13, 1343, line, 0.9)
    for x, idx in [(258, 1), (461, 2)]:
        add_line(items, f"{code}-L4-metric-divider-{idx}", x, 1210, x, 1352, line, 1.2)
        add_line(items, f"{code}-L4-metric-divider-{idx}-highlight", x + 2, 1210, x + 2, 1352, light, 1.0)
        add_ellipse(items, f"{code}-L4-metric-divider-{idx}-top-stud", x + 1, 1209, 4, 4, gold, panel, 1.0)
        add_ellipse(items, f"{code}-L4-metric-divider-{idx}-bottom-stud", x + 1, 1352, 3, 3, gold, panel, 1.0)

    # Icon outlines. These are intentionally simple editable paths; the raster
    # layer remains the visual fallback and the paths are the source geometry.
    cat = [[81, 1280], [84, 1259], [96, 1268], [110, 1268], [122, 1259], [125, 1280], [125, 1302], [81, 1302]]
    add(items, f"{code}-L4-icon-cat-face", cat, True, line, "none", 2.0)
    add_ellipse(items, f"{code}-L4-icon-cat-eye-l", 91, 1283, 3, 3, line, line, 1.0)
    add_ellipse(items, f"{code}-L4-icon-cat-eye-r", 115, 1283, 3, 3, line, line, 1.0)
    eye = [[271, 1284], [281, 1274], [296, 1268], [306, 1266], [318, 1270], [333, 1276], [341, 1284], [333, 1292], [318, 1298], [306, 1302], [294, 1298], [281, 1292]]
    add(items, f"{code}-L4-icon-eye", eye, True, line, "none", 2.0)
    add_ellipse(items, f"{code}-L4-icon-eye-pupil", 306, 1284, 13, 13, line, "none", 2.0)
    add_ellipse(items, f"{code}-L4-icon-eye-pupil-core", 306, 1284, 4, 4, line, line, 1.0)
    moon = []
    for i in range(25):
        a = math.radians(48 + (312 - 48) * i / 24)
        moon.append([509 + 25 * math.cos(a), 1284 + 25 * math.sin(a)])
    add(items, f"{code}-L4-icon-moon", moon, False, line, "none", 3.0)
    add_ellipse(items, f"{code}-L4-icon-moon-star-1", 538, 1264, 2, 2, line, line, 1.0)
    add_ellipse(items, f"{code}-L4-icon-moon-star-2", 546, 1279, 2, 2, line, line, 1.0)

    return items


def points_to_svg_path(points, closed):
    d = "M " + " ".join(f"{x:g},{y:g}" for x, y in points)
    return d + (" Z" if closed else "")


def write_svg(code, items, path, viewbox=None):
    if viewbox is None:
        svg_width, svg_height, svg_viewbox = W, H, f"0 0 {W} {H}"
    else:
        vx, vy, vw, vh = viewbox
        svg_width, svg_height, svg_viewbox = vw, vh, f"{vx} {vy} {vw} {vh}"
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{svg_width}" height="{svg_height}" viewBox="{svg_viewbox}">']
    parts.append(f"  <title>{code} fixed card vector paths</title>")
    for item in items:
        d = points_to_svg_path(item["points"], item["closed"])
        stroke = item["stroke"] or "none"
        fill = item["fill"] or "none"
        width = item["width"]
        parts.append(
            f'  <path id="{item["name"]}" d="{d}" fill="{fill}" stroke="{stroke}" stroke-width="{width}" stroke-linejoin="round" stroke-linecap="round"/>'
        )
    parts.append("</svg>\n")
    path.write_text("\n".join(parts), encoding="utf-8")


def write_jsx_specs(all_specs, path):
    # ASCII path names make the ExtendScript import reliable on older Photoshop
    # builds; the accompanying SVGs retain the full descriptive names.
    payload = json.dumps(all_specs, ensure_ascii=True, separators=(",", ":"))
    path.write_text("var VECTOR_PATH_SPECS = " + payload + ";\n", encoding="utf-8")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    all_specs = {}
    for code in THEMES:
        items = build_paths(code)
        all_specs[code] = items
        write_svg(code, items, OUT / f"{code}-fixed-artwork-editable.svg")
        (OUT / f"{code}-fixed-artwork-path-spec.json").write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
        label_items = [item for item in items if f"{code}-L4-label-" in item["name"]]
        write_svg(code, label_items, OUT / f"{code}-rarity-label-editable.svg", viewbox=(34, 32, 165, 183))
        (OUT / f"{code}-rarity-label-path-spec.json").write_text(json.dumps(label_items, ensure_ascii=False, indent=2), encoding="utf-8")
    write_jsx_specs(all_specs, OUT / "vector-path-specs.jsxinc")
    print(OUT)


if __name__ == "__main__":
    main()
