"""Exports what the app draws (src/renderer/src/assets/pixel/):

  atlas.png + atlas.json   every sprite: furniture (one frame per CRT state), partitions,
                           chairs (seat and back apart, so a sitter goes between them),
                           characters (8 variants x 4 directions x idle/walkA/walkB + seated),
                           speech bubbles, the floor shadow and one diamond per floor tile
  project-base.png         the project floor's slab, floor, back walls, rugs and elevator
  project.json             the project floor's layout: where each sprite goes on the
                           base canvas, its footprint for depth sorting, the rooms, seats,
                           walls, blocked tiles and spots the game walks to
  casa-base.png            the Casa's slab, floor, back walls, rugs, wall boards and elevator
  casa.json                the Casa's layout: furniture (the clickable pieces carry their
                           action), Luna's table and its chairs, the user's desk and chair,
                           the wall boards, walls, blocked tiles, tags and spots
  estudos-base.png         the study floor's slab, floor, back walls, rugs, wall boards and elevator
  estudos.json             the study floor's layout: furniture (the clickable pieces carry their
                           action), the chairs of Cora, Bonnie, the teachers and the user,
                           where the teacher of the turn stands, walls, blocked tiles, tags, zones

Everything is placed at its final pixel position on the native canvas (736x460), so the
app only blits: no half-pixel rounding differs from the approved scene-projeto.png.
World units: 16 per tile (x right-down, y left-down, z up); the app's tiles are units / 16.
"""
import hashlib
import json
import os
from PIL import Image
from px import H, add_outline
import furn as F
from floorkit import SW, SH, OX, OY, TS, W, D, WALL_H, PART_H, Scene, new_layer, OAK, WALNUT, draw_floor, Layer
import scene_projeto as P
import scene_casa2 as C
import scene_estudos as E
from desks import ws_back, ws_front_x, ws_front_y, ws_front_shift
from chars import sprite, VARIANTS, palette

APP = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                   'src', 'renderer', 'src', 'assets', 'pixel')
STATES = ('green', 'amber', 'red', 'off')
DIRS = ('FL', 'FR', 'BL', 'BR')
# the way a sitter looks -> sprite direction and seated frame
SIT = {'+x': ('FR', 'sitF'), '-x': ('BL', 'sitB'), '+y': ('FL', 'sitF'), '-y': ('BR', 'sitB')}


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
        # glass walls that stand in the middle of a row or column of tiles: they block those tiles
        s.half = []

    def add(s, fp, fn, shadow=False):
        super().add(fp, fn, shadow)
        s.rec.append((s.kind, tuple(fp), s.items[-1][1]))

    def take(s):
        out, s.rec = s.rec, []
        return out

    def gx(s, x0, x1, yp, doors=(), **k):
        if yp % TS:
            s.half.append(('z', yp // TS, x0, x1, door_tiles(doors)))
        else:
            s.walls.append({'axis': 'z', 'at': yp // TS, 'from': x0 // TS, 'to': x1 // TS, 'doors': door_tiles(doors)})
        kind, s.kind = s.kind, 'wall'
        super().gx(x0, x1, yp, doors, **k)
        s.kind = kind

    def wy(s, y0, y1, xp, doors=()):
        s.walls.append({'axis': 'x', 'at': xp // TS, 'from': y0 // TS, 'to': y1 // TS, 'doors': door_tiles(doors)})
        kind, s.kind = s.kind, 'wall'
        super().wy(y0, y1, xp, doors)
        s.kind = kind

    def gy(s, y0, y1, xp, doors=(), **k):
        if xp % TS:
            s.half.append(('x', xp // TS, y0, y1, door_tiles(doors)))
        else:
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


def covered(a, b):
    """tiles an extent covers: at least half a tile, or the one under its middle when smaller."""
    need = min(TS // 2, (b - a) / 2)
    return [i for i in range(int(a // TS), int((b - 1) // TS) + 1) if min(b, (i + 1) * TS) - max(a, i * TS) >= need]


def blocked_by(footprints):
    out = set()
    for x0, y0, x1, y1 in footprints:
        for tx in covered(x0, x1):
            for ty in covered(y0, y1):
                out.add((tx, ty))
    return sorted([list(t) for t in out])


def render(L, fn, size=(SW, SH)):
    """runs fn on an empty layer; returns (cropped image, left, top) or None."""
    keep = L.img
    L.img = Image.new('RGBA', size, (0, 0, 0, 0))
    fn()
    img, L.img = L.img, keep
    bb = img.getbbox()
    return (img.crop(bb), bb[0], bb[1]) if bb else None


def elevator_doors(place, name, x0, x1):
    """the elevator doors half open and open: drawn over the base while someone arrives or leaves."""
    return [{k: v for k, v in place(f'{name}/elevator{i}', lambda k=k: F.elevator_open_y(place.L, 0, x0, x1, k),
                                    (x0, 0, x1, 1)).items() if k != 'fp'} for i, k in enumerate((0.5, 1.0))]


# the skull that strikes a dismissed agent, the ghost that rises from it and the puff of the hit
FX = {
    'skull': ({'X': 'efe6d2', 'x': 'cfc4ad', 'O': 'ff3b5c', 'W': '3a2f3a'}, [
        "..XXXXXXX..",
        ".XXXXXXXXXx",
        "XXXXXXXXXXx",
        "XXOOXXXOOXx",
        "XXOOXXXOOXx",
        "XXXXXWXXXXx",
        ".XXXXXXXXx.",
        "..XWXWXWx..",
        "..XXXXXxx..",
    ]),
    'ghost': ({'X': 'f4f2ff', 'x': 'd6d2ec', 'E': '1d1b26'}, [
        "...XXXX...",
        "..XXXXXX..",
        ".XXXXXXXx.",
        ".XEXXEXXx.",
        ".XEXXEXXx.",
        ".XXXXXXXx.",
        ".XXXXXXXx.",
        ".XXXXXXXx.",
        ".XXXXXXXx.",
        ".XX.XX.Xx.",
        ".X...X..x.",
    ]),
    'puff': ({'X': '7a5cc4', 'x': '4b3a66'}, [
        "..XXXX...",
        ".XXXXXXx.",
        "XXXXXXXxx",
        "XXXXXXxxx",
        ".XXXXxxx.",
        "..xxxx...",
    ]),
}


def fx(name):
    pal, rows = FX[name]
    img = Image.new('RGBA', (len(rows[0]), len(rows)), (0, 0, 0, 0))
    for r, row in enumerate(rows):
        for c, ch in enumerate(row):
            if ch in pal:
                img.putpixel((c, r), H(pal[ch]))
    big = Image.new('RGBA', (img.width + 2, img.height + 2), (0, 0, 0, 0))
    big.paste(img, (1, 1))
    add_outline(big)
    return big


def main():
    os.makedirs(APP, exist_ok=True)
    atlas = Atlas()
    L = new_layer()

    def place(name, fn, fp):
        got = render(L, fn)
        x0, y0, x1, y1 = fp
        return {'f': atlas.put(name, got[0]), 'x': got[1], 'y': got[2], 'fp': [x0, y0, x1, y1]}
    place.L = L

    def items(name, recs):
        out = []
        for i, (kind, fp, fn) in enumerate(recs):
            it = place(f'{name}/{i}', fn, fp)
            if kind == 'wall':
                it['wall'] = True  # walls block tile edges, not tiles
            out.append(it)
        return out

    def seat(name, x, y, face, wood=False, col=None):
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
            'seat': place(f'{name}/seat', lambda: draw(L, x, y, face, 'seat', *([col] if col else [])), fp),
            'back': place(f'{name}/back', lambda: draw(L, x, y, face, 'back', *([col] if col else [])), fp),
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
                'seat': seat(f'room{r}/coord', cx0 - 12, cy0 + 34 - 13, '+x', col=F.CHAIRS[P.ROOM_CHAIRS[r][6]]),
                'plate': [cpx, int(cpy) - 6],
            },
            'slots': [],
        }
        for i, (x, y) in enumerate(P.slots(ry0, h)):
            sx, sy = x + 16, y + 3
            ipx, ipy = L.P(sx + 5 + 6, sy + 5 + 6, 30)
            room['slots'].append({
                'desk': desk(f'room{r}/slot{i}', lambda s, st, x=x, y=y: ws_back(s, x, y, None, st)),
                'seat': seat(f'room{r}/slot{i}', sx, sy, '-x', col=F.CHAIRS[P.ROOM_CHAIRS[r][i]]),
                'plate': [ipx + 26, int(ipy) + 2],
            })
        rooms.append(room)

    # ---------- Emi and the meeting room ----------
    ex, ey, ew = P.EMI_DESK
    epx, epy = L.P(336, 282, 0)
    emi = {
        'desk': desk('emi', lambda s, st: ws_back(s, ex, ey, None, st, d_=ew)),
        'seat': seat('emi', ex + 16, ey + (ew - 26) // 2 + 3, '-x', col=F.CHAIRS[P.EMI_CHAIR]),
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
    blocked = set()
    furniture = [it['fp'] for it in static if not it.get('wall')]
    furniture += [room['coordinator']['desk']['green']['fp'] for room in rooms]
    # all six member desks: 5 and 6 stand against the far wall, so the middle rows stay the aisle
    furniture += [slot['desk']['green']['fp'] for room in rooms for slot in room['slots']]
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
        'elevator': {'tile': [17, 1], 'point': [17.5, 0.45], 'door': [P.ELEVATOR[0], P.ELEVATOR[1], 50],
                     'open': elevator_doors(place, 'project', *P.ELEVATOR)},
    }
    with open(os.path.join(APP, 'project.json'), 'w', encoding='utf8') as f:
        json.dump(layout, f, separators=(',', ':'), ensure_ascii=False)

    casa(L, place, items, seat)
    estudos(L, place, items, seat)

    # ---------- characters, bubbles, shadow, floor tiles ----------
    for vi in range(len(VARIANTS)):
        for d in DIRS:
            for fr in ('idle', 'walkA', 'walkB'):
                atlas.put(f'char/{vi}/{d}/{fr}', sprite(vi, d, fr))
        for d, fr in (('BL', 'sitB'), ('BR', 'sitB'), ('FL', 'sitF'), ('FR', 'sitF'),
                      ('BL', 'typeB'), ('BR', 'typeB'), ('FL', 'typeF'), ('FR', 'typeF')):
            atlas.put(f'char/{vi}/{d}/{fr}', sprite(vi, d, fr))
        # knocked out by the skull: flat on the floor
        atlas.put(f'char/{vi}/down', sprite(vi, 'FL', 'idle').rotate(90, expand=True))
    for name in FX:
        atlas.put(f'fx/{name}', fx(name))
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
    data['palettes'] = [palette(vi) for vi in range(len(VARIANTS))]
    with open(os.path.join(APP, 'atlas.json'), 'w', encoding='utf8') as f:
        json.dump(data, f, separators=(',', ':'))

    print('atlas:', len(atlas.frames), 'frames ->', APP)


def casa(L, place, items, seat):
    """casa-base.png + casa.json: the ground floor, from scene_casa2.py."""
    base = new_layer()
    C.shell(base)
    base.img.save(os.path.join(APP, 'casa-base.png'), optimize=True)

    sc = Capture(L)
    C.entrance(sc)
    C.half_wall(sc, 0)
    C.half_wall(sc, 1)
    C.office(sc)
    for i, (dx, dy) in enumerate(C.DESKS):
        sc.add((dx, dy, dx + 14, dy + C.DESK_D), lambda dx=dx, dy=dy, i=i: C.work_desk(L, dx, dy, C.TABLE_LOOK[i][1]), True)
    x, y, w = C.VOCE_DESK
    ws_front_y(sc, x, y, None, C.VOCE_LOOK[1], w=w, centered=True)
    sc.rec.pop()  # the user's chair is a seat below
    C.voce_corner(sc)
    C.media(sc, people=False)
    static = items('casa', sc.take())
    # what a click on a piece of furniture does
    acts = {C.SKULL: 'skull', C.RADIO: 'radio', C.TOTEM: 'totem', C.WRITING: 'writing', C.FILMS_TV: 'films',
            (292, 114, 306, 154): 'films', (x, y, x + w, y + 14): 'computer'}
    acts.update({fp: 'games' for fp in C.ARCADES})
    acts.update({fp: 'books' for fp in C.SHELVES})
    for it in static:
        act = acts.get(tuple(it['fp']))
        if act:
            it['act'] = act

    def box(fn):
        img, bx, by = render(L, fn)
        return [bx, by, img.width, img.height]

    # the boards hang on the back wall: drawn in the base, clicked by their box
    hot = [{'act': act, 'box': box(lambda a=a, b=b: C.board(L, a, b))} for a, b, act, _n in C.BOARDS]
    # tags (HTML) over the clickable things: art units x, y and height
    tags = {n: [(a + b) / 2, 0, 46] for a, b, _act, n in C.BOARDS}
    tags.update({
        'Claude FM': [C.RADIO[0] + 6, C.RADIO[1] + 17, 34], 'Caveira': [150, 24, 34], 'Rotinas de agentes': [2, 176, 46],
        'Novo agente': [70, 270, 40], 'Livros': [306, 4, 44], 'Escrita': [(C.WRITING[0] + C.WRITING[2]) / 2, C.WRITING[1] + 18, 30],
        'Filmes': [233, 133, 34], 'Jogos': [233, 238, 38], 'Gastos': [218, 0, 54], 'Alarme': [168, 0, 54],
    })
    # Luna's chair first, then the residents' in the order the approved art fills them
    seats = [seat(f'casa/table{i}', *C.TABLE_SEATS[i], col=F.CHAIRS[C.TABLE_LOOK[i][0]]) for i in C.SEAT_ORDER]
    walls = sc.walls
    blocked = blocked_by([it['fp'] for it in static if not it.get('wall')])
    ex0, ex1 = C.ELEVATOR
    # the screen of the Claude FM console (top-left, top-right, bottom-left), facing +x
    rx, ry = C.RADIO[:2]
    # the sofa spots of the lounge corners: where a resting agent is drawn seated. The backrest
    # is on the near side (sofa_mx), so the sitter sorts just behind the sofa.
    couch = []
    for hx, hy, look, kind in C.HANG:
        if kind != 'sit':
            continue
        sofa = next(it['fp'] for it in static if it['fp'][0] <= hx < it['fp'][2] and it['fp'][1] <= hy < it['fp'][3])
        dx, dy = look[0] - hx, look[1] - hy
        face = ('+x' if dx > 0 else '-x') if abs(dx) >= abs(dy) else ('+y' if dy > 0 else '-y')
        direction, frame = SIT[face]
        px, py = L.P(hx, hy, 7)
        couch.append({'at': [hx, hy], 'fp': [sofa[0] - 4, hy - 2, sofa[0], hy + 2], 'sit': [int(px - 12), int(py - 28)],
                      'head': [int(px) + 3, int(py) - 24], 'dir': direction, 'pose': frame})
    tv = [[rx + 10, ry + 26, 28], [rx + 10, ry + 8, 28], [rx + 10, ry + 26, 18]]
    layout = {
        'tile': TS,
        'size': [W // TS, D // TS],
        'canvas': [SW, SH],
        'origin': [OX, OY],
        'base': 'casa-base.png',
        'static': static,
        'walls': walls,
        'blocked': blocked,
        'hot': hot,
        'tags': tags,
        'tv': tv,
        'table': {'center': [C.TABLE[0] + C.TABLE[2] / 2, C.TABLE[1] + C.TABLE[3] / 2], 'seats': seats},
        'voce': {'seat': seat('casa/voce', x + w - 13 - ws_front_shift(w, True), y - 12, '+y', col=F.CHAIRS[C.VOCE_LOOK[0]]), 'desk': [x, y, x + w, y + 14]},
        'hang': [{'at': [hx, hy], 'look': list(look), 'kind': kind} for hx, hy, look, kind in C.HANG],
        'zones': [{'name': n, 'rect': list(r)} for n, r in C.ZONES],
        'elevator': {'tile': [ex0 // TS, 1], 'point': [(ex0 + ex1) / 2 / TS, 0.45], 'door': [ex0, ex1, 40],
                     'open': elevator_doors(place, 'casa', ex0, ex1)},
        'couch': couch,
        # the routines board on the west wall (plane x=0): y0, y1, z0, z1; the app draws the next routine there
        'totem': list(C.TOTEM_WALL),
        # the window glass on the west wall (plane x=0): y0, y1, z0, z1; the app paints the sky for the hour
        'window': list(C.WINDOW),
    }
    with open(os.path.join(APP, 'casa.json'), 'w', encoding='utf8') as f:
        json.dump(layout, f, separators=(',', ':'), ensure_ascii=False)


def estudos(L, place, items, seat):
    """estudos-base.png + estudos.json: the study floor, from scene_estudos.py."""
    base = new_layer()
    E.shell(base)
    base.img.save(os.path.join(APP, 'estudos-base.png'), optimize=True)

    sc = Capture(L)
    E.hall(sc)
    E.library_walls(sc)
    E.library(sc)
    for name, (x, y, w) in (('cora', E.CORA_DESK), ('bonnie', E.BONNIE_DESK)):
        ws_front_y(sc, x, y, None, E.LOOK[name][1], w=w, centered=True)
        sc.rec.pop()  # the chair is a seat below
    E.library_plant(sc)
    E.diretoria_walls(sc)
    E.diretoria(sc)
    E.diretoria_front(sc, chairs=False)
    E.teachers_walls(sc)
    E.teachers_room(sc)
    E.teachers_plants(sc)
    E.classroom_front(sc)
    E.classroom(sc, people=False)
    E.notes_walls(sc)
    E.notes(sc, people=False)
    static = items('estudos', sc.take())
    # what a click on a piece of furniture does
    acts = {fp: 'library' for fp in E.LIB_SHELVES + [E.CLASS_SHELF, E.NOTE_SHELF]}
    acts.update({E.BOARD: 'cycle', E.STUDENT_DESK: 'desk', E.POSTER: 'questions', E.PROF_CABINET: 'questions',
                 E.NOTES_DESK: 'cards', E.CARDS_TABLE: 'cards'})
    acts.update({fp: 'cards' for fp in E.NOTE_CABINETS})
    for name, (x, y, w) in (('cora', E.CORA_DESK), ('bonnie', E.BONNIE_DESK)):
        acts[(x, y, x + w, y + 14)] = name
    for it in static:
        act = acts.get(tuple(it['fp']))
        if act:
            it['act'] = act

    def box(fn):
        img, bx, by = render(L, fn)
        return [bx, by, img.width, img.height]

    # the class schedule hangs on the west wall: drawn in the base, clicked by its box
    hot = [{'act': 'schedule', 'box': box(lambda: E.schedule(L))}]
    # the study trail board hangs on the back wall of the diretoria, behind Bonnie: clicked by its box
    hot.append({'act': 'trail', 'box': box(lambda: E.trail_board(L))})
    # half walls block the tiles they stand on, but their doors
    half = set()
    for axis, at, a, b, doors in sc.half:
        for i in range(a // TS, -(-b // TS)):
            if i not in doors:
                half.add((at, i) if axis == 'x' else (i, at))
    blocked = sorted(set(map(tuple, blocked_by([it['fp'] for it in static if not it.get('wall')]))) | half)

    def wood(name, spots):
        return [seat(f'estudos/{name}{i}', x, y, face, wood=True) for i, (x, y, face) in enumerate(spots)]

    cx, cy, cw = E.CORA_DESK
    bx, by, bw = E.BONNIE_DESK
    sx, sy, sface = E.STUDENT_SEAT
    tx, ty = E.TUTOR_AT
    d0 = E.STUDENT_DESK
    ex0, ex1 = E.ELEVATOR
    layout = {
        'tile': TS,
        'size': [W // TS, D // TS],
        'canvas': [SW, SH],
        'origin': [OX, OY],
        'base': 'estudos-base.png',
        'static': static,
        'walls': sc.walls,
        'blocked': [list(t) for t in blocked],
        'hot': hot,
        # HTML tags over the clickable things: art units x, y and height
        'tags': {
            'Biblioteca': [72, 4, 40], 'Tópico atual': [126, 152, 46], 'Horário de aula': [0, 188, 46],
            'Questões': [163, 153, 34], 'Sua carteira': [148, 212, 26], 'Notas e cartões': [316, 212, 26],
            'Trilha de estudos': [(E.TRAIL[0] + E.TRAIL[1]) / 2, 0, E.TRAIL[3] + 6],
        },
        'cora': seat('estudos/cora', cx + cw - 13 - ws_front_shift(cw, True), cy - 12, '+y', col=F.CHAIRS[E.LOOK['cora'][0]]),
        'bonnie': seat('estudos/bonnie', bx + bw - 13 - ws_front_shift(bw, True), by - 12, '+y', col=F.CHAIRS[E.LOOK['bonnie'][0]]),
        'visitors': wood('visit', E.VISIT_SEATS),
        'teachers': wood('teacher', E.TEACHER_SEATS),
        'student': {'seat': seat('estudos/student', sx, sy, sface), 'desk': list(d0)},
        'notes': wood('notes', [E.NOTE_SEAT])[0],
        'class': {'at': [tx, ty], 'look': [(d0[0] + d0[2]) / 2, (d0[1] + d0[3]) / 2]},
        'zones': [{'name': n, 'rect': list(r)} for n, r in E.ZONES],
        'elevator': {'tile': [ex0 // TS, 1], 'point': [(ex0 + ex1) / 2 / TS, 0.45], 'door': [ex0, ex1, 40],
                     'open': elevator_doors(place, 'estudos', ex0, ex1)},
    }
    with open(os.path.join(APP, 'estudos.json'), 'w', encoding='utf8') as f:
        json.dump(layout, f, separators=(',', ':'), ensure_ascii=False)


if __name__ == '__main__':
    main()
