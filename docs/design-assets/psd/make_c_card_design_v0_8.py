"""Compose the v0.8 C-card style checkpoint.

The elements remain, but the treatment is intentionally reduced to one
primary border per object, flat low-contrast fills, and restrained typography.
This is a review image only; it does not modify the PSD.
"""

from pathlib import Path

from PIL import Image


BASE = Path(__file__).resolve().parent / "rarity-masters-v0-2" / "C"
OUT = BASE / "C-design-draft-v0-8-minimal-style.png"

L1 = [
    "L1-01-outer-gradient-C.png",
    "L1-03-surface-C.png",
    "L1-04-panel-C.png",
    "L1-06-photo-shadow-C.png",
]
L4 = [
    "L4-01-frame-primary-line-C.png",
    "L4-10-photo-aperture-primary-C.png",
    "L4-20-number-fill-C.png",
    "L4-21-number-primary-line-C.png",
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
]
LABEL = [
    "L4A-small-02-label-fill-C.png",
    "L4A-small-03-label-primary-line-C.png",
]


def load(name: str) -> Image.Image:
    return Image.open(BASE / name).convert("RGBA")


def transform(image: Image.Image, scale=1.0, pivot=(0.0, 0.0), dx=0.0, dy=0.0) -> Image.Image:
    if scale == 1.0:
        result = Image.new("RGBA", image.size, (0, 0, 0, 0))
        result.alpha_composite(image, dest=(round(dx), round(dy)))
        return result
    px, py = pivot
    inverse = (
        1.0 / scale,
        0.0,
        px - (px + dx) / scale,
        0.0,
        1.0 / scale,
        py - (py + dy) / scale,
    )
    return image.transform(
        image.size,
        Image.Transform.AFFINE,
        inverse,
        resample=Image.Resampling.BICUBIC,
        fillcolor=(0, 0, 0, 0),
    )


def main() -> None:
    art = Image.new("RGBA", (720, 1420), (0, 0, 0, 0))

    def add(image: Image.Image) -> None:
        art.alpha_composite(image)

    for name in L1:
        add(load(name))
    add(load("L2-background-replaceable-C.png"))
    add(load("L3-cat-slot-placeholder-C.png"))
    for name in L4:
        add(load(name))

    # Badge: retain the element, but reduce it to a small unobtrusive marker.
    badge_ratio = 0.60 / 0.72
    for name in LABEL:
        add(transform(load(name), badge_ratio, (44.0, 42.0)))
    add(load("L4-24-number-prefix-C.png"))
    add(transform(load("L4A-small-08-label-letter-C.png"), badge_ratio, (44.0, 42.0)))

    # Text and score remain left/right aligned to the existing grid; only the
    # visual weight is reduced for the style review.
    add(load("L5-01-number-value-C.png"))
    add(transform(load("L5-02-pet-name-C.png"), 0.84, (104.0, 1009.0)))
    add(transform(load("L5-03-copy-line-one-C.png"), 0.86, (104.0, 1140.0), 0.0, -5.0))
    add(transform(load("L5-04-copy-line-two-C.png"), 0.86, (104.0, 1140.0), 0.0, -5.0))

    # One clean score ring, with the fixed label under the replaceable score.
    score_ratio = 0.82 / 0.90
    add(transform(load("L4-26-score-fill-C.png"), score_ratio, (604.0, 1048.0)))
    add(transform(load("L4-27-score-primary-line-C.png"), score_ratio, (604.0, 1048.0)))
    add(transform(load("L4-31-score-title-C.png"), score_ratio, (604.0, 1048.0)))
    add(transform(load("L5-05-score-C.png"), score_ratio, (604.0, 1048.0)))
    for name in ["L5-06-charm-C.png", "L5-07-clever-C.png", "L5-08-aura-C.png"]:
        add(load(name))

    art.save(OUT, "PNG")
    print(OUT)


if __name__ == "__main__":
    main()
