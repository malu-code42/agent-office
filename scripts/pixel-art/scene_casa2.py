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
from desks import ws_front_y
from chars import sprite

WARM = planks([H('e2b989'), H('d8ad7c'), H('dcb384')], H('b98c5f'), H('c39769'))
WARMY = planks([H('dcae7c'), H('d3a473'), H('d8aa78')], H('b3865a'), H('bf9266'), along='y')
HONEY = planks([H('e9c487'), H('e0b878'), H('e5be80')], H('c49a5a'), H('cfa566'))

# the elevator door on the back wall (x0, x1)
ELEVATOR = (180, 204)
# the half walls between the halves and the hall: x, doors (y0, y1)
HALF_WALLS = [(160, [(56, 88), (176, 208)]), (224, [(56, 88), (176, 208)])]
# the boards on the back wall: x0, x1, action, name
BOARDS = [(8, 42, 'agenda', 'Agenda'), (54, 90, 'goals', 'Objetivos'), (102, 148, 'personal-routines', 'Rotinas pessoais')]
# Luna's table (x, y, w, d) and its chairs (x, y, the way the sitter looks); Luna takes the first
TABLE = (44, 132, 36, 26)
TABLE_SEATS = [(50, 120, '+y'), (66, 120, '+y'), (30, 146, '+x'), (84, 141, '-x'), (50, 162, '-y'), (66, 162, '-y')]
# who sits where in the preview (variant, or None for an empty chair)
TABLE_PEOPLE = [6, 1, 2, None, 7, None]
# Luna's chair, then the residents' chairs in the order the preview fills them
SEAT_ORDER = [0, 1, 2, 4, 3, 5]
# the user's desk (x, y, width), against the front wall
VOCE_DESK = (70, 266, 36)
# footprints of the clickable furniture (export_app.py tags the items with these)
SKULL = (146, 20, 154, 28)
RADIO = (2, 30, 14, 64)
# the 'Rotinas de agentes' board: in the back corner of Luna's table room, by the half wall, clear of the doors and chairs
TOTEM = (142, 100, 156, 110)
WRITING = (306, 14, 322, 50)
FILMS_TV = (228, 120, 238, 146)
ARCADES = [(228, 216, 238, 228), (228, 232, 238, 244), (228, 248, 238, 260)]
SHELVES = [(x, 0, x + 28, 8) for x in range(232, 380, 30)]
# where idle agents of the Casa sit or play: x, y (art units), the point they look at, kind
HANG = [
    (69, 38, (8, 40), 'sit'), (69, 58, (8, 50), 'sit'),           # sofa of the sala de estar
    (299, 124, (233, 133), 'sit'), (299, 144, (233, 133), 'sit'),  # Filmes sofa, facing the TV
    (246, 222, (233, 222), 'play'), (246, 238, (233, 238), 'play'), (246, 254, (233, 254), 'play'),  # arcades
    (258, 238, (233, 238), 'stand'), (284, 40, (244, 36), 'stand'),
]
# names shown when the pointer is over a part of the floor (tiles: x0, y0, x1, y1)
ZONES = [
    ('Mesa da Luna', (0, 6, 10, 13)),
    ('Sala de estar', (0, 0, 10, 6)),
    ('Sua mesa', (0, 13, 10, 18)),
    ('Entrada', (10, 0, 14, 18)),
    ('Livros', (14, 0, 19, 5)),
    ('Escrita', (19, 0, 24, 5)),
    ('Filmes', (14, 5, 24, 12)),
    ('Jogos', (14, 12, 24, 18)),
]


def totem(L, x, y):
    """'Rotinas de agentes' standing board, face +y."""
    L.pbox(x, y, 0, 14, 8, 2, T('8a6a52', '73563f', '5c4430'))
    L.pbox(x + 6, y + 3, 2, 2, 2, 12, T('8a6a52', '73563f', '5c4430'), outline=False)
    L.pbox(x, y + 2, 14, 14, 3, 20, T('8a6448', 'f4ead2', '73563f'))
    for i, c in enumerate(('7cc4bc', 'f2b8c0', 'f6e27a', 'a9d6ec')):
        zz = 30 - i * 4
        L.qy(y + 5, x + 2, x + 4, zz, zz + 2, H(c))
        L.qy(y + 5, x + 5, x + 12, zz + 1, zz + 2, H('8a7a6a'))


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
    F.rug(L, 20, 18, 104, 86, H('e7c39a'), H('cf9f72'), H('fbe9c8'))
    # wall decor (west wall of the sala de estar)
    G.wall_shelf_x(L, 0, 4, 24, 30)
    G.clock_x(L, 0, 46, 44)
    F.frame_x(L, 0, 70, 84, 26, 40)
    F.frame_x(L, 0, 88, 98, 30, 42, art=('9cc4dc', 'f6e27a', '8cc477'))
    F.frame_x(L, 0, 112, 132, 22, 44, art=('f2c58a', 'fbf3e0', 'e86a5a'), fr='5f7fb4')
    F.rug(L, 22, 106, 104, 186, H('c9d6e8'), H('a8b8d0'), H('f4f0e6'))
    F.rug(L, 232, 16, 292, 70, H('d9a0a0'), H('b87a7a'), H('f6dcd0'))
    F.rug(L, 230, 100, 330, 168, H('a9b8d8'), H('8698c0'), H('e4eaf6'))
    F.rug(L, 230, 210, 300, 280, H('f2d6a0'), H('dcb880'), H('fbf3e0'))


def entrance(sc):
    L, add = sc.L, sc.add
    add((164, 3, 174, 13), lambda: F.plant(L, 164, 3, seed=1), True)
    add((210, 3, 220, 13), lambda: F.plant(L, 210, 3, seed=2), True)
    add(TOTEM, lambda: totem(L, *TOTEM[:2]), True)


def half_wall(sc, i):
    x, doors = HALF_WALLS[i]
    sc.wy(0, D, x, doors=doors)


def sala(sc):
    L, add = sc.L, sc.add
    add(SKULL, lambda: G.skull_stand(L, *SKULL[:2]), True)
    add(RADIO, lambda: G.radio_tv(L, *RADIO[:2]), True)
    add((30, 40, 42, 54), lambda: G.low_table(L, 30, 40, 12, 14), True)
    add((62, 28, 76, 68), lambda: F.sofa_mx(L, 62, 28, T('e7b3a6', 'd39486', 'b87a6d'), 40), True)
    add((96, 22, 102, 28), lambda: F.lamp(L, 96, 22), True)
    add((30, 20, 42, 32), lambda: G.armchair(L, 30, 20, '+y', T('b9d3b0', '9cbf93', '7fa277')), True)
    add((4, 110, 14, 120), lambda: F.plant(L, 4, 110, seed=5), True)


def table_top(L):
    tx, ty, tw, td = TABLE
    F.small_table(L, tx, ty, tw, td)
    F.mug(L, tx + 6, ty + 6, 12); F.papers(L, tx + 14, ty + 10, 12); F.mug(L, tx + 26, ty + 8, 12, 'a9d6ec')


def luna_table(sc):
    """the approved art's table: one item, chairs and sitters drawn in a fixed order."""
    L = sc.L
    tx, ty = TABLE[:2]

    def sit(i):
        cx, cy, face = TABLE_SEATS[i]
        vi = TABLE_PEOPLE[i]
        d, fr = {'+y': ('FL', 'sitF'), '+x': ('FR', 'sitF'), '-x': ('BL', 'sitB'), '-y': ('BR', 'sitB')}[face]
        F.wood_chair(L, cx, cy, face, 'seat')
        if face in ('+y', '+x'):
            F.wood_chair(L, cx, cy, face, 'back')
        if vi is not None:
            F.seated_wood(L, sprite(vi, d, fr), cx, cy)
        if face in ('-y', '-x'):
            F.wood_chair(L, cx, cy, face, 'back')

    def group():
        for i in (0, 1, 2):
            sit(i)
        table_top(L)
        for i in (3, 4, 5):
            sit(i)
    sc.add((tx - 14, ty - 12, tx + 48, ty + 38), group)
    px, py = L.P(tx + 10, ty - 8, 8)
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
    add((238, 30, 250, 42), lambda: G.armchair(L, 238, 30, '+x', T('d9a0a0', 'c08080', 'a06868')), True)
    add((258, 32, 268, 42), lambda: G.low_table(L, 258, 32, 10, 10), True)
    add((274, 20, 280, 26), lambda: F.lamp(L, 274, 20), True)
    # Escrita, between the shelves and the pink reading corner
    add(WRITING, lambda: (F.desk(L, 306, 14, 16, 36), G.typewriter(L, 309, 18, 12),
                          G.notebook(L, 310, 30, 12), F.mug(L, 312, 42, 12)), True)
    add((326, 22, 334, 30), lambda: F.wood_chair(L, 326, 22, '-x'))
    add((310, 56, 316, 62), lambda: F.lamp(L, 310, 56), True)
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
    sala(sc)
    luna_table(sc)
    x, y, w = VOCE_DESK
    ws_front_y(sc, x, y, 0, 'green', w=w, head='voce')
    voce_corner(sc)
    half_wall(sc, 1)
    media(sc)
    # plaques of the preview (the app shows names on hover instead)
    sc.label('Rotinas de agentes', 149, 104, 40)
    sc.label('Entrada', 192, 284)
    for a_, b_, _act, n in BOARDS:
        sc.label(n, (a_ + b_) / 2, 0, WALL_H + 2, dy=-6)
    sc.label('Caveira', 150, 24, 36)
    sc.label('Claude FM', 8, 47, 34)
    sc.label('Sala de estar', 106, 70)
    sc.label('Mesa da Luna', 124, 150)
    mx, my = L.P(78, 270, 34)
    sc.labels.append(('Novo agente', mx + 2, int(my) - 18))
    vx, vy = L.P(98, 262, 0)
    sc.labels.append(('Você', vx + 22, int(vy) - 6))
    sc.label('Livros', 306, 0, WALL_H + 2, dy=-6)
    sc.label('Escrita', 330, 66)
    sc.label('Filmes', 278, 174)
    sc.label('Jogos', 270, 284)
    sc.label('Sala de mídias', 262, 96)
    return sc.finish(bubbles=[('luna', '...'), ('voce', 'ok')])


if __name__ == '__main__':
    print(save2(build(), 'scene-casa'))
