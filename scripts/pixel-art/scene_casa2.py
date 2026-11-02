"""scene-casa.png - Luna's house floor (24x18 tiles).

Split in parts so export_app.py builds the app's Casa from the same geometry:
shell() draws what never sorts (floor, walls, rugs, elevator, wall boards and decor),
the other parts add sortable items to a Scene. people=False leaves every chair empty.
"""
from px import H
import furn as F
import furn2 as G
from furn import T
from floorkit import (W, D, new_layer, save2, Scene, region_floor, OAK, planks, back_walls, CASA_WALL, draw_floor, WALL_H)
from desks import ws_front_y, graphite, east_set
from chars import sprite

WARM = planks([H('e2b989'), H('d8ad7c'), H('dcb384')], H('b98c5f'), H('c39769'))
WARMY = planks([H('dcae7c'), H('d3a473'), H('d8aa78')], H('b3865a'), H('bf9266'), along='y')
HONEY = planks([H('e9c487'), H('e0b878'), H('e5be80')], H('c49a5a'), H('cfa566'))

# the elevator door on the back wall (x0, x1)
ELEVATOR = (180, 204)
# the half walls between the halves and the hall: x, doors (y0, y1)
HALF_WALLS = [(160, [(56, 88), (176, 208)]), (224, [(56, 88), (176, 208)])]
# the boards on the back wall: x0, x1, action, name
BOARDS = [(8, 42, 'agenda', 'Agenda'), (54, 90, 'goals', 'Objetivos'), (102, 138, 'personal-routines', 'Rotinas pessoais')]
# the four work desks (x, y; each 14 x 30, the sitter east of it looking -x); Luna takes the first,
# then the residents fill them in order
DESK_D = 30
DESKS = [(30, 84), (76, 84), (30, 120), (76, 120)]
# the chair of each desk: x, y, the way the sitter looks
TABLE_SEATS = [(x + 16, y + 10, '-x') for x, y in DESKS]
# the rug under the desks: x0, y0, x1, y1
DESK_RUG = (20, 74, 112, 156)
# the bounding box of the desks (x, y, w, d): its middle is where the group looks at
TABLE = (30, 84, 82, 66)
# who sits where in the preview (variant, or None for an empty chair)
TABLE_PEOPLE = [6, 1, 2, None]
SEAT_ORDER = [0, 1, 2, 3]
# the user's desk (x, y, width), against the front wall
VOCE_DESK = (70, 266, 36)
# footprints of the clickable furniture (export_app.py tags the items with these)
SKULL = (146, 20, 154, 28)
# Claude FM: the old living room in the media room's corner: the console on the half wall, the pink
# sofa facing it, the green armchair, the low table and the cream rug
RADIO = (228, 12, 240, 46)
READ_SOFA = (290, 10, 304, 50)
# the 'Rotinas de agentes' board hangs on the west wall of Luna's table room (plane x=0): y0, y1, z0, z1, clear of the window
TOTEM_WALL = (168, 184, 26, 42)
TOTEM = (0, 168, 2, 184)
# the window on the west wall by the user's corner: y0, y1, z0, z1 (the glass is drawn by the app: morning, day, evening, night)
WINDOW = (192, 262, 20, 50)
# the writing desk: in front of the last bookshelf, its west edge on the shelf's
WRITING = (344, 24, 360, 60)
FILMS_TV = (228, 120, 238, 146)
ARCADES = [(228, 216, 238, 228), (228, 232, 238, 244), (228, 248, 238, 260)]
SHELVES = [(x, 0, x + 28, 8) for x in range(232, 380, 30)]
# where idle agents of the Casa sit or play: x, y (art units), the point they look at, kind
HANG = [
    (297, 20, (234, 29), 'sit'), (297, 40, (234, 29), 'sit'),      # reading sofa, facing the Claude FM
    (299, 124, (233, 133), 'sit'), (299, 144, (233, 133), 'sit'),  # Filmes sofa, facing the TV
    (246, 222, (233, 222), 'play'), (246, 238, (233, 238), 'play'), (246, 254, (233, 254), 'play'),  # arcades
    (258, 238, (233, 238), 'stand'), (240, 62, (234, 29), 'stand'),
    (26, 150, (9, 149), 'stand'),                                  # coffee corner of the office
]
# names shown when the pointer is over a part of the floor (tiles: x0, y0, x1, y1)
ZONES = [
    ('Mesa da Luna', (0, 4, 10, 10)),
    ('Sua mesa', (0, 13, 10, 18)),
    ('Escritório', (0, 0, 10, 18)),
    ('Entrada', (10, 0, 14, 18)),
    ('Livros', (14, 0, 21, 5)),
    ('Escrita', (21, 0, 24, 5)),
    ('Filmes', (14, 5, 24, 12)),
    ('Jogos', (14, 12, 24, 18)),
]


def totem(L):
    """'Rotinas de agentes' board on the west wall (plane x=0): the frame; the app paints the screen."""
    y0, y1, z0, z1 = TOTEM_WALL
    fr = H('5f4533')
    # a ring only: the app draws the screen first and this sprite sorts over it
    L.qx(0, y0 - 1, y1 + 1, z1, z1 + 1, fr)
    L.qx(0, y0 - 1, y1 + 1, z0 - 1, z0, fr)
    L.qx(0, y0 - 1, y0, z0, z1, fr)
    L.qx(0, y1, y1 + 1, z0, z1, fr)


def window_frame(L):
    """the wood frame and sill of the west-wall window; the app paints the glass for the time of day."""
    y0, y1, z0, z1 = WINDOW
    L.begin(); L.qx(0, y0 - 3, y1 + 3, z0 - 3, z1 + 3, H('8a6448')); L.end()
    L.qx(0, y0 - 1, y1 + 1, z0 - 1, z1 + 1, H('b98c5f'))
    L.qx(0, y0, y1, z0, z1, H('24304a'))
    L.pbox(0, y0 - 5, z0 - 6, 5, y1 - y0 + 10, 3, T('b98c5f', '8a6448', '73563f'))


def board(L, x0, x1):
    F.corkboard_y(L, 0, x0, x1, 22, 42)


def shell(L):
    """everything drawn straight on the layer, under every sorted item."""
    draw_floor(L, W, D, region_floor([((0, 0, 10, 18), WARM), ((10, 0, 14, 18), OAK)], WARMY))
    back_walls(L, CASA_WALL)
    F.elevator_y(L, 0, *ELEVATOR)
    F.rug(L, 178, 22, 206, 276, H('c98a7a'), H('a86a5c'), H('f1d8c8'))
    for a_, b_, _act, _n in BOARDS:
        board(L, a_, b_)
    # wall decor (west wall of the office)
    G.wall_shelf_x(L, 0, 4, 24, 30)
    window_frame(L)
    G.clock_x(L, 0, 46, 44)
    F.frame_x(L, 0, 70, 84, 26, 40)
    F.frame_x(L, 0, 88, 98, 30, 42, art=('9cc4dc', 'f6e27a', '8cc477'))
    F.frame_x(L, 0, 112, 132, 22, 44, art=('f2c58a', 'fbf3e0', 'e86a5a'), fr='5f7fb4')
    F.rug(L, *DESK_RUG, H('9fb7d6'), H('809cc2'), H('e4eaf6'))
    F.rug(L, 244, 10, 328, 72, H('e7c39a'), H('cf9f72'), H('fbe9c8'))
    F.rug(L, 230, 100, 330, 168, H('a9b8d8'), H('8698c0'), H('e4eaf6'))
    F.rug(L, 230, 210, 300, 280, H('f2d6a0'), H('dcb880'), H('fbf3e0'))


def entrance(sc):
    L, add = sc.L, sc.add
    add((164, 3, 174, 13), lambda: F.plant(L, 164, 3, seed=1), True)
    add((210, 3, 220, 13), lambda: F.plant(L, 210, 3, seed=2), True)
    add(TOTEM, lambda: totem(L), True)


def half_wall(sc, i):
    x, doors = HALF_WALLS[i]
    sc.wy(0, D, x, doors=doors)


def office(sc):
    """the office's furniture besides the desks: files and printer on the west wall, coffee corner, the skull."""
    L, add = sc.L, sc.add
    add(SKULL, lambda: G.skull_stand(L, *SKULL[:2]), True)
    add((2, 28, 12, 40), lambda: F.file_cabinet(L, 2, 28, '+x'), True)
    add((2, 41, 12, 53), lambda: F.file_cabinet(L, 2, 41, '+x'), True)
    add((2, 56, 16, 68), lambda: F.printer(L, 2, 56), True)
    add((4, 80, 14, 90), lambda: F.plant(L, 4, 80, seed=5), True)
    add((2, 140, 16, 158), lambda: F.coffee_machine(L, 2, 140), True)
    add((4, 159, 12, 167), lambda: F.water_cooler(L, 4, 159), True)
    add((130, 22, 140, 32), lambda: F.plant(L, 130, 22, big=False, seed=4), True)


# the work desks' look, mixed from the floor's palette: (chair, screen) of each table desk and of the user's desk
TABLE_LOOK = [('terra', 'blue'), ('green', 'lilac'), ('blue', 'rose'), ('mustard', 'mint')]
VOCE_LOOK = ('lilac', 'green')


def work_desk(L, x, y, screen):
    """a graphite desk: an ultrawide set back toward the wall, a laptop, a keyboard and a mug (the sitter is east of it)."""
    graphite(L, x, y, 14, DESK_D)
    east_set(L, x, y, screen)


def luna_table(sc):
    """the four work desks: each one item, chair and sitter drawn after it."""
    L = sc.L
    for i, (x, y) in enumerate(DESKS):
        cx, cy, _face = TABLE_SEATS[i]
        vi = TABLE_PEOPLE[i]
        col = F.CHAIRS[TABLE_LOOK[i][0]]

        def chair(cx=cx, cy=cy, vi=vi, col=col):
            F.chair(L, cx, cy, '-x', 'seat', col)
            if vi is not None:
                F.seated(L, sprite(vi, 'BL', 'sitB'), cx, cy)
            F.chair(L, cx, cy, '-x', 'back', col)
        sc.add((x, y, x + 14, y + DESK_D), lambda x=x, y=y, i=i: work_desk(L, x, y, TABLE_LOOK[i][1]), True)
        sc.add((cx, cy, cx + 10, cy + 10), chair)
    px, py = L.P(TABLE_SEATS[0][0] + 5, TABLE_SEATS[0][1] + 5, 7)
    sc.heads['luna'] = (int(px) + 3 * L.S, int(py) - 24 * L.S)


def voce_corner(sc):
    """the furniture around the user's desk (the desk itself is ws_front_y)."""
    L, add = sc.L, sc.add
    add((122, 262, 132, 272), lambda: F.plant(L, 122, 262, big=False, seed=9), True)
    add((36, 266, 48, 276), lambda: F.file_cabinet(L, 36, 266, '+y'), True)
    add((18, 266, 28, 276), lambda: F.plant(L, 18, 266, seed=10), True)
    add((56, 270, 62, 276), lambda: F.lamp(L, 56, 270), True)


def media(sc, people=True):
    L, add = sc.L, sc.add
    for fp in SHELVES:
        add(fp, lambda x=fp[0]: F.bookshelf(L, x, 0, 28), True)
    # Claude FM corner, as the old living room: console, low table, green armchair, pink sofa, lamp
    add(RADIO, lambda: G.radio_tv(L, *RADIO[:2]), True)
    add((258, 22, 270, 36), lambda: G.low_table(L, 258, 22, 12, 14), True)
    add((258, 44, 270, 56), lambda: G.armchair(L, 258, 44, '-y', T('b9d3b0', '9cbf93', '7fa277')), True)
    add(READ_SOFA, lambda: F.sofa_mx(L, *READ_SOFA[:2], T('e7b3a6', 'd39486', 'b87a6d'), 40), True)
    add((316, 14, 322, 20), lambda: F.lamp(L, 316, 14), True)
    # Escrita: in front of the last bookshelf
    wx, wy = WRITING[:2]
    add(WRITING, lambda: (F.desk(L, wx, wy, 16, 36), G.typewriter(L, wx + 3, wy + 4, 12),
                          G.notebook(L, wx + 4, wy + 16, 12), F.mug(L, wx + 6, wy + 28, 12)), True)
    add((wx + 20, wy + 8, wx + 28, wy + 16), lambda: F.wood_chair(L, wx + 20, wy + 8, '-x'))
    add((wx + 22, wy + 32, wx + 28, wy + 38), lambda: F.lamp(L, wx + 22, wy + 32), True)
    # Filmes: TV on the west wall, low table, sofa facing the TV, one rug
    add(FILMS_TV, lambda: F.tv(L, *FILMS_TV[:2]), True)
    add((258, 126, 270, 140), lambda: G.low_table(L, 258, 126, 12, 14), True)
    add((292, 114, 306, 154), lambda: F.sofa_mx(L, 292, 114, T('8fb3dc', '6f95c2', '587aa4'), 40), True)
    add((316, 104, 326, 114), lambda: F.plant(L, 316, 104, big=False, seed=7), True)
    # Jogos: 3 cabinets side by side on the west wall, poufs in front, own rug
    add(ARCADES[0], lambda: G.arcade_x(L, 228, 216), True)
    add(ARCADES[1], lambda: G.arcade_x(L, 228, 232, T('e88a7a', 'cc6e5e', 'a8564a'), H('f2e27a')), True)
    add(ARCADES[2], lambda: G.arcade_x(L, 228, 248, T('8fd0a0', '6fb484', '58966a'), H('f6e27a')), True)
    add((254, 222, 262, 230), lambda: G.pouf(L, 254, 222, T('f6d27a', 'e0b85a', 'c49c44')), True)
    add((254, 254, 262, 262), lambda: G.pouf(L, 254, 254, T('9fc8b8', '82ae9c', '6a9482')), True)
    if people:
        sc.stand(sprite(5, 'BL', 'idle'), 252, 240)
    add((364, 270, 374, 280), lambda: F.plant(L, 364, 270, seed=8), True)
    add((364, 100, 374, 110), lambda: F.plant(L, 364, 100, seed=12), True)


def build():
    L = new_layer()
    shell(L)
    sc = Scene(L)
    entrance(sc)
    sc.stand(sprite(4, 'FL', 'walkA'), 192, 140)
    half_wall(sc, 0)
    office(sc)
    luna_table(sc)
    x, y, w = VOCE_DESK
    ws_front_y(sc, x, y, 0, VOCE_LOOK[1], w=w, head='voce', col=F.CHAIRS[VOCE_LOOK[0]], centered=True)
    voce_corner(sc)
    half_wall(sc, 1)
    media(sc)
    # plaques of the preview (the app shows names on hover instead)
    sc.label('Rotinas de agentes', 2, 176, 46)
    sc.label('Entrada', 192, 284)
    for a_, b_, _act, n in BOARDS:
        sc.label(n, (a_ + b_) / 2, 0, WALL_H + 2, dy=-6)
    sc.label('Caveira', 150, 24, 36)
    sc.label('Claude FM', 234, 29, 34)
    sc.label('Escritório', 124, 40)
    sc.label('Mesa da Luna', 124, 130)
    mx, my = L.P(68, 270, 34)
    sc.labels.append(('Novo agente', mx + 2, int(my) - 18))
    vx, vy = L.P(98, 262, 0)
    sc.labels.append(('Você', vx + 22, int(vy) - 6))
    sc.label('Livros', 306, 0, WALL_H + 2, dy=-6)
    sc.label('Escrita', 366, 60)
    sc.label('Filmes', 278, 174)
    sc.label('Jogos', 270, 284)
    sc.label('Sala de mídias', 262, 96)
    return sc.finish(bubbles=[('luna', '...'), ('voce', 'ok')])


if __name__ == '__main__':
    print(save2(build(), 'scene-casa'))
