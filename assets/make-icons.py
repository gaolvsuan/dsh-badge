"""Generate the dsh-badge icons.

Two marks, four colours each:

  icon-fluke-*  the traced whale fluke on a coloured tile, badge in the corner
  icon-dot-*    the badge alone: a disc with the count

Run it with the bundled Python:

    python assets/make-icons.py

The fluke shape lives in assets/source/fluke-mask.png, traced once from the
author's reference so regeneration needs no screenshot.
"""

import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\segoeuib.ttf",
    r"C:\Windows\Fonts\arialbd.ttf",
    r"C:\Windows\Fonts\seguisb.ttf",
]

COLORS = {
    "purple": "#8b5cf6",
    "red": "#f5455c",
    "blue": "#3b82f6",
    "green": "#10b981",
}

MAIN = 512


def load_font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def rounded_tile(size, radius, fill):
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(image).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=fill)
    return image


APP_ICON_CANDIDATES = [
    r"C:\Users\yct\AppData\Local\Programs\DeepSeek Harness\resources\icon.png",
    os.path.join(HERE, "source", "dsh-icon.png"),
]


def load_app_icon():
    for path in APP_ICON_CANDIDATES:
        if os.path.exists(path):
            return Image.open(path).convert("RGBA")
    return None


def app_icon(size, color, text="1"):
    """The DeepSeek Harness mark with the badge over its top-right corner.

    This one carries the host's own logo, so it is kept as an alternative for
    people who want the storefront tile to look exactly like the taskbar.
    """
    source = load_app_icon()
    if source is None:
        return None

    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    image.alpha_composite(source.resize((size, size), Image.LANCZOS))

    radius = int(size * 0.26)
    gap = int(size * 0.015)
    cx = size - radius - gap
    cy = radius + gap

    disc = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    disc_draw = ImageDraw.Draw(disc)
    disc_draw.ellipse(
        [cx - radius, cy - radius, cx + radius, cy + radius],
        fill=color,
        outline="#ffffff",
        width=max(3, int(size * 0.022)),
    )
    image.alpha_composite(disc)

    font = load_font(int(radius * 1.05))
    ImageDraw.Draw(image).text((cx, cy), text, font=font, fill="#ffffff", anchor="mm")
    return image


def fluke_mask(size):
    path = os.path.join(HERE, "source", "fluke-mask.png")
    if not os.path.exists(path):
        return None
    return Image.open(path).convert("L").resize((size, size), Image.LANCZOS)


def fluke_icon(size, color, text="1"):
    """The traced fluke on a tile, with the count pinned to its corner."""
    image = rounded_tile(size, int(size * 0.22), color)

    mask = fluke_mask(size)
    if mask is not None:
        inner = int(size * 0.64)
        left = int(size * 0.06)
        top = int(size * 0.30)
        shape = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        shape.paste(
            Image.new("RGBA", (inner, inner), "#ffffff"),
            (left, top),
            mask.resize((inner, inner), Image.LANCZOS),
        )
        image.alpha_composite(shape)

    radius = int(size * 0.21)
    gap = int(size * 0.02)
    cx = size - radius - gap
    cy = radius + gap

    disc = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    disc_draw = ImageDraw.Draw(disc)
    disc_draw.ellipse(
        [cx - radius, cy - radius, cx + radius, cy + radius],
        fill=color,
        outline="#ffffff",
        width=max(3, int(size * 0.02)),
    )
    image.alpha_composite(disc)

    font = load_font(int(radius * 1.05))
    ImageDraw.Draw(image).text((cx, cy), text, font=font, fill="#ffffff", anchor="mm")
    return image


def dot_icon(size, color, text="1"):
    """The badge alone: a disc with the count, nothing to decode."""
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.ellipse([0, 0, size - 1, size - 1], fill=color)
    draw.text(
        (size / 2, size / 2),
        text,
        font=load_font(int(size * 0.58)),
        fill="#ffffff",
        anchor="mm",
    )
    return image


def save(image, name):
    path = os.path.join(HERE, name)
    image.save(path, "PNG")
    print(f"{name}\t{image.size[0]}x{image.size[1]}\t{os.path.getsize(path)} bytes")


def main():
    for color_name, hex_value in COLORS.items():
        save(fluke_icon(MAIN, hex_value), f"icon-fluke-{color_name}-{MAIN}.png")
        save(dot_icon(MAIN, hex_value), f"icon-dot-{color_name}-{MAIN}.png")
        save(app_icon(MAIN, hex_value), f"icon-app-{color_name}-{MAIN}.png")

    # The files the README, the screenshots list and the market entry point at.
    save(fluke_icon(MAIN, COLORS["purple"]), "icon-fluke-512.png")
    save(fluke_icon(180, COLORS["purple"]), "icon-fluke-180.png")
    save(dot_icon(MAIN, COLORS["red"]), "icon-dot-512.png")
    save(dot_icon(180, COLORS["red"]), "icon-dot-180.png")
    save(app_icon(180, COLORS["purple"]), "icon-app-180.png")


if __name__ == "__main__":
    main()
