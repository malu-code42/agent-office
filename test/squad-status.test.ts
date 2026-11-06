import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SquadStatusStore } from '../src/main/squad-status'
import type { SquadInfo } from '../src/shared/types'

const squad = (code: string) => ({ code, name: code, availability: 'available' }) as unknown as SquadInfo

describe('estado de pausa e desativação dos squads', () => {
  it('guarda o estado por andar e sobrevive a reabrir o app', () => {
    const data = mkdtempSync(join(tmpdir(), 'ao-status-'))
    const store = new SquadStatusStore(data)
    store.set('/floor/a', 'sala-1', 'paused')
    store.set('/floor/a', 'sala-2', 'disabled')
    expect(store.get('/floor/a', 'sala-1')).toBe('paused')
    expect(store.get('/floor/b', 'sala-1')).toBeUndefined()

    const again = new SquadStatusStore(data)
    expect(again.get('/floor/a', 'sala-2')).toBe('disabled')
    again.set('/floor/a', 'sala-1', null)
    expect(new SquadStatusStore(data).get('/floor/a', 'sala-1')).toBeUndefined()
  })

  it('apply marca pausado e desativado como indisponível, com o motivo', () => {
    const data = mkdtempSync(join(tmpdir(), 'ao-status-'))
    const store = new SquadStatusStore(data)
    store.set('/floor/a', 'sala-1', 'paused')
    const [paused, free] = store.apply('/floor/a', [squad('sala-1'), squad('sala-2')])
    expect(paused!.availability).toBe('unavailable')
    expect(paused!.unavailableReason).toMatch(/^Pausado: retome/)
    expect(free!.availability).toBe('available')
  })

  it('arquivo corrompido fecha tudo: squads ficam fora e nada muda o estado', () => {
    const data = mkdtempSync(join(tmpdir(), 'ao-status-'))
    writeFileSync(join(data, 'squad-status.json'), '{ isto não é json')
    const store = new SquadStatusStore(data)
    expect(store.get('/floor/a', 'sala-1')).toBe('disabled')
    const [s] = store.apply('/floor/a', [squad('sala-1')])
    expect(s!.availability).toBe('unavailable')
    expect(s!.unavailableReason).toMatch(/squad-status\.json/)
    expect(() => store.set('/floor/a', 'sala-1', null)).toThrow(/squad-status\.json/)
  })

  it('estado desconhecido no arquivo também fecha tudo', () => {
    const data = mkdtempSync(join(tmpdir(), 'ao-status-'))
    writeFileSync(join(data, 'squad-status.json'), JSON.stringify({ '/floor/a': { 'sala-1': 'rodando' } }))
    expect(new SquadStatusStore(data).get('/floor/a', 'sala-1')).toBe('disabled')
  })
})
