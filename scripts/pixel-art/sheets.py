"""sheet-moveis.png and tiles.png (native + 2x)."""
from px import H, Layer
import furn as F
import furn2 as G
from furn import T
from room import draw_floor
from floorkit import (save2, OAK, WALNUT, parquet, checker, speckled, PROJECT_WALL, CASA_WALL, SCHOOL_WALL,
                      glass_x, wainscot_wall, GRAPHITE, GREENF, shade)
from scene_projeto import SLATE, WARMG, SAGE
from scene_casa2 import WARM, HONEY
from scene_estudos import HALL, AULA, PROF, blackboard_stand

BGS = H('e9e1d0')


def moveis():
    CW, CH, NC = 88, 96, 6
    cells = [
        ('desk +y', 26, lambda L: (F.desk(L, 0, 0), F.crt(L, 2, 1, 12, '+y'), F.keyboard(L, 16, 10, 12), F.mug(L, 25, 3, 12))),
        ('desk +x', 26, lambda L: (F.desk(L, 0, 0, 14, 30), F.crt(L, 1, 15, 12, '+x', 'amber'), F.keyboard(L, 2, 2, 12, 'y'))),
        ('crt states', 20, lambda L: [F.crt(L, i * 18 - 30, 0, 0, '+y', s) for i, s in enumerate(('green', 'amber', 'red', 'off'))]),
        ('chair', 10, lambda L: F.chair(L, 0, 0, '+y')),
        ('boss desk', 26, lambda L: (G.boss_desk(L, 0, 0), F.crt(L, 1, 14, 13, '+x'), F.papers(L, 3, 4, 13))),
        ('easel wb', 20, lambda L: F.whiteboard(L, 0, 0)),
        ('bookshelf', 20, lambda L: F.bookshelf(L, 0, 0, 28)),
        ('sofa', 20, lambda L: F.sofa(L, 0, 0, '+y', T('f0a060', 'd9844a', 'b86a38'))),
        ('round table', 30, lambda L: rt(L)),
        ('meeting tbl', 24, lambda L: (F.small_table(L, -10, 0, 40, 18), [F.wood_chair(L, x, -12, '+y') for x in (-6, 8, 22)])),
        ('tv', 16, lambda L: F.tv(L, 0, 0)),
        ('elevator', -16, lambda L: (L.pbox(0, -4, 0, 34, 4, 56, T('8a8f96', 'f3ece0', 'dad2c4')), F.elevator_y(L, 0, 6, 26))),
        ('cooler+plant', 8, lambda L: (F.water_cooler(L, 0, 0), F.plant(L, 16, 4, seed=2))),
        ('arcades', 12, lambda L: (G.arcade(L, 0, 0), G.arcade(L, 16, 0, T('e88a7a', 'cc6e5e', 'a8564a'), H('f2e27a')))),
        ('foosball', 14, lambda L: (G.foosball(L, 0, 0), G.pouf(L, 4, 22, T('f6d27a', 'e0b85a', 'c49c44')))),
        ('ping-pong', 30, lambda L: G.pingpong(L, 0, 0)),
        ('caveira', 12, lambda L: G.skull_stand(L, 0, 0)),
        ('claude fm', 26, lambda L: G.radio_tv(L, 0, 0)),
        ('blackboard', 20, lambda L: blackboard_stand(L, 0, 0)),
        ('escrita', 20, lambda L: (F.desk(L, 0, 0, 32, 16), G.typewriter(L, 4, 3, 12), G.notebook(L, 18, 6, 12), G.cards_box(L, 24, 2, 12))),
        ('armchair', 12, lambda L: (G.armchair(L, 0, 0, '+y', T('d9a0a0', 'c08080', 'a06868')), F.lamp(L, 18, 2))),
        ('patio', 24, lambda L: (G.planter(L, 0, 0), F.bench(L, -14, 14), G.lamp_post(L, 22, -10))),
        ('cabinet', 8, lambda L: (F.file_cabinet(L, 0, 0), F.printer(L, 16, 6))),
        ('bubbles', 0, None),
    ]
    rows = (len(cells) + NC - 1) // NC
    L = Layer(CW * NC, CH * rows, 0, 0, BGS)
    for i, (name, off, fn) in enumerate(cells):
        cx, cy = (i % NC) * CW, (i // NC) * CH
        if (i % NC + i // NC) % 2:
            L.rect(cx, cy, CW, CH, H('ded4c0'))
        L.ox, L.oy = cx + CW // 2, cy + 56 - off // 2
        if fn:
            fn(L)
        else:
            for k, kind in enumerate(('...', '!', 'ok', '?')):
                F.bubble(L, cx + 12 + (k % 2) * 40, cy + 36 + (k // 2) * 36, kind)
    return L.img


def rt(L):
    F.wood_chair(L, -4, -26, '+y'); F.wood_chair(L, -26, -4, '+x')
    F.round_table(L, 0, 0, 15)
    F.wood_chair(L, 18, -4, '-x'); F.wood_chair(L, -4, 18, '-y')


def tiles():
    floors = [OAK, WALNUT, WARM, HONEY, parquet(), SLATE, WARMG, SAGE, HALL, AULA, PROF]
    L = Layer(6 * 44 + 8, 2 * 26 + 100 + 8, 0, 0, BGS)
    for i, fn in enumerate(floors):
        L.ox, L.oy = 6 + 16 + (i % 6) * 44, 6 + (i // 6) * 24
        draw_floor(L, 16, 16, lambda x, y, fn=fn: fn(x + 32, y + 32), slab=False)
    # wall segments (1 tile) with each wainscot finish + partitions
    def wall(st):
        up = st['upper']
        L.pbox(0, -4, 0, 16, 4, 56, (st['top'], up, shade(up, .9)))
        L.qy(0, 0, 16, 2, 20, st['wains']); L.qy(0, 0, 16, 20, 22, st['cap']); L.qy(0, 0, 16, 0, 2, st['base'])
    pieces = [lambda: wall(PROJECT_WALL), lambda: wall(CASA_WALL), lambda: wall(SCHOOL_WALL),
              lambda: glass_x(L, 0, 32, 0, frame=GRAPHITE), lambda: glass_x(L, 0, 32, 0, frame=GREENF),
              lambda: wainscot_wall(L, 0, 0, 32, 4)]
    for i, fn in enumerate(pieces):
        L.ox, L.oy = 10 + i * 44 + (0 if i < 3 else -6), 60 + 70 - (0 if i < 3 else 14)
        fn()
    return L.img


if __name__ == '__main__':
    print(save2(moveis(), 'sheet-moveis'))
    print(save2(tiles(), 'tiles'))
