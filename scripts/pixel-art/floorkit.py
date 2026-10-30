"""Shared 32x24-tile floor frame: same canvas, slab, walls, partitions, labels for every floor."""
import math, random, os
from PIL import Image
from px import H, Layer, OUT, OUTDIR, add_outline, fill_poly
from font5 import plaque
import furn as F
from furn import T
from room import draw_floor, draw_sorted, BG

TS = 16
W, D = 24 * TS, 18 * TS          # 384 x 288 world units (24x18 tiles)
S = 1                            # tile 32x16
SW, SH = 736, 460                # one canvas for all floors
OX, OY = 320, 87
WALL_H = 56
PART_H = 40


def new_layer():
    return Layer(SW, SH, OX, OY, BG, S=S)


def save2(img, name):
    os.makedirs(OUTDIR, exist_ok=True)
    p = os.path.join(OUTDIR, name + '.png')
    img.save(p)
    img.resize((img.width * 2, img.height * 2), Image.NEAREST).save(os.path.join(OUTDIR, name + '_2x.png'))
    return p


def shade(c, f):
    return (int(c[0] * f), int(c[1] * f), int(c[2] * f), c[3])


# ---- floors ---------------------------------------------------------------------
def region_floor(regions, default):
    """regions: list of ((x0,y0,x1,y1) in tiles, fn). first match wins."""
    def f(x, y):
        tx, ty = x / TS, y / TS
        for (a, b, c, d), fn in regions:
            if a <= tx < c and b <= ty < d:
                return fn(x, y)
        return default(x, y)
    return f


def planks(cols, edge, seam, width=6, along='x', seg=48):
    def f(x, y):
        u, v = (x, y) if along == 'x' else (y, x)
        p = math.floor(v / width)
        if v % width < 0.9:
            return edge
        if (u + (p * 23) % seg) % seg < 1:
            return seam
        return cols[p % len(cols)]
    return f


OAK = planks([H('ead1a6'), H('e2c799'), H('e6cc9f')], H('c9a979'), H('d2b385'))
WALNUT = planks([H('9a6a48'), H('8f6142'), H('94664a')], H('6e4a33'), H('7a5239'))
HONEY = None


def parquet(c1=H('e8b765'), c2=H('dba855'), line=H('b98a3e')):
    def f(x, y):
        bx, by = math.floor(x / 8), math.floor(y / 8)
        fx, fy = x % 8, y % 8
        if fx < 0.7 or fy < 0.7:
            return line
        if (bx + by) % 2 == 0:
            return c1 if (fy % 4) >= 0.7 else line
        return c2 if (fx % 4) >= 0.7 else line
    return f


def carpet_tiles(c1, c2, seam):
    def f(x, y):
        tx, ty = math.floor(x / 8), math.floor(y / 8)
        if x % 8 < 0.6 or y % 8 < 0.6:
            return seam
        v = y if (tx + ty) % 2 == 0 else x
        return c2 if math.floor(v) % 3 == 0 else c1
    return f


def checker(c1, c2, size=8):
    def f(x, y):
        return c1 if (math.floor(x / size) + math.floor(y / size)) % 2 == 0 else c2
    return f


def speckled(base, sp1, sp2, border=None, rect=None):
    def f(x, y):
        if border and rect:
            x0, y0, x1, y1 = [v * TS for v in rect]
            if min(x - x0, x1 - x, y - y0, y1 - y) < 3:
                return border
        h = (int(x) * 73856093 ^ int(y * 2) * 19349663) & 1023
        if h < 30:
            return sp1
        if h < 55:
            return sp2
        return base
    return f


# ---- walls ----------------------------------------------------------------------
PROJECT_WALL = dict(upper=H('f3ece0'), wains=H('6f7c8a'), cap=H('e8e2d6'), base=H('3d434b'), top=H('8a8f96'))
CASA_WALL = dict(upper=H('efe0c4'), wains=H('b88a5e'), cap=H('dcb98e'), base=H('6e4a33'), top=H('8f765f'), panels=True)
SCHOOL_WALL = dict(upper=H('f6eed6'), wains=H('7fb38f'), cap=H('f2cf5b'), base=H('3e6b4c'), top=H('8a9a7c'))


def back_walls(L, st, h=WALL_H, t=4):
    top = st['top']
    up = st['upper']
    L.pbox(-t, -t, 0, t, D + t, h, (top, shade(up, .9), shade(up, .86)))
    L.pbox(0, -t, 0, W, t, h, (top, up, shade(up, .9)))
    for plane, n, f in (('y', W, 1.0), ('x', D, .9)):
        q = L.qy if plane == 'y' else L.qx
        q(0, 0, n, 2, 20, shade(st['wains'], f))
        q(0, 0, n, 20, 22, shade(st['cap'], f))
        q(0, 0, n, 0, 2, shade(st['base'], f))
        q(0, 0, n, h - 2, h, shade(up, f * .94))
        if st.get('panels'):
            for u in range(8, n, 16):
                q(0, u, u + 1, 4, 18, shade(st['wains'], f * .85))


def wainscot_wall(L, x, y, w, d, wood=T('c99a66', 'b88a5e', '9c7148'), cap=T('ead1a6', 'd8b98a', 'c4a271'), h=22):
    """low wood wall with baseboard, panel lines and a wider cap."""
    L.pbox(x, y, 0, w, d, h, wood)
    if w >= d:
        L.qy(y + d, x, x + w, 0, 3, H('6e4a33'))
        for u in range(x + 6, x + w - 2, 12):
            L.qy(y + d, u, u + 1, 5, h - 4, H('a07448'))
    else:
        L.qx(x + w, y, y + d, 0, 3, H('5c3d2a'))
        for u in range(y + 6, y + d - 2, 12):
            L.qx(x + w, u, u + 1, 5, h - 4, H('8a6340'))
    L.pbox(x - 1, y - 1, h, w + 2, d + 2, 2, cap)


GRAPHITE = T('6b717a', '50565e', '3d424a')
GREENF = T('7fb38f', '5f9a72', '4a7d5a')
GLASS = H('cfe8f2', 70)


def glass_x(L, x0, x1, yp, doors=(), frame=GRAPHITE, h=PART_H):
    """glass partition along x at y=yp. doors: list of (a,b) gaps."""
    segs, cur = [], x0
    for a, b in sorted(doors):
        segs.append((cur, a)); cur = b
    segs.append((cur, x1))
    for a, b in segs:
        if b - a < 2:
            continue
        L.begin(); L.qy(yp + 1, a, b, 3, h, GLASS); L.end(False)
        for i in range(2):
            u = a + 6 + i * 3
            if u + 1 < b:
                L.qy(yp + 1, u, u + 1, h - 16 - i * 3, h - 6 - i * 3, H('ffffff', 110))
        L.pbox(a, yp, 0, b - a, 2, 3, frame)
        L.pbox(a, yp, h, b - a, 2, 2, frame)
        for p in list(range(a, b - 2, 32)) + [b - 2]:
            L.pbox(p, yp, 0, 2, 2, h, frame)
    for a, b in doors:
        L.pbox(a, yp, h, b - a, 2, 2, frame)


def glass_y(L, y0, y1, xp, doors=(), frame=GRAPHITE, h=PART_H):
    segs, cur = [], y0
    for a, b in sorted(doors):
        segs.append((cur, a)); cur = b
    segs.append((cur, y1))
    for a, b in segs:
        if b - a < 2:
            continue
        L.begin(); L.qx(xp + 1, a, b, 3, h, GLASS); L.end(False)
        for i in range(2):
            u = a + 6 + i * 3
            if u + 1 < b:
                L.qx(xp + 1, u, u + 1, h - 16 - i * 3, h - 6 - i * 3, H('ffffff', 110))
        L.pbox(xp, a, 0, 2, b - a, 3, frame)
        L.pbox(xp, a, h, 2, b - a, 2, frame)
        for p in list(range(a, b - 2, 32)) + [b - 2]:
            L.pbox(xp, p, 0, 2, 2, h, frame)
    for a, b in doors:
        L.pbox(xp, a, h, 2, b - a, 2, frame)


def split_x(x0, x1, yp, doors, step=32):
    """footprints for sorting a partition along x (split at doors and every `step` units)."""
    out, cur = [], x0
    cuts = sorted([v for d in doors for v in d] + (list(range(x0, x1, step)) if step else []) + [x1])
    for c in cuts:
        if c > cur:
            if not any(a <= cur and c <= b for a, b in doors):
                out.append((cur, c))
            cur = c
    return out


class Scene:
    def __init__(s, L):
        s.L, s.items, s.heads, s.labels, s.dark = L, [], {}, [], []

    def add(s, fp, fn, shadow=False):
        if shadow:
            x0, y0, x1, y1 = fp
            def g(fn=fn):
                s.L.begin(); s.L.qz(0, x0 - 1, y0 - 1, x1 + 2, y1 + 2, (40, 28, 24, 45)); s.L.end(False)
                fn()
            s.items.append((fp, g))
        else:
            s.items.append((fp, fn))

    def gx(s, x0, x1, yp, doors=(), frame=GRAPHITE):
        """glass along x as sortable pieces"""
        for a, b in split_x(x0, x1, yp, doors):
            s.add((a, yp, b, yp + 2), lambda a=a, b=b: glass_x(s.L, a, b, yp, frame=frame))
        for a, b in doors:
            s.add((a, yp, b, yp + 2), lambda a=a, b=b: s.L.pbox(a, yp, PART_H, b - a, 2, 2, frame))

    def gy(s, y0, y1, xp, doors=(), frame=GRAPHITE):
        for a, b in split_x(y0, y1, xp, doors):
            s.add((xp, a, xp + 2, b), lambda a=a, b=b: glass_y(s.L, a, b, xp, frame=frame))
        for a, b in doors:
            s.add((xp, a, xp + 2, b), lambda a=a, b=b: s.L.pbox(xp, a, PART_H, 2, b - a, 2, frame))

    def wx(s, x0, x1, yp, doors=()):
        for a, b in split_x(x0, x1, yp, doors, step=0):
            s.add((a, yp, b, yp + 4), lambda a=a, b=b: wainscot_wall(s.L, a, yp, b - a, 4))

    def wy(s, y0, y1, xp, doors=()):
        for a, b in split_x(y0, y1, xp, doors, step=0):
            s.add((xp, a, xp + 4, b), lambda a=a, b=b: wainscot_wall(s.L, xp, a, 4, b - a))

    def stand(s, spr, x, y, tag=None):
        s.add((x - 2, y - 2, x + 2, y + 2), lambda: F.standing(s.L, spr, x, y))
        if tag:
            px, py = s.L.P(x, y); s.heads[tag] = (int(px) + 3 * s.L.S, int(py) - 29 * s.L.S)

    def label(s, text_, x, y, z=0, dy=0):
        px, py = s.L.P(x, y, z)
        s.labels.append((text_, px, int(py) + dy))

    def darken(s, x0, y0, x1, y1, h=PART_H + 4):
        s.dark.append((x0, y0, x1, y1, h))

    def finish(s, bubbles=()):
        draw_sorted(s.items)
        L = s.L
        for x0, y0, x1, y1, h in s.dark:
            pts = [L.P(x0, y0, h), L.P(x1, y0, h), L.P(x1, y0, 0), L.P(x1, y1, 0), L.P(x0, y1, 0), L.P(x0, y1, h)]
            m = Image.new('L', L.img.size, 0)
            fill_poly(m.load(), m.size, pts, 255)
            dk = Image.eval(L.img.convert('RGB'), lambda v: v)
            r, g, b = dk.split()
            dk = Image.merge('RGB', (r.point(lambda v: int(v * .5)), g.point(lambda v: int(v * .52)), b.point(lambda v: int(v * .62))))
            L.img.paste(dk.convert('RGBA'), (0, 0), m)
        for tag, kind in bubbles:
            F.bubble(L, *s.heads[tag], kind)
        for t_, px, py in s.labels:
            plaque(L, t_, px, py)
        return L.img
