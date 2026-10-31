"""Exports what the app draws (src/renderer/src/assets/pixel/):

  atlas.png + atlas.json   every sprite: furniture (one frame per CRT state), partitions,
                           chairs (seat and back apart, so a sitter goes between them),
                           characters (8 variants x 4 directions x idle/walkA/walkB + seated),
                           speech bubbles, the floor shadow and one diamond per floor tile
  project-base.png         the project floor's slab, floor, back walls, rugs and elevator
  project.json             the project floor's layout: where each sprite goes on the
                           base canvas, its footprint for depth sorting, the rooms, seats,
                           walls, blocked tiles and spots the game walks to

Everything is placed at its final pixel position on the native canvas (736x460), so the
app only blits: no half-pixel rounding differs from the approved scene-projeto.png.
World units: 16 per tile (x right-down, y left-down, z up); the app's tiles are units / 16.
"""
import hashlib
import json
import os
from PIL import Image
from px import H
import furn as F
from floorkit import SW, SH, OX, OY, TS, W, D, WALL_H, PART_H, Scene, new_layer, OAK, WALNUT, draw_floor, Layer
import scene_projeto as P
from desks import ws_back, ws_front_x
from chars import sprite, VARIANTS, letters, palette, SW2, SH2

APP = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                   'src', 'renderer', 'src', 'assets', 'pixel')
STATES = ('green', 'amber', 'red', 'off')
DIRS = ('FL', 'FR', 'BL', 'BR')
# the way a sitter looks -> sprite direction and seated frame
SIT = {'+x': ('FR', 'sitF'), '-x': ('BL', 'sitB'), '+y': ('FL', 'sitF'), '-y': ('BR', 'sitB')}
# the app's hair cuts ("Corte 1".."Corte 6" in the look editor) -> chars.py styles
CUTS = ['short', 'spiky', 'long', 'bun', 'twin', 'pony']
CHAR_FRAMES = [(d, f) for d in DIRS for f in ('idle', 'walkA', 'walkB')] + [('BL', 'sitB'), ('BR', 'sitB'), ('FL', 'sitF'), ('FR', 'sitF')]
TESTS = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'test', 'fixtures')


class Atlas:
    """Frames by name; identical pixels share one frame."""

    def __init__(s):
        s.frames, s.by_hash = {}, {}

    def put(s, name, img):
        key = hashlib.sha1(img.tobytes() + bytes(img.size)).hexdigest()
        if key in s.by_hash:
            return s.by_hash[key]
        n, k = name, 2
        while n in s.frames:
            n, k = f'{name}~{k}', k + 1
        s.frames[n] = img
        s.by_hash[key] = n
        return n

    def save(s, png, js):
        """shelf packing, tallest first, 1px gap so nearest-neighbour scaling never bleeds."""
        names = sorted(s.frames, key=lambda n: (-s.frames[n].height, n))
        width, x, y, row, rects = 512, 0, 0, 0, {}
        for n in names:
            w, h = s.frames[n].size
            if x + w > width:
                x, y, row = 0, y + row + 1, 0
            rects[n] = (x, y, w, h)
            x, row = x + w + 1, max(row, h)
        img = Image.new('RGBA', (width, y + row), (0, 0, 0, 0))
        for n, (x, y, w, h) in rects.items():
            img.paste(s.frames[n], (x, y))
        img.save(png, optimize=True)
        with open(js, 'w', encoding='utf8') as f:
            json.dump({'image': os.path.basename(png), 'frames': {n: list(rects[n]) for n in sorted(rects)}}, f,
                      separators=(',', ':'))


class Capture(Scene):
    """Scene that remembers each item (and each glass wall) instead of drawing it."""

    def __init__(s, L):
        super().__init__(L)
        s.rec, s.kind, s.walls = [], 'furniture', []

    def add(s, fp, fn, shadow=False):
        super().add(fp, fn, shadow)
        s.rec.append((s.kind, tuple(fp), s.items[-1][1]))

    def take(s):
        out, s.rec = s.rec, []
        return out

    def gx(s, x0, x1, yp, doors=(), **k):
        s.walls.append({'axis': 'z', 'at': yp // TS, 'from': x0 // TS, 'to': x1 // TS, 'doors': door_tiles(doors)})
        kind, s.kind = s.kind, 'wall'
        super().gx(x0, x1, yp, doors, **k)
        s.kind = kind

    def gy(s, y0, y1, xp, doors=(), **k):
        s.walls.append({'axis': 'x', 'at': xp // TS, 'from': y0 // TS, 'to': y1 // TS, 'doors': door_tiles(doors)})
        kind, s.kind = s.kind, 'wall'
        super().gy(y0, y1, xp, doors, **k)
        s.kind = kind


def door_tiles(doors):
    """tiles a door opens: the ones it covers at least half of."""
    out = []
    for a, b in doors:
        out += [i for i in range(a // TS, b // TS + 1) if min(b, (i + 1) * TS) - max(a, i * TS) >= TS // 2]
    return out


def render(L, fn, size=(SW, SH)):
    """runs fn on an empty layer; returns (cropped image, left, top) or None."""
    keep = L.img
    L.img = Image.new('RGBA', size, (0, 0, 0, 0))
    fn()
    img, L.img = L.img, keep
    bb = img.getbbox()
    return (img.crop(bb), bb[0], bb[1]) if bb else None


def main():
    os.makedirs(APP, exist_ok=True)
    atlas = Atlas()
    L = new_layer()

    def place(name, fn, fp):
        got = render(L, fn)
        x0, y0, x1, y1 = fp
        return {'f': atlas.put(name, got[0]), 'x': got[1], 'y': got[2], 'fp': [x0, y0, x1, y1]}

    def items(name, recs):
        out = []
        for i, (kind, fp, fn) in enumerate(recs):
            it = place(f'{name}/{i}', fn, fp)
            if kind == 'wall':
                it['wall'] = True  # walls block tile edges, not tiles
            out.append(it)
        return out

    def seat(name, x, y, face, wood=False):
        """a chair as two frames (seat, back) and where its sitter is drawn."""
        draw = F.wood_chair if wood else F.chair
        size = 8 if wood else 10
        fp = (x, y, x + size, y + size)
        direction, frame = SIT[face]
        cx, cy, z = (x + 4, y + 4, 8) if wood else (x + 5, y + 5, 7)
        px, py = L.P(cx, cy, z)
        return {
            'at': [cx, cy],
            'fp': list(fp),
            'seat': place(f'{name}/seat', lambda: draw(L, x, y, face, 'seat'), fp),
            'back': place(f'{name}/back', lambda: draw(L, x, y, face, 'back'), fp),
            # the backrest hides the sitter when it stands on the near side
            'front': face in ('-x', '-y'),
            'sit': [int(px - 12), int(py - 28)],
            'head': [int(px) + 3, int(py) - 24],
            'dir': direction,
            'pose': frame,
        }

    def desk(name, make):
        """one frame per CRT state; make(sc, state) adds the desk (and its chair, dropped here)."""
        out = {}
        for st in STATES:
            sc = Capture(L)
            make(sc, st)
            kind, fp, fn = sc.take()[0]
            out[st] = place(f'{name}/{st}', fn, fp)
        return out

    # ---------- the shell: one image under everything ----------
    base = new_layer()
    P.shell(base)
    base.img.save(os.path.join(APP, 'project-base.png'), optimize=True)

    # ---------- fixed items ----------
    sc = Capture(L)
    P.lounge(sc, people=False)
    static = items('lounge', sc.take())
    P.meeting_walls(sc)
    P.meeting_table(sc)
    P.meeting_decor(sc)
    static += items('meeting', sc.take())
    sc.kind = 'wall'  # the door posts and lintel of the diretoria too
    P.diretoria_walls(sc)
    sc.kind = 'furniture'
    P.diretoria_back(sc)
    P.diretoria_front(sc)
    static += items('diretoria', sc.take())
    for r, (ry0, h, *_rest) in enumerate(P.ROOMS):
        P.room_walls(sc, ry0, h)
        P.room_shelf(sc, ry0, h)
        static += items(f'room{r}', sc.take())
    walls = sc.walls

    # ---------- squad rooms ----------
    rooms = []
    for r, (ry0, h, *_rest) in enumerate(P.ROOMS):
        cx0, cy0 = P.coordinator_at(ry0, h)
        px, py = L.P(0, ry0 + h // 2, WALL_H + 2)
        cpx, cpy = L.P(23, ry0 + h // 2 + 13, 40)
        dark = [L.P(0, ry0, PART_H + 4), L.P(P.RW, ry0, PART_H + 4), L.P(P.RW, ry0, 0), L.P(P.RW, ry0 + h, 0),
                L.P(0, ry0 + h, 0), L.P(0, ry0 + h, PART_H + 4)]
        room = {
            'rect': [0, ry0 // TS, P.RW // TS, (ry0 + h) // TS],
            'plate': [px, int(py) - 6],
            'dark': [[round(a, 1), round(b, 1)] for a, b in dark],
            'coordinator': {
                'desk': desk(f'room{r}/coord', lambda s, st: ws_front_x(s, cx0, cy0, None, st)),
                'center': [cx0 + 7, cy0 + 17],
                'seat': seat(f'room{r}/coord', cx0 - 12, cy0 + 34 - 13, '+x'),
                'plate': [cpx, int(cpy) - 6],
            },
            'slots': [],
        }
        for i, (x, y) in enumerate(P.slots(ry0, h)):
            extra = 'mug' if i % 2 else 'papers'
            sx, sy = x + 16, y + 3
            ipx, ipy = L.P(sx + 5 + 6, sy + 5 + 6, 30)
            room['slots'].append({
                'desk': desk(f'room{r}/slot{i}', lambda s, st, x=x, y=y, extra=extra: ws_back(s, x, y, None, st, extra)),
                'seat': seat(f'room{r}/slot{i}', sx, sy, '-x'),
                'plate': [ipx + 26, int(ipy) + 2],
            })
        rooms.append(room)

    # ---------- Emi and the meeting room ----------
    ex, ey, ew = P.EMI_DESK
    epx, epy = L.P(336, 282, 0)
    emi = {
        'desk': desk('emi', lambda s, st: ws_back(s, ex, ey, None, st, 'papers', boss=True, d_=ew)),
        'seat': seat('emi', ex + 16, ey + (ew - 26) // 2 + 3, '-x'),
        'plate': [epx, int(epy)],
    }
    mpx, mpy = L.P(232, 282, 0)
    meeting = {
        'rect': [11, 7, 18, 18],
        'table': [225, 202],
        'seats': [seat(f'meeting/{i}', x, y, face, wood=True) for i, (x, y, face) in enumerate(P.MEETING_SEATS)],
        'plate': [mpx, int(mpy)],
    }
    lpx, lpy = L.P(282, 44, 0)

    # ---------- tiles: blocked by furniture (walls block edges instead) ----------
    def covered(a, b):
        """tiles an extent covers: at least half a tile, or the one under its middle when smaller."""
        need = min(TS // 2, (b - a) / 2)
        return [i for i in range(int(a // TS), int((b - 1) // TS) + 1) if min(b, (i + 1) * TS) - max(a, i * TS) >= need]

    blocked = set()
    furniture = [it['fp'] for it in static if not it.get('wall')]
    furniture += [room['coordinator']['desk']['green']['fp'] for room in rooms]
    # the four desks of the approved art; the middle row (members 5 and 6) stays the aisle between them
    furniture += [slot['desk']['green']['fp'] for room in rooms for slot in room['slots'][:4]]
    furniture.append(emi['desk']['green']['fp'])
    for x0, y0, x1, y1 in furniture:
        for tx in covered(x0, x1):
            for ty in covered(y0, y1):
                blocked.add((tx, ty))

    layout = {
        'tile': TS,
        'size': [W // TS, D // TS],
        'canvas': [SW, SH],
        'origin': [OX, OY],
        'base': 'project-base.png',
        'static': static,
        'walls': walls,
        'blocked': sorted([list(t) for t in blocked]),
        'rooms': rooms,
        'emi': emi,
        'meeting': meeting,
        'director': {'rect': [18, 7, 24, 18], 'plate': emi['plate']},
        'lounge': {'rect': [11, 0, 24, 7], 'plate': [lpx, int(lpy)]},
        'elevator': {'tile': [17, 1], 'point': [17.5, 0.45], 'door': [P.ELEVATOR[0], P.ELEVATOR[1], 50]},
    }
    with open(os.path.join(APP, 'project.json'), 'w', encoding='utf8') as f:
        json.dump(layout, f, separators=(',', ':'), ensure_ascii=False)

    # ---------- characters, bubbles, shadow, floor tiles ----------
    for vi in range(len(VARIANTS)):
        for d in DIRS:
            for fr in ('idle', 'walkA', 'walkB'):
                atlas.put(f'char/{vi}/{d}/{fr}', sprite(vi, d, fr))
        for d, fr in (('BL', 'sitB'), ('BR', 'sitB'), ('FL', 'sitF'), ('FR', 'sitF')):
            atlas.put(f'char/{vi}/{d}/{fr}', sprite(vi, d, fr))
    anchors = {}
    small = Layer(64, 64, 0, 0, (0, 0, 0, 0))
    for kind, name in (('...', 'dots'), ('!', 'bang'), ('?', 'ask'), ('ok', 'ok')):
        img, x0, y0 = render(small, lambda: F.bubble(small, 40, 40, kind), (64, 64))
        anchors[atlas.put(f'bubble/{name}', img)] = [40 - x0, 40 - y0]
    img, x0, y0 = render(small, lambda: (small.begin(), small.ell(32, 32, 6, 2.5, (40, 30, 30, 70)), small.end(False)),
                         (64, 64))
    anchors[atlas.put('shadow', img)] = [32 - x0, 32 - y0]
    for name, fn in (('oak', OAK), ('walnut', WALNUT), ('slate', P.SLATE), ('warmg', P.WARMG), ('sage', P.SAGE)):
        t = Layer(32, 16, 16, 0, (0, 0, 0, 0))
        draw_floor(t, 16, 16, lambda x, y, fn=fn: fn(x + 32, y + 32), slab=False)
        atlas.put(f'tile/{name}', t.img)
    atlas.save(os.path.join(APP, 'atlas.png'), os.path.join(APP, 'atlas.json'))
    with open(os.path.join(APP, 'atlas.json'), encoding='utf8') as f:
        data = json.load(f)
    data['anchors'] = anchors
    with open(os.path.join(APP, 'atlas.json'), 'w', encoding='utf8') as f:
        json.dump(data, f, separators=(',', ':'))

    # ---------- characters as palette letters, recoloured by the app with each look ----------
    known = set(palette(0))

    def rows(style, d, fr):
        g = letters(style, d[0], fr, mirror=d[1] == 'R')
        cell = lambda r, c: '2' if g.get((r, c)) == 'B2' else g[(r, c)] if g.get((r, c)) in known else '.'
        return [''.join(cell(r, c) for c in range(SW2)) for r in range(SH2)]

    chars = {'w': SW2, 'h': SH2, 'cuts': CUTS, 'frames': [f'{d}/{f}' for d, f in CHAR_FRAMES],
             'grids': {cut: [rows(cut, d, f) for d, f in CHAR_FRAMES] for cut in CUTS}}
    with open(os.path.join(APP, 'chars.json'), 'w', encoding='utf8') as f:
        json.dump(chars, f, separators=(',', ':'))
    # what the generator paints for a few variants, so the tests check the app's recolouring pixel by pixel
    hexa = lambda c: '%02x%02x%02x%02x' % tuple(c)
    refs = []
    for vi, d, fr in ((0, 'FL', 'idle'), (0, 'BR', 'walkA'), (2, 'FR', 'sitF'), (3, 'BL', 'sitB')):
        pal = palette(vi)
        img = sprite(vi, d, fr)
        refs.append({'cut': VARIANTS[vi][1], 'frame': f'{d}/{fr}',
                     'palette': {('2' if k == 'B2' else k): hexa(v)[:6] for k, v in pal.items()},
                     'pixels': [hexa(img.getpixel((x, y))) for y in range(SH2) for x in range(SW2)]})
    os.makedirs(TESTS, exist_ok=True)
    with open(os.path.join(TESTS, 'pixel-chars-ref.json'), 'w', encoding='utf8') as f:
        json.dump(refs, f, separators=(',', ':'))

    print('atlas:', len(atlas.frames), 'frames ->', APP)


if __name__ == '__main__':
    main()
