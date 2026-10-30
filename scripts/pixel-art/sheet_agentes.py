"""sheet-agentes.png: rows = variants; cols = FL/FR/BL/BR x (idle, walkA, walkB) + seated-type(back) + seated-front."""
from PIL import Image
from px import H
from chars import sprite, VARIANTS

CW, CH = 24, 32
cols = [(d, f) for d in ('FL', 'FR', 'BL', 'BR') for f in ('idle', 'walkA', 'walkB')] + [('BR', 'sitB'), ('FL', 'sitF')]


def build():
    img = Image.new('RGBA', (CW * len(cols) + 4, CH * len(VARIANTS) + 4), H('e9e1d0'))
    for r in range(len(VARIANTS)):
        for c, (d, f) in enumerate(cols):
            if (r + c) % 2:
                img.paste(H('ded4c0'), (2 + c * CW, 2 + r * CH, 2 + (c + 1) * CW, 2 + (r + 1) * CH))
            img.alpha_composite(sprite(r, d, f), (2 + c * CW, 2 + r * CH))
    return img


if __name__ == '__main__':
    from floorkit import save2; print(save2(build(), 'sheet-agentes'))
