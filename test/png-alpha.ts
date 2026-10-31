import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { expect } from 'vitest'

/** The alpha of an 8-bit RGBA, non-interlaced PNG (what export_app.py writes), row by row. */
export function pngAlpha(path: string): { width: number; alpha: (x: number, y: number) => number } {
  const buf = readFileSync(path)
  let pos = 8
  let width = 0
  let height = 0
  const idat: Buffer[] = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('latin1', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      expect([data[8], data[9], data[12]]).toEqual([8, 6, 0])
    } else if (type === 'IDAT') idat.push(data)
    pos += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * 4
  const px = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i]
      const a = i >= 4 ? px[y * stride + i - 4] : 0
      const b = y ? px[(y - 1) * stride + i] : 0
      const c = i >= 4 && y ? px[(y - 1) * stride + i - 4] : 0
      const p = a + b - c
      const pa = Math.abs(p - a)
      const pb = Math.abs(p - b)
      const pc = Math.abs(p - c)
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]
      px[y * stride + i] = (x + pred) & 255
    }
  }
  return { width, alpha: (x, y) => px[y * stride + x * 4 + 3] }
}
