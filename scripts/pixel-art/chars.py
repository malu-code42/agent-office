"""Chibi agents, 24x32 cells. Base views drawn facing front-left (F) / back-left (B); right = mirror."""
from PIL import Image, ImageOps
from px import H, OUT, add_outline

W, HT = 24, 32          # design grid; sprites are rendered 2x (48x64) via Scale2x + detail pass
SW2, SH2 = 24, 32

FACE = (5, [
    "........SSSSSSSS........",
    "......SSSSSSSSSSSS......",
    ".....SSSSSSSSSSSSSS.....",
    ".....SSSSSSSSSSSSSS.....",
    ".....SSSSSSSSSSSSSS.....",
    ".....SSSSSSSSSSSSSS.....",
    ".....SSSEESSEESSSSS.....",
    ".....SSSEESSEESSSSS.....",
    ".....SSbSSSSSbSSSSS.....",
    ".....SSSSSMSSSSSSSS.....",
    "......SSSSSSSSSSSS......",
    "........SSSSSSSS........",
])

IDLE = [
    "...........SS...........",
    ".........CWSSWC.........",
    "........CCCCCCCC........",
    ".......CCOCCCCOCC.......",
    ".......CCOCCCCOCC.......",
    ".......CCOCCCCOCC.......",
    ".......SSOCCCCOSS.......",
    ".........PPPPPP.........",
    ".........PPOPPP.........",
    ".........PPOPPP.........",
    ".........PPOPPP.........",
    "........BBBOBBB.........",
]
WALKA = [
    "...........SS...........",
    ".........CWSSWC.........",
    "........CCCCCCCC........",
    ".......CCOCCCCOCC.......",
    "......CCOCCCCCOCC.......",
    "......CCOCCCCCOCC.......",
    "......SS.OCCCCOCC.......",
    ".........PPPPPP.........",
    "........PPP.PPP.........",
    "........PP...PP.........",
    "........PP..BBB.........",
    ".......BBB..............",
]
WALKB = [
    "...........SS...........",
    ".........CWSSWC.........",
    "........CCCCCCCC........",
    ".......CCOCCCCOCC.......",
    ".......CCOCCCCCOCC......",
    ".......CCOCCCCCOCC......",
    ".......CCOCCCCO.SS......",
    ".........PPPPPP.........",
    ".........PPP.PPP........",
    ".........PP...PP........",
    ".........PP..BBB........",
    "........BBB.............",
]


def _back(rows):
    rows = [r.replace('W', 'C') for r in rows]
    rows[2] = rows[2].replace('CCCCCCCC', 'CCCYYCCC')  # back seam / shoulder yoke
    rows[3] = rows[3].replace('OCCCCO', 'OCCYCO')
    return rows


BODY = {
    'idle': (17, IDLE), 'walkA': (17, WALKA), 'walkB': (17, WALKB),
    'sitB': (20, [
        "...........SS...........",
        ".........CCCCCC.........",
        "........CCCYCCCC........",
        ".......CCCCYCCCCC.......",
        "......CCOCCYCCCOCC......",
        "......CCOCCCCCCOCC......",
        "........CCCCCCCC........",
        "........PPPPPPPP........",
        ".......PPPPPPPPPP.......",
    ]),
    'sitF': (20, [
        "...........SS...........",
        ".........CWSSWC.........",
        "........CCCCCCCC........",
        ".......CCOCCCCOCC.......",
        ".......CCOCCCCOCC.......",
        "........SSCCCCSS........",
        "........PPPPPPPP........",
        "........PPPPPPPP........",
        "........BBB..BBB........",
    ]),
}
# typing at a desk: the second frame of a two-frame loop with sitF / sitB (a hand up, an elbow in)
BODY['typeF'] = (20, BODY['sitF'][1][:4] + [
    ".......SSOCCCCOCC.......",
    "..........CCCCSS........",
] + BODY['sitF'][1][6:])
BODY['typeB'] = (20, BODY['sitB'][1][:5] + [
    ".......COCCCCCCOCC......",
] + BODY['sitB'][1][6:])
BODY_BACK = {k: (v[0], _back(v[1])) for k, v in BODY.items() if k in ('idle', 'walkA', 'walkB')}
BODY_BACK['sitB'] = BODY['sitB']
BODY_BACK['typeB'] = BODY['typeB']
HEAD_DY = {'idle': 0, 'walkA': 1, 'walkB': 1, 'sitB': 3, 'sitF': 3, 'typeF': 3, 'typeB': 2}

CAP = (2, [
    "........................",
    ".........HHHHHH.........",
    ".......HHHHHHHHHH.......",
    "......HHLLHHHHHHHH......",
    ".....HHLHHHHHHHHHHH.....",
    "....HHHHHHHHHHHHHHHH....",
    "....HHHHHHHHHHHHHHHH....",
    "....HHHHHHHHHHHHHHHH....",
])
SWEEP = (10, [
    "....HH.HH.HHH.HHHHHH....",
    "....H...........HHHH....",
    ".................HHH....",
    ".................HH.....",
])
LONGF = (10, [
    "....HHHHH.HHH.HHHHHH....",
    "....HH..........HHHH....",
    "....HH..........HHHH....",
    "....HH...........HHHH...",
    "....HH...........HHHH...",
    "....H............HHHH...",
    ".................HHHH...",
])
LONG_BEHIND = (12, [
    "...HH..............HH...",
    "...HH..............HH...",
    "...HHH............HHH...",
    "...HHH............HHH...",
    "...HHHH..........HHHH...",
    "...HHHHH........HHHHH...",
    "....HHHHH......HHHHH....",
    "....HHHH........HHHH....",
    "....HHHH........HHHH....",
    ".....HH..........HH.....",
])
LONG_BACK = (16, [
    ".....HHHHHHHHHHHHHH.....",
    ".....HHHHHHHHHHHHHH.....",
    "......HHHHHHHHHHHH......",
    "......HHHHHHHHHHHH......",
    ".......HHHHHHHHHH.......",
    ".......HHH.HHHH.HH......",
])
BOBF = (10, [
    "....HHHHHHHHHHHHHHHH....",
    "....HHH.........HHHHH...",
    "....HH..........HHHHH...",
    "....HH...........HHHH...",
    "....HH...........HHHH...",
    "....HHH.........HHHHH...",
])
BOB_BACK = (14, [
    "....HHHHHHHHHHHHHHHH....",
    "....HHHHHHHHHHHHHHHH....",
    "....HHHHHHHHHHHHHHHH....",
    ".....HHHHHHHHHHHHHH.....",
])
PONY_BEHIND = (6, [
    "...................AA...",
    "...................HHH..",
    "..................HHHHH.",
    "..................HHHHH.",
    "...................HHHH.",
    "...................HHHH.",
    "....................HHH.",
    "....................HH..",
    "...................HH...",
])
PONY_BACK = (9, [
    "..........AAAA..........",
    "..........hHHh..........",
    ".........hHHHHh.........",
    ".........hHLHHh.........",
    ".........hHHHHh.........",
    ".........hHHHh..........",
    "..........hHHh..........",
    "..........hHHh..........",
    "...........hHh..........",
    "...........hHh..........",
    "...........hHh..........",
    "............h...........",
])
BUN = (0, [
    "..........HHHH..........",
    ".........HHLHHH.........",
    ".........HHHHHH.........",
])
BUN_TIE = (3, [
    "..........AAAA..........",
])
SPIKES = (0, [
    ".........H....H.........",
    "........HH...HH...H.....",
    ".......HHHH.HHHH.HH.....",
    "......HHHHHHHHHHHHH.....",
])
TWIN = (0, [
    "........................",
    ".....HHH........HHH.....",
    "....HHLHH......HHLHH....",
    "....HHHHH......HHHHH....",
    ".....HHH........HHH.....",
])
GLASSES = (10, [
    ".......GGGGGGGG.........",
    ".......G..GG..G.........",
])
HEADSET_F = (3, [
    "..........AAAA..........",
    "........AA....AA........",
    ".......A........A.......",
    "................A.......",
    ".................A......",
    ".................A......",
    ".................A......",
    "................aAAa....",
    "................aAAa....",
    "................aAAa....",
    "...............A........",
    "............AAA.........",
])
HEADSET_B = (3, [
    "..........AAAA..........",
    "........AA....AA........",
    ".......A........A.......",
    "......A..........A......",
    ".....A............A.....",
    ".....A............A.....",
    ".....A............A.....",
    "....aAa..........aAa....",
    "....aAa..........aAa....",
    "....aAa..........aAa....",
])

STYLES = {
    'short':   dict(front=[CAP, SWEEP], behind=[], back=[CAP]),
    'long':    dict(front=[CAP, LONGF], behind=[LONG_BEHIND], back=[CAP, LONG_BACK]),
    'pony':    dict(front=[CAP, SWEEP], behind=[PONY_BEHIND], back=[CAP, PONY_BACK]),
    'bun':     dict(front=[BUN, CAP, SWEEP, BUN_TIE], behind=[], back=[BUN, CAP, BUN_TIE]),
    'spiky':   dict(front=[SPIKES, CAP, SWEEP], behind=[], back=[SPIKES, CAP]),
    'bob':     dict(front=[CAP, BOBF], behind=[], back=[CAP, BOB_BACK]),
    'twin':    dict(front=[TWIN, CAP, BOBF], behind=[], back=[TWIN, CAP, BOB_BACK]),
}

SKINS = {
    'light': ('f7d7b5', 'e3b48e'),
    'peach': ('f2c49b', 'd9a077'),
    'tan':   ('d9a274', 'bb8259'),
    'brown': ('a8714b', '8a5a3a'),
}

# name, style, skin, hair(H,h,L), shirt(C,c), pants(P,p), shoes, acc(A,a), glasses, headset
VARIANTS = [
    ('Dev castanho',  'short', 'light', ('7a4a2e', '5a3420', 'a26a45'), ('86acd8', '6688b6'), ('4f5873', '3b4259'), '5a4038', None, False, False),
    ('Dev cabelo longo', 'long', 'tan', ('3a3340', '27222d', '5a5266'), ('94c9a0', '6fa57d'), ('5c5468', '453f50'), '3f3a40', None, False, False),
    ('Dev rabo-de-cavalo', 'pony', 'light', ('ecc66e', 'c9a14e', 'fae3a0'), ('eca7b8', 'cc8597'), ('56607e', '414a64'), '6b4a3a', ('d95f5f', 'a84444'), False, False),
    ('Dev coque', 'bun', 'brown', ('3b2a24', '2a1d19', '5a4238'), ('f0d27e', 'd0b05c'), ('6a5545', '524033'), '3f3030', ('e8a0b4', 'c47f92'), False, False),
    ('Dev oculos', 'spiky', 'peach', ('66749e', '4c587e', '8a98c2'), ('eeeae0', 'cfc8b8'), ('4a4f5e', '363a47'), '2f3038', None, True, False),
    ('Dev chanel', 'bob', 'light', ('e693a8', 'c47388', 'f6bccb'), ('ad9cd9', '8a7ab8'), ('4f5873', '3b4259'), '5a4038', None, False, False),
    ('Luna', 'long', 'light', ('f0a24e', 'cf7f34', 'ffc983'), ('7cc4bc', '5aa39b'), ('5b5070', '463d58'), '5a4038', ('4a4a5a', '33333f'), False, True),
    ('Emi', 'twin', 'peach', ('5a3d6e', '432c54', '7d5b94'), ('f29a7e', 'd27a60'), ('4a5470', '373f57'), '3f3a40', None, False, False),
]


def _stamp(grid, layer, mirror_ok=True, dy=0, only_empty=False):
    r0, rows = layer
    for i, row in enumerate(rows):
        for c, ch in enumerate(row):
            if ch != '.':
                key = (r0 + i + dy, c)
                if only_empty and key in grid:
                    continue
                grid[key] = ch


GROUP = {'S': 'S', 's': 'S', 'H': 'H', 'h': 'h', 'L': 'H', 'C': 'C', 'c': 'C', 'P': 'P', 'p': 'P', 'Y': 'C'}
SHADE = {'S': ('s', 2), 'C': ('c', 2), 'P': ('p', 1), 'H': ('h', 1)}


def _autoshade(g):
    """light always from the upper-left: shade the right end of every material run."""
    g = {k: (GROUP.get(v, v) if v != 'Y' else 'c') for k, v in g.items()}
    out = dict(g)
    rows = {}
    for (r, c) in g:
        rows.setdefault(r, []).append(c)
    for r, cols in rows.items():
        cols.sort()
        run = []
        for c in cols + [None]:
            ch = g.get((r, c)) if c is not None else None
            if run and (c is None or ch != g[(r, run[-1])] or c != run[-1] + 1):
                base = g[(r, run[-1])]
                if base in SHADE:
                    sh, k = SHADE[base]
                    k = k if len(run) >= 5 else 1
                    for cc in run[-k:]:
                        out[(r, cc)] = sh
                run = []
            if c is not None:
                run.append(c)
    # hair: dark where it meets skin below or ends; highlight band upper-left
    for (r, c), ch in g.items():
        if ch != 'H':
            continue
        below = g.get((r + 1, c))
        if below in ('S', 'E', 'b', 'M', None):
            out[(r, c)] = 'h'
    hair = [k for k, v in g.items() if v == 'H']
    if hair:
        top = min(r for r, _ in hair)
        for r in (top + 2, top + 3):
            cs = sorted(c for rr, c in hair if rr == r)
            if cs:
                for c in cs[2:4] if r == top + 2 else cs[1:2]:
                    out[(r, c)] = 'L'
    return out


def make(vi, view, frame, mirror=False):
    """view: 'F' front, 'B' back. Built facing left; mirror=True flips geometry then re-shades."""
    name, style, skin, hair, shirt, pants, shoes, acc, glasses, headset = VARIANTS[vi]
    st = STYLES[style]
    hdy = HEAD_DY[frame]
    g = {}
    if view == 'F':
        for l in st['behind']:
            _stamp(g, l, dy=hdy)
        _stamp(g, BODY[frame])
        _stamp(g, FACE, dy=hdy)
        for l in st['front']:
            _stamp(g, l, dy=hdy)
        if glasses:
            _stamp(g, GLASSES, dy=hdy)
        if headset:
            _stamp(g, HEADSET_F, dy=hdy)
    else:
        _stamp(g, BODY_BACK[frame])
        oval = {}
        _stamp(oval, FACE, dy=hdy)
        for k in oval:
            g[k] = 'H'
        for l in st['back']:
            _stamp(g, l, dy=hdy)
        g[(12 + hdy, 5)] = 'S'; g[(13 + hdy, 5)] = 'S'  # ear
        if headset:
            _stamp(g, HEADSET_B, dy=hdy)
    if mirror:
        g = {(r, W - 1 - c): v for (r, c), v in g.items()}
    g = _autoshade(g)
    g2 = _detail(g, view == 'F', False)
    sk = SKINS[skin]
    base = {
        'S': H(sk[0]), 's': H(sk[1]), 'E': H('2e2635'), 'M': H('a8525a'), 'b': H('f4b0aa'),
        'H': H(hair[0]), 'h': H(hair[1]), 'L': H(hair[2]),
        'C': H(shirt[0]), 'c': H(shirt[1]), 'P': H(pants[0]), 'p': H(pants[1]), 'B': H(shoes),
        'O': OUT, 'G': H('6b5560'), 'W': H('ffffff'), 'w': H('fbf6ea'),
        'A': H(acc[0]) if acc else H('d95f5f'), 'a': H(acc[1]) if acc else H('a84444'),
    }
    pal = _full(base)
    img = Image.new('RGBA', (SW2, SH2), (0, 0, 0, 0))
    px = img.load()
    for (r, c), ch in g2.items():
        if 0 <= r < SH2 and 0 <= c < SW2 and ch in pal:
            px[c, r] = pal[ch]
    add_outline(img)
    return img


def _full(base):
    """the base colours plus the mid tones, folds, deep hair and shoe highlight made from them."""
    mix = lambda c, d, t=.5: tuple(int(c[i] * (1 - t) + d[i] * t) for i in range(3)) + (255,)
    pal = dict(base)
    for m, (x, y) in MIDS.items():
        pal[m] = mix(base[x], base[y])
    pal['x'] = mix(base['c'], OUT, .35)   # shirt folds
    pal['y'] = mix(base['p'], OUT, .35)
    pal['z'] = mix(base['h'], OUT, .3)    # hair deep
    pal['B2'] = mix(base['B'], (255, 255, 255, 255), .2)
    return pal


# the colours a Look repaints (the app recolours the sprites by role): role -> the base it follows
ROLES = {'S': 'S', 's': 'S', 'q': 'S', 'H': 'H', 'h': 'H', 'L': 'H', 'k': 'H', 'z': 'H',
         'C': 'C', 'c': 'C', 'r': 'C', 'x': 'C', 'P': 'P', 'p': 'P', 't': 'P', 'y': 'P', 'B': 'B', 'B2': 'B'}


def palette(vi):
    """the colour of each repaintable role of a variant, as hex."""
    _n, _st, skin, hair, shirt, pants, shoes, *_ = VARIANTS[vi]
    sk = SKINS[skin]
    base = {'S': H(sk[0]), 's': H(sk[1]), 'H': H(hair[0]), 'h': H(hair[1]), 'L': H(hair[2]),
            'C': H(shirt[0]), 'c': H(shirt[1]), 'P': H(pants[0]), 'p': H(pants[1]), 'B': H(shoes)}
    pal = _full(base)
    return {r: '%02x%02x%02x' % pal[r][:3] for r in ROLES}


MIDS = {'q': ('S', 's'), 'r': ('C', 'c'), 't': ('P', 'p'), 'k': ('H', 'h')}
_MIDOF = {'S': ('s', 'q'), 'C': ('c', 'r'), 'P': ('p', 't'), 'H': ('h', 'k')}


def _scale2x(g):
    out = {}
    for (r, c), P in g.items():
        A, B, C, D = g.get((r - 1, c)), g.get((r, c + 1)), g.get((r, c - 1)), g.get((r + 1, c))
        e0 = C if (C == A and C != D and A != B) else P
        e1 = A if (A == B and A != C and B != D) else P
        e2 = D if (D == C and D != B and C != A) else P
        e3 = B if (B == D and B != A and D != C) else P
        for (dr, dc), v in (((0, 0), e0), ((0, 1), e1), ((1, 0), e2), ((1, 1), e3)):
            if v is not None:
                out[(2 * r + dr, 2 * c + dc)] = v
    return out


def _detail(g, front, glasses):
    out = dict(g)
    # mid tones between base and shade (4-tone ramps)
    for (r, c), v in g.items():
        if v in _MIDOF:
            sh, mid = _MIDOF[v]
            if g.get((r, c + 1)) == sh or g.get((r + 1, c)) == sh:
                out[(r, c)] = mid
    # inner outline lines -> fold / seam tones
    for (r, c), v in g.items():
        if v == 'O':
            nb = [g.get((r + dr, c + dc)) for dr, dc in ((0, 1), (0, -1), (1, 0), (-1, 0))]
            if None in nb:
                continue
            out[(r, c)] = 'y' if any(n in ('P', 'p') for n in nb) else 'x'
    # hair deep tone at the very bottom edge
    for (r, c), v in g.items():
        if v == 'h' and g.get((r + 1, c)) is None:
            out[(r, c)] = 'z'
    # shoe highlight
    for (r, c), v in g.items():
        if v == 'B' and g.get((r - 1, c)) not in ('B',) and g.get((r, c - 1)) == 'B':
            out[(r, c)] = 'B2'
    if front:
        eyes = [(r, c) for (r, c), v in g.items() if v == 'E']
        for r, c in eyes:  # white glint at the top-left of each eye
            if g.get((r - 1, c)) != 'E' and g.get((r, c - 1)) != 'E':
                out[(r, c)] = 'W'
        for (r, c), v in g.items():  # slimmer mouth
            if v == 'M' and g.get((r - 1, c)) == 'M':
                out[(r, c)] = 'S'
        if glasses and eyes:
            blocks = {}
            for r, c in eyes:
                blocks.setdefault(c // 8, []).append((r, c))
            spans = []
            for pts in blocks.values():
                r0 = min(p[0] for p in pts) - 2; r1 = max(p[0] for p in pts) + 2
                c0 = min(p[1] for p in pts) - 3; c1 = max(p[1] for p in pts) + 3
                spans.append((c0, c1, r0))
                for rr in range(r0, r1 + 1):
                    for cc in range(c0, c1 + 1):
                        edge = rr in (r0, r1) or cc in (c0, c1)
                        corner = rr in (r0, r1) and cc in (c0, c1)
                        if edge and not corner and out.get((rr, cc)) in ('S', 's', 'q', 'b'):
                            out[(rr, cc)] = 'G'
            spans.sort()
            if len(spans) == 2:
                for cc in range(spans[0][1] + 1, spans[1][0]):
                    if out.get((spans[0][2] + 1, cc)) in ('S', 's', 'q'):
                        out[(spans[0][2] + 1, cc)] = 'G'
    return out


def sprite(vi, direction, frame):
    """direction: FL, FR, BL, BR (right = re-shaded mirror, light stays upper-left)"""
    return make(vi, direction[0], frame, mirror=direction[1] == 'R')
