"""scene-projeto.png - project floor (24x18 tiles): four L-shaped squad rooms in the corners around Emi's office.

AO-106. The approved board (planta.dc.html) is a plan view; the scene is isometric and draws only the two back
walls (x = 0 and y = 0), so the plan is turned: its top is the west wall (x = 0) and its right is the north wall
(y = 0). In tiles (x runs down-right, y down-left):

    x   0..7   top rooms (I, II)        y   0..6   right rooms (II, IV), the elevator hall at its end
        7..9   their coordinator strips      6..7   their extension (the free column, the door at its end)
        9..15  Emi's office, the halls       7..11  Emi's office, the halls above and below it
       15..17  the bottom rooms' strips     11..12  the left rooms' extension
       17..24  bottom rooms (III, IV)       12..18  left rooms (I, III)

Each room is an L: the block (3 x 3 desks, a pair of tiles each: the desk and its chair), the extension (a free
column along the corridor that serves every chair column and ends in the door) and the strip, two tiles deep, with
the coordinator's own desk. The corridors form a cross around the office, joined by a ring. Windows end the
corridors at the top, the bottom and the left; the elevator ends the one at the right. Only the top window is on a
drawn wall: the others are recorded for the layout (WINDOWS) but not painted.

Split in parts so export_app.py builds the app's atlas from the same geometry: shell() draws what never sorts
(floor, walls, rugs, elevator, windows, whiteboards), the other parts add sortable items to a Scene.
people=False leaves every chair empty.
"""
from px import H
import furn as F
import furn2 as G
from floorkit import (W, D, TS, new_layer, save2, Scene, region_floor, OAK, WALNUT, carpet_tiles, back_walls,
                      PROJECT_WALL, WALL_H, draw_floor)
from desks import ws_back, ws_front_x

SLATE = carpet_tiles(H('93a3b6'), H('8696aa'), H('76869a'))
WARMG = carpet_tiles(H('bdb4a9'), H('b1a89d'), H('9d958b'))
SAGE = carpet_tiles(H('afbea4'), H('a3b298'), H('919f86'))
ROSE = carpet_tiles(H('c9aeb6'), H('bda1aa'), H('a98a95'))

NX, NY = W // TS, D // TS
# the plan's columns along x and along y, in tiles
TOP_X, TOP_STRIP, HALL_X, BOT_STRIP, BOT_X = (0, 7), (7, 9), (9, 15), (15, 17), (17, 24)
RIGHT_Y, EXT_RIGHT, OFFICE_Y, EXT_LEFT, LEFT_Y = (0, 6), 6, (7, 11), 11, (12, 18)
OFFICE = (HALL_X[0], OFFICE_Y[0], HALL_X[1], OFFICE_Y[1])

# the elevator door on the back wall y = 0 (x0, x1): the end of the corridor at the right, centred on tile 12
ELEVATOR = (188, 212)
ELEVATOR_TILE = (12, 1)
# the windows that end the corridors: the end, the plane of the wall ('x': at x = `at`, spanning y; 'y': at y = `at`,
# spanning x), its span in art units and whether the scene draws that wall. The bottom and the left ends are on the
# front walls, which the isometric scene does not draw: those windows are part of the plan, not of the picture.
WINDOWS = [
    {'end': 'cima', 'plane': 'x', 'at': 0, 'span': [120, 168], 'drawn': True},
    {'end': 'baixo', 'plane': 'x', 'at': NX * TS, 'span': [120, 168], 'drawn': False},
    {'end': 'esquerda', 'plane': 'y', 'at': NY * TS, 'span': [168, 216], 'drawn': False},
]
WINDOW_Z = (24, 48)
# Emi's desk (x, y, length) in the office; her chair is east of it and she looks west, at the office door
EMI_DESK = (176, 122, 44)
EMI_CHAIR = 'mustard'
# the office door: on the plane x = 9, tiles 8 and 9 of y
OFFICE_DOOR = ('x', HALL_X[0], (8, 9))

# a member desk is 14 deep; the ones that face +x are 28 long (the 12-unit set needs the room), the others 26
MEMBER_LEN = 28
COORD_LEN = 34

# chair colours per room, mixed from its carpet: nine member desks, then the coordinator's
CHAIRS = [['slate', 'sky', 'steel', 'blue', 'sand', 'sky', 'steel', 'slate', 'blue', 'blue'],
          ['terra', 'sand', 'mustard', 'steel', 'rose', 'sand', 'terra', 'mustard', 'rose', 'terra'],
          ['sage', 'mint', 'green', 'sand', 'lilac', 'mint', 'sage', 'green', 'sand', 'sage'],
          ['lilac', 'rose', 'sky', 'mint', 'mustard', 'lilac', 'rose', 'sky', 'steel', 'lilac']]


def make_room(i, numeral, top, left, carpet, screen):
    """one L: its two rectangles (tiles x0, y0, x1, y1), door, desks and the tiles the game walks to."""
    bx = TOP_X if top else BOT_X
    sx = TOP_STRIP if top else BOT_STRIP
    by = LEFT_Y if left else RIGHT_Y
    ext = EXT_LEFT if left else EXT_RIGHT
    block = (bx[0], min(by[0], ext), bx[1], max(by[1], ext + 1))
    strip = (sx[0], by[0], sx[1], by[1])
    # (desk tile, chair tile) of the three columns, then the free row beside the strip. The top rooms' sitters face
    # +x (towards the coordinator) so their chair is the west tile of the pair; the bottom rooms' the east one.
    pairs = [(1, 0), (3, 2), (5, 4)] if top else [(18, 19), (20, 21), (22, 23)]
    rows = [by[0] + 2 * r for r in range(3)]
    return {
        'index': i, 'numeral': numeral, 'top': top, 'left': left, 'carpet': carpet, 'screen': screen,
        'block': block, 'strip': strip, 'rects': [block, strip], 'ext': ext,
        'spare': 6 if top else 17,
        'members': [(d, c, row) for row in rows for d, c in pairs],
        # the door at the end of the extension, on the plane x = 7 (top) or 17 (bottom), tile `ext` of y
        'door': ('x', TOP_X[1] if top else BOT_X[0], ext),
        'coord_col': TOP_STRIP[0] if top else BOT_STRIP[1] - 1,
        'y_mid': (by[0] + by[1]) * TS // 2,
        # the wall the room touches in the scene: x = 0 ('west'), y = 0 ('north'), or none (the corner nearest the viewer)
        'back': 'west' if top else (None if left else 'north'),
        'chairs': CHAIRS[i],
    }


# I top-left of the plan, II top-right, III bottom-left, IV bottom-right. The plan's top is x = 0 and its right is
# y = 0, so in the scene I is the left corner, II the back corner, III the front one and IV the right one
ROOMS = [make_room(i, *args) for i, args in enumerate((('I', True, True, SLATE, 'green'), ('II', True, False, WARMG, 'amber'),
                                                       ('III', False, True, SAGE, 'red'), ('IV', False, False, ROSE, 'green')))]


# ---- desks ------------------------------------------------------------------------------
def member_at(room, k):
    """(x, y, face) of the k-th member desk (art units): its corner, and the way its sitter looks."""
    d, _c, row = room['members'][k]
    if room['top']:
        return d * TS + 1, row * TS + 2, '+x'
    return d * TS + 1, row * TS + 3, '-x'


def member_chair(room, k):
    """(x, y, face) of the chair of the k-th member desk: its corner on the floor."""
    x, y, face = member_at(room, k)
    if face == '+x':
        return x - 12, y + MEMBER_LEN - 13, face
    return x + 16, y + 3, face


def draw_member(sc, room, k, vi, state, head=None):
    x, y, face = member_at(room, k)
    col = F.CHAIRS[room['chairs'][k]]
    if face == '+x':
        return ws_front_x(sc, x, y, vi, state, d_=MEMBER_LEN, head=head, col=col)
    return ws_back(sc, x, y, vi, state, head=head, col=col)


def coord_at(room):
    """(x, y, face): the coordinator's own desk, in the middle of the strip; its sitter looks at the members."""
    return room['coord_col'] * TS + 1, room['y_mid'] - COORD_LEN // 2, ('-x' if room['top'] else '+x')


def coord_chair(room):
    x, y, face = coord_at(room)
    if face == '-x':
        return x + 16, y + (COORD_LEN - 26) // 2 + 3, face
    return x - 12, y + COORD_LEN - 13, face


def draw_coord(sc, room, vi, state, head=None):
    x, y, face = coord_at(room)
    col = F.CHAIRS[room['chairs'][9]]
    if face == '-x':
        return ws_back(sc, x, y, vi, state, head=head, d_=COORD_LEN, col=col)
    return ws_front_x(sc, x, y, vi, state, d_=COORD_LEN, head=head, col=col)


# ---- glass around every room and the office, found from the tiles they enclose ----------------------
def cells_of(rects):
    return {(x, y) for x0, y0, x1, y1 in rects for x in range(x0, x1) for y in range(y0, y1)}


def runs_around(cells):
    """the edges between a set of tiles and the floor beside it, as runs (axis, at, from, to) in tiles.
    axis 'x' is a wall at x = at spanning y (sc.gy); axis 'z' a wall at y = at spanning x (sc.gx). The edges on the
    floor's border are left out: the two back walls are drawn by the shell, the front ones not at all."""
    edges = {}
    for x, y in cells:
        for dx, dy, axis, at, idx in ((-1, 0, 'x', x, y), (1, 0, 'x', x + 1, y), (0, -1, 'z', y, x), (0, 1, 'z', y + 1, x)):
            nx, ny = x + dx, y + dy
            if (nx, ny) in cells or not (0 <= nx < NX and 0 <= ny < NY):
                continue
            edges.setdefault((axis, at), []).append(idx)
    out = []
    for (axis, at), idxs in sorted(edges.items()):
        idxs.sort()
        start = prev = idxs[0]
        for i in idxs[1:] + [None]:
            if i is not None and i == prev + 1:
                prev = i
                continue
            out.append((axis, at, start, prev + 1))
            if i is not None:
                start = prev = i
    return out


def outline(cells):
    """the outer boundary of a set of tiles as one polygon of tile corners, without collinear points."""
    nxt = {}
    for x, y in cells:
        for (dx, dy), a, b in (((0, -1), (x, y), (x + 1, y)), ((1, 0), (x + 1, y), (x + 1, y + 1)),
                               ((0, 1), (x + 1, y + 1), (x, y + 1)), ((-1, 0), (x, y + 1), (x, y))):
            if (x + dx, y + dy) not in cells:
                nxt[a] = b
    start = min(nxt)
    pts, cur = [start], nxt[start]
    while cur != start:
        pts.append(cur)
        cur = nxt[cur]
    n = len(pts)
    return [p for i, p in enumerate(pts)
            if (p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) != (pts[(i + 1) % n][0] - p[0], pts[(i + 1) % n][1] - p[1])]


def glass_around(sc, cells, doors):
    """glass along every edge of the tiles; `doors` are (axis, at, tile) gaps."""
    for axis, at, a, b in runs_around(cells):
        gaps = []
        for i in sorted(i for ax, p, i in doors if ax == axis and p == at and a <= i < b):
            if gaps and gaps[-1][1] == i * TS:
                gaps[-1] = (gaps[-1][0], (i + 1) * TS)
            else:
                gaps.append((i * TS, (i + 1) * TS))
        if axis == 'x':
            sc.gy(a * TS, b * TS, at * TS, doors=gaps)
        else:
            sc.gx(a * TS, b * TS, at * TS, doors=gaps)


def partitions(sc):
    for room in ROOMS:
        glass_around(sc, cells_of(room['rects']), {room['door']})
    axis, at, idxs = OFFICE_DOOR
    glass_around(sc, cells_of([OFFICE]), {(axis, at, i) for i in idxs})


# ---- the shell: what never sorts ------------------------------------------------------------------
def shell(L):
    regions = [(r, room['carpet']) for room in ROOMS for r in room['rects']] + [(OFFICE, WALNUT)]
    draw_floor(L, W, D, region_floor(regions, OAK))
    back_walls(L, PROJECT_WALL)
    F.elevator_y(L, 0, *ELEVATOR)
    for win in WINDOWS:
        if win['drawn']:
            F.window_x(L, win['at'], *win['span'], *WINDOW_Z)
    # a whiteboard on the back wall of each room that has one
    for room in ROOMS:
        bx0, by0, bx1, by1 = (v * TS for v in room['block'])
        if room['back'] == 'west':
            mid = (by0 + by1) // 2
            G.wall_whiteboard_x(L, 0, mid - 16, mid + 16, 20, 40)
        elif room['back'] == 'north':
            mid = (bx0 + bx1) // 2
            F.wall_whiteboard_y(L, 0, mid - 16, mid + 16, 20, 40)
    # a runner from the elevator, and a rug under Emi's desk
    F.rug(L, 160, 6, 224, 70, H('f2c58a'), H('d9a066'), H('fbe9c8'))
    F.rug(L, 156, 118, 236, 170, H('5d5f66'), H('c9925a'), H('6d6f76'))


# ---- sortable parts -------------------------------------------------------------------------------
def halls(sc):
    L, add = sc.L, sc.add
    # the elevator hall: a plant each side of the door; the top hall: a plant each side of the window
    add((150, 4, 160, 14), lambda: F.plant(L, 150, 4, seed=1), True)
    add((226, 4, 236, 14), lambda: F.plant(L, 226, 4, seed=2), True)
    add((4, 114, 14, 124), lambda: F.plant(L, 4, 114, seed=3), True)
    add((4, 164, 14, 174), lambda: F.plant(L, 4, 164, seed=4), True)
    # the ends of the left hall and the bottom hall
    add((226, 274, 238, 284), lambda: F.water_cooler(L, 226, 274), True)
    add((148, 276, 158, 286), lambda: F.plant(L, 148, 276, big=False, seed=5), True)
    add((366, 114, 376, 124), lambda: F.plant(L, 366, 114, big=False, seed=6), True)
    add((366, 164, 376, 174), lambda: F.plant(L, 366, 164, seed=7), True)


def office_decor(sc):
    L, add = sc.L, sc.add
    add((196, 114, 224, 122), lambda: F.bookshelf(L, 196, 114, 28), True)
    add((150, 114, 162, 124), lambda: F.file_cabinet(L, 150, 114, '+y'), True)
    add((226, 160, 236, 170), lambda: F.plant(L, 226, 160, big=False, seed=8), True)


def office(sc, people=True, state='green'):
    office_decor(sc)
    x, y, w = EMI_DESK
    ws_back(sc, x, y, 7 if people else None, state, head='emi', d_=w, col=F.CHAIRS[EMI_CHAIR])


def squad_room(sc, room, people=0, state=None, variants=(0, 5, 4, 1, 3, 2, 5, 0, 4)):
    """the desks of one room; `people` of the nine member desks are occupied (the others stay empty and dark)."""
    state = state or room['screen']
    draw_coord(sc, room, [3, 4, 1, 5][room['index']], state, head=room['numeral'])
    for k in range(9):
        draw_member(sc, room, k, variants[k] if k < people else None, state if k < people else 'off')
    px, py = sc.L.P(*plate_at(room))
    sc.labels.append((f"Sala {room['numeral']}", px, int(py) - 6))


def plate_at(room):
    """where the room's plate hangs (x, y, z): on the back wall it touches, else over its coordinator's desk."""
    bx0, by0, bx1, by1 = (v * TS for v in room['block'])
    if room['back'] == 'west':
        return 0, (by0 + by1) // 2, WALL_H + 2
    if room['back'] == 'north':
        return (bx0 + bx1) // 2, 0, WALL_H + 2
    x, y, _ = coord_at(room)
    return x + 7, y + COORD_LEN // 2, 48


def build():
    L = new_layer()
    shell(L)
    sc = Scene(L)
    halls(sc)
    partitions(sc)
    office(sc)
    # the preview shows rooms with six, three, none and all nine desks taken
    for room, n in zip(ROOMS, (6, 3, 0, 9)):
        squad_room(sc, room, n)
    return sc.finish(bubbles=[('I', '...'), ('II', '?'), ('III', '!'), ('IV', '...'), ('emi', '...')])


if __name__ == '__main__':
    print(save2(build(), 'scene-projeto'))
