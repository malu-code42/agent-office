"""Furniture & props. World units: 16 = one 32x16 tile. Faces: top light, left(+y) mid, right(+x) dark."""
import random
from px import H, OUT, text, lighten

T = lambda a, b, c: (H(a), H(b), H(c))
WOOD = T('e8c592', 'd2a46e', 'b38253')
WOODD = T('c0915e', 'a37548', '855b37')
CRT = T('efe7d2', 'dbcfb2', 'bfb193')
CHAIR = T('5a5a66', '42424d', '31313a')
METAL = T('dfe2e4', 'c2c7cc', 'a2a9b0')
POT = T('e7a174', 'cc7c53', 'ad6240')
LEAF = [H('4f8a4c'), H('69a65c'), H('8cc477'), H('b3df92')]
SCREEN = H('22382c')
GREEN = H('8ae391')
GREEN2 = H('58a866')
AMBER = H('f4bb55')
WHITE = H('fbf8f0')
SKY = H('a9d6ec')
SKY2 = H('cfeaf5')


# ---- desks & computers ------------------------------------------------------
def desk(L, x, y, w=30, d=14, h=12, col=WOOD, leg=WOODD):
    if w >= d:
        L.pbox(x + 1, y + 1, 0, 2, d - 2, h - 2, leg)
        L.pbox(x + 3, y + 1, 2, w - 6, 1, h - 5, leg)  # modesty panel (back)
        L.pbox(x + w - 3, y + 1, 0, 2, d - 2, h - 2, leg)
    else:
        L.pbox(x + 1, y + 1, 0, w - 2, 2, h - 2, leg)
        L.pbox(x + 1, y + 3, 2, 1, d - 6, h - 5, leg)
        L.pbox(x + 1, y + d - 3, 0, w - 2, 2, h - 2, leg)
    L.pbox(x, y, h - 2, w, d, 2, col)


PANEL = T('4a4f5c', '363a46', '262932')
BEZEL = H('5b6173')
# per state: screen background, the code lines on it (bright first) and the power LED on the back
_SCREEN = {'green': (H('4cb892'), [H('e4fbe0'), H('1d5a4a'), H('b9efc4')], H('7be07f')),
           'amber': (H('d9a441'), [H('fff0c4'), H('6b4a14'), H('ffe08a')], H('f4bb55')),
           'red': (H('d0605a'), [H('ffd8d4'), H('6e1f24'), H('f6a8a2')], H('ff5a4a')),
           'off': (H('1c1f26'), None, H('6b6f73'))}
# lateral start, width, bottom z (above the desk) and height of each panel, per variant: two monitors,
# an ultrawide, a main monitor with a vertical one (the setups of the original office)
_PANELS = [[(0, 6, 3, 12), (7, 6, 3, 12)],
           [(0, 13, 4, 10)],
           [(0, 9, 3, 11), (10, 4, 3, 15)]]
# the code on a screen: indent and length of each line (cut to the panel's width)
_CODE = [(0, 5), (1, 4), (2, 5), (1, 3), (0, 4), (2, 3)]


def crt(L, x, y, z, face='+y', screen='green', variant=None):
    """modern workstation, a row of flat monitors ~14 wide on a thin stand. (x,y) = footprint corner
    (14x10, or 10x14 for +x/-x). The back of the monitors (face -y/-x) shows the power LED of the state."""
    bg, lines, led = _SCREEN[screen]
    if variant is None:
        variant = (x * 7 + y * 13) % len(_PANELS)
    along_x = face in ('+y', '-y')

    def box(u, v, zz, wu, wv, hz, col):
        # u runs along the desk, v toward the side the screens look at (0..10)
        if face == '+y':
            L.pbox(x + u, y + v, zz, wu, wv, hz, col)
        elif face == '-y':
            L.pbox(x + u, y + 10 - v - wv, zz, wu, wv, hz, col)
        elif face == '+x':
            L.pbox(x + v, y + u, zz, wv, wu, hz, col)
        else:
            L.pbox(x + 10 - v - wv, y + u, zz, wv, wu, hz, col)

    def plane(a, b, za, zb, col):
        # a quad on the screen plane (v = 10) between lateral a..b; only the +y / +x sides are seen
        if face == '+y':
            L.qy(y + 10, x + a, x + b, z + za, z + zb, col)
        else:
            L.qx(x + 10, y + a, y + b, z + za, z + zb, col)

    box(2, 5, 0, 10, 5, 1, PANEL)  # foot
    for u0, w, zb, h in _PANELS[variant]:
        box(u0 + w // 2 - 1, 8, 1, 2, 2, zb, PANEL)  # neck
        box(u0, 8, zb, w, 2, h, PANEL)
        if face in ('+y', '+x'):
            L.begin(); plane(u0, u0 + w, zb, zb + h, BEZEL); L.end(False)
            L.begin(); plane(u0 + 1, u0 + w - 1, zb + 1, zb + h - 1, bg); L.end(False)
            if lines:
                for i, zz in enumerate(range(zb + h - 3, zb + 1, -2)):
                    ind, ln = _CODE[(i + u0) % len(_CODE)]
                    a0, a1 = u0 + 1 + min(ind, w - 4), u0 + 1 + min(ind + ln, w - 3)
                    plane(a0 + 1, a1 + 1, zz, zz + 1, lines[(i + u0) % len(lines)])
    if face == '-y':
        L.dot(*[int(v) for v in L.P(x + 7, y + 2, z + 4)], led)
    elif face == '-x':
        L.dot(*[int(v) for v in L.P(x + 2, y + 7, z + 4)], led)


def keyboard(L, x, y, z, along='x'):
    w, d = (10, 4) if along == 'x' else (4, 10)
    L.pbox(x, y, z, w, d, 1, METAL)


def mug(L, x, y, z, col='f4f0e6'):
    L.pbox(x, y, z, 2, 2, 3, T(col, col, col))
    L.dot(*[int(v) for v in L.P(x + 1, y + 1, z + 3)], H('6b4a35'))


def papers(L, x, y, z):
    L.pbox(x, y, z, 5, 4, 1, T('fbf8f0', 'e2ddd0', 'cfc8b8'))


def chair(L, x, y, face='-y', part='all'):
    """office swivel chair, seat 10x10 at (x,y). face = direction occupant looks."""
    if part in ('all', 'seat'):
        L.pbox(x + 2, y + 4, 0, 6, 2, 1, CHAIR)
        L.pbox(x + 4, y + 2, 0, 2, 6, 1, CHAIR)
        L.pbox(x + 4, y + 4, 1, 2, 2, 4, CHAIR, outline=False)
        L.pbox(x, y, 5, 10, 10, 2, CHAIR)
    back = {'-y': (x, y + 9, 7, 10, 2, 9), '+y': (x, y - 1, 7, 10, 2, 9),
            '-x': (x + 9, y, 7, 2, 10, 9), '+x': (x - 1, y, 7, 2, 10, 9)}[face]
    if part == 'all' or part == 'back':
        L.pbox(*back, CHAIR)


def seated(L, spr, x, y):
    """blit seated sprite on 10x10 chair at (x,y)"""
    px, py = L.P(x + 5, y + 5, 7)
    L.blit(spr, px - 12 * L.S, py - 28 * L.S)


def standing(L, spr, x, y, shadow=True):
    px, py = L.P(x, y, 0)
    if shadow:
        L.begin(); L.ell(px, py, 6 * L.S, 2.5 * L.S, (40, 30, 30, 70)); L.end(False)
    L.blit(spr, px - 12 * L.S, py - 30 * L.S)


# ---- props --------------------------------------------------------------------
def coffee_machine(L, x, y):
    """counter + machine, front facing +x (place against left wall)."""
    L.pbox(x, y, 0, 14, 18, 12, T('d6dadd', 'bcc2c7', '9aa1a9'))
    L.begin(); L.qx(x + 14, y + 2, y + 8, 2, 10, H('aab1b8')); L.qx(x + 14, y + 10, y + 16, 2, 10, H('aab1b8')); L.end(False)
    L.pbox(x + 1, y + 2, 12, 10, 12, 16, T('8e959d', '737a82', '5b6168'))
    L.pbox(x + 3, y + 5, 28, 6, 6, 5, T('6b4a35', '553a29', '42301f'))
    L.begin(); L.qx(x + 11, y + 4, y + 12, 21, 26, H('2f4f6a')); L.end(False)
    L.qx(x + 11, y + 5, y + 9, 24, 25, H('7fd0f0'))
    L.dot(*[int(v) for v in L.P(x + 11, y + 11, 23)], H('ff6b5a'))
    L.pbox(x + 9, y + 6, 15, 3, 3, 3, T('3a3a40', '2e2e33', '232328'))
    L.pbox(x + 10, y + 7, 12, 2, 2, 3, T('fbf8f0', 'e8e2d4', 'd0c8b6'))
    mug(L, x + 6, y + 15, 12, 'e9a0a0')


def water_cooler(L, x, y):
    L.pbox(x, y, 0, 8, 8, 14, T('eef0f2', 'd5dade', 'b6bec5'))
    L.begin(); L.box(x + 1, y + 1, 14, 6, 6, 9, (H('bfe3f5', 210), H('9fcfea', 210), H('84bcdc', 210))); L.end()
    L.dot(*[int(v) for v in L.P(x + 8, y + 4, 9)], H('5aa0e0'))
    L.dot(*[int(v) for v in L.P(x + 8, y + 6, 9)], H('e86060'))


def whiteboard(L, x, y):
    """easel whiteboard facing +y, 26 wide."""
    for lx in (x + 2, x + 22):
        L.pbox(lx, y, 0, 2, 2, 30, T('9aa1a9', '7d848c', '62686f'))
        L.pbox(lx - 2, y - 2, 0, 6, 6, 1, T('9aa1a9', '7d848c', '62686f'))
    L.pbox(x, y + 2, 12, 26, 2, 18, T('c4c9ce', 'fbfbf6', 'a9afb5'))
    L.pbox(x + 2, y + 4, 11, 22, 2, 1, T('c4c9ce', 'b0b6bc', '9aa1a9'))
    yf = y + 4
    marks = [(x + 3, x + 11, 26, H('4a78c8')), (x + 3, x + 8, 23, H('4a78c8')), (x + 14, x + 22, 26, H('d65a5a')),
             (x + 14, x + 18, 23, H('d65a5a')), (x + 3, x + 7, 18, H('4fa860')), (x + 10, x + 16, 18, H('4a78c8')),
             (x + 19, x + 22, 16, H('d65a5a'))]
    for a, b, zz, c in marks:
        L.qy(yf, a, b, zz, zz + 1, c)
    L.qy(yf, x + 12, x + 13, 15, 22, H('9aa1a9'))


def plant(L, x, y, big=True, seed=1):
    s = 10 if big else 8
    L.pbox(x, y, 0, s, s, 8 if big else 6, POT)
    L.pbox(x - 1, y - 1, (8 if big else 6) - 1, s + 2, s + 2, 2, POT)
    cx, cy = L.P(x + s / 2, y + s / 2, 10 if big else 8)
    rnd = random.Random(seed)
    S = L.S
    L.begin()
    blobs = [(0, -14, 7, 6), (-6, -8, 6, 5), (6, -8, 6, 5), (-3, -20, 5, 5), (4, -18, 5, 5), (0, -3, 6, 3)] if big else \
            [(0, -7, 6, 5), (-4, -3, 4, 3), (4, -3, 4, 3), (0, -12, 4, 4)]
    for dx, dy, a, b in blobs:
        L.ell(cx + dx * S, cy + dy * S, a * S, b * S, LEAF[1])
    L.end()
    for dx, dy, a, b in blobs:
        L.ell(cx + (dx + 1) * S, cy + (dy + 1) * S, a * 0.75 * S, b * 0.65 * S, LEAF[0])
        L.ell(cx + (dx - .5) * S, cy + (dy - .5) * S, a * 0.6 * S, b * 0.55 * S, LEAF[1])
        L.ell(cx + (dx - 1.5) * S, cy + (dy - 1.5) * S, a * 0.35 * S, b * 0.32 * S, LEAF[2])
        L.ell(cx + (dx - 2) * S, cy + (dy - 2) * S, a * 0.14 * S, b * 0.14 * S, LEAF[3])
    for _ in range(8 if big else 4):
        dx, dy, a, b = rnd.choice(blobs)
        L.rect(int(cx + (dx + rnd.uniform(-a, a) * .6) * S), int(cy + (dy + rnd.uniform(-b, b) * .5) * S), 1, 1, LEAF[3])


def bookshelf(L, x, y, w=28):
    """against back (y=0) wall, front faces +y, depth 8, height 34."""
    L.pbox(x, y, 0, w, 8, 34, WOODD)
    rnd = random.Random(w + x)
    cols = ['d26a5a', '5f8fc9', 'e8c35a', '6aa86a', 'a07ac0', 'e8915a', 'f0eadc', '4f6a8a']
    for zz in (2, 13, 24):
        L.begin(); L.qy(y + 8, x + 2, x + w - 2, zz, zz + 9, H('6b4a32')); L.end(False)
        bx = x + 2
        while bx < x + w - 3:
            bw = rnd.choice((2, 2, 3))
            bh = rnd.choice((6, 7, 8))
            c = H(rnd.choice(cols))
            L.qy(y + 8, bx, min(bx + bw, x + w - 2), zz, zz + bh, c)
            bx += bw + (1 if rnd.random() < 0.2 else 0)


def sofa(L, x, y, face='+x', col=T('b9d3b0', '9cbf93', '7fa277'), length=36):
    """sofa facing +x (backrest at low x) or +y (backrest at low y)."""
    if face == '+x':
        L.pbox(x, y, 0, 14, length, 7, col)
        L.pbox(x, y, 7, 5, length, 9, col)
        L.pbox(x + 5, y, 7, 9, 4, 4, col)
        L.pbox(x + 5, y + length - 4, 7, 9, 4, 4, col)
        for i in range(2):
            L.pbox(x + 5, y + 4 + i * (length - 8) // 2, 7, 8, (length - 8) // 2, 2, col)
        L.pbox(x + 4, y + 10, 9, 3, 6, 6, T('f2d6a0', 'e0bd80', 'c9a266'))
    else:
        L.pbox(x, y, 0, length, 14, 7, col)
        L.pbox(x, y, 7, length, 5, 9, col)
        L.pbox(x, y + 5, 7, 4, 9, 4, col)
        L.pbox(x + length - 4, y + 5, 7, 4, 9, 4, col)
        for i in range(2):
            L.pbox(x + 4 + i * (length - 8) // 2, y + 5, 7, (length - 8) // 2, 8, 2, col)
        L.pbox(x + 8, y + 4, 9, 6, 3, 6, T('f2d6a0', 'e0bd80', 'c9a266'))


def rug(L, x0, y0, x1, y1, c1=H('d9a6a0'), c2=H('c08a86'), c3=H('f1d8c8')):
    L.begin(); L.qz(0, x0, y0, x1, y1, c2); L.end()
    L.qz(0, x0 + 2, y0 + 2, x1 - 2, y1 - 2, c1)
    L.qz(0, x0 + 4, y0 + 4, x1 - 4, y0 + 5, c3)
    L.qz(0, x0 + 4, y1 - 5, x1 - 4, y1 - 4, c3)
    L.qz(0, x0 + 4, y0 + 4, x0 + 5, y1 - 4, c3)
    L.qz(0, x1 - 5, y0 + 4, x1 - 4, y1 - 4, c3)


def tv(L, x, y):
    """low cabinet + retro TV, screen facing +x."""
    L.pbox(x, y, 0, 10, 26, 9, WOODD)
    L.begin(); L.qx(x + 10, y + 2, y + 12, 2, 7, H('9a6e44')); L.qx(x + 10, y + 14, y + 24, 2, 7, H('9a6e44')); L.end(False)
    L.pbox(x + 1, y + 6, 9, 6, 12, 10, T('6a6a74', '55555f', '44444d'))
    L.pbox(x + 3, y + 4, 9, 6, 18, 13, T('7d7d88', '62626c', '4d4d56'))
    L.begin(); L.qx(x + 9, y + 6, y + 20, 11, 20, H('5d8fa8')); L.end(False)
    L.qx(x + 9, y + 7, y + 12, 18, 19, H('a8d4e6'))
    L.qx(x + 9, y + 13, y + 18, 13, 14, H('f2c58a'))
    L.pbox(x + 5, y + 10, 22, 2, 2, 1, T('7d7d88', '62626c', '4d4d56'))


def round_table(L, cx, cy, r=14):
    """pedestal round table centred at world (cx,cy)."""
    L.pbox(cx - 4, cy - 4, 0, 8, 8, 1, WOODD)
    L.pbox(cx - 1, cy - 1, 1, 2, 2, 10, WOODD, outline=False)
    px, py = L.P(cx, cy, 12)
    S = L.S
    L.begin(); L.ell(px, py + 2 * S, r * 1.42 * S, r * 0.71 * S, WOOD[2]); L.ell(px, py, r * 1.42 * S, r * 0.71 * S, WOOD[0]); L.end()
    L.ell(px, py + S, (r * 1.42 - 1) * S, (r * 0.71 - 1) * S, WOOD[1])
    L.ell(px - S, py, (r * 1.42 - 2) * S, (r * 0.71 - 1) * S, WOOD[0])
    L.ell(px - 4 * S, py - 2 * S, r * 0.5 * S, r * 0.2 * S, lighten(WOOD[0], .3))


def wood_chair(L, x, y, face='+y', part='all', col=WOOD):
    """8x8 seat at (x,y), seat z=7."""
    if part in ('all', 'seat'):
        for lx, ly in ((x, y), (x + 6, y), (x, y + 6), (x + 6, y + 6)):
            L.pbox(lx, ly, 0, 2, 2, 6, WOODD, outline=False)
        L.pbox(x, y, 6, 8, 8, 2, col)
    back = {'-y': (x, y + 7, 8, 8, 1, 9), '+y': (x, y, 8, 8, 1, 9),
            '-x': (x + 7, y, 8, 1, 8, 9), '+x': (x, y, 8, 1, 8, 9)}[face]
    if part in ('all', 'back'):
        L.pbox(*back, col)


def seated_wood(L, spr, x, y):
    px, py = L.P(x + 4, y + 4, 8)
    L.blit(spr, px - 12 * L.S, py - 28 * L.S)


def bed(L, x, y, quilt=T('f2b8c0', 'dc9aa4', 'c27f8a')):
    """head against back wall (y low). 22 wide x 34 long."""
    L.pbox(x, y, 0, 22, 34, 6, WOODD)
    L.pbox(x, y - 2, 0, 22, 3, 18, WOODD)
    L.pbox(x + 1, y + 1, 6, 20, 32, 4, T('fbf8f0', 'e8e2d4', 'd0c8b6'))
    L.pbox(x + 3, y + 3, 10, 7, 6, 3, T('ffffff', 'eae6dc', 'd6d0c2'))
    L.pbox(x + 12, y + 3, 10, 7, 6, 3, T('ffffff', 'eae6dc', 'd6d0c2'))
    L.pbox(x, y + 12, 6, 22, 22, 5, quilt)
    L.qz(11, x + 2, y + 18, x + 20, y + 19, quilt[0])
    L.qz(11, x + 2, y + 25, x + 20, y + 26, H('fbe0e4'))


def nightstand(L, x, y):
    L.pbox(x, y, 0, 9, 9, 10, WOOD)
    L.qy(y + 9, x + 2, x + 7, 5, 6, WOODD[2])
    L.pbox(x + 3, y + 3, 10, 3, 3, 2, T('8a6a52', '73563f', '5c4430'))
    L.pbox(x + 2, y + 2, 12, 5, 5, 6, T('fff1c4', 'f5dc9a', 'e2c27a'))


def counter(L, x, y, w, d, top=T('f0ece4', 'd8d2c6', 'bfb8aa'), body=T('a9c7d6', '8fb2c4', '7598ab')):
    L.pbox(x, y, 0, w, d, 12, body)
    L.pbox(x, y, 12, w, d, 2, top)


def stove(L, x, y):
    counter(L, x, y, 16, 14, body=T('e8e6e2', 'd2cfca', 'b5b1ab'))
    for dx, dy in ((4, 4), (11, 4), (4, 10), (11, 10)):
        L.wel(x + dx, y + dy, 14, 2.5, H('3a3a40'))


def fridge(L, x, y):
    L.pbox(x, y, 0, 14, 14, 34, T('f4f6f6', 'dde2e4', 'c0c8cc'))
    L.qy(y + 14, x + 1, x + 13, 20, 21, H('aab4ba'))
    L.qy(y + 14, x + 10, x + 11, 23, 30, H('8f9aa1'))
    L.qy(y + 14, x + 10, x + 11, 8, 17, H('8f9aa1'))
    L.qy(y + 14, x + 3, x + 6, 26, 29, H('f2c94c'))


def small_table(L, x, y, w=18, d=18):
    for lx, ly in ((x + 1, y + 1), (x + w - 3, y + 1), (x + 1, y + d - 3), (x + w - 3, y + d - 3)):
        L.pbox(lx, ly, 0, 2, 2, 10, WOODD, outline=False)
    L.pbox(x, y, 10, w, d, 2, WOOD)


def bench(L, x, y, length=28):
    """park bench along x, backrest at low y."""
    for lx in (x + 2, x + length - 4):
        L.pbox(lx, y + 1, 0, 2, 8, 6, T('5a5a62', '45454c', '35353b'))
    for i in range(3):
        L.pbox(x, y + 2 + i * 3, 6, length, 2, 1, WOOD)
    L.pbox(x, y, 9, length, 1, 3, WOOD)
    L.pbox(x, y, 13, length, 1, 3, WOOD)


def bush(L, x, y, r=8, flowers=None, seed=3):
    px, py = L.P(x, y, 0)
    rnd = random.Random(seed)
    r = r * L.S
    L.begin(); L.ell(px, py - r * 0.6, r * 1.3, r * 0.9, LEAF[1]); L.end()
    L.ell(px + L.S, py - r * 0.5, r * 1.0, r * 0.65, LEAF[0])
    L.ell(px - L.S, py - r * 0.7, r * 0.9, r * 0.6, LEAF[1])
    L.ell(px - 3 * L.S, py - r * 0.9, r * 0.4, r * 0.3, LEAF[2])
    if flowers:
        for _ in range(6):
            fx = px + rnd.randint(-int(r), int(r))
            fy = py - r * 0.6 + rnd.randint(-int(r * 0.6), int(r * 0.4))
            L.dot(int(fx), int(fy), H(flowers))


def tree(L, x, y):
    L.pbox(x - 2, y - 2, 0, 4, 4, 18, T('a0754e', '8a6040', '6e4b31'))
    px, py = L.P(x, y, 18)
    S = L.S
    L.begin()
    for dx, dy, a, b in ((0, -10, 14, 11), (-9, -2, 9, 7), (9, -2, 9, 7), (0, -20, 9, 7)):
        L.ell(px + dx * S, py + dy * S, a * S, b * S, LEAF[1])
    L.end()
    for dx, dy, a, b in ((0, -10, 14, 11), (-9, -2, 9, 7), (9, -2, 9, 7), (0, -20, 9, 7)):
        L.ell(px + (dx + 2) * S, py + (dy + 2) * S, a * 0.7 * S, b * 0.6 * S, LEAF[0])
        L.ell(px + (dx - 2) * S, py + (dy - 2) * S, a * 0.45 * S, b * 0.4 * S, LEAF[2])
    for dx, dy in ((-5, -16), (4, -22), (-10, -5), (7, -8), (-1, -12)):
        L.dot(int(px + dx * S), int(py + dy * S), LEAF[3])


def lamp(L, x, y):
    L.pbox(x, y, 0, 6, 6, 1, T('7d6a5a', '66564a', '524439'))
    L.pbox(x + 2, y + 2, 1, 2, 2, 22, T('7d6a5a', '66564a', '524439'), outline=False)
    L.pbox(x, y, 22, 6, 6, 5, T('fff1c4', 'f5dc9a', 'e2c27a'))


# ---- wall-mounted (plane y=yp facing +y, or x=xp facing +x) ----------------------
def window_y(L, yp, x0, x1, z0, z1):
    L.begin(); L.qy(yp, x0 - 2, x1 + 2, z0 - 2, z1 + 2, H('f7f2e6')); L.end()
    L.qy(yp, x0, x1, z0, z1, SKY)
    L.qy(yp, x0, x1, z0, z0 + (z1 - z0) // 3, SKY2)
    mx = (x0 + x1) // 2
    L.qy(yp, mx, mx + 1, z0, z1, H('f7f2e6'))
    L.qy(yp, x0, x1, (z0 + z1) // 2, (z0 + z1) // 2 + 1, H('f7f2e6'))
    for i in range(3):  # glint
        L.qy(yp, x0 + 2 + i, x0 + 3 + i, z1 - 3 - i * 2, z1 - 1 - i * 2, WHITE)
    L.pbox(x0 - 3, yp, z0 - 4, x1 - x0 + 6, 3, 2, T('f7f2e6', 'e2dccc', 'cfc6b2'))


def window_x(L, xp, y0, y1, z0, z1):
    L.begin(); L.qx(xp, y0 - 2, y1 + 2, z0 - 2, z1 + 2, H('ece6d8')); L.end()
    L.qx(xp, y0, y1, z0, z1, H('9ccbe0'))
    L.qx(xp, y0, y1, z0, z0 + (z1 - z0) // 3, H('c0dfec'))
    my = (y0 + y1) // 2
    L.qx(xp, my, my + 1, z0, z1, H('ece6d8'))
    L.qx(xp, y0, y1, (z0 + z1) // 2, (z0 + z1) // 2 + 1, H('ece6d8'))
    L.pbox(xp, y0 - 3, z0 - 4, 3, y1 - y0 + 6, 2, T('f7f2e6', 'e2dccc', 'cfc6b2'))


def frame_y(L, yp, x0, x1, z0, z1, art=('9cc4dc', 'f2c58a', '8cc477'), fr='8a6448'):
    L.begin(); L.qy(yp, x0 - 1, x1 + 1, z0 - 1, z1 + 1, H(fr)); L.end()
    L.qy(yp, x0, x1, z0, z1, H(art[0]))
    L.qy(yp, x0, x1, z0, z0 + (z1 - z0) // 2, H(art[2]))
    L.qy(yp, x0 + (x1 - x0) // 2, x1 - 1, z0 + (z1 - z0) // 2, z1 - 1, H(art[1]))


def frame_x(L, xp, y0, y1, z0, z1, art=('e8b4c0', 'fbf3e0', '9cc4dc'), fr='8a6448'):
    L.begin(); L.qx(xp, y0 - 1, y1 + 1, z0 - 1, z1 + 1, H(fr)); L.end()
    L.qx(xp, y0, y1, z0, z1, H(art[0]))
    L.qx(xp, y0 + 2, y1 - 2, z0 + 2, z1 - 2, H(art[1]))
    L.qx(xp, y0 + 3, y1 - 3, z0 + 3, z0 + 5, H(art[2]))


def wall_whiteboard_y(L, yp, x0, x1, z0, z1):
    L.begin(); L.qy(yp, x0 - 1, x1 + 1, z0 - 1, z1 + 1, H('b5bbc1')); L.end()
    L.qy(yp, x0, x1, z0, z1, H('fbfbf6'))
    for i, c in enumerate(('4a78c8', 'd65a5a', '4a78c8', '4fa860')):
        zz = z1 - 3 - i * 3
        L.qy(yp, x0 + 2, x0 + 2 + (5 + (i * 7) % 9), zz, zz + 1, H(c))
    L.qy(yp, x1 - 8, x1 - 2, z0 + 3, z0 + 4, H('d65a5a'))
    L.qy(yp, x1 - 6, x1 - 4, z0 + 2, z0 + 7, H('d65a5a'))


def corkboard_y(L, yp, x0, x1, z0, z1):
    L.begin(); L.qy(yp, x0 - 1, x1 + 1, z0 - 1, z1 + 1, H('8a6448')); L.end()
    L.qy(yp, x0, x1, z0, z1, H('d4a36e'))
    notes = [('fbf3e0', 1, 6, 3, 8), ('f6e27a', 8, 13, 9, 14), ('f2b8c0', 15, 20, 4, 9),
             ('a9d6ec', 3, 8, 11, 15), ('fbf3e0', 14, 20, 11, 15), ('b9e0a8', 22, 26, 6, 12)]
    for c, a, b, za, zb in notes:
        if x0 + b <= x1:
            L.qy(yp, x0 + a, x0 + b, z0 + za, z0 + zb, H(c))
            L.dot(*[int(v) for v in L.P(x0 + (a + b) // 2, yp, z0 + zb - 1)], H('d65a5a'))
    # calendar grid
    L.qy(yp, x0 + 8, x0 + 13, z0 + 3, z0 + 4, H('8a6448'))


def elevator_x(L, xp, y0, y1, z1=40):
    """elevator on wall plane x=xp (faces +x)."""
    L.begin(); L.qx(xp, y0 - 3, y1 + 3, 0, z1 + 3, H('9aa1a9')); L.end()
    L.qx(xp, y0 - 2, y1 + 2, 0, z1 + 2, H('7d848c'))
    my = (y0 + y1) // 2
    L.qx(xp, y0, my, 0, z1, H('d5dade'))
    L.qx(xp, my, y1, 0, z1, H('c3c9ce'))
    L.qx(xp, my, my + 1, 0, z1, H('6e757d'))
    L.qx(xp, y0 + 1, y0 + 2, 2, z1 - 2, H('eef1f3'))
    L.qx(xp, my + 1, my + 2, 2, z1 - 2, H('dfe3e6'))
    L.begin(); L.qx(xp, my - 3, my + 3, z1 + 5, z1 + 9, H('2f3a40')); L.end()
    L.qx(xp, my - 1, my + 1, z1 + 6, z1 + 8, H('f4bb55'))
    L.begin(); L.qx(xp, y1 + 5, y1 + 8, 18, 26, H('b5bbc1')); L.end()
    L.qx(xp, y1 + 6, y1 + 7, 23, 24, H('f4bb55'))
    L.qx(xp, y1 + 6, y1 + 7, 20, 21, H('f4bb55'))


def elevator_y(L, yp, x0, x1, z1=40):
    L.begin(); L.qy(yp, x0 - 3, x1 + 3, 0, z1 + 3, H('9aa1a9')); L.end()
    L.qy(yp, x0 - 2, x1 + 2, 0, z1 + 2, H('7d848c'))
    mx = (x0 + x1) // 2
    L.qy(yp, x0, mx, 0, z1, H('e2e6e9'))
    L.qy(yp, mx, x1, 0, z1, H('d0d5d9'))
    L.qy(yp, mx, mx + 1, 0, z1, H('6e757d'))
    L.begin(); L.qy(yp, mx - 3, mx + 3, z1 + 5, z1 + 9, H('2f3a40')); L.end()
    L.qy(yp, mx - 1, mx + 1, z1 + 6, z1 + 8, H('f4bb55'))
    L.begin(); L.qy(yp, x1 + 5, x1 + 8, 18, 26, H('b5bbc1')); L.end()
    L.qy(yp, x1 + 6, x1 + 7, 23, 24, H('f4bb55'))



def elevator_open_y(L, yp, x0, x1, k, z1=40):
    """the doors of elevator_y slid apart by k (0..1): the lit cabin shows between them."""
    mx = (x0 + x1) // 2
    gap = max(1, round((mx - x0) * k))
    L.qy(yp, mx - gap, mx + gap, 0, z1, H('4a4450'))
    L.qy(yp, mx - gap + 2, mx + gap - 2, 2, z1 - 2, H('f1dfb4'))
    L.qy(yp, mx - gap + 2, mx + gap - 2, 2, 5, H('c8b48e'))
    if mx - gap > x0:
        L.qy(yp, x0, mx - gap, 0, z1, H('e2e6e9'))
        L.qy(yp, mx - gap - 1, mx - gap, 0, z1, H('6e757d'))
    if mx + gap < x1:
        L.qy(yp, mx + gap, x1, 0, z1, H('d0d5d9'))
        L.qy(yp, mx + gap, mx + gap + 1, 0, z1, H('6e757d'))

# ---- speech bubbles (screen space; x,y = tail tip) ---------------------------------
CHECK = [(0, 2), (1, 3), (2, 4), (3, 3), (4, 2), (5, 1), (6, 0), (1, 2), (2, 3), (3, 2), (4, 1), (5, 0)]


def bubble(L, x, y, kind='...'):
    """speech bubble, tail tip at (x,y); sized to the layer scale."""
    from font5 import draw as fdraw
    S = L.S
    w, h = 15 * S, 10 * S
    bx, by = x - 4 * S, y - h - 2 * S
    L.begin()
    L.rect(bx + 2, by, w - 4, h, WHITE); L.rect(bx + 1, by + 1, w - 2, h - 2, WHITE); L.rect(bx, by + 2, w, h - 4, WHITE)
    for i in range(2 * S + 1):
        L.rect(x, y - 2 * S - 1 + i, 2 * S + 1 - i, 1, WHITE)
    L.end()
    L.rect(bx + 2, by + 1, w - 6, 1, H('ffffff'))
    L.rect(bx + 2, by + h - 2, w - 4, 1, H('e6e0d4'))
    cx, cy = bx + w // 2, by + h // 2
    if kind == '...':
        for i in (-4, 0, 4):
            L.rect(cx + i * S - 1, cy - 1, 2, 2, H('4a3b30'))
    elif kind == 'ok':
        for dx, dy in CHECK:
            L.rect(cx - 3 * S + dx * S // 1, cy - 2 * S + dy * S // 1, S, S, H('3f9a4e'))
    else:
        fdraw(L, kind, cx - 2, cy - 4, H('d65a5a') if kind == '!' else H('4a78c8'))



def file_cabinet(L, x, y, face='+x'):
    """10x12 cabinet, drawers on +x face (or +y)."""
    if face == '+x':
        L.pbox(x, y, 0, 10, 12, 18, T('e2dccc', 'cdc5b2', 'b3aa95'))
        for zz in (2, 8, 14):
            L.qx(x + 10, y + 4, y + 8, zz + 2, zz + 3, H('7d735f'))
            L.qx(x + 10, y + 1, y + 11, zz - 1, zz, H('9c937e'))
    else:
        L.pbox(x, y, 0, 12, 10, 18, T('e2dccc', 'cdc5b2', 'b3aa95'))
        for zz in (2, 8, 14):
            L.qy(y + 10, x + 4, x + 8, zz + 2, zz + 3, H('7d735f'))
            L.qy(y + 10, x + 1, x + 11, zz - 1, zz, H('9c937e'))


def printer(L, x, y):
    L.pbox(x, y, 0, 14, 12, 10, T('a9b0b7', '8f969d', '757c83'))
    L.pbox(x + 1, y + 1, 10, 12, 10, 5, T('eef0f2', 'd5dade', 'b6bec5'))
    L.pbox(x + 3, y + 3, 15, 7, 6, 1, T('fbf8f0', 'e2ddd0', 'cfc8b8'))
    L.dot(*[int(v) for v in L.P(x + 13, y + 9, 13)], H('7be07f'))


def sofa_mx(L, x, y, col=T('b9d3b0', '9cbf93', '7fa277'), length=36):
    """sofa whose occupants face -x (backrest at high x): we see its back."""
    L.pbox(x, y, 0, 14, length, 7, col)
    L.pbox(x, y, 7, 9, 4, 4, col)
    L.pbox(x, y + length - 4, 7, 9, 4, 4, col)
    for i in range(2):
        L.pbox(x + 1, y + 4 + i * (length - 8) // 2, 7, 8, (length - 8) // 2, 2, col)
    L.pbox(x + 3, y + 8, 9, 3, 6, 6, T('f2d6a0', 'e0bd80', 'c9a266'))
    L.pbox(x + 9, y, 7, 5, length, 9, col)


def wardrobe(L, x, y, w=18):
    L.pbox(x, y, 0, w, 10, 38, WOOD)
    m = x + w // 2
    L.qy(y + 10, m, m + 1, 2, 36, WOOD[2])
    L.qy(y + 10, m - 3, m - 2, 18, 22, WOODD[2])
    L.qy(y + 10, m + 2, m + 3, 18, 22, WOODD[2])


def fence_x(L, x0, x1, y):
    """picket fence along x at y."""
    col = T('fbf6ea', 'ebe2cf', 'd4c9b2')
    L.pbox(x0, y, 4, x1 - x0, 1, 1, col, outline=False)
    L.pbox(x0, y, 9, x1 - x0, 1, 1, col, outline=False)
    for px in range(x0, x1 - 1, 5):
        L.pbox(px, y, 0, 2, 2, 12, col)


def fence_y(L, x, y0, y1):
    col = T('fbf6ea', 'ebe2cf', 'd4c9b2')
    L.pbox(x, y0, 4, 1, y1 - y0, 1, col, outline=False)
    L.pbox(x, y0, 9, 1, y1 - y0, 1, col, outline=False)
    for py in range(y0, y1 - 1, 5):
        L.pbox(x, py, 0, 2, 2, 12, col)


def flowers(L, x0, y0, x1, y1, seed=1):
    rnd = random.Random(seed)
    for _ in range(int((x1 - x0) * (y1 - y0) / 30)):
        px, py = L.P(rnd.uniform(x0, x1), rnd.uniform(y0, y1))
        c = H(rnd.choice(('f2a0b0', 'f6e27a', 'fbf6ea', 'b9a0e0')))
        L.dot(int(px), int(py) - 1, c)
        L.dot(int(px), int(py), LEAF[0])
