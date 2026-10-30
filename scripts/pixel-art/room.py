"""Room shell (slab, floor, back walls, low walls) + back-to-front item sorting."""
import math, random
from px import H, Layer, OUT
from furn import T

BG = H('1f1b24')
WALL_Y = T('8f765f', 'ecdfc4', 'd9c8a6')   # wall along x (faces +y): light
WALL_X = T('8f765f', 'e3d2b2', 'cdbb98')   # wall along y (faces +x): a bit darker
LOWWALL = T('b89a7a', 'ecdfc4', 'd5c3a1')
SLAB = T('8a7d74', '6e625b', '574d48')


def grey_checker(x, y):
    tx, ty = math.floor(x / 16), math.floor(y / 16)
    base = H('d6d9db') if (tx + ty) % 2 == 0 else H('b9bec3')
    fx, fy = x - tx * 16, y - ty * 16
    if fx < 1 or fy < 1:
        return H('b3b8bd') if (tx + ty) % 2 == 0 else H('aeb3b8')
    if fx > 14.5 or fy > 14.5:
        return H('e1e3e5') if (tx + ty) % 2 == 0 else H('cdd1d4')
    return base


def warm_wood(x, y):
    plank = math.floor(y / 6)
    off = (plank * 23) % 48
    seam = (x + off) % 48 < 1
    edge = (y % 6) < 0.9
    c = [H('e2b989'), H('d8ad7c'), H('dcb384')][plank % 3]
    if edge:
        return H('b98c5f')
    if seam:
        return H('c39769')
    return c


def wood_x(x, y):  # planks running along y
    return warm_wood(y, x)


def carpet(x, y):
    if (int(x) % 8 == 3 and int(y) % 8 == 3):
        return H('c99a9e')
    return H('d9b0b2')


_rg = random.Random(7)
_GRASS = {}


def grass(x, y):
    k = (int(x) // 2, int(y) // 2)
    if k not in _GRASS:
        r = _rg.random()
        _GRASS[k] = H('8ec46f') if r < 0.12 else H('a8d585') if r < 0.2 else H('9ccf7a')
    return _GRASS[k]


def kitchen_tile(x, y):
    tx, ty = math.floor(x / 8), math.floor(y / 8)
    if (x % 8) < 0.8 or (y % 8) < 0.8:
        return H('c9c2b4')
    return H('f2ede2') if (tx + ty) % 2 == 0 else H('e4dccb')


def draw_floor(L, W, D, fn, slab=True):
    if slab:
        L.pbox(0, 0, -10, W, D, 10, SLAB)
    img = L.img
    px = img.load()
    S = L.S
    x0 = int(L.ox - D * S) - 1
    x1 = int(L.ox + W * S) + 1
    y0 = int(L.oy) - 1
    y1 = int(L.oy + (W + D) / 2 * S) + 1
    for r in range(y0, y1):
        for c in range(x0, x1):
            sx = (c + 0.5 - L.ox) / S
            sy = (r + 0.5 - L.oy) / S
            x = sy + sx / 2
            y = sy - sx / 2
            if 0 <= x < W and 0 <= y < D:
                px[c, r] = fn(x, y)


def back_walls(L, W, D, h=56, t=4):
    L.pbox(-t, -t, 0, t, D + t, h, WALL_X)
    L.pbox(0, -t, 0, W, t, h, WALL_Y)
    # baseboards + top shadow line
    L.qy(0, 0, W, 0, 3, H('c2ab88'))
    L.qx(0, 0, D, 0, 3, H('b59e7c'))
    L.qy(0, 0, W, h - 2, h, H('d9c8a6'))
    L.qx(0, 0, D, h - 2, h, H('c8b692'))


def low_wall(L, x, y, w, d, h=20):
    L.pbox(x, y, 0, w, d, h, LOWWALL)


def behind(a, b):
    return (a[2] <= b[0] and a[1] < b[3]) or (a[3] <= b[1] and a[0] < b[2])


def draw_sorted(items):
    """items: list of ((x0,y0,x1,y1), fn). Topological back-to-front order."""
    items = sorted(items, key=lambda it: (it[0][0] + it[0][1], it[0][0]))
    state = [0] * len(items)
    order = []

    def visit(i):
        if state[i]:
            return
        state[i] = 1
        for j in range(len(items)):
            if j != i and not state[j] and behind(items[j][0], items[i][0]):
                visit(j)
        state[i] = 2
        order.append(i)

    for i in range(len(items)):
        visit(i)
    for i in order:
        items[i][1]()
