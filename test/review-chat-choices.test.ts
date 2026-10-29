import { describe, expect, it } from 'vitest'
import { pendingChoices, restoreChoices, type Pending } from '../src/renderer/src/ui/review-chat-choices'

type FocusKind = 'continuar' | 'reagendar' | 'revisar' | 'descartar'

/* Pending.date é AAAA-MM-DD (formato do <input type="date">). */
const pending = (kind: FocusKind, date = '', reason = ''): Map<string, Pending> =>
  new Map([['tabc123', { kind, date, reason }]])

describe('escolhas da revisão no chat (puras)', () => {
  it('converter continuar em escolha sem operação; revisar é preservada no rascunho', () => {
    expect(pendingChoices(pending('continuar'))).toEqual({})
    expect(pendingChoices(pending('revisar'))).toEqual({ tabc123: { kind: 'revisar' } })
  })

  it('converter reagendar de AAAA-MM-DD para DD.MM.AAAA somente quando houver data', () => {
    expect(pendingChoices(pending('reagendar', '2026-10-20'))).toEqual({
      tabc123: { kind: 'reagendar', date: '20.10.2026' },
    })
    expect(pendingChoices(pending('reagendar'))).toEqual({})
  })

  it('converter descartar com motivo', () => {
    expect(pendingChoices(pending('descartar', '', 'Já não é necessário'))).toEqual({
      tabc123: { kind: 'descartar', reason: 'Já não é necessário' },
    })
  })

  it('mesclar escolhas de várias tarefas', () => {
    const map = new Map<string, Pending>()
    map.set('tabc123', { kind: 'continuar', date: '', reason: '' })
    map.set('tdef456', { kind: 'reagendar', date: '2026-10-21', reason: '' })
    map.set('tghi789', { kind: 'descartar', date: '', reason: 'Não farei mais' })
    expect(pendingChoices(map)).toEqual({
      tdef456: { kind: 'reagendar', date: '21.10.2026' },
      tghi789: { kind: 'descartar', reason: 'Não farei mais' },
    })
  })

  it('restaurar escolhas do rascunho (DD.MM.AAAA) para AAAA-MM-DD', () => {
    expect(restoreChoices({})).toEqual(new Map())
    expect(restoreChoices({ tabc123: { kind: 'continuar' } })).toEqual(
      new Map([['tabc123', { kind: 'continuar', date: '', reason: '' }]]),
    )
    expect(restoreChoices({ tdef456: { kind: 'reagendar', date: '21.10.2026' } })).toEqual(
      new Map([['tdef456', { kind: 'reagendar', date: '2026-10-21', reason: '' }]]),
    )
    expect(restoreChoices({ tghi789: { kind: 'descartar', reason: 'motivo' } })).toEqual(
      new Map([['tghi789', { kind: 'descartar', date: '', reason: 'motivo' }]]),
    )
  })

  it('round-trip: rascunho salvo e restaurado preserva a data de reagendamento', () => {
    const choices = pendingChoices(pending('reagendar', '2026-10-20'))
    expect(restoreChoices(choices)).toEqual(new Map([['tabc123', { kind: 'reagendar', date: '2026-10-20', reason: '' }]]))
  })
})
