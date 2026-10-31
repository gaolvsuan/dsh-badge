"""Generate the dsh-badge icons.

Two families:

  icon-*.png      the badge on its own: a numbered disc on a rounded tile
  icon-app-*.png  the same badge over the DeepSeek Harness app icon, which is
                  what the taskbar actually looks like and reads faster in a
                  storefront tile

Run it with the bundled Python:

    python assets/make-icons.py

The app-icon family needs the DSH icon. It is read from the installed
application; nothing else in the repository depends on it.
"""

import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\segoeuib.ttf",
    r"C:\Windows\Fonts\arialbd.ttf",
    r"C:\Windows\Fonts\seguisb.ttf",
]

APP_ICON_CANDIDATES = [
    r"C:\Users\yct\AppData\Local\Programs\DeepSeek Harness\resources\icon.png",
    os.path.join(HERE, "source", "dsh-icon.png"),
]

COLORS = {
    "purple": "#8b5cf6",
    "red": "#f5455c",
    "blue": "#3b82f6",
    "green": "#10b981",
}

DARK = "#151823"


def load_font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def load_app_icon():
    for path in APP_ICON_CANDIDATES:
        if os.path.exists(path):
            return Image.open(path).convert("RGBA")
    return None


def rounded_tile(size, radius, fill, background=None):
    image = Image.new("RGBA", (size, size), background or (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=fill)
    return image


def draw_number(image, text, color, size_ratio=0.52, center=None):
    size = image.size[0]
    font = load_font(int(size * size_ratio))
    draw = ImageDraw.Draw(image)
    cx, cy = center or (size / 2, size / 2)
    draw.text((cx, cy), text, font=font, fill=color, anchor="mm")
    return image


def solid_icon(size, color, text="1"):
    """The badge itself: a coloured rounded tile with a white numeral."""
    image = rounded_tile(size, int(size * 0.22), color)
    return draw_number(image, text, "#ffffff")


def ring_icon(size, color, text="1"):
    """A dark tile with the coloured disc sitting on it, as the taskbar shows."""
    image = rounded_tile(size, int(size * 0.22), DARK)
    disc = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(disc)
    margin = int(size * 0.14)
    draw.ellipse([margin, margin, size - margin, size - margin], fill=color)
    image.alpha_composite(disc)
    return draw_number(image, text, "#ffffff", 0.34)


def disc_icon(size, color, text="1"):
    """Transparent background, disc only."""
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.ellipse([0, 0, size - 1, size - 1], fill=color)
    return draw_number(image, text, "#ffffff", 0.5)


def app_icon(size, color, text="1", corners=None):
    """The app icon with the badge over its top-right corner.

    `corners` masks the tile so only the named corners stay rounded, which gives
    the app mark the same quarter shape as the corner family.
    """
    source = load_app_icon()
    if source is None:
        return None

    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    base = source.resize((size, size), Image.LANCZOS)

    if corners is None:
        image.alpha_composite(base)
    else:
        radius = int(size * 0.30)
        mask = Image.new("L", (size, size), 0)
        mask_draw = ImageDraw.Draw(mask)
        mask_draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
        for corner in ("tl", "tr", "bl", "br"):
            if corner in corners:
                continue
            box = {
                "tl": [0, 0, radius, radius],
                "tr": [size - radius - 1, 0, size - 1, radius],
                "bl": [0, size - radius - 1, radius, size - 1],
                "br": [size - radius - 1, size - radius - 1, size - 1, size - 1],
            }[corner]
            mask_draw.rectangle(box, fill=255)
        # The source tile is already rounded with transparency behind it, so the
        # squared-off corners need the tile's own background colour behind them.
        background = base.getpixel((size // 2, int(size * 0.05)))[:3]
        canvas = Image.new("RGBA", (size, size), background + (255,))
        canvas.alpha_composite(base)
        image.paste(canvas, (0, 0), mask)

    radius = int(size * 0.26)
    gap = int(size * 0.015)
    cx = size - radius - gap
    cy = radius + gap

    disc = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(disc)
    draw.ellipse(
        [cx - radius, cy - radius, cx + radius, cy + radius],
        fill=color,
        outline="#ffffff",
        width=max(3, int(size * 0.022)),
    )
    image.alpha_composite(disc)

    font = load_font(int(radius * 1.05))
    ImageDraw.Draw(image).text((cx, cy), text, font=font, fill="#ffffff", anchor="mm")
    return image


def corner_icon(size, color, rounded=("tl",), text="1", radius_ratio=0.30):
    """A tile with only the named corners rounded, the rest squared off.

    Pillow rounds every corner equally, so the unwanted ones are painted back
    square with the same fill after the fact.
    """
    radius = int(size * radius_ratio)
    image = rounded_tile(size, radius, color)
    draw = ImageDraw.Draw(image)
    if "tl" not in rounded:
        draw.rectangle([0, 0, radius, radius], fill=color)
    if "tr" not in rounded:
        draw.rectangle([size - radius - 1, 0, size - 1, radius], fill=color)
    if "bl" not in rounded:
        draw.rectangle([0, size - radius - 1, radius, size - 1], fill=color)
    if "br" not in rounded:
        draw.rectangle([size - radius - 1, size - radius - 1, size - 1, size - 1], fill=color)
    return draw_number(image, text, "#ffffff", 0.5)


def quarter_icon(size, color, text="1"):
    """A quarter disc: the right angle at the bottom-right, the arc opposite."""
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.pieslice([0, 0, size * 2, size * 2], start=180, end=270, fill=color)
    return draw_number(image, text, "#ffffff", 0.34, center=(size * 0.58, size * 0.58))


def whale_mask(size):
    """Alpha mask of the app mark's dark ink, so it can be recoloured."""
    source = load_app_icon()
    if source is None:
        return None
    resized = source.resize((size, size), Image.LANCZOS).convert("RGBA")
    pixels = resized.load()
    mask = Image.new("L", (size, size), 0)
    mask_pixels = mask.load()
    for y in range(size):
        for x in range(size):
            red, green, blue, alpha = pixels[x, y]
            if alpha > 40 and (red + green + blue) / 3 < 120:
                mask_pixels[x, y] = 255
    return mask


def app_corner_icon(size, color, corners=("tl",), text="1"):
    """Dark tile in the quarter shape, white whale, badge in the corner."""
    radius = int(size * 0.30)
    image = rounded_tile(size, radius, DARK)
    draw = ImageDraw.Draw(image)
    boxes = {
        "tl": [0, 0, radius, radius],
        "tr": [size - radius - 1, 0, size - 1, radius],
        "bl": [0, size - radius - 1, radius, size - 1],
        "br": [size - radius - 1, size - radius - 1, size - 1, size - 1],
    }
    for corner, box in boxes.items():
        if corner not in corners:
            draw.rectangle(box, fill=DARK)

    mask = whale_mask(size)
    if mask is not None:
        image.paste(Image.new("RGBA", (size, size), "#ffffff"), (0, 0), mask)

    badge_radius = int(size * 0.24)
    gap = int(size * 0.02)
    cx = size - badge_radius - gap
    cy = badge_radius + gap

    disc = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    disc_draw = ImageDraw.Draw(disc)
    disc_draw.ellipse(
        [cx - badge_radius, cy - badge_radius, cx + badge_radius, cy + badge_radius],
        fill=color,
        outline="#ffffff",
        width=max(3, int(size * 0.02)),
    )
    image.alpha_composite(disc)

    font = load_font(int(badge_radius * 1.05))
    ImageDraw.Draw(image).text((cx, cy), text, font=font, fill="#ffffff", anchor="mm")
    return image


def save(image, name):
    if image is None:
        print(f"{name}\tskipped, no app icon found")
        return
    path = os.path.join(HERE, name)
    image.save(path, "PNG")
    print(f"{name}\t{image.size[0]}x{image.size[1]}\t{os.path.getsize(path)} bytes")


def main():
    for color_name, hex_value in COLORS.items():
        save(solid_icon(512, hex_value), f"icon-{color_name}-512.png")

    for size in (512, 256, 180):
        save(solid_icon(size, COLORS["purple"]), f"icon-{size}.png")

    save(ring_icon(512, COLORS["purple"]), "icon-ring-512.png")
    save(disc_icon(512, COLORS["purple"]), "icon-disc-512.png")

    for size in (512, 256, 180):
        save(app_icon(size, COLORS["purple"]), f"icon-app-{size}.png")
    for color_name in ("red", "blue", "green"):
        save(app_icon(512, COLORS[color_name]), f"icon-app-{color_name}-512.png")

    # Corner variants: only the named corners are rounded.
    corner_variants = {
        "tl": ("tl",),
        "top": ("tl", "tr"),
        "left": ("tl", "bl"),
        "diag": ("tl", "br"),
        "tr": ("tr",),
    }
    for name, corners in corner_variants.items():
        for size in (512, 180):
            save(corner_icon(size, COLORS["purple"], corners), f"icon-corner-{name}-{size}.png")
    for size in (512, 180):
        save(quarter_icon(size, COLORS["purple"]), f"icon-quarter-{size}.png")

    # The app mark cut to the same corner shapes.
    for name, corners in corner_variants.items():
        for size in (512, 180):
            save(app_icon(size, COLORS["purple"], corners=corners), f"icon-app-corner-{name}-{size}.png")

    # The quarter shape on a dark tile, white whale, badge in the corner.
    for name, corners in corner_variants.items():
        for size in (512, 180):
            save(app_corner_icon(size, COLORS["purple"], corners), f"icon-quarter-app-{name}-{size}.png")


if __name__ == "__main__":
    main()
