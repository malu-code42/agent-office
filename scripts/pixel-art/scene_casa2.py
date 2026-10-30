"""scene-casa.png - Luna's house floor (22x16 tiles)."""
from px import H
import furn as F
import furn2 as G
from furn import T
from floorkit import (W, D, new_layer, save2, Scene, region_floor, OAK, planks, back_walls, CASA_WALL, draw_floor, WALL_H)
from desks import ws_back, ws_front_y
from chars import sprite

WARM = planks([H('e2b989'), H('d8ad7c'), H('dcb384')], H('b98c5f'), H('c39769'))
WARMY = planks([H('dcae7c'), H('d3a473'), H('d8aa78')], H('b3865a'), H('bf9266'), along='y')
HONEY = planks([H('e9c487'), H('e0b878'), H('e5be80')], H('c49a5a'), H('cfa566'))


def totem(L, x, y):
    """'Rotinas de agentes' standing board, face +y."""
    L.pbox(x, y, 0, 14, 8, 2, T('8a6a52', '73563f', '5c4430'))
    L.pbox(x + 6, y + 3, 2, 2, 2, 12, T('8a6a52', '73563f', '5c4430'), outline=False)
    L.pbox(x, y + 2, 14, 14, 3, 20, T('8a6448', 'f4ead2', '73563f'))
    for i, c in enumerate(('7cc4bc', 'f2b8c0', 'f6e27a', 'a9d6ec')):
        zz = 30 - i * 4
        L.qy(y + 5, x + 2, x + 4, zz, zz + 2, H(c))
        L.qy(y + 5, x + 5, x + 12, zz + 1, zz + 2, H('8a7a6a'))


def build():
    L = new_layer()
    draw_floor(L, W, D, region_floor([((0, 0, 10, 18), WARM), ((10, 0, 14, 18), OAK)], WARMY))
    back_walls(L, CASA_WALL)
    sc = Scene(L)
    add = sc.add

    # ---------------- entrada (hall between the halves, 4 tiles) ----------------
    F.elevator_y(L, 0, 180, 204)
    add((164, 3, 174, 13), lambda: F.plant(L, 164, 3, seed=1), True)
    add((210, 3, 220, 13), lambda: F.plant(L, 210, 3, seed=2), True)
    F.rug(L, 178, 22, 206, 276, H('c98a7a'), H('a86a5c'), H('f1d8c8'))
    add((206, 70, 220, 80), lambda: totem(L, 206, 70), True)
    sc.label('Rotinas de agentes', 213, 74, 40)
    sc.label('Entrada', 192, 284)
    sc.stand(sprite(4, 'FL', 'walkA'), 192, 140)

    # ---------------- half A: sala de estar + Você + mesa da Luna ----------------
    sc.wy(0, 288, 160, doors=[(56, 88), (176, 208)])
    for a_, b_, n in ((8, 42, 'Agenda'), (54, 90, 'Objetivos'), (102, 148, 'Rotinas pessoais')):
        F.corkboard_y(L, 0, a_, b_, 22, 42)
        sc.label(n, (a_ + b_) / 2, 0, WALL_H + 2, dy=-6)
    add((146, 20, 154, 28), lambda: G.skull_stand(L, 146, 20), True)
    sc.label('Caveira', 150, 24, 36)
    # sala de estar (north part)
    add((2, 30, 14, 64), lambda: G.radio_tv(L, 2, 30), True)
    sc.label('Claude FM', 8, 47, 34)
    F.rug(L, 20, 18, 104, 86, H('e7c39a'), H('cf9f72'), H('fbe9c8'))
    add((30, 40, 42, 54), lambda: G.low_table(L, 30, 40, 12, 14), True)
    add((62, 28, 76, 68), lambda: F.sofa_mx(L, 62, 28, T('e7b3a6', 'd39486', 'b87a6d'), 40), True)
    add((96, 22, 102, 28), lambda: F.lamp(L, 96, 22), True)
    add((30, 20, 42, 32), lambda: G.armchair(L, 30, 20, '+y', T('b9d3b0', '9cbf93', '7fa277')), True)
    sc.label('Sala de estar', 106, 70)
    # wall decor (west wall of the sala de estar)
    G.wall_shelf_x(L, 0, 4, 24, 30)
    G.clock_x(L, 0, 46, 44)
    F.frame_x(L, 0, 70, 84, 26, 40)
    F.frame_x(L, 0, 88, 98, 30, 42, art=('9cc4dc', 'f6e27a', '8cc477'))
    F.frame_x(L, 0, 112, 132, 22, 44, art=('f2c58a', 'fbf3e0', 'e86a5a'), fr='5f7fb4')
    add((4, 110, 14, 120), lambda: F.plant(L, 4, 110, seed=5), True)
    # mesa da Luna: square table, 6 chairs (Luna + 3 residents)
    F.rug(L, 22, 106, 104, 186, H('c9d6e8'), H('a8b8d0'), H('f4f0e6'))
    tx, ty = 44, 132

    def sit(cx, cy, face, vi, d, fr):
        F.wood_chair(L, cx, cy, face, 'seat')
        if face in ('+y', '+x'):
            F.wood_chair(L, cx, cy, face, 'back')
        if vi is not None:
            F.seated_wood(L, sprite(vi, d, fr), cx, cy)
        if face in ('-y', '-x'):
            F.wood_chair(L, cx, cy, face, 'back')

    def table_group():
        sit(tx + 6, ty - 12, '+y', 6, 'FL', 'sitF')
        sit(tx + 22, ty - 12, '+y', 1, 'FL', 'sitF')
        sit(tx - 14, ty + 14, '+x', 2, 'FR', 'sitF')
        F.small_table(L, tx, ty, 36, 26)
        F.mug(L, tx + 6, ty + 6, 12); F.papers(L, tx + 14, ty + 10, 12); F.mug(L, tx + 26, ty + 8, 12, 'a9d6ec')
        sit(tx + 40, ty + 9, '-x', None, 'BL', 'sitB')
        sit(tx + 6, ty + 30, '-y', 7, 'BR', 'sitB')
        sit(tx + 22, ty + 30, '-y', None, 'BR', 'sitB')
    add((tx - 14, ty - 12, tx + 48, ty + 38), table_group)
    px, py = L.P(tx + 10, ty - 8, 8); sc.heads['luna'] = (int(px) + 3 * L.S, int(py) - 24 * L.S)
    sc.label('Mesa da Luna', 124, 150)
    # Você: desk rotated 90 deg, against the front wall (opposite the Objetivos board)
    ws_front_y(sc, 70, 266, 0, 'green', w=36, head='voce')
    mx, my = L.P(78, 270, 34)
    sc.labels.append(('Novo agente', mx + 2, int(my) - 18))
    vx, vy = L.P(98, 262, 0)
    sc.labels.append(('Você', vx + 22, int(vy) - 6))
    add((122, 262, 132, 272), lambda: F.plant(L, 122, 262, big=False, seed=9), True)
    # furnish the corner left of the desk
    add((36, 266, 48, 276), lambda: F.file_cabinet(L, 36, 266, '+y'), True)
    add((18, 266, 28, 276), lambda: F.plant(L, 18, 266, seed=10), True)
    add((56, 270, 62, 276), lambda: F.lamp(L, 56, 270), True)

    # ---------------- half B: sala de mídias ----------------
    sc.wy(0, 288, 224, doors=[(56, 88), (176, 208)])
    for x in range(232, 380, 30):
        add((x, 0, x + 28, 8), lambda x=x: F.bookshelf(L, x, 0, 28), True)
    sc.label('Livros', 306, 0, WALL_H + 2, dy=-6)
    F.rug(L, 232, 16, 292, 70, H('d9a0a0'), H('b87a7a'), H('f6dcd0'))
    add((238, 30, 250, 42), lambda: G.armchair(L, 238, 30, '+x', T('d9a0a0', 'c08080', 'a06868')), True)
    add((258, 32, 268, 42), lambda: G.low_table(L, 258, 32, 10, 10), True)
    add((274, 20, 280, 26), lambda: F.lamp(L, 274, 20), True)
    # Escrita, between the shelves and the pink reading corner
    add((306, 14, 322, 50), lambda: (F.desk(L, 306, 14, 16, 36), G.typewriter(L, 309, 18, 12),
                                     G.notebook(L, 310, 30, 12), F.mug(L, 312, 42, 12)), True)
    add((326, 22, 334, 30), lambda: F.wood_chair(L, 326, 22, '-x'))
    add((310, 56, 316, 62), lambda: F.lamp(L, 310, 56), True)
    sc.label('Escrita', 330, 66)
    # Filmes: TV on the west wall, low table, sofa facing the TV, one rug
    F.rug(L, 230, 100, 330, 168, H('a9b8d8'), H('8698c0'), H('e4eaf6'))
    add((228, 120, 238, 146), lambda: F.tv(L, 228, 120), True)
    add((258, 126, 270, 140), lambda: G.low_table(L, 258, 126, 12, 14), True)
    add((292, 114, 306, 154), lambda: F.sofa_mx(L, 292, 114, T('8fb3dc', '6f95c2', '587aa4'), 40), True)
    add((316, 104, 326, 114), lambda: F.plant(L, 316, 104, big=False, seed=7), True)
    sc.label('Filmes', 278, 174)
    # Jogos: 3 cabinets side by side on the west wall, poufs in front, own rug
    F.rug(L, 230, 210, 300, 280, H('f2d6a0'), H('dcb880'), H('fbf3e0'))
    add((228, 216, 238, 228), lambda: G.arcade_x(L, 228, 216), True)
    add((228, 232, 238, 244), lambda: G.arcade_x(L, 228, 232, T('e88a7a', 'cc6e5e', 'a8564a'), H('f2e27a')), True)
    add((228, 248, 238, 260), lambda: G.arcade_x(L, 228, 248, T('8fd0a0', '6fb484', '58966a'), H('f6e27a')), True)
    add((254, 222, 262, 230), lambda: G.pouf(L, 254, 222, T('f6d27a', 'e0b85a', 'c49c44')), True)
    add((254, 254, 262, 262), lambda: G.pouf(L, 254, 254, T('9fc8b8', '82ae9c', '6a9482')), True)
    sc.stand(sprite(5, 'BL', 'idle'), 252, 240)
    add((364, 270, 374, 280), lambda: F.plant(L, 364, 270, seed=8), True)
    add((364, 100, 374, 110), lambda: F.plant(L, 364, 100, seed=12), True)
    sc.label('Jogos', 270, 284)
    sc.label('Sala de mídias', 262, 96)

    return sc.finish(bubbles=[('luna', '...'), ('voce', 'ok')])


if __name__ == '__main__':
    print(save2(build(), 'scene-casa'))
