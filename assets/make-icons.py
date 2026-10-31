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


def app_icon(size, color, text="1"):
    """The app icon with the badge over its top-right corner."""
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


if __name__ == "__main__":
    main()
