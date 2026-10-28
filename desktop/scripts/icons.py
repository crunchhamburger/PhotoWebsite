# Draws the app icon (build/icon.icns via iconutil) and the menu-bar paw (build/trayTemplate*.png).
# Usage: python3 desktop/scripts/icons.py   (needs Pillow; macOS for iconutil)
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(HERE, '..', 'build')
os.makedirs(BUILD, exist_ok=True)
SS = 4  # supersampling


def rounded(draw, box, r, fill):
    draw.rounded_rectangle(box, radius=r, fill=fill)


def app_icon(size=1024):
    S = size * SS
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    # macOS icon grid: the tile is ~80% of the canvas, with a soft shadow.
    m = int(S * 0.1)
    tile = (m, m, S - m, S - m)
    shadow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((m, m + S * 0.012, S - m, S - m + S * 0.012), radius=S * 0.18, fill=(0, 0, 0, 120))
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(S * 0.012)))
    # Dark tile with a gentle top-to-bottom gradient.
    grad = Image.new('RGBA', (S, S))
    gd = ImageDraw.Draw(grad)
    for y in range(S):
        t = y / S
        c = (int(30 - 14 * t), int(30 - 14 * t), int(34 - 14 * t), 255)
        gd.line([(0, y), (S, y)], fill=c)
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle(tile, radius=S * 0.18, fill=255)
    img.paste(grad, (0, 0), mask)
    # Everything on the tile is drawn on its own layer and blended (ImageDraw doesn't blend alpha),
    # then clipped to the rounded tile.
    art = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(art)
    # Dot grid, like the whiteboard.
    step = S * 0.055
    y = m + step
    while y < S - m - step * 0.5:
        x = m + step
        while x < S - m - step * 0.5:
            r = S * 0.004
            d.ellipse((x - r, y - r, x + r, y + r), fill=(255, 255, 255, 34))
            x += step
        y += step
    # Three list cards (the brand mark).
    u = (S - 2 * m) / 10
    ox, oy = m + u * 1.45, m + u * 1.45
    cards = [
        ((ox, oy, ox + u * 3.2, oy + u * 2.6), (216, 255, 90)),
        ((ox + u * 3.9, oy, ox + u * 7.1, oy + u * 3.9), (124, 199, 255)),
        ((ox, oy + u * 3.3, ox + u * 3.2, oy + u * 7.1), (255, 158, 122)),
    ]
    lines = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ld = ImageDraw.Draw(lines)
    for box, col in cards:
        rounded(d, box, u * 0.45, col + (255,))
        x0, y0, x1, y1 = box
        ly = y0 + u * 0.75
        while ly < y1 - u * 0.5:
            ld.rounded_rectangle((x0 + u * 0.45, ly - u * 0.11, x1 - u * 0.6, ly + u * 0.11), radius=u * 0.11, fill=(11, 11, 12, 64))
            ly += u * 0.62
    art.alpha_composite(lines)
    d = ImageDraw.Draw(art)
    # A paw under the blue card: the pet.
    px, py, pr = ox + u * 5.5, oy + u * 6.15, u * 0.82
    paw = (199, 155, 255, 255)
    d.ellipse((px - pr, py - pr * 0.82, px + pr, py + pr * 0.82), fill=paw)
    for dx, dy, rr in ((-1.25, -1.15, 0.38), (-0.45, -1.75, 0.4), (0.45, -1.75, 0.4), (1.25, -1.15, 0.38)):
        cx, cy, r = px + dx * pr, py + dy * pr, rr * pr * 1.35
        d.ellipse((cx - r * 0.85, cy - r, cx + r * 0.85, cy + r), fill=paw)
    clipped = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    clipped.paste(art, (0, 0), Image.composite(art.getchannel('A'), Image.new('L', (S, S), 0), mask))
    img.alpha_composite(clipped)
    return img.resize((size, size), Image.LANCZOS)


def paw_template(size):
    S = size * SS
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    k = (0, 0, 0, 255)
    cx, cy, r = S * 0.5, S * 0.64, S * 0.2
    d.ellipse((cx - r, cy - r * 0.84, cx + r, cy + r * 0.84), fill=k)
    for dx, dy, rr in ((-0.3, -0.12, 0.085), (-0.12, -0.3, 0.09), (0.12, -0.3, 0.09), (0.3, -0.12, 0.085)):
        x, y, q = S * (0.5 + dx), S * (0.5 + dy), S * rr
        d.ellipse((x - q * 0.85, y - q, x + q * 0.85, y + q), fill=k)
    return img.resize((size, size), Image.LANCZOS)


def main():
    base = app_icon(1024)
    base.save(os.path.join(BUILD, 'icon.png'))
    with tempfile.TemporaryDirectory() as tmp:
        iconset = os.path.join(tmp, 'icon.iconset')
        os.makedirs(iconset)
        for s in (16, 32, 128, 256, 512):
            base.resize((s, s), Image.LANCZOS).save(os.path.join(iconset, f'icon_{s}x{s}.png'))
            base.resize((s * 2, s * 2), Image.LANCZOS).save(os.path.join(iconset, f'icon_{s}x{s}@2x.png'))
        if sys.platform == 'darwin':
            subprocess.run(['iconutil', '-c', 'icns', iconset, '-o', os.path.join(BUILD, 'icon.icns')], check=True)
    paw_template(22).save(os.path.join(BUILD, 'trayTemplate.png'))
    paw_template(44).save(os.path.join(BUILD, 'trayTemplate@2x.png'))
    print('icons written to', os.path.normpath(BUILD))


main()
