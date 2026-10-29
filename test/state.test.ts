import { describe, expect, it } from 'vitest'
import { State } from '../src/renderer/src/state'
import type { OfficeState } from '../src/shared/types'

function baseOfficeState(): OfficeState {
  return {
    agents: [],
    permissions: [],
    results: [],
    tickets: [],
    bridge: { installed: false, listening: false, port: 0 },
    settings: { vaultPath: '' },
    platform: 'win32',
    usage: [],
    accounts: [],
    system: null,
    squads: [],
    squadProposals: [],
    squadQueues: [],
    ledgerToday: { day: '2026-10-17', costByCwd: {}, agents: {} },
    dataNotices: [],
    onBattery: false,
    routines: [],
    macJobs: [],
    proposals: [],
    reviewDraft: false,
    reviewDue: false,
    reviewNextDay: null,
    focusCount: 0,
    barTimer: null,
    forceTour: false,
  } as unknown as OfficeState
}

describe('State hidrata reviewNextDay e reviewDue após reinício', () => {
  it('mantém reviewNextDay e reviewDue vindos do getState', () => {
    const initial = baseOfficeState()
    initial.reviewDraft = true
    initial.reviewDue = false
    initial.reviewNextDay = '2026-10-20'

    const state = new State(initial)

    expect(state.reviewDraft).toBe(true)
    expect(state.reviewDue).toBe(false)
    expect(state.reviewNextDay).toBe('2026-10-20')
  })

  it('inicia com reviewNextDay null e reviewDue false quando ausentes', () => {
    const initial = baseOfficeState()

    const state = new State(initial)

    expect(state.reviewDraft).toBe(false)
    expect(state.reviewDue).toBe(false)
    expect(state.reviewNextDay).toBe(null)
  })
})
