"""Workstations where the agent always faces their own monitor.
ws_back : agent seen from behind (facing -x), CRT screen faces the agent (+x) -> screen visible beside them.
ws_front*: agent faces the viewer, CRT screen faces the agent -> we see the monitor's back, set beside them."""
import furn as F
import furn2 as G
from chars import sprite


def _led(L, x, y, z, state):
    L.dot(*[int(v) for v in L.P(x, y, z)], G.LED[state])


def ws_back(sc, x, y, vi, state, extra='mug', head=None, boss=False, d_=26):
    """desk long along y at (x,y) 14 x d_; agent east of it, facing -x (BL), at the middle of the desk."""
    L = sc.L
    o = (d_ - 26) // 2
    z = 13 if boss else 12

    def d():
        if boss:
            G.boss_desk(L, x, y, 14, d_)
        else:
            F.desk(L, x, y, 14, d_)
        F.crt(L, x + 1, y + o + 1, z, '+x', state)
        F.keyboard(L, x + 10, y + o + 3, z, 'y')
        if extra == 'mug':
            F.mug(L, x + 4, y + o + 19, z)
        elif extra == 'papers':
            F.papers(L, x + 4, y + o + 18, z)
    sc.add((x, y, x + 14, y + d_), d, True)
    cx, cy = x + 16, y + o + 3

    def c():
        F.chair(L, cx, cy, '-x', 'seat')
        if vi is not None:
            F.seated(L, sprite(vi, 'BL', 'sitB'), cx, cy)
        F.chair(L, cx, cy, '-x', 'back')
    sc.add((cx, cy, cx + 10, cy + 10), c)
    if head:
        px, py = L.P(cx + 5, cy + 5, 7); sc.heads[head] = (int(px) + 3 * L.S, int(py) - 24 * L.S)
    return cx + 5, cy + 5


def ws_front_y(sc, x, y, vi, state, boss=False, w=34, head=None):
    """desk long along x at (x,y) w x 14; agent north of it facing +y (FL); monitor (back to us) beside."""
    L = sc.L

    def d():
        if boss:
            G.boss_desk_y(L, x, y, w, 14)
        else:
            F.desk(L, x, y, w, 14)
        z = 13 if boss else 12
        F.crt(L, x + 1, y + 1, z, '-y', state)
        _led(L, x + 8, y + 11, z + 9, state)
        F.keyboard(L, x + w - 14, y + 2, z)
        F.papers(L, x + w - 13, y + 8, z)
    sc.add((x, y, x + w, y + 14), d, True)
    cx, cy = x + w - 13, y - 12

    def c():
        F.chair(L, cx, cy, '+y')
        if vi is not None:
            F.seated(L, sprite(vi, 'FL', 'sitF'), cx, cy)
    sc.add((cx, cy, cx + 10, cy + 10), c)
    if head:
        px, py = L.P(cx + 5, cy + 5, 7); sc.heads[head] = (int(px) + 3 * L.S, int(py) - 24 * L.S)


def ws_front_x(sc, x, y, vi, state, boss=True, d_=34, head=None):
    """desk long along y at (x,y) 14 x d_; agent west of it facing +x (FR); monitor (back to us) beside."""
    L = sc.L

    def d():
        if boss:
            G.boss_desk(L, x, y, 14, d_)
        else:
            F.desk(L, x, y, 14, d_)
        z = 13 if boss else 12
        F.crt(L, x + 1, y + 1, z, '-x', state)
        _led(L, x + 11, y + 8, z + 9, state)
        F.keyboard(L, x + 2, y + d_ - 13, z, 'y')
        F.papers(L, x + 7, y + d_ - 10, z)
    sc.add((x, y, x + 14, y + d_), d, True)
    cx, cy = x - 12, y + d_ - 13

    def c():
        F.chair(L, cx, cy, '+x')
        if vi is not None:
            F.seated(L, sprite(vi, 'FR', 'sitF'), cx, cy)
    sc.add((cx, cy, cx + 10, cy + 10), c)
    if head:
        px, py = L.P(cx + 5, cy + 5, 7); sc.heads[head] = (int(px) + 3 * L.S, int(py) - 24 * L.S)
