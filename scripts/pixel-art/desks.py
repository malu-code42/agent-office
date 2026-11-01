"""Workstations where the agent always faces their own monitor.
ws_back : agent seen from behind (facing -x), CRT screen faces the agent (+x) -> screen visible beside them.
ws_front*: agent faces the viewer, CRT screen faces the agent -> we see the monitor's back, set beside them."""
import furn as F
import furn2 as G
from chars import sprite


def graphite(L, x, y, w, d):
    F.desk(L, x, y, w, d, col=F.DESK_TOP, leg=F.DESK_LEG)


def east_set(L, x, a, state):
    """ultrawide set back, laptop, keyboard and mug on a desk 14 wide at x; a = lateral start; sitter east (+x)."""
    F.crt(L, x - 4, a + 2, 12, '+x', state, 1)
    G.laptop(L, x + 6, a + 18, 12, '+x', '82aaff')
    F.keyboard(L, x + 10, a + 5, 12, 'y')
    F.mug(L, x + 10, a + 2, 12)


def ws_back(sc, x, y, vi, state, head=None, d_=26, col=F.CHAIR):
    """desk long along y at (x,y) 14 x d_; agent east of it, facing -x (BL), at the middle of the desk."""
    L = sc.L
    o = (d_ - 26) // 2

    def d():
        graphite(L, x, y, 14, d_)
        east_set(L, x, y + o, state)
    sc.add((x, y, x + 14, y + d_), d, True)
    cx, cy = x + 16, y + o + 3

    def c():
        F.chair(L, cx, cy, '-x', 'seat', col)
        if vi is not None:
            F.seated(L, sprite(vi, 'BL', 'sitB'), cx, cy)
        F.chair(L, cx, cy, '-x', 'back', col)
    sc.add((cx, cy, cx + 10, cy + 10), c)
    if head:
        px, py = L.P(cx + 5, cy + 5, 7); sc.heads[head] = (int(px) + 3 * L.S, int(py) - 24 * L.S)
    return cx + 5, cy + 5


def ws_front_shift(w, centered):
    """how far west the set of ws_front_y moves to sit in the middle of the desk."""
    return int(w / 2 - 8) if centered else 0


def ws_front_y(sc, x, y, vi, state, w=34, head=None, col=F.CHAIR, centered=False):
    """desk long along x at (x,y) w x 14; agent north of it facing +y (FL); monitor (back to us) in front of the wall side.
    centered: the monitor, keyboard and chair in the middle of the desk instead of at its east end."""
    L = sc.L
    x0 = x
    x = x - ws_front_shift(w, centered)

    def d():
        graphite(L, x0, y, w, 14)
        F.crt(L, x + w - 14, y + 8, 12, '-y', state, 1)
        G.laptop(L, x + w - 24, y + 5, 12, '-y', '82aaff')
        F.keyboard(L, x + w - 13, y + 2, 12)
        F.mug(L, x + w - 16, y + 2, 12)
    sc.add((x0, y, x0 + w, y + 14), d, True)
    cx, cy = x + w - 13, y - 12

    def c():
        F.chair(L, cx, cy, '+y', 'all', col)
        if vi is not None:
            F.seated(L, sprite(vi, 'FL', 'sitF'), cx, cy)
    sc.add((cx, cy, cx + 10, cy + 10), c)
    if head:
        px, py = L.P(cx + 5, cy + 5, 7); sc.heads[head] = (int(px) + 3 * L.S, int(py) - 24 * L.S)


def ws_front_x(sc, x, y, vi, state, d_=34, head=None, col=F.CHAIR):
    """desk long along y at (x,y) 14 x d_; agent west of it facing +x (FR); monitor (back to us) set back."""
    L = sc.L
    a = y + d_ - 16  # lateral start, so the set centres on the chair

    def d():
        graphite(L, x, y, 14, d_)
        F.crt(L, x + 8, a + 2, 12, '-x', state, 1)
        G.laptop(L, x + 2, a - 10, 12, '-x', '82aaff')
        F.keyboard(L, x, a + 5, 12, 'y')
        F.mug(L, x + 2, a + 2, 12)
    sc.add((x, y, x + 14, y + d_), d, True)
    cx, cy = x - 12, y + d_ - 13

    def c():
        F.chair(L, cx, cy, '+x', 'all', col)
        if vi is not None:
            F.seated(L, sprite(vi, 'FR', 'sitF'), cx, cy)
    sc.add((cx, cy, cx + 10, cy + 10), c)
    if head:
        px, py = L.P(cx + 5, cy + 5, 7); sc.heads[head] = (int(px) + 3 * L.S, int(py) - 24 * L.S)


def ws_back_y(sc, x, y, vi, state, extra='papers', head=None, boss=False, w=34):
    """desk long along x at (x,y) w x 14; agent south of it facing -y (BR), at its middle; the CRT faces the agent."""
    L = sc.L
    z = 13 if boss else 12
    m = x + w // 2

    def d():
        if boss:
            G.boss_desk_y(L, x, y, w, 14)
        else:
            F.desk(L, x, y, w, 14)
        F.crt(L, m - 7, y + 1, z, '+y', state)
        F.keyboard(L, m - 5, y + 10, z)
        if extra == 'mug':
            F.mug(L, x + 4, y + 4, z)
        elif extra == 'papers':
            F.papers(L, x + 3, y + 5, z)
    sc.add((x, y, x + w, y + 14), d, True)
    cx, cy = m - 5, y + 16

    def c():
        F.chair(L, cx, cy, '-y', 'seat')
        if vi is not None:
            F.seated(L, sprite(vi, 'BR', 'sitB'), cx, cy)
        F.chair(L, cx, cy, '-y', 'back')
    sc.add((cx, cy, cx + 10, cy + 10), c)
    if head:
        px, py = L.P(cx + 5, cy + 5, 7); sc.heads[head] = (int(px) + 3 * L.S, int(py) - 24 * L.S)
    return cx, cy
