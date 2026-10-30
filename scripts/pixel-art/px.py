"""Tiny aliased isometric pixel-art toolkit (2:1, tile 32x16 = 16 world units)."""
import math, os
from PIL import Image, ImageChops

# previews go to <repo>/out/pixel-art (ignored by git)
OUTDIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'out', 'pixel-art')


def H(s, a=255):
    s = s.lstrip('#')
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), a)


OUT = H('2b2320')
PALETTE_USED = set()


def fill_poly(px, size, pts, col):
    """Pixel-centre scanline fill: exact 2:1 stepping, no antialias."""
    W, Hh = size
    ys = [p[1] for p in pts]
    y0, y1 = max(int(math.floor(min(ys))), 0), min(int(math.ceil(max(ys))), Hh)
    n = len(pts)
    for r in range(y0, y1):
        yc = r + 0.5
        xs = []
        for i in range(n):
            (xa, ya), (xb, yb) = pts[i], pts[(i + 1) % n]
            if (ya <= yc < yb) or (yb <= yc < ya):
                xs.append(xa + (yc - ya) * (xb - xa) / (yb - ya))
        xs.sort()
        for k in range(0, len(xs) - 1, 2):
            c0 = max(math.ceil(xs[k] - 0.5), 0)
            c1 = min(math.ceil(xs[k + 1] - 0.5), W)
            for c in range(c0, c1):
                px[c, r] = col


def _mix(c, d, t):
    return tuple(int(c[i] * (1 - t) + d[i] * t) for i in range(3))


def add_outline(img, col=OUT, selout=True, aa=True):
    """1px ring. selout: ring tinted from the object colour (lighter on lit top/left edges).
    aa: half-tone pixel in each concave stair corner so 2:1 edges read smooth."""
    bb = img.getbbox()
    if not bb:
        return
    W, Hh = img.size
    x0, y0, x1, y1 = max(bb[0] - 2, 0), max(bb[1] - 2, 0), min(bb[2] + 2, W), min(bb[3] + 2, Hh)
    sub = img.crop((x0, y0, x1, y1))
    a = sub.getchannel('A').point(lambda v: 255 if v > 0 else 0)
    dil = a.copy()
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        sh = Image.new('L', a.size, 0)
        sh.paste(a, (dx, dy))
        dil = ImageChops.lighter(dil, sh)
    ring = ImageChops.subtract(dil, a)
    if not selout:
        sub.paste(Image.new('RGBA', sub.size, col), (0, 0), ring)
        img.paste(sub, (x0, y0))
        return
    px, rp, ap = sub.load(), ring.load(), a.load()
    sw, sh_ = sub.size
    pts = [(x, y) for y in range(sh_) for x in range(sw) if rp[x, y]]
    rc = {}
    for x, y in pts:
        best = None
        for (dx, dy, lit) in ((0, 1, True), (1, 0, True), (0, -1, False), (-1, 0, False)):
            u, v = x + dx, y + dy
            if 0 <= u < sw and 0 <= v < sh_ and ap[u, v]:
                best = (px[u, v], lit)
                break
        base, lit = best
        c = _mix(_mix(base, (0, 0, 0), .62 if lit else .72), col, .45)
        rc[(x, y)] = c
    for (x, y), c in rc.items():
        px[x, y] = c + (255,)
    if aa:
        for y in range(sh_):
            for x in range(sw):
                if ap[x, y] or (x, y) in rc:
                    continue
                hz = [rc.get((x + d, y)) for d in (-1, 1)]
                vt = [rc.get((x, y + d)) for d in (-1, 1)]
                hz = [c for c in hz if c]; vt = [c for c in vt if c]
                if hz and vt:
                    px[x, y] = hz[0] + (110,)
    img.paste(sub, (x0, y0))


def lighten(c, t):
    return _mix(c, (255, 250, 240), t) + (c[3],)


def darken(c, t):
    return _mix(c, (30, 22, 28), t) + (c[3],)


class Layer:
    def __init__(s, w, h, ox, oy, bg=(0, 0, 0, 0), S=1):
        s.img = Image.new('RGBA', (w, h), bg)
        s.ox, s.oy, s.S = ox, oy, S
        s.tmp = None

    # projection (S = pixels per world unit horizontally; tile = 32S x 16S)
    def P(s, x, y, z=0):
        return (s.ox + (x - y) * s.S, s.oy + ((x + y) / 2 - z) * s.S)

    @property
    def tgt(s):
        return s.tmp if s.tmp is not None else s.img

    def begin(s):
        s.tmp = Image.new('RGBA', s.img.size, (0, 0, 0, 0))

    def end(s, outline=True, col=OUT):
        if outline:
            add_outline(s.tmp, col)
        s.img.alpha_composite(s.tmp)
        s.tmp = None

    # primitives ----------------------------------------------------------
    def poly(s, pts, col):
        t = s.tgt
        fill_poly(t.load(), t.size, pts, col)

    def wpoly(s, wpts, col):
        s.poly([s.P(*p) for p in wpts], col)

    def box(s, x, y, z, w, d, h, c3, sides=(1, 1, 1)):
        top, left, right = c3
        if sides[1]:
            s.wpoly([(x, y + d, z), (x + w, y + d, z), (x + w, y + d, z + h), (x, y + d, z + h)], left)
        if sides[2]:
            s.wpoly([(x + w, y, z), (x + w, y + d, z), (x + w, y + d, z + h), (x + w, y, z + h)], right)
        if sides[0]:
            s.wpoly([(x, y, z + h), (x + w, y, z + h), (x + w, y + d, z + h), (x, y + d, z + h)], top)
        if w >= 4 and d >= 4 and h >= 1:
            hl = lighten(top, .35)  # lit rim on the front edges of the top face
            e = 1.0 / s.S
            if sides[0]:
                s.wpoly([(x, y + d - e, z + h), (x + w, y + d - e, z + h), (x + w, y + d, z + h), (x, y + d, z + h)], hl)
                s.wpoly([(x + w - e, y, z + h), (x + w, y, z + h), (x + w, y + d, z + h), (x + w - e, y + d, z + h)], hl)
            if z <= 0 and h >= 4:  # ambient occlusion where it meets the floor
                if sides[1]:
                    s.wpoly([(x, y + d, z), (x + w, y + d, z), (x + w, y + d, z + 1.5), (x, y + d, z + 1.5)], darken(left, .22))
                if sides[2]:
                    s.wpoly([(x + w, y, z), (x + w, y + d, z), (x + w, y + d, z + 1.5), (x + w, y, z + 1.5)], darken(right, .22))

    def pbox(s, *a, outline=True, **k):
        """box as its own outlined part"""
        s.begin(); s.box(*a, **k); s.end(outline)

    def qy(s, yp, x0, x1, z0, z1, col):  # quad on plane y=yp (faces +y, 'left' face)
        s.wpoly([(x0, yp, z0), (x1, yp, z0), (x1, yp, z1), (x0, yp, z1)], col)

    def qx(s, xp, y0, y1, z0, z1, col):  # quad on plane x=xp (faces +x, 'right' face)
        s.wpoly([(xp, y0, z0), (xp, y1, z0), (xp, y1, z1), (xp, y0, z1)], col)

    def qz(s, z, x0, y0, x1, y1, col):  # flat quad
        s.wpoly([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], col)

    def ell(s, cx, cy, a, b, col):  # screen-space ellipse, pixel-centre test
        t = s.tgt; px = t.load(); W, Hh = t.size
        for r in range(int(cy - b) - 1, int(cy + b) + 2):
            for c in range(int(cx - a) - 1, int(cx + a) + 2):
                if 0 <= c < W and 0 <= r < Hh:
                    dx, dy = (c + 0.5 - cx) / a, (r + 0.5 - cy) / b
                    if dx * dx + dy * dy < 1:
                        px[c, r] = col

    def wel(s, x, y, z, r, col):  # iso circle on plane z
        cx, cy = s.P(x, y, z)
        s.ell(cx, cy, r * s.S, r * s.S / 2, col)

    def rect(s, x, y, w, h, col):
        t = s.tgt; px = t.load(); W, Hh = t.size
        for r in range(int(y), int(y + h)):
            for c in range(int(x), int(x + w)):
                if 0 <= c < W and 0 <= r < Hh:
                    px[c, r] = col

    def dot(s, x, y, col):
        s.rect(x, y, s.S, s.S, col)

    def blit(s, spr, x, y):
        s.tgt.alpha_composite(spr, (int(x), int(y)))


# 3x5 pixel font ---------------------------------------------------------------
FONT = {
    'A': '010101111101101', 'B': '110101110101110', 'C': '011100100100011', 'D': '110101101101110',
    'E': '111100110100111', 'F': '111100110100100', 'G': '011100101101011', 'H': '101101111101101',
    'I': '111010010010111', 'L': '100100100100111', 'M': '101111111101101', 'N': '110101101101101',
    'O': '010101101101010', 'P': '110101110100100', 'R': '110101110101101', 'S': '011100010001110',
    'T': '111010010010010', 'U': '101101101101111', 'V': '101101101101010', 'Y': '101101010010010',
    'Ç': '011100100011010', '.': '000000000000010', ' ': '000000000000000', '!': '010010010000010',
    '?': '110001010000010', '1': '010110010010111', '2': '110001010100111', '3': '110001010001110',
    'J': '001001001101010', 'K': '101101110101101', 'Q': '010101101110011', 'W': '101101111111101',
    'X': '101101010101101', 'Z': '111001010100111', '0': '111101101101111', '4': '101101111001001',
    '5': '111100110001110', '6': '011100111101111', '7': '111001010010010', '8': '111101111101111',
    '9': '111101111001110', '·': '000000010000000', '-': '000000111000000', ':': '000010000010000',
}
ACC = str.maketrans('ÁÀÂÃÉÊÍÓÔÕÚ', 'AAAAEEIOOOU')


def text(L, s, x, y, col):
    for i, ch in enumerate(s):
        g = FONT.get(ch.upper().translate(ACC), FONT[' '])
        for k, v in enumerate(g):
            if v == '1':
                L.dot(x + i * 4 + k % 3, y + k // 3, col)


def plaque(L, s, cx, y):
    """dark app-style name plaque"""
    label(L, s, cx, y, H('35303a'), H('f3ead8'))


def label(L, s, cx, y, bg=H('f4ecd8'), fg=H('4a3b30')):
    w = len(s) * 4 + 3
    x = int(cx - w / 2)
    L.begin(); L.rect(x, y, w, 9, bg); L.end()
    text(L, s, x + 2, y + 2, fg)


def save(img, name):
    os.makedirs(OUTDIR, exist_ok=True)
    p = os.path.join(OUTDIR, name + '.png')
    img.save(p)
    img.resize((img.width * 4, img.height * 4), Image.NEAREST).save(os.path.join(OUTDIR, name + '_4x.png'))
    return p
