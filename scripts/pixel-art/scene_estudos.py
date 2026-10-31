"""scene-estudos.png - study floor (24x18 tiles), school finish.

Split in parts so export_app.py builds the app's study floor from the same geometry:
shell() draws what never sorts (floor, walls, rugs, elevator, wall boards and decor),
the other parts add sortable items to a Scene. people=False leaves every chair empty.
"""
from px import H
import furn as F
import furn2 as G
from furn import T
from floorkit import (W, D, new_layer, save2, Scene, region_floor, WALNUT, parquet, checker, speckled,
                      back_walls, SCHOOL_WALL, GREENF, draw_floor, WALL_H)
from desks import ws_front_y
from chars import sprite

HALL = checker(H('f4ecd6'), H('c9e6d2'), 16)
AULA = speckled(H('cfe3f0'), H('a9c6dc'), H('f4f8fb'), H('8fb3cf'), (6.5, 9, 12, 18))
PROF = speckled(H('eadcc2'), H('d4c3a4'), H('f8f0e2'), H('c9b48e'), (0, 9, 6.5, 18))

# the elevator door on the back wall (x0, x1)
ELEVATOR = (192, 216)
# the desks of Cora and Bonnie (x, y, width); the chair is north of the desk
CORA_DESK = (104, 74, 40)
BONNIE_DESK = (286, 50, 44)
# Biblioteca: the nine topic shelves (five on the back wall, three in a row, one on the west wall)
LIB_SHELVES = [(x, 0, x + 28, 8) for x in (6, 36, 66, 96, 126)] + [(x, 40, x + 28, 48) for x in (8, 38, 68)] + [(2, 58, 10, 86)]
# Diretoria: the study trail board on the back wall, behind Bonnie (x0, x1, z0, z1)
TRAIL = (268, 332, 14, 40)
# Diretoria: the visitors' chairs in front of Bonnie's desk (x, y, the way the sitter looks)
VISIT_SEATS = [(296, 72, '-y'), (316, 72, '-y')]
# Sala dos professores: the boards on the west wall (y0, y1, z0, z1), the table, the filing cabinet
SCHEDULE = (164, 212, 16, 42)
CORKBOARD = (242, 270, 20, 38)
PICTURE = (148, 160, 24, 38)
PROF_TABLE = (44, 182, 66, 248)
PROF_CABINET = (86, 150, 98, 160)
COFFEE = (0, 218, 14, 236)
# the teachers' chairs and who sits there in the preview (variant)
TEACHER_SEATS = [(30, 186, '+x'), (30, 208, '+x'), (30, 230, '+x'), (70, 196, '-x'), (70, 218, '-x')]
TEACHER_PEOPLE = [0, 2, 4, 1, 7]
# Sala de aula: blackboard on its stand, poster easel, the user's desk and chair, globe, shelf
BOARD = (112, 150, 140, 156)
POSTER = (150, 150, 176, 156)
STUDENT_DESK = (132, 204, 164, 220)
STUDENT_SEAT = (143, 222, '-y')
GLOBE = (108, 184, 116, 192)
CLASS_SHELF = (106, 252, 114, 280)
# where the teacher of the turn stands in front of the class (x, y), looking at the desk
TUTOR_AT = (150, 172)
# Estudo individual: filing cabinets, shelf, the notes desk and its chair, the cards table
NOTE_CABINETS = [(244, 158, 254, 170), (244, 172, 254, 184)]
NOTE_SHELF = (244, 250, 252, 278)
NOTE_SEAT = (310, 190, '+y')
NOTES_DESK = (296, 204, 336, 220)
CARDS_TABLE = (330, 246, 360, 262)
# names shown when the pointer is over a part of the floor (tiles: x0, y0, x1, y1); first match wins
ZONES = [
    ('Biblioteca', (0, 0, 11, 7)),
    ('Diretoria · Bonnie', (15, 0, 24, 7)),
    ('Sala dos professores', (0, 9, 7, 18)),
    ('Sala de aula', (7, 9, 12, 18)),
    ('Estudo individual · notas e cartões', (15, 9, 24, 18)),
    ('Corredor', (0, 0, 24, 18)),
]


def blackboard_stand(L, x, y):
    """free-standing blackboard facing +y (28 wide)."""
    for lx in (x + 2, x + 24):
        L.pbox(lx, y, 0, 2, 2, 32, T('a07448', '8a6340', '6e4b31'))
        L.pbox(lx - 2, y - 2, 0, 6, 6, 1, T('a07448', '8a6340', '6e4b31'))
    L.pbox(x, y + 2, 12, 28, 2, 20, T('a07448', '8a6340', '6e4b31'))
    G.blackboard_y(L, y + 4, x + 2, x + 26, 14, 30)


def globe(L, x, y):
    """classroom globe on a small stand."""
    L.pbox(x, y, 0, 8, 8, 10, T('a07448', '8a6340', '6e4b31'))
    L.pbox(x + 3, y + 3, 10, 2, 2, 3, T('c9a24e', 'b08a3c', '957230'), outline=False)
    px, py = [int(v) for v in L.P(x + 4, y + 4, 18)]
    L.begin(); L.ell(px, py, 5, 5, H('6fa8d8')); L.end()
    L.ell(px - 1, py - 1, 2.5, 2, H('8cc477')); L.ell(px + 2, py + 2, 1.5, 1.5, H('8cc477'))
    L.rect(px - 2, py - 3, 1, 1, H('dff0fa'))


def schedule(L):
    G.schedule_x(L, 0, *SCHEDULE)


def corkboard(L):
    G.corkboard_x(L, 0, *CORKBOARD)


def trail_board(L):
    G.trail_board_y(L, 0, *TRAIL)


def shell(L):
    """everything drawn straight on the layer, under every sorted item."""
    draw_floor(L, W, D, region_floor([((0, 0, 10.5, 6.5), parquet()), ((15, 0, 24, 6.5), WALNUT),
                                      ((0, 9, 6.5, 18), PROF), ((6.5, 9, 12, 18), AULA), ((15, 9, 24, 18), WALNUT)], HALL))
    back_walls(L, SCHOOL_WALL)
    F.elevator_y(L, 0, *ELEVATOR)
    F.rug(L, 190, 20, 218, 100, H('a9c6dc'), H('7fa3c0'), H('f4f0e6'))
    F.rug(L, 254, 18, 376, 96, H('c9d6e8'), H('a8b8d0'), H('f4f0e6'))
    corkboard(L)
    F.frame_x(L, 0, *PICTURE)
    schedule(L)
    trail_board(L)
    F.rug(L, 262, 160, 376, 278, H('a8505a'), H('843c46'), H('e8c0b0'))


def gx(sc, *a, **k):
    sc.gx(*a, frame=GREENF, **k)


def gy(sc, *a, **k):
    sc.gy(*a, frame=GREENF, **k)


def hall(sc):
    L, add = sc.L, sc.add
    add((176, 3, 186, 13), lambda: F.plant(L, 176, 3, seed=1), True)
    add((222, 3, 232, 13), lambda: F.plant(L, 222, 3, seed=2), True)


def library_walls(sc):
    gx(sc, 0, 168, 104, doors=[(40, 62)])
    gy(sc, 0, 104, 168, doors=[(44, 66)])


def library(sc):
    L, add = sc.L, sc.add
    for fp in LIB_SHELVES[:8]:
        add(fp, lambda x=fp[0], y=fp[1]: F.bookshelf(L, x, y, 28), True)
    x, y = LIB_SHELVES[8][:2]
    add(LIB_SHELVES[8], lambda: G.bookshelf_x(L, x, y, 28, seed=11), True)


def library_plant(sc):
    L = sc.L
    sc.add((152, 86, 162, 96), lambda: F.plant(L, 152, 86, big=False, seed=2), True)


def diretoria_walls(sc):
    gy(sc, 0, 104, 240, doors=[(62, 84)])
    gx(sc, 240, 384, 104)


def diretoria(sc):
    L, add = sc.L, sc.add
    add((248, 4, 260, 14), lambda: F.file_cabinet(L, 248, 4, '+y'), True)
    add((340, 0, 368, 8), lambda: F.bookshelf(L, 340, 0, 28), True)


def diretoria_front(sc, chairs=True):
    L, add = sc.L, sc.add
    if chairs:
        for x, y, face in VISIT_SEATS:
            add((x, y, x + 8, y + 8), lambda x=x, y=y, face=face: F.wood_chair(L, x, y, face))
    add((366, 84, 376, 94), lambda: F.plant(L, 366, 84, seed=3), True)


def teachers_walls(sc):
    gx(sc, 0, 104, 144, doors=[(66, 88)])
    gy(sc, 144, 288, 104, doors=[(220, 242)])


def teachers_room(sc):
    L, add = sc.L, sc.add
    add(COFFEE, lambda: F.coffee_machine(L, *COFFEE[:2]), True)
    add(PROF_CABINET, lambda: F.file_cabinet(L, *PROF_CABINET[:2], '+y'), True)
    x0, y0, x1, y1 = PROF_TABLE
    add(PROF_TABLE, lambda: (F.small_table(L, x0, y0, x1 - x0, y1 - y0), F.papers(L, 50, 194, 12),
                             F.mug(L, 56, 216, 12), F.papers(L, 48, 232, 12)), True)


def teachers_chairs(sc):
    L = sc.L
    for (cx, cy, face), vi in zip(TEACHER_SEATS, TEACHER_PEOPLE):
        d, fr = {'+x': ('FR', 'sitF'), '-x': ('BL', 'sitB')}[face]

        def tg(cx=cx, cy=cy, face=face, vi=vi, d=d, fr=fr):
            F.wood_chair(L, cx, cy, face, 'seat')
            if face == '+x':
                F.wood_chair(L, cx, cy, face, 'back')
            F.seated_wood(L, sprite(vi, d, fr), cx, cy)
            if face == '-x':
                F.wood_chair(L, cx, cy, face, 'back')
        sc.add((cx, cy, cx + 8, cy + 8), tg)


def teachers_plants(sc):
    L, add = sc.L, sc.add
    add((4, 270, 14, 280), lambda: F.plant(L, 4, 270, seed=4), True)
    add((86, 266, 96, 276), lambda: F.plant(L, 86, 266, big=False, seed=14), True)


def board(L):
    """free-standing blackboard with alphabet strip and clock on top."""
    blackboard_stand(L, 112, 150)
    for i, c in enumerate(('d26a5a', 'f2cf5b', '5f8fc9', '6aa86a', 'a07ac0')):
        L.qy(154, 114 + i * 5, 118 + i * 5, 33, 36, H(c))
    G.clock_y(L, 154, 126, 40)


def poster(L):
    """poster on a small easel."""
    F.whiteboard(L, 150, 150)
    F.frame_y(L, 154, 156, 170, 16, 28, art=('a9d6ec', 'f2b8c0', 'f6e27a'))


def student_desk(L):
    """the user's desk: centred, facing the blackboard."""
    F.desk(L, 132, 204, 32, 16)
    G.notebook(L, 144, 210, 12)
    L.pbox(136, 208, 12, 6, 2, 2, T('e86a8a', 'cc5070', 'a84058'))          # pencil case
    F.mug(L, 156, 210, 12, 'f6e27a')
    L.pbox(158, 206, 12, 3, 3, 1, T('7d6a5a', '66564a', '524439'))         # desk lamp
    L.pbox(159, 207, 13, 1, 1, 6, T('7d6a5a', '66564a', '524439'), outline=False)
    L.pbox(157, 205, 19, 5, 5, 3, T('fff1c4', 'f5dc9a', 'e2c27a'))


def classroom_front(sc):
    """the west and north walls of the classroom with the blackboard and the poster between them."""
    L, add = sc.L, sc.add
    gx(sc, 104, 192, 144, doors=[(170, 190)])
    add(BOARD, lambda: board(L), True)
    add(POSTER, lambda: poster(L), True)
    gy(sc, 144, 288, 192)


def classroom(sc, people=True):
    L, add = sc.L, sc.add
    if people:
        sc.stand(sprite(2, 'FL', 'idle'), *TUTOR_AT, tag='tutor')
    add(STUDENT_DESK, lambda: student_desk(L), True)
    if people:
        x, y, face = STUDENT_SEAT
        add((x, y, x + 10, y + 10), lambda: F.chair(L, x, y, face))
    add(GLOBE, lambda: globe(L, *GLOBE[:2]), True)
    add(CLASS_SHELF, lambda: G.bookshelf_x(L, *CLASS_SHELF[:2], 28, h=22, seed=8), True)
    add((176, 270, 186, 280), lambda: F.plant(L, 176, 270, big=False, seed=5), True)


def notes_walls(sc):
    gx(sc, 240, 384, 144, doors=[(300, 322)])
    gy(sc, 144, 288, 240)


def notes(sc, people=True):
    L, add = sc.L, sc.add
    for fp in NOTE_CABINETS:
        add(fp, lambda fp=fp: F.file_cabinet(L, *fp[:2]), True)
    add(NOTE_SHELF, lambda: G.bookshelf_x(L, *NOTE_SHELF[:2], 28, h=22, seed=13), True)
    if people:
        x, y, face = NOTE_SEAT
        add((x, y, x + 8, y + 8), lambda: F.wood_chair(L, x, y, face))
    add(NOTES_DESK, lambda: (F.desk(L, 296, 204, 40, 16), G.notebook(L, 302, 208, 12),
                             G.cards_box(L, 316, 208, 12), F.mug(L, 328, 208, 12)), True)
    add((344, 194, 350, 200), lambda: F.lamp(L, 344, 194), True)
    add(CARDS_TABLE, lambda: (F.small_table(L, 330, 246, 30, 16), G.cards_box(L, 336, 250, 12),
                              G.cards_box(L, 348, 252, 12)), True)
    add((366, 270, 376, 280), lambda: F.plant(L, 366, 270, seed=6), True)


def build():
    L = new_layer()
    shell(L)
    sc = Scene(L)
    # the items in the order of the approved scene (equal depths draw in that order)
    hall(sc)
    sc.stand(sprite(1, 'FR', 'walkA'), 210, 120)
    library_walls(sc)
    library(sc)
    x, y, w = CORA_DESK
    ws_front_y(sc, x, y, 5, 'green', boss=True, w=w, head='cora')
    library_plant(sc)
    diretoria_walls(sc)
    diretoria(sc)
    x, y, w = BONNIE_DESK
    ws_front_y(sc, x, y, 3, 'green', boss=True, w=w, head='bonnie')
    diretoria_front(sc)
    teachers_walls(sc)
    teachers_room(sc)
    teachers_chairs(sc)
    teachers_plants(sc)
    classroom_front(sc)
    classroom(sc)
    notes_walls(sc)
    notes(sc)
    # plaques of the preview (the app shows names on hover instead)
    sc.label('Biblioteca', 84, 0, WALL_H + 2, dy=-6)
    sc.label('Cora · bibliotecária', 136, 66, 44)
    sc.label('Diretoria · Bonnie', 316, 100)
    sc.label('Trilha de estudos', 300, 0, TRAIL[3] + 2, dy=-6)
    sc.label('Horário de aula', 0, 188, WALL_H + 2, dy=-6)
    sc.label('Sala dos professores', 52, 284)
    sc.label('Tópico atual', 126, 152, 50)
    sc.label('Sua carteira', 148, 238)
    sc.label('Sala de aula', 148, 284)
    sc.label('Estudo individual · notas e cartões', 312, 284)
    return sc.finish(bubbles=[('cora', '...'), ('tutor', '?'), ('bonnie', 'ok')])


if __name__ == '__main__':
    print(save2(build(), 'scene-estudos'))
