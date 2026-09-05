"""
Draw the home-screen icons.

iOS will not use an SVG for "Add to Home Screen", and it does not scale the
favicon either — without a real apple-touch-icon PNG it screenshots the page
and pins that, which is why the app looked like a grey thumbnail on the home
screen. This redraws the mark from Logo.tsx at the sizes iOS and Android ask
for. Run it after changing the logo:

    python scripts/make-icons.py
"""

from PIL import Image, ImageDraw

BG_TOP = (26, 26, 30)
BG_BOTTOM = (14, 14, 16)
ACCENT_HI = (244, 121, 108)
ACCENT = (224, 87, 79)

SS = 4  # supersample, then shrink: the only cheap way to get clean edges


def blend(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def stroke(d, pts, width, closed=False):
    """A gradient stroke, drawn one segment at a time and capped with dots."""
    seq = list(pts) + ([pts[0]] if closed else [])
    ys = [p[1] for p in seq]
    lo, hi = min(ys), max(ys)
    span = (hi - lo) or 1
    for (x1, y1), (x2, y2) in zip(seq, seq[1:]):
        t = ((y1 + y2) / 2 - lo) / span
        c = blend(ACCENT_HI, ACCENT, t)
        d.line([(x1, y1), (x2, y2)], fill=c, width=width)
        for x, y in ((x1, y1), (x2, y2)):
            r = width / 2
            d.ellipse([x - r, y - r, x + r, y + r], fill=c)


def icon(size, pad=0.0):
    n = size * SS
    img = Image.new('RGB', (n, n), BG_TOP)
    d = ImageDraw.Draw(img)

    # A vertical wash, the same one the app's panels use.
    for y in range(n):
        d.line([(0, y), (n, y)], fill=blend(BG_TOP, BG_BOTTOM, y / n))

    # The mark is drawn in the 32-unit space of the SVG, inset so iOS's
    # rounded mask never clips the hexagon's corners.
    inset = n * (0.14 + pad)
    scale = (n - inset * 2) / 32

    def P(x, y):
        return (inset + x * scale, inset + y * scale)

    hexagon = [P(16, 2.8), P(27, 9.4), P(27, 22.6), P(16, 29.2), P(5, 22.6), P(5, 9.4)]
    stroke(d, hexagon, round(2.4 * scale), closed=True)
    stroke(d, [P(12, 21), P(12, 11), P(20, 21), P(20, 11)], round(2.8 * scale))

    return img.resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    # iOS shows it on a home screen where every other icon is full-bleed, so
    # it gets a touch more padding than the browser-tab sizes.
    icon(180, pad=0.03).save('public/apple-touch-icon.png')
    icon(192).save('public/icon-192.png')
    icon(512).save('public/icon-512.png')
    icon(32).save('public/favicon-32.png')
    print('wrote 4 icons to public/')
