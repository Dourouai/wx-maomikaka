from pathlib import Path

from PIL import Image


BASE = Path(__file__).resolve().parent / "rarity-masters-v0-2" / "C"
SCALE = 0.72
PIVOT_X = 44.0
PIVOT_Y = 42.0


def main() -> None:
    for source in sorted(BASE.glob("L4A-*.png")):
        target_name = "L4A-small-" + source.name[len("L4A-"):]
        target = BASE / target_name
        image = Image.open(source).convert("RGBA")
        # Scale only the label artwork around the original top-left anchor;
        # the output remains a full 720x1420 transparent canvas.
        inverse = (
            1.0 / SCALE,
            0.0,
            (SCALE - 1.0) / SCALE * PIVOT_X,
            0.0,
            1.0 / SCALE,
            (SCALE - 1.0) / SCALE * PIVOT_Y,
        )
        scaled = image.transform(
            image.size,
            Image.Transform.AFFINE,
            inverse,
            resample=Image.Resampling.LANCZOS,
        )
        scaled.save(target)
        print(target)


if __name__ == "__main__":
    main()
