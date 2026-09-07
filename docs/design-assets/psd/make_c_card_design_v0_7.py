"""Compose a review-only C-card design draft from the v0.6 components.

This file deliberately does not touch the PSD. It is the visual checkpoint
for the next pass: a smaller C badge, a smaller score seal, and a safe gap
between the two-line copy and the metric module.
"""

from pathlib import Path

from PIL import Image


BASE = Path(__file__).resolve().parent / "rarity-masters-v0-2" / "C"
OUT = BASE / "C-design-draft-v0-7-simple.png"

L1 = [
    "L1-01-outer-gradient-C.png",
    "L1-02-shell-inner-C.png",
    "L1-03-surface-C.png",
    "L1-04-panel-C.png",
    "L1-05-panel-inner-C.png",
    "L1-06-photo-shadow-C.png",
    "L1-07-paper-highlight-C.png",
]
L4 = [
    "L4-01-frame-primary-line-C.png",
    "L4-04-frame-highlight-line-C.png",
    "L4-07-photo-recess-deep-C.png",
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
    "L4A-small-04-label-inner-highlight-C.png",
]
METRICS = ["L5-06-charm-C.png", "L5-07-clever-C.png", "L5-08-aura-C.png"]


def load(name: str) -> Image.Image:
    return Image.open(BASE / name).convert("RGBA")


def transform(image: Image.Image, scale=1.0, pivot=(0.0, 0.0), dx=0.0, dy=0.0) -> Image.Image:
    px, py = pivot
    if scale == 1.0:
        result = Image.new("RGBA", image.size, (0, 0, 0, 0))
        result.alpha_composite(image, dest=(round(dx), round(dy)))
        return result
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

    # The review draft keeps only the simplified active line set.
    for name in L4:
        add(load(name))

    # Reduce the already-small badge from 72% to 60% of the original plate.
    label_ratio = 0.60 / 0.72
    for name in LABEL:
        add(transform(load(name), label_ratio, (44.0, 42.0)))

    add(load("L4-24-number-prefix-C.png"))
    add(transform(load("L4A-small-08-label-letter-C.png"), label_ratio, (44.0, 42.0)))

    add(load("L5-01-number-value-C.png"))
    add(load("L5-02-pet-name-C.png"))
    # Net copy offset becomes +20 px from the original source coordinate,
    # leaving a visible breathing gap before the metric module at y=1178.
    add(transform(load("L5-03-copy-line-one-C.png"), 1.0, dy=-11))
    add(transform(load("L5-04-copy-line-two-C.png"), 1.0, dy=-11))
    # Keep the score stack ordered: fill/line first, then fixed MIKA, then
    # the replaceable score value on top.
    add(transform(load("L4-26-score-fill-C.png"), 0.82 / 0.90, (604.0, 1048.0)))
    add(transform(load("L4-27-score-primary-line-C.png"), 0.82 / 0.90, (604.0, 1048.0)))
    add(transform(load("L4-31-score-title-C.png"), 0.82 / 0.90, (604.0, 1048.0)))
    add(transform(load("L5-05-score-C.png"), 0.82 / 0.90, (604.0, 1048.0)))
    for name in METRICS:
        add(load(name))

    art.save(OUT, "PNG")
    print(OUT)


if __name__ == "__main__":
    main()
