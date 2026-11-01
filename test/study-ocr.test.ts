import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/main/study-ocr-worker?nodeWorker', () => ({ default: () => ({}) }))

import { needsOcr, pagesWithoutText, PdfTextCache, type PdfOcrJob } from '../src/main/study-pdf'
import { pdfOcrQueue, type OcrRunner } from '../src/main/study-ocr'

const TEXT = 'Probabilidade condicional é a probabilidade de um evento dado outro evento.'
const dirs: string[] = []
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ocr-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('OCR de PDF escaneado', () => {
  it('reconhece páginas sem texto e só pede OCR quando o PDF parece escaneado', () => {
    expect(pagesWithoutText([TEXT, ' ', '', TEXT])).toEqual([1, 2])
    expect(needsOcr(['', '', ''])).toBe(true)
    // Uma página em branco num livro com texto não vale um OCR.
    expect(needsOcr([TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, '', TEXT, TEXT, TEXT])).toBe(false)
    expect(needsOcr([TEXT, '', TEXT, ''])).toBe(true)
    expect(needsOcr([])).toBe(false)
  })

  it('a leitura de um PDF escaneado entra na fila e o cache guarda o texto reconhecido', async () => {
    const dir = tmp()
    const jobs: PdfOcrJob[] = []
    const cache = new PdfTextCache(dir, async () => ['', TEXT], (job) => jobs.push(job))
    const info = { mtimeMs: 1, size: 10 }
    expect(await cache.pages('/a.pdf', info, () => Buffer.from('x'))).toEqual(['', TEXT])
    expect(jobs).toHaveLength(1)
    // Até o OCR terminar, a mesma consulta pede de novo (a fila ignora a repetição).
    cache.cached('/a.pdf', info)
    expect(jobs).toHaveLength(2)
    jobs[0]!.finish(['Texto lido por OCR', TEXT])
    expect(cache.cached('/a.pdf', info)).toEqual(['Texto lido por OCR', TEXT])
    expect(jobs).toHaveLength(2)
  })

  it('um PDF com texto não vai para o OCR', async () => {
    const jobs: PdfOcrJob[] = []
    const cache = new PdfTextCache(tmp(), async () => [TEXT, TEXT], (job) => jobs.push(job))
    await cache.pages('/b.pdf', { mtimeMs: 1, size: 1 }, () => Buffer.from('x'))
    expect(jobs).toHaveLength(0)
  })

  it('a fila lê só as páginas sem texto, uma vez por arquivo, e mantém o texto que já existia', async () => {
    const calls: number[][] = []
    const run: OcrRunner = async (_path, pages, onPage) => {
      calls.push(pages)
      for (const i of pages) onPage(i, `ocr ${i}`)
    }
    const queue = pdfOcrQueue(tmp(), run)
    const finish = vi.fn()
    queue({ key: 'k1', path: '/c.pdf', pages: ['', TEXT, ''], finish })
    queue({ key: 'k1', path: '/c.pdf', pages: ['', TEXT, ''], finish })
    await flush()
    expect(calls).toEqual([[0, 2]])
    expect(finish).toHaveBeenCalledOnce()
    expect(finish).toHaveBeenCalledWith(['ocr 0', TEXT, 'ocr 2'])
  })

  it('retoma do ponto em que parou quando a leitura é interrompida', async () => {
    const dir = tmp()
    let stopAfter = 1
    const seen: number[][] = []
    const run: OcrRunner = async (_path, pages, onPage) => {
      seen.push(pages)
      for (const i of pages) {
        if (stopAfter-- === 0) throw Object.assign(new Error('parou'), { transient: true })
        onPage(i, `ocr ${i}`)
      }
    }
    const queue = pdfOcrQueue(dir, run)
    const finish = vi.fn()
    const job = { key: 'k2', path: '/d.pdf', pages: ['', '', ''], finish }
    queue(job)
    await flush()
    expect(finish).not.toHaveBeenCalled()
    expect(readdirSync(dir)).toContain('k2.ocr-progress.json')
    stopAfter = 99
    queue(job)
    await flush()
    expect(seen[1]).toEqual([1, 2])
    expect(finish).toHaveBeenCalledWith(['ocr 0', 'ocr 1', 'ocr 2'])
    expect(readdirSync(dir)).not.toContain('k2.ocr-progress.json')
  })

  it('progresso corrompido é ignorado', async () => {
    const dir = tmp()
    writeFileSync(join(dir, 'k3.ocr-progress.json'), '{quebrado')
    const finish = vi.fn()
    pdfOcrQueue(dir, async (_p, pages, onPage) => pages.forEach((i) => onPage(i, 'ok')))({ key: 'k3', path: '/e.pdf', pages: [''], finish })
    await flush()
    expect(finish).toHaveBeenCalledWith(['ok'])
  })
})
