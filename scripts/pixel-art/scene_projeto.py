"""scene-projeto.png - project floor (24x18 tiles).

Split in parts so export_app.py builds the app's atlas from the same geometry:
shell() draws what never sorts (floor, walls, rugs, elevator, whiteboards), the other
parts add sortable items to a Scene. people=False leaves every chair empty.
"""
from px import H
import furn as F
import furn2 as G
from furn import T
from floorkit import (GRAPHITE, W, D, new_layer, save2, Scene, region_floor, OAK, WALNUT, carpet_tiles, back_walls,
                      PROJECT_WALL, PART_H, WALL_H, draw_floor)
from desks import ws_back, ws_front_x
from chars import sprite

SLATE = carpet_tiles(H('93a3b6'), H('8696aa'), H('76869a'))
WARMG = carpet_tiles(H('bdb4a9'), H('b1a89d'), H('9d958b'))
SAGE = carpet_tiles(H('afbea4'), H('a3b298'), H('919f86'))

RW = 144
ROOMS = [  # ry0, h, carpet, name, screen, coordinator, members (None = individual agent)
    (0, 96, SLATE, 'Dev Alfa · trabalhando', 'green', 3, [1, 5, 4]),
    (96, 96, WARMG, 'Dev Beta · aguardando', 'amber', 4, [0, 2, 'ind']),
    (192, 96, SAGE, 'Conteúdo · bloqueado', 'red', 1, [3, 5]),
]
# the elevator door on the back wall (x0, x1) and the Emi desk (x, y, width)
ELEVATOR = (268, 292)
# turned to face the west wall: Emi sits east of her desk, the visitors west of it
EMI_DESK = (320, 176, 44)
EMI_VISITORS = [(304, 184), (304, 204)]
# meeting chairs: (x, y, the way the sitter looks)
MEETING_SEATS = [(200, cy, '+x') for cy in (170, 196, 222)] + [(242, cy, '-x') for cy in (170, 196, 222)]


def slots(ry0, h):
    """member desks of a squad room, in creation order: near column first, top then bottom.
    The approved art shows the first four; 5 and 6 fill the middle row of each column."""
    return [(64, ry0 + 8), (64, ry0 + h - 34), (104, ry0 + 8), (104, ry0 + h - 34), (64, ry0 + 35), (104, ry0 + 35)]


def coordinator_at(ry0, h):
    return 30, ry0 + h // 2 - 17


def shell(L):
    """everything drawn straight on the layer, under every sorted item."""
    draw_floor(L, W, D, region_floor([((0, 0, 9, 6), SLATE), ((0, 6, 9, 12), WARMG), ((0, 12, 9, 18), SAGE),
                                      ((11, 7, 24, 18), WALNUT)], OAK))
    back_walls(L, PROJECT_WALL)
    F.elevator_y(L, 0, *ELEVATOR)
    F.rug(L, 180, 12, 246, 70, H('f2c58a'), H('d9a066'), H('fbe9c8'))
    F.rug(L, 188, 134, 276, 276, H('5d5f66'), H('c9925a'), H('6d6f76'))
    # clear door frame of the diretoria: threshold + mats on the floor
    L.qz(0, 280, 244, 296, 270, H('c9925a'))
    L.qz(0, 284, 246, 292, 268, H('e8d9b8'))
    L.qz(0, 287, 244, 291, 270, H('3d424a'))
    F.rug(L, 298, 150, 378, 270, H('7f9fd0'), H('5f7fb4'), H('c9d8f0'))
    for ry0, h, *_ in ROOMS:
        G.wall_whiteboard_x(L, 0, ry0 + 8, ry0 + 40, 20, 40)


def lounge(sc, people=True):
    L, add = sc.L, sc.add
    add((252, 3, 262, 13), lambda: F.plant(L, 252, 3, seed=1), True)
    add((298, 3, 308, 13), lambda: F.plant(L, 298, 3, seed=2), True)
    add((184, 16, 224, 30), lambda: F.sofa(L, 184, 16, '+y', T('f0a060', 'd9844a', 'b86a38'), 40), True)
    add((196, 38, 212, 46), lambda: G.low_table(L, 196, 38, 16, 8), True)
    add((186, 52, 194, 60), lambda: G.pouf(L, 186, 52, T('f6d27a', 'e0b85a', 'c49c44')), True)
    add((214, 52, 222, 60), lambda: G.pouf(L, 214, 52, T('9fc8b8', '82ae9c', '6a9482')), True)
    add((234, 6, 242, 14), lambda: F.water_cooler(L, 234, 6), True)
    add((318, 0, 330, 10), lambda: G.arcade(L, 318, 0), True)
    add((334, 0, 346, 10), lambda: G.arcade(L, 334, 0, T('e88a7a', 'cc6e5e', 'a8564a'), H('f2e27a')), True)
    add((330, 44, 356, 58), lambda: G.foosball(L, 330, 44), True)
    add((366, 4, 376, 14), lambda: F.plant(L, 366, 4, big=False, seed=3), True)
    if people:
        sc.stand(sprite(0, 'BR', 'idle'), 340, 24)
        sc.stand(sprite(2, 'FL', 'walkA'), 262, 96)
    sc.label('Descanso e lazer', 282, 44)


def meeting_walls(sc):
    sc.gx(176, 288, 112, doors=[(214, 232)])
    sc.gy(112, 288, 176, doors=[(150, 168)])


def meeting_table(sc):
    L = sc.L
    sc.add((212, 160, 238, 244), lambda: (F.small_table(L, 212, 160, 26, 84), F.papers(L, 218, 170, 12),
                                          F.mug(L, 226, 196, 12), F.papers(L, 220, 222, 12)), True)


def meeting_decor(sc):
    L, add = sc.L, sc.add
    add((180, 270, 190, 280), lambda: F.plant(L, 180, 270, seed=4), True)
    add((272, 116, 282, 126), lambda: F.plant(L, 272, 116, big=False, seed=5), True)


def meeting(sc, people=True):
    L, add = sc.L, sc.add
    meeting_walls(sc)
    meeting_table(sc)
    for i, (cy, vi) in enumerate(((170, 5), (196, 1), (222, 4))):
        def west(cy=cy, vi=vi):
            F.wood_chair(L, 200, cy, '+x')
            if people:
                F.seated_wood(L, sprite(vi, 'FR', 'sitF'), 200, cy)
        add((200, cy, 208, cy + 8), west)
        add((242, cy, 250, cy + 8), lambda cy=cy: F.wood_chair(L, 242, cy, '-x'))
    meeting_decor(sc)
    sc.label('Sala de reunião · 3 em reunião', 232, 282)


def diretoria_walls(sc):
    L, add = sc.L, sc.add
    sc.gx(288, 384, 112, doors=[(318, 336)])
    sc.gy(112, 288, 288, doors=[(246, 268)])
    # graphite posts and a thick lintel over the door to the meeting room
    add((288, 242, 290, 246), lambda: L.pbox(287, 242, 0, 3, 3, PART_H + 4, GRAPHITE))
    add((288, 268, 290, 271), lambda: L.pbox(287, 268, 0, 3, 3, PART_H + 4, GRAPHITE))
    add((288, 246, 290, 268), lambda: L.pbox(287, 242, PART_H, 3, 29, 4, GRAPHITE))


def diretoria_back(sc):
    L, add = sc.L, sc.add
    add((350, 116, 378, 124), lambda: F.bookshelf(L, 350, 116, 28), True)
    add((294, 116, 306, 126), lambda: F.file_cabinet(L, 294, 116, '+y'), True)


def diretoria_front(sc):
    L, add = sc.L, sc.add
    for vx, vy in EMI_VISITORS:
        add((vx, vy, vx + 8, vy + 8), lambda vx=vx, vy=vy: F.wood_chair(L, vx, vy, '+x'))
    add((366, 268, 376, 278), lambda: F.plant(L, 366, 268, seed=6), True)
    add((372, 150, 378, 156), lambda: F.lamp(L, 372, 150), True)


def diretoria(sc, people=True, state='green'):
    diretoria_walls(sc)
    diretoria_back(sc)
    x, y, w = EMI_DESK
    ws_back(sc, x, y, 7 if people else None, state, 'papers', head='emi', boss=True, d_=w)
    diretoria_front(sc)
    sc.label('Diretoria · Emi', 336, 282)


def room_walls(sc, ry0, h):
    if ry0 > 0:
        sc.gx(0, RW, ry0)
    dy = ry0 + h // 2 - 9
    sc.gy(ry0, ry0 + h, RW, doors=[(dy, dy + 18)])


def room_shelf(sc, ry0, h):
    L = sc.L
    sc.add((2, ry0 + h - 26, 10, ry0 + h - 4), lambda: G.bookshelf_x(L, 2, ry0 + h - 26, 22, seed=ry0), True)


def build():
    L = new_layer()
    shell(L)
    sc = Scene(L)
    lounge(sc)
    meeting(sc)
    diretoria(sc)
    for i, r in enumerate(ROOMS):
        squad_room(sc, i, *r)
    return sc.finish(bubbles=[('A', '...'), ('B', '?'), ('C', '!'), ('emi', '...')])


def squad_room(sc, idx, ry0, h, carpet, name, screen, coord, members):
    L = sc.L
    room_walls(sc, ry0, h)
    room_shelf(sc, ry0, h)
    # coordinator: west, facing the members (+x)
    ws_front_x(sc, *coordinator_at(ry0, h), coord, screen)
    px, py = L.P(23, ry0 + h // 2 + 13, 40)
    sc.labels.append(('Coordenação', px, int(py) - 6))
    # members (face -x, toward the coordinator)
    for i, vi in enumerate(members):
        x, y = slots(ry0, h)[i]
        if vi == 'ind':
            cx, cy = ws_back(sc, x, y, 5, 'green', 'papers')
            pxx, pyy = L.P(cx + 6, cy + 6, 30)
            sc.labels.append(('Agente individual', pxx + 26, int(pyy) + 2))
        else:
            ws_back(sc, x, y, vi, screen, 'mug' if i % 2 else 'papers', head='ABC'[idx] if i == 0 else None)
    px, py = L.P(0, ry0 + h // 2, WALL_H + 2)
    sc.labels.append((name, px, int(py) - 6))


if __name__ == '__main__':
    print(save2(build(), 'scene-projeto'))
