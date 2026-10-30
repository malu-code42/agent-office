"""scene-estudos.png - study floor (22x16 tiles), school finish."""
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


def build():
    L = new_layer()
    draw_floor(L, W, D, region_floor([((0, 0, 10.5, 6.5), parquet()), ((15, 0, 24, 6.5), WALNUT),
                                      ((0, 9, 6.5, 18), PROF), ((6.5, 9, 12, 18), AULA), ((15, 9, 24, 18), WALNUT)], HALL))
    back_walls(L, SCHOOL_WALL)
    sc = Scene(L)
    add = sc.add
    gx = lambda *a, **k: sc.gx(*a, frame=GREENF, **k)
    gy = lambda *a, **k: sc.gy(*a, frame=GREENF, **k)

    # ---------------- hall + elevator ----------------
    F.elevator_y(L, 0, 192, 216)
    add((176, 3, 186, 13), lambda: F.plant(L, 176, 3, seed=1), True)
    add((222, 3, 232, 13), lambda: F.plant(L, 222, 3, seed=2), True)
    F.rug(L, 190, 20, 218, 100, H('a9c6dc'), H('7fa3c0'), H('f4f0e6'))
    sc.stand(sprite(1, 'FR', 'walkA'), 210, 120)

    # ---------------- biblioteca (Cora) ----------------
    gx(0, 168, 104, doors=[(40, 62)])
    gy(0, 104, 168, doors=[(44, 66)])
    for x in (6, 36, 66, 96, 126):
        add((x, 0, x + 28, 8), lambda x=x: F.bookshelf(L, x, 0, 28), True)
    for x in (8, 38, 68):
        add((x, 40, x + 28, 48), lambda x=x: F.bookshelf(L, x, 40, 28), True)
    add((2, 58, 10, 86), lambda: G.bookshelf_x(L, 2, 58, 28, seed=11), True)
    ws_front_y(sc, 104, 74, 5, 'green', boss=True, w=40, head='cora')
    add((152, 86, 162, 96), lambda: F.plant(L, 152, 86, big=False, seed=2), True)
    sc.label('Biblioteca', 84, 0, WALL_H + 2, dy=-6)
    sc.label('Cora · bibliotecária', 136, 66, 44)

    # ---------------- diretoria (Bonnie) ----------------
    gy(0, 104, 240, doors=[(62, 84)])
    gx(240, 384, 104)
    F.rug(L, 254, 18, 376, 96, H('c9d6e8'), H('a8b8d0'), H('f4f0e6'))
    add((248, 4, 260, 14), lambda: F.file_cabinet(L, 248, 4, '+y'), True)
    add((340, 0, 368, 8), lambda: F.bookshelf(L, 340, 0, 28), True)
    ws_front_y(sc, 286, 50, 3, 'green', boss=True, w=44, head='bonnie')
    add((296, 72, 304, 80), lambda: F.wood_chair(L, 296, 72, '-y'))
    add((316, 72, 324, 80), lambda: F.wood_chair(L, 316, 72, '-y'))
    add((366, 84, 376, 94), lambda: F.plant(L, 366, 84, seed=3), True)
    sc.label('Diretoria · Bonnie', 316, 100)

    # ---------------- sala dos professores (x 0..104) ----------------
    gx(0, 104, 144, doors=[(66, 88)])
    G.corkboard_x(L, 0, 242, 270, 20, 38)
    F.frame_x(L, 0, 148, 160, 24, 38)
    gy(144, 288, 104, doors=[(220, 242)])
    G.schedule_x(L, 0, 164, 212, 16, 42)
    sc.label('Horário de aula', 0, 188, WALL_H + 2, dy=-6)
    add((0, 218, 14, 236), lambda: F.coffee_machine(L, 0, 218), True)
    add((86, 150, 98, 160), lambda: F.file_cabinet(L, 86, 150, '+y'), True)
    add((44, 182, 66, 248), lambda: (F.small_table(L, 44, 182, 22, 66), F.papers(L, 50, 194, 12),
                                     F.mug(L, 56, 216, 12), F.papers(L, 48, 232, 12)), True)
    teachers = [(30, 186, '+x', 0, 'FR', 'sitF'), (30, 208, '+x', 2, 'FR', 'sitF'), (30, 230, '+x', 4, 'FR', 'sitF'),
                (70, 196, '-x', 1, 'BL', 'sitB'), (70, 218, '-x', 7, 'BL', 'sitB')]
    for cx, cy, face, vi, d, fr in teachers:
        def tg(cx=cx, cy=cy, face=face, vi=vi, d=d, fr=fr):
            F.wood_chair(L, cx, cy, face, 'seat')
            if face == '+x':
                F.wood_chair(L, cx, cy, face, 'back')
            F.seated_wood(L, sprite(vi, d, fr), cx, cy)
            if face == '-x':
                F.wood_chair(L, cx, cy, face, 'back')
        add((cx, cy, cx + 8, cy + 8), tg)
    add((4, 270, 14, 280), lambda: F.plant(L, 4, 270, seed=4), True)
    add((86, 266, 96, 276), lambda: F.plant(L, 86, 266, big=False, seed=14), True)
    sc.label('Sala dos professores', 52, 284)

    # ---------------- sala de aula (x 104..192) ----------------
    gx(104, 192, 144, doors=[(170, 190)])

    def board():  # free-standing blackboard with alphabet strip and clock on top
        blackboard_stand(L, 112, 150)
        for i, c in enumerate(('d26a5a', 'f2cf5b', '5f8fc9', '6aa86a', 'a07ac0')):
            L.qy(154, 114 + i * 5, 118 + i * 5, 33, 36, H(c))
        G.clock_y(L, 154, 126, 40)
    add((112, 150, 140, 156), board, True)

    def poster():  # poster on a small easel
        F.whiteboard(L, 150, 150)
        F.frame_y(L, 154, 156, 170, 16, 28, art=('a9d6ec', 'f2b8c0', 'f6e27a'))
    add((150, 150, 176, 156), poster, True)
    gy(144, 288, 192)
    sc.label('Tópico atual', 126, 152, 50)
    sc.stand(sprite(2, 'FL', 'idle'), 150, 172, tag='tutor')
    def student_desk():  # the user's desk: centred, facing the blackboard
        F.desk(L, 132, 204, 32, 16)
        G.notebook(L, 144, 210, 12)
        L.pbox(136, 208, 12, 6, 2, 2, T('e86a8a', 'cc5070', 'a84058'))          # pencil case
        F.mug(L, 156, 210, 12, 'f6e27a')
        L.pbox(158, 206, 12, 3, 3, 1, T('7d6a5a', '66564a', '524439'))         # desk lamp
        L.pbox(159, 207, 13, 1, 1, 6, T('7d6a5a', '66564a', '524439'), outline=False)
        L.pbox(157, 205, 19, 5, 5, 3, T('fff1c4', 'f5dc9a', 'e2c27a'))
    add((132, 204, 164, 220), student_desk, True)

    def student_chair():
        F.chair(L, 143, 222, '-y')
    add((143, 222, 153, 232), student_chair)
    sc.label('Sua carteira', 148, 238)
    add((108, 184, 116, 192), lambda: globe(L, 108, 184), True)
    add((106, 252, 114, 280), lambda: G.bookshelf_x(L, 106, 252, 28, h=22, seed=8), True)
    add((176, 270, 186, 280), lambda: F.plant(L, 176, 270, big=False, seed=5), True)
    sc.label('Sala de aula', 148, 284)

    # ---------------- estudo individual (x 240..384) ----------------
    gx(240, 384, 144, doors=[(300, 322)])
    gy(144, 288, 240)
    F.rug(L, 262, 160, 376, 278, H('a8505a'), H('843c46'), H('e8c0b0'))
    add((244, 158, 254, 170), lambda: F.file_cabinet(L, 244, 158), True)
    add((244, 172, 254, 184), lambda: F.file_cabinet(L, 244, 172), True)
    add((244, 250, 252, 278), lambda: G.bookshelf_x(L, 244, 250, 28, h=22, seed=13), True)
    add((310, 190, 318, 198), lambda: F.wood_chair(L, 310, 190, '+y'))
    add((296, 204, 336, 220), lambda: (F.desk(L, 296, 204, 40, 16), G.notebook(L, 302, 208, 12),
                                       G.cards_box(L, 316, 208, 12), F.mug(L, 328, 208, 12)), True)
    add((344, 194, 350, 200), lambda: F.lamp(L, 344, 194), True)
    add((330, 246, 360, 262), lambda: (F.small_table(L, 330, 246, 30, 16), G.cards_box(L, 336, 250, 12),
                                       G.cards_box(L, 348, 252, 12)), True)
    add((366, 270, 376, 280), lambda: F.plant(L, 366, 270, seed=6), True)
    sc.label('Estudo individual · notas e cartões', 312, 284)

    return sc.finish(bubbles=[('cora', '...'), ('tutor', '?'), ('bonnie', 'ok')])


if __name__ == '__main__':
    print(save2(build(), 'scene-estudos'))
