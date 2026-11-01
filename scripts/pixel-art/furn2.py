"""Round-2 props (project / casa / study floors)."""
import random
from px import H
from furn import T, WOOD, WOODD, METAL, bush

LED = {'green': H('7be07f'), 'amber': H('f4bb55'), 'red': H('ff5a4a'), 'off': H('6b6f73')}


def boss_desk(L, x, y, w=14, d=30):
    """solid wood 'chefe' desk, front panel on +x."""
    col = T('b98256', '9c6a42', '7d5233')
    L.pbox(x, y, 0, w, d, 11, col)
    L.qx(x + w, y + 3, y + d - 3, 2, 9, H('8a5c38'))
    L.qx(x + w, y + 5, y + d - 5, 4, 7, H('7d5233'))
    L.pbox(x - 1, y - 1, 11, w + 2, d + 2, 2, T('d9a774', 'bd8a5a', '9c6a42'))


def boss_desk_y(L, x, y, w=34, d=14):
    """boss desk long along x, front panel on +y."""
    col = T('b98256', '9c6a42', '7d5233')
    L.pbox(x, y, 0, w, d, 11, col)
    L.qy(y + d, x + 3, x + w - 3, 2, 9, H('8a5c38'))
    L.pbox(x - 1, y - 1, 11, w + 2, d + 2, 2, T('d9a774', 'bd8a5a', '9c6a42'))


def wall_whiteboard_x(L, xp, y0, y1, z0, z1):
    L.begin(); L.qx(xp, y0 - 1, y1 + 1, z0 - 1, z1 + 1, H('9aa1a9')); L.end()
    L.qx(xp, y0, y1, z0, z1, H('fbfbf6'))
    for i, c in enumerate(('4a78c8', 'd65a5a', '4a78c8', '4fa860')):
        zz = z1 - 3 - i * 3
        L.qx(xp, y0 + 2, y0 + 2 + (5 + (i * 7) % 9), zz, zz + 1, H(c))
    L.qx(xp, y1 - 9, y1 - 2, z0 + 3, z0 + 4, H('4fa860'))


def bookshelf_x(L, x, y, d=28, h=34, seed=0):
    """against a west wall, front faces +x."""
    L.pbox(x, y, 0, 8, d, h, WOODD)
    rnd = random.Random(seed * 7 + d + y)
    cols = ['d26a5a', '5f8fc9', 'e8c35a', '6aa86a', 'a07ac0', 'e8915a', 'f0eadc', '4f6a8a']
    for zz in range(2, h - 8, 11):
        L.begin(); L.qx(x + 8, y + 2, y + d - 2, zz, zz + 9, H('6b4a32')); L.end(False)
        by = y + 2
        while by < y + d - 3:
            bw = rnd.choice((2, 2, 3)); bh = rnd.choice((6, 7, 8))
            L.qx(x + 8, by, min(by + bw, y + d - 2), zz, zz + bh, H(rnd.choice(cols)))
            by += bw + (1 if rnd.random() < .2 else 0)


def arcade(L, x, y, body=T('8a7ad0', '6f5fb8', '574a96'), screen=H('6fd0e0')):
    """cabinet against back wall, screen on +y."""
    L.pbox(x, y, 0, 12, 10, 30, body)
    L.begin(); L.qy(y + 10, x + 2, x + 10, 18, 26, H('23262e')); L.end(False)
    L.qy(y + 10, x + 3, x + 9, 21, 22, screen); L.qy(y + 10, x + 4, x + 6, 23, 24, H('f4bb55'))
    L.qy(y + 10, x + 1, x + 11, 27, 29, H('f4bb55'))
    L.pbox(x, y + 10, 12, 12, 4, 3, body)
    L.dot(*[int(v) for v in L.P(x + 3, y + 12, 15)], H('e85a5a'))
    L.dot(*[int(v) for v in L.P(x + 7, y + 12, 15)], H('5aa0e0'))


def foosball(L, x, y):
    for lx, ly in ((x + 1, y + 1), (x + 23, y + 1), (x + 1, y + 11), (x + 23, y + 11)):
        L.pbox(lx, ly, 0, 2, 2, 9, WOODD, outline=False)
    L.pbox(x, y, 9, 26, 14, 4, WOOD)
    L.qz(13, x + 2, y + 2, x + 24, y + 12, H('6fae5c'))
    L.qz(13, x + 12, y + 2, x + 13, y + 12, H('eaf3dc'))
    for i, rx in enumerate(range(x + 4, x + 24, 4)):
        L.pbox(rx, y - 2, 14, 1, 18, 1, METAL, outline=False)
        L.dot(*[int(v) for v in L.P(rx, y + 7, 14)], H('d65a5a') if i % 2 else H('4a78c8'))


def pingpong(L, x, y):
    for lx, ly in ((x + 2, y + 2), (x + 22, y + 2), (x + 2, y + 40), (x + 22, y + 40)):
        L.pbox(lx, ly, 0, 2, 2, 10, T('5a5a62', '45454c', '35353b'), outline=False)
    L.pbox(x, y, 10, 26, 44, 2, T('4f8fc0', '3a74a0', '2d5c80'))
    L.qz(12, x + 12, y + 1, x + 13, y + 43, H('eaf3fa'))
    L.qz(12, x + 1, y + 1, x + 25, y + 2, H('eaf3fa'))
    L.qz(12, x + 1, y + 42, x + 25, y + 43, H('eaf3fa'))
    L.pbox(x - 1, y + 21, 12, 28, 2, 4, T('f4f4f0', 'dcdcd6', 'c4c4bc'))


def pouf(L, x, y, col):
    L.pbox(x, y, 0, 8, 8, 6, col)


def low_table(L, x, y, w=14, d=10):
    L.pbox(x, y, 0, w, d, 6, WOODD)
    L.pbox(x, y, 6, w, d, 1, WOOD)


def armchair(L, x, y, face='+x', col=T('9fb7d6', '809cc2', '6782a8')):
    if face == '+x':
        L.pbox(x, y, 0, 12, 12, 7, col); L.pbox(x, y, 7, 4, 12, 9, col)
        L.pbox(x + 4, y, 7, 8, 3, 4, col); L.pbox(x + 4, y + 9, 7, 8, 3, 4, col)
    elif face == '+y':
        L.pbox(x, y, 0, 12, 12, 7, col); L.pbox(x, y, 7, 12, 4, 9, col)
        L.pbox(x, y + 4, 7, 3, 8, 4, col); L.pbox(x + 9, y + 4, 7, 3, 8, 4, col)
    elif face == '-y':
        L.pbox(x, y, 0, 12, 12, 7, col)
        L.pbox(x, y, 7, 3, 8, 4, col); L.pbox(x + 9, y, 7, 3, 8, 4, col)
        L.pbox(x, y + 8, 7, 12, 4, 9, col)
    else:  # -x : backrest at high x
        L.pbox(x, y, 0, 12, 12, 7, col)
        L.pbox(x, y, 7, 8, 3, 4, col); L.pbox(x, y + 9, 7, 8, 3, 4, col)
        L.pbox(x + 8, y, 7, 4, 12, 9, col)


def skull_stand(L, x, y):
    """the 'Caveira': skull on a small pedestal."""
    L.pbox(x, y, 0, 8, 8, 14, T('8a6a52', '73563f', '5c4430'))
    L.pbox(x - 1, y - 1, 14, 10, 10, 2, T('a07c60', '8a6a52', '73563f'))
    px, py = [int(v) for v in L.P(x + 4, y + 4, 16)]
    S = L.S
    L.begin(); L.ell(px, py - 6 * S, 5 * S, 5 * S, H('f2ecdc')); L.rect(px - 3 * S, py - 3 * S, 6 * S, 3 * S, H('f2ecdc')); L.end()
    L.ell(px + S, py - 5 * S, 3.5 * S, 3.5 * S, H('ddd4c0'))
    L.ell(px - S, py - 7 * S, 2.5 * S, 2.5 * S, H('fbf8ef'))
    L.ell(px - 2 * S, py - 5 * S, 1.3 * S, 1.3 * S, H('3a2f2a')); L.ell(px + 2 * S, py - 5 * S, 1.3 * S, 1.3 * S, H('3a2f2a'))
    L.rect(px, py - 3 * S, 1, S, H('3a2f2a'))
    for dx in (-2, 0, 2):
        L.rect(px + dx * S, py - S, 1, S, H('8a7f70'))


def typewriter(L, x, y, z):
    L.pbox(x, y, z, 10, 8, 3, T('5c8a7a', '4a7466', '3a5e52'))
    L.pbox(x + 1, y + 1, z + 3, 8, 3, 2, T('5c8a7a', '4a7466', '3a5e52'))
    L.pbox(x + 2, y, z + 5, 6, 1, 5, T('fbf8f0', 'f2ede0', 'dcd5c4'))


def radio_tv(L, x, y):
    """'Claude FM': vintage radio-TV console, front faces +x."""
    L.pbox(x, y, 0, 12, 34, 16, T('b07a4e', '94633c', '774e2e'))
    L.begin(); L.qx(x + 12, y + 3, y + 13, 4, 13, H('d9b98a')); L.end(False)
    for zz in (5, 7, 9, 11):
        L.qx(x + 12, y + 4, y + 12, zz, zz + 1, H('8a6a4a'))
    L.begin(); L.qx(x + 12, y + 16, y + 31, 3, 13, H('2f3a40')); L.end(False)
    L.qx(x + 12, y + 17, y + 30, 8, 12, H('f2a34a'))
    L.qx(x + 12, y + 18, y + 22, 9, 11, H('2f3a40'))
    L.pbox(x + 2, y + 6, 16, 8, 22, 14, T('7d7d88', '62626c', '4d4d56'))
    L.begin(); L.qx(x + 10, y + 8, y + 26, 18, 28, H('8fc6d8')); L.end(False)
    L.qx(x + 10, y + 10, y + 16, 25, 26, H('d6f0f8'))
    L.qx(x + 10, y + 18, y + 24, 20, 21, H('f2a34a'))


def blackboard_y(L, yp, x0, x1, z0, z1):
    L.begin(); L.qy(yp, x0 - 2, x1 + 2, z0 - 2, z1 + 2, H('a07448')); L.end()
    L.qy(yp, x0, x1, z0, z1, H('2f5a46'))
    for i, (a, b) in enumerate(((2, 14), (2, 9), (2, 18), (4, 12))):
        zz = z1 - 3 - i * 3
        L.qy(yp, x0 + a, min(x0 + b, x1 - 1), zz, zz + 1, H('e8efe6'))
    L.qy(yp, x1 - 8, x1 - 3, z0 + 3, z0 + 4, H('f2cf5b'))


def blackboard_x(L, xp, y0, y1, z0, z1):
    L.begin(); L.qx(xp, y0 - 2, y1 + 2, z0 - 2, z1 + 2, H('a07448')); L.end()
    L.qx(xp, y0, y1, z0, z1, H('2f5a46'))
    for i, (a, b) in enumerate(((2, 14), (2, 9), (2, 18), (4, 12))):
        zz = z1 - 3 - i * 3
        L.qx(xp, y0 + a, min(y0 + b, y1 - 1), zz, zz + 1, H('e8efe6'))
    L.qx(xp, y1 - 8, y1 - 3, z0 + 3, z0 + 4, H('f2cf5b'))


def schedule_x(L, xp, y0, y1, z0, z1):
    """'Horario de aula' grid board on a west wall."""
    L.begin(); L.qx(xp, y0 - 1, y1 + 1, z0 - 1, z1 + 1, H('6b4a32')); L.end()
    L.qx(xp, y0, y1, z0, z1, H('fbf6ea'))
    L.qx(xp, y0, y1, z1 - 3, z1, H('5f9a72'))
    cols = ['f2b8c0', 'a9d6ec', 'f6e27a', 'b9e0a8', 'd9c4f0']
    rnd = random.Random(5)
    for cy in range(y0 + 1, y1 - 3, 5):
        for rz in range(z0 + 1, z1 - 5, 4):
            if rnd.random() < .7:
                L.qx(xp, cy, cy + 4, rz, rz + 3, H(rnd.choice(cols)))


def trail_board_y(L, yp, x0, x1, z0, z1):
    """'Trilha de estudos' board on a back wall: a header strip, three lists of topic cards
    (done in green, current in yellow, the rest in paper) joined by a dotted trail."""
    L.begin(); L.qy(yp, x0 - 1, x1 + 1, z0 - 1, z1 + 1, H('6b4a32')); L.end()
    L.qy(yp, x0, x1, z0, z1, H('fbf6ea'))
    L.qy(yp, x0, x1, z1 - 4, z1, H('5f7fb4'))
    cw = (x1 - x0 - 4) // 3
    cards = [('b9e0a8', 'b9e0a8', 'b9e0a8'), ('b9e0a8', 'f6e27a', 'fbe9c8'), ('fbe9c8', 'fbe9c8', 'fbe9c8')]
    for i, column in enumerate(cards):
        cx = x0 + 2 + i * cw
        L.qy(yp, cx, cx + cw - 2, z1 - 7, z1 - 5, H('a8b8d0'))
        for j, c in enumerate(column):
            rz = z1 - 12 - j * 6
            if rz > z0:
                L.qy(yp, cx + 1, cx + cw - 3, rz, rz + 4, H(c))
    # the trail: a dotted line from the first card to the current one
    for k in range(0, cw + 4, 3):
        L.qy(yp, x0 + 4 + k, x0 + 5 + k, z0 + 2, z0 + 3, H('d65a5a'))


def corkboard_x(L, xp, y0, y1, z0, z1):
    L.begin(); L.qx(xp, y0 - 1, y1 + 1, z0 - 1, z1 + 1, H('8a6448')); L.end()
    L.qx(xp, y0, y1, z0, z1, H('d4a36e'))
    for c, a, b, za, zb in (('fbf3e0', 1, 6, 3, 8), ('f6e27a', 8, 13, 9, 14), ('f2b8c0', 15, 20, 4, 9),
                            ('a9d6ec', 3, 8, 11, 15), ('b9e0a8', 14, 20, 11, 15)):
        if y0 + b <= y1:
            L.qx(xp, y0 + a, y0 + b, z0 + za, z0 + zb, H(c))


def planter(L, cx, cy):
    L.pbox(cx - 10, cy - 10, 0, 20, 20, 6, T('d9c8a6', 'c4ae88', 'a8926e'))
    L.qz(6, cx - 8, cy - 8, cx + 8, cy + 8, H('6b4a32'))
    bush(L, cx - 3, cy - 3, 8, 'f2a0b0', 7)
    bush(L, cx + 3, cy + 3, 7, 'f6e27a', 8)


def bench_y(L, x, y, length=28):
    """bench along y, backrest at low x (sits facing +x)."""
    for ly in (y + 2, y + length - 4):
        L.pbox(x + 1, ly, 0, 8, 2, 6, T('5a5a62', '45454c', '35353b'))
    for i in range(3):
        L.pbox(x + 2 + i * 3, y, 6, 2, length, 1, WOOD)
    L.pbox(x, y, 9, 1, length, 3, WOOD)
    L.pbox(x, y, 13, 1, length, 3, WOOD)


def lamp_post(L, x, y):
    L.pbox(x - 1, y - 1, 0, 4, 4, 2, T('4a4f57', '3d424a', '2f3339'))
    L.pbox(x, y, 2, 2, 2, 30, T('4a4f57', '3d424a', '2f3339'), outline=False)
    L.pbox(x - 2, y - 2, 32, 6, 6, 5, T('fff1c4', 'f5dc9a', 'e2c27a'))
    L.pbox(x - 2, y - 2, 37, 6, 6, 1, T('4a4f57', '3d424a', '2f3339'))


def clock_y(L, yp, x, z):
    px, py = [int(v) for v in L.P(x, yp, z)]
    L.begin(); L.ell(px, py, 4 * L.S, 4 * L.S, H('fbf8f0')); L.end()
    L.dot(px, py - 2, H('3a2f2a')); L.dot(px, py - 1, H('3a2f2a')); L.dot(px + 1, py, H('3a2f2a'))


def cards_box(L, x, y, z):
    L.pbox(x, y, z, 8, 5, 3, T('e8d6b0', 'd2bd92', 'b8a276'))
    for i, c in enumerate(('fbf8f0', 'f2b8c0', 'a9d6ec')):
        L.pbox(x + 1 + i * 2, y + 1, z + 3, 2, 3, 2, T(c, c, c), outline=False)


def notebook(L, x, y, z):
    L.pbox(x, y, z, 7, 5, 1, T('fbf8f0', 'e2ddd0', 'cfc8b8'))
    L.qz(z + 1, x + 3, y, x + 4, y + 5, H('d65a5a'))


def laptop(L, x, y, z, face='+y', screen='6fd0e0'):
    """open laptop on a table; `face` is the way its screen looks (the sitter is on that side).
    (x,y) = footprint corner: 8x6 for +y/-y, 6x8 for +x/-x. A screen facing -y/-x shows its lid back."""
    body, lid = T('dfe2e4', 'c2c7cc', 'a2a9b0'), T('8a9098', '6f757d', '565b63')
    if face in ('+y', '-y'):
        ly = y if face == '+y' else y + 5
        if face == '+y':
            L.pbox(x, ly, z + 1, 8, 1, 5, lid)
        L.pbox(x, y, z, 8, 6, 1, body)
        if face == '-y':
            L.pbox(x, ly, z + 1, 8, 1, 5, lid)
        else:
            L.begin(); L.qy(ly + 1, x + 1, x + 7, z + 2, z + 6, H('23262e')); L.end(False)
            L.qy(ly + 1, x + 2, x + 6, z + 3, z + 5, H(screen))
    else:
        lx = x if face == '+x' else x + 5
        if face == '+x':
            L.pbox(lx, y, z + 1, 1, 8, 5, lid)
        L.pbox(x, y, z, 6, 8, 1, body)
        if face == '-x':
            L.pbox(lx, y, z + 1, 1, 8, 5, lid)
        else:
            L.begin(); L.qx(lx + 1, y + 1, y + 7, z + 2, z + 6, H('23262e')); L.end(False)
            L.qx(lx + 1, y + 2, y + 6, z + 3, z + 5, H(screen))


def arcade_x(L, x, y, body=T('8a7ad0', '6f5fb8', '574a96'), screen=H('6fd0e0')):
    """cabinet against a west wall, screen on +x."""
    L.pbox(x, y, 0, 10, 12, 30, body)
    L.begin(); L.qx(x + 10, y + 2, y + 10, 18, 26, H('23262e')); L.end(False)
    L.qx(x + 10, y + 3, y + 9, 21, 22, screen); L.qx(x + 10, y + 4, y + 6, 23, 24, H('f4bb55'))
    L.qx(x + 10, y + 1, y + 11, 27, 29, H('f4bb55'))
    L.pbox(x + 10, y, 12, 4, 12, 3, body)
    L.dot(*[int(v) for v in L.P(x + 12, y + 3, 15)], H('e85a5a'))
    L.dot(*[int(v) for v in L.P(x + 12, y + 7, 15)], H('5aa0e0'))


def clock_x(L, xp, y, z):
    px, py = [int(v) for v in L.P(xp, y, z)]
    L.begin(); L.ell(px, py, 4 * L.S, 4 * L.S, H('fbf8f0')); L.end()
    L.rect(px, py - 2, 1, 3, H('3a2f2a')); L.rect(px + 1, py, 2, 1, H('3a2f2a'))


def wall_shelf_x(L, xp, y0, y1, z):
    """small wall shelf on a west wall with a pot, books and a jar."""
    L.pbox(xp, y0, z, 5, y1 - y0, 2, WOOD)
    L.pbox(xp + 1, y0 + 2, z + 2, 3, 3, 3, T('e7a174', 'cc7c53', 'ad6240'))
    cx, cy = [int(v) for v in L.P(xp + 2.5, y0 + 3.5, z + 6)]
    L.begin(); L.ell(cx, cy - 2, 4, 3, H('69a65c')); L.end()
    L.ell(cx - 1, cy - 3, 2, 1.5, H('8cc477'))
    for i, c in enumerate(('d26a5a', '5f8fc9', 'e8c35a')):
        L.pbox(xp + 1, y0 + 8 + i * 2, z + 2, 3, 2, 5 - i, T(c, c, c), outline=False)
    L.pbox(xp + 1, y1 - 5, z + 2, 3, 3, 4, T('cfeaf5', 'a9d6ec', '84bcdc'))
