import { describe, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'

vi.mock('electron', () => ({ BrowserWindow: class {} }))

import { pdfPageUrl } from '../src/main/pdf-viewer'
import { openStudySourceArgsSchema } from '../src/main/validate'

describe('fonte aberta na página', () => {
  it('monta a URL do PDF com a página', () => {
    const url = pdfPageUrl(resolve('vault', 'Estudos', 'Livro A.pdf'), 119)
    expect(url.startsWith('file:///')).toBe(true)
    expect(url).toContain('Livro%20A.pdf')
    expect(url.endsWith('#page=119')).toBe(true)
  })

  it('cai na página 1 quando a página é inválida', () => {
    expect(pdfPageUrl('/x.pdf', 0).endsWith('#page=1')).toBe(true)
    expect(pdfPageUrl('/x.pdf', 2.5).endsWith('#page=1')).toBe(true)
  })

  it('aceita a página como opcional e recusa página inválida', () => {
    expect(openStudySourceArgsSchema.parse(['Estudos/a.pdf'])).toEqual(['Estudos/a.pdf'])
    expect(openStudySourceArgsSchema.parse(['Estudos/a.pdf', 12])).toEqual(['Estudos/a.pdf', 12])
    expect(() => openStudySourceArgsSchema.parse(['Estudos/a.pdf', 0])).toThrow()
    expect(() => openStudySourceArgsSchema.parse(['Estudos/a.pdf', 'x'])).toThrow()
  })
})
