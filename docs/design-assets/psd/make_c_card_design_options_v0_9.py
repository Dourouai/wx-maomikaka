"""Render three C-card design directions for visual review only.

The source photo, cat silhouette, content positions, and information elements
stay consistent. The options change the treatment: quiet specimen, archival
ticket, and dark botanical plaque.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


BASE = Path(__file__).resolve().parent / "rarity-masters-v0-2" / "C"
OUT = BASE

L1_MINIMAL = [
    "L1-01-outer-gradient-C.png",
    "L1-03-surface-C.png",
    "L1-04-panel-C.png",
    "L1-06-photo-shadow-C.png",
]
L1_TICKET = [
    "L1-01-outer-gradient-C.png",
    "L1-02-shell-inner-C.png",
    "L1-04-panel-C.png",
    "L1-06-photo-shadow-C.png",
]
L1_DARK = [
    "L1-01-outer-gradient-C.png",
    "L1-02-shell-inner-C.png",
    "L1-03-surface-C.png",
    "L1-04-panel-C.png",
    "L1-06-photo-shadow-C.png",
]
PHOTO = ["L2-background-replaceable-C.png", "L3-cat-slot-placeholder-C.png"]
FRAME = ["L4-01-frame-primary-line-C.png", "L4-10-photo-aperture-primary-C.png"]
NUMBER = ["L4-20-number-fill-C.png", "L4-21-number-primary-line-C.png"]
SCORE = ["L4-26-score-fill-C.png", "L4-27-score-primary-line-C.png"]
NAME = ["L4-32-name-divider-C.png"]
METRIC_CORE = [
    "L4-41-metric-module-fill-C.png",
    "L4-42-metric-cell-1-fill-C.png",
    "L4-43-metric-cell-2-fill-C.png",
    "L4-44-metric-cell-3-fill-C.png",
    "L4-45-metric-module-primary-line-C.png",
    "L4-57-metric-divider-1-deep-C.png",
    "L4-60-metric-divider-2-deep-C.png",
]
ICONS = ["L4-64-icon-charm-C.png", "L4-65-icon-clever-C.png", "L4-66-icon-aura-C.png"]
TEXT = [
    "L4-24-number-prefix-C.png",
    "L5-01-number-value-C.png",
    "L5-02-pet-name-C.png",
    "L5-03-copy-line-one-C.png",
    "L5-04-copy-line-two-C.png",
    "L4-31-score-title-C.png",
    "L5-05-score-C.png",
    "L5-06-charm-C.png",
    "L5-07-clever-C.png",
    "L5-08-aura-C.png",
]

OPTIONS = {
    "a": {
        "slug": "C-design-option-a-specimen",
        "title": "A｜留白标本",
        "board_title": "A / SPECIMEN",
        "dark": (61, 82, 65),
        "light": (248, 252, 237),
        "panel": (239, 248, 227),
        "metric": (249, 252, 239),
        "cream": (248, 252, 237),
        "l1": L1_MINIMAL,
        "metric_mode": "rounded",
        "badge_mode": "polygon",
        "title_scale": 0.84,
        "copy_scale": 0.86,
    },
    "b": {
        "slug": "C-design-option-b-archive-ticket",
        "title": "B｜档案票据",
        "board_title": "B / ARCHIVE",
        "dark": (91, 67, 47),
        "light": (255, 249, 232),
        "panel": (248, 239, 216),
        "metric": (255, 247, 226),
        "cream": (255, 249, 232),
        "l1": L1_TICKET,
        "metric_mode": "ticket",
        "badge_mode": "ticket",
        "title_scale": 0.78,
        "copy_scale": 0.82,
    },
    "c": {
        "slug": "C-design-option-c-dark-botanical",
        "title": "C｜深框植物",
        "board_title": "C / BOTANICAL",
        "dark": (40, 70, 59),
        "light": (246, 244, 226),
        "panel": (230, 238, 216),
        "metric": (53, 83, 67),
        "cream": (246, 244, 226),
        "l1": L1_DARK,
        "metric_mode": "dark",
        "badge_mode": "polygon",
        "title_scale": 0.88,
        "copy_scale": 0.84,
    },
}


def load(name: str) -> Image.Image:
    return Image.open(BASE / name).convert("RGBA")


def recolor(image: Image.Image, dark, light) -> Image.Image:
    """Map a fixed green source component to the option's two-tone palette."""
    alpha = image.getchannel("A")
    result = ImageOps.colorize(ImageOps.grayscale(image), black=dark, white=light)
    result.putalpha(alpha)
    return result


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


def add(art: Image.Image, name: str, option: dict, *, raw=False, tone=None) -> None:
    image = load(name)
    if not raw:
        dark, light = tone or (option["dark"], option["light"])
        image = recolor(image, dark, light)
    art.alpha_composite(image)


def draw_badge(art: Image.Image, option: dict) -> None:
    draw = ImageDraw.Draw(art)
    dark = option["dark"]
    light = option["light"]
    if option["badge_mode"] == "ticket":
        draw.rounded_rectangle((47, 53, 145, 147), radius=10, fill=light, outline=dark, width=2)
        draw.line((57, 62, 135, 62), fill=light, width=2)
    else:
        badge_ratio = 0.60 / 0.72
        badge = transform(recolor(load("L4A-small-02-label-fill-C.png"), dark, light), badge_ratio, (44, 42))
        outline = transform(recolor(load("L4A-small-03-label-primary-line-C.png"), dark, light), badge_ratio, (44, 42))
        art.alpha_composite(badge)
        art.alpha_composite(outline)
    letter = transform(recolor(load("L4A-small-08-label-letter-C.png"), dark, light), 0.60 / 0.72, (44, 42))
    art.alpha_composite(letter)


def draw_ticket_metrics(art: Image.Image, option: dict) -> None:
    draw = ImageDraw.Draw(art)
    dark = option["dark"]
    fill = option["metric"]
    draw.rounded_rectangle((55, 1178, 665, 1348), radius=7, fill=fill, outline=dark, width=2)
    draw.line((258, 1185, 258, 1341), fill=dark, width=1)
    draw.line((461, 1185, 461, 1341), fill=dark, width=1)


def draw_dark_metrics(art: Image.Image, option: dict) -> None:
    draw = ImageDraw.Draw(art)
    draw.rounded_rectangle((55, 1178, 665, 1348), radius=12, fill=option["metric"], outline=option["dark"], width=2)
    draw.line((258, 1185, 258, 1341), fill=option["cream"], width=1)
    draw.line((461, 1185, 461, 1341), fill=option["cream"], width=1)


def compose(option: dict) -> Image.Image:
    art = Image.new("RGBA", (720, 1420), (0, 0, 0, 0))
    for name in option["l1"]:
        add(art, name, option)
    for name in PHOTO:
        add(art, name, option, raw=True)
    for name in FRAME + NUMBER + NAME:
        add(art, name, option)

    if option["metric_mode"] == "rounded":
        for name in METRIC_CORE:
            add(art, name, option)
        icon_tone = None
    elif option["metric_mode"] == "ticket":
        draw_ticket_metrics(art, option)
        icon_tone = None
    else:
        draw_dark_metrics(art, option)
        icon_tone = (option["cream"], option["cream"])
    for name in ICONS:
        add(art, name, option, tone=icon_tone)

    draw_badge(art, option)
    add(art, "L4-24-number-prefix-C.png", option)
    add(art, "L5-01-number-value-C.png", option)

    score_ratio = 0.82 / 0.90
    score_fill = transform(recolor(load("L4-26-score-fill-C.png"), option["dark"], option["light"]), score_ratio, (604, 1048))
    score_line = transform(recolor(load("L4-27-score-primary-line-C.png"), option["dark"], option["light"]), score_ratio, (604, 1048))
    score_title = transform(recolor(load("L4-31-score-title-C.png"), option["dark"], option["light"]), score_ratio, (604, 1048))
    score_value = transform(recolor(load("L5-05-score-C.png"), option["dark"], option["light"]), score_ratio, (604, 1048))
    art.alpha_composite(score_fill)
    art.alpha_composite(score_line)
    art.alpha_composite(score_title)
    art.alpha_composite(score_value)

    # Weight of title/copy differs by direction, but their left anchor stays fixed.
    title = transform(recolor(load("L5-02-pet-name-C.png"), option["dark"], option["light"]), option["title_scale"], (104, 1009))
    copy_one = transform(recolor(load("L5-03-copy-line-one-C.png"), option["dark"], option["light"]), option["copy_scale"], (104, 1140), dy=-5)
    copy_two = transform(recolor(load("L5-04-copy-line-two-C.png"), option["dark"], option["light"]), option["copy_scale"], (104, 1140), dy=-5)
    # Repaint the earlier text once so each option keeps its intended weight.
    # The earlier copies are covered by the same transparent glyph bounds.
    art.alpha_composite(title)
    art.alpha_composite(copy_one)
    art.alpha_composite(copy_two)

    for name in ["L5-06-charm-C.png", "L5-07-clever-C.png", "L5-08-aura-C.png"]:
        add(art, name, option, tone=icon_tone)
    return art


def main() -> None:
    rendered = []
    for key, option in OPTIONS.items():
        image = compose(option)
        target = OUT / f"{option['slug']}.png"
        image.save(target, "PNG")
        rendered.append((option["board_title"], image))
        print(target)

    board = Image.new("RGBA", (930, 590), (235, 232, 222, 255))
    draw = ImageDraw.Draw(board)
    for index, (title, image) in enumerate(rendered):
        thumb = image.resize((270, 532), Image.Resampling.LANCZOS)
        x = 20 + index * 305
        board.alpha_composite(thumb, dest=(x, 38))
        draw.text((x, 14), title, fill=(45, 45, 42, 255))
    board_path = OUT / "C-design-options-v0-9-board.png"
    board.convert("RGB").save(board_path, "PNG")
    print(board_path)


if __name__ == "__main__":
    main()
