import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PdfTextCache, pdfPages } from '../src/main/study-pdf'
import { tinyPdf } from './helpers/tiny-pdf'

describe('texto local de PDF', () => {
  it('lê o texto de cada página, em ordem', async () => {
    const pages = await pdfPages(tinyPdf(['Pilhas e listas', 'Filas circulares (FIFO)', 'Arvores binarias']))
    expect(pages).toHaveLength(3)
    expect(pages[0]).toContain('Pilhas')
    expect(pages[1]).toContain('Filas circulares (FIFO)')
    expect(pages[2]).toContain('Arvores')
  })

  it('rejeita um arquivo que não é PDF', async () => {
    await expect(pdfPages(Buffer.from('não sou um pdf'))).rejects.toThrow()
  })

  it('guarda as páginas por caminho, data e tamanho e só relê quando o arquivo muda', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ao-pdf-cache-'))
    const file = join(dir, 'aula.pdf')
    writeFileSync(file, tinyPdf(['Fila']))
    const cache = new PdfTextCache(join(dir, 'cache'))
    const read = vi.fn(() => tinyPdf(['Fila']))
    const first = await cache.pages(file, { mtimeMs: 1, size: 10 }, read)
    const again = await new PdfTextCache(join(dir, 'cache')).pages(file, { mtimeMs: 1, size: 10 }, read)
    expect(again).toEqual(first)
    expect(read).toHaveBeenCalledTimes(1)
    expect(readdirSync(join(dir, 'cache'))).toHaveLength(1)
    await cache.pages(file, { mtimeMs: 2, size: 10 }, read)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('lembra um PDF ilegível e não o relê a cada busca', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ao-pdf-cache-'))
    const read = vi.fn(() => Buffer.from('não sou um pdf'))
    const cache = new PdfTextCache(join(dir, 'cache'))
    await expect(cache.pages('x.pdf', { mtimeMs: 1, size: 3 }, read)).rejects.toThrow()
    await expect(cache.pages('x.pdf', { mtimeMs: 1, size: 3 }, read)).rejects.toThrow(/ilegível/)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('passado o prazo, um PDF nunca lido fica para o fundo e a próxima busca o encontra pronto', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ao-pdf-cache-'))
    const extract = vi.fn(async () => ['Fila'])
    const cache = new PdfTextCache(join(dir, 'cache'), extract)
    const info = { mtimeMs: 1, size: 10 }
    expect(await cache.pagesBy('a.pdf', info, () => Buffer.from('x'), Date.now() - 1)).toBe('pending')
    await vi.waitFor(() => expect(cache.cached('a.pdf', info)).toEqual(['Fila']))
    expect(await cache.pagesBy('a.pdf', info, () => Buffer.from('x'), Date.now() - 1)).toEqual(['Fila'])
    // Two requests for the same file while it is parsed share one parse.
    await Promise.all([cache.pages('b.pdf', info, () => Buffer.from('x')), cache.pages('b.pdf', info, () => Buffer.from('x'))])
    expect(extract).toHaveBeenCalledTimes(2)
  })
})
