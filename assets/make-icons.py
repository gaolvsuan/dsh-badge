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

import math
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


def fluke_mask(size):
    """The traced fluke, scaled to the requested size."""
    path = os.path.join(HERE, "source", "fluke-mask.png")
    if not os.path.exists(path):
        return None
    return Image.open(path).convert("L").resize((size, size), Image.LANCZOS)


def fluke_badge_icon(size, fluke="#3b82f6", badge="#f5455c", text="1"):
    """A blue fluke on a white tile with a red count at its top-right.

    The fluke is centred; the badge hangs off its upper-right corner so the pair
    reads as one mark rather than a logo with a sticker on it.
    """
    image = rounded_tile(size, int(size * 0.22), "#ffffff")

    mask = fluke_mask(size)
    if mask is None:
        return image

    inner = int(size * 0.58)
    # Shift the fluke left so the fluke-plus-badge pair, not the fluke alone,
    # sits in the middle of the tile.
    left = (size - inner) // 2 - int(size * 0.035)
    top = (size - inner) // 2
    shape = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shape.paste(
        Image.new("RGBA", (inner, inner), fluke),
        (left, top),
        mask.resize((inner, inner), Image.LANCZOS),
    )
    image.alpha_composite(shape)

    badge_radius = int(size * 0.15)
    cx = left + inner - int(size * 0.04)
    cy = top + int(size * 0.08)

    disc = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    disc_draw = ImageDraw.Draw(disc)
    disc_draw.ellipse(
        [cx - badge_radius, cy - badge_radius, cx + badge_radius, cy + badge_radius],
        fill=badge,
        outline="#ffffff",
        width=max(3, int(size * 0.018)),
    )
    image.alpha_composite(disc)

    font = load_font(int(badge_radius * 1.05))
    ImageDraw.Draw(image).text((cx, cy), text, font=font, fill="#ffffff", anchor="mm")
    return image


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

    badge_radius = int(size * 0.21)
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


def ellipse_points(cx, cy, rx, ry, angle_deg, steps=64):
    """Points around a rotated ellipse, for polygon drawing."""
    angle = math.radians(angle_deg)
    points = []
    for step in range(steps):
        theta = 2 * math.pi * step / steps
        x = rx * math.cos(theta)
        y = ry * math.sin(theta)
        points.append(
            (
                cx + x * math.cos(angle) - y * math.sin(angle),
                cy + x * math.sin(angle) + y * math.cos(angle),
            )
        )
    return points


def whale_tail_icon(size, color, text="1"):
    """A whale fluke with the count pinned to it.

    Two swept lobes over a short stem: a generic whale shape that carries no
    third-party mark, and a disc that keeps the same badge language as the tab
    and the taskbar.
    """
    image = rounded_tile(size, int(size * 0.22), color)
    tail = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    tail_draw = ImageDraw.Draw(tail)

    left = ellipse_points(size * 0.31, size * 0.40, size * 0.27, size * 0.072, -52)
    right = ellipse_points(size * 0.59, size * 0.40, size * 0.27, size * 0.072, 52)
    tail_draw.polygon(left, fill="#ffffff")
    tail_draw.polygon(right, fill="#ffffff")

    stem = [
        (size * 0.41, size * 0.46),
        (size * 0.49, size * 0.46),
        (size * 0.47, size * 0.88),
        (size * 0.43, size * 0.88),
    ]
    tail_draw.polygon(stem, fill="#ffffff")
    image.alpha_composite(tail)

    badge_radius = int(size * 0.19)
    cx = size - badge_radius - int(size * 0.02)
    cy = badge_radius + int(size * 0.02)

    disc = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    disc_draw = ImageDraw.Draw(disc)
    disc_draw.ellipse(
        [cx - badge_radius, cy - badge_radius, cx + badge_radius, cy + badge_radius],
        fill=color,
        outline="#ffffff",
        width=max(3, int(size * 0.022)),
    )
    image.alpha_composite(disc)

    font = load_font(int(badge_radius * 1.05))
    ImageDraw.Draw(image).text((cx, cy), text, font=font, fill="#ffffff", anchor="mm")
    return image


def bubble_icon(size, color, text="1", tail="bl"):
    """A notification bubble: a rounded tile with a tail, and the count inside.

    The tail is what makes it read as a notification rather than a plain app
    tile, and it borrows nobody's mark.
    """
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    # A left-pointing tail needs room outside the body, so the body shifts right.
    inset = int(size * 0.16) if tail == "left" else 0
    body_height = int(size * 0.78)
    radius = int(size * 0.24)
    draw.rounded_rectangle([inset, 0, size - 1, body_height], radius=radius, fill=color)

    if tail == "bl":
        draw.polygon(
            [
                (int(size * 0.20), body_height - int(size * 0.02)),
                (int(size * 0.46), body_height - int(size * 0.02)),
                (int(size * 0.10), size - 1),
            ],
            fill=color,
        )
    elif tail == "br":
        draw.polygon(
            [
                (size - int(size * 0.20), body_height - int(size * 0.02)),
                (size - int(size * 0.46), body_height - int(size * 0.02)),
                (size - int(size * 0.10), size - 1),
            ],
            fill=color,
        )
    elif tail == "left":
        draw.polygon(
            [
                (inset + 2, int(size * 0.26)),
                (inset + 2, int(size * 0.54)),
                (0, int(size * 0.40)),
            ],
            fill=color,
        )

    font = load_font(int(size * 0.44))
    draw.text(((size + inset) / 2, body_height / 2), text, font=font, fill="#ffffff", anchor="mm")
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

    # Notification bubbles: no third-party mark, the tail carries the meaning.
    for tail in ("bl", "br", "left"):
        for size in (512, 180):
            save(bubble_icon(size, COLORS["purple"], tail=tail), f"icon-bubble-{tail}-{size}.png")
    for color_name in ("red", "blue", "green"):
        save(bubble_icon(512, COLORS[color_name], tail="bl"), f"icon-bubble-{color_name}-512.png")

    # A whale fluke with the count pinned on it.
    for size in (512, 256, 180):
        save(whale_tail_icon(size, COLORS["purple"]), f"icon-whale-{size}.png")
    for color_name in ("red", "blue", "green"):
        save(whale_tail_icon(512, COLORS[color_name]), f"icon-whale-{color_name}-512.png")

    # The traced fluke: the shape the author picked, at every size.
    for size in (512, 256, 180):
        save(fluke_icon(size, COLORS["purple"]), f"icon-fluke-{size}.png")
    for color_name in ("red", "blue", "green"):
        save(fluke_icon(512, COLORS[color_name]), f"icon-fluke-{color_name}-512.png")

    # Blue fluke on white, red count on its corner.
    for size in (512, 256, 180):
        save(fluke_badge_icon(size), f"icon-fluke-white-{size}.png")


if __name__ == "__main__":
    main()
