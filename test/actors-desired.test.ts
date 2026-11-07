import { describe, expect, it } from 'vitest'
import type { AgentSummary } from '@shared/types'
import { GameActors } from '../src/renderer/src/game/actors'
import { LOUNGE_AFTER_MS, type Actor, type Goal } from '../src/renderer/src/game/types'

// AO-95: nobody walks to the player. `desired` picks where an agent stays; with a permission, question, plan or
// result pending it stays where it is (desk, or Luna's chair) and never heads for the player.
// `desired` only reads state, so it runs on a stand-in for the game (the renderer has no canvas in tests).

type Items = { permissions: unknown[]; results: unknown[]; questions?: unknown[]; plans?: unknown[] }
const EMPTY: Items = { permissions: [], results: [], questions: [], plans: [] }

function desired(
  agent: Partial<AgentSummary>,
  opts: { items?: Partial<Items>; resting?: boolean; projectFloor?: boolean; floor?: number; actor?: Partial<Actor> } = {},
): Goal {
  const items = { ...EMPTY, ...opts.items }
  const game = {
    state: { itemsFor: () => items },
    resting: () => opts.resting ?? false,
    homeFloor: () => opts.floor ?? 1,
    upperOf: () => (opts.projectFloor === false ? undefined : { project: 'p1' }),
  }
  const actor = { restSince: null, ...opts.actor } as Actor
  const fn = (GameActors.prototype as unknown as { desired(actor: Actor, a: AgentSummary): Goal }).desired
  return fn.call(game, actor, { id: 'agent-1', role: 'worker', ...agent } as AgentSummary)
}

const pending = (): Partial<Items> => ({ permissions: [{}], questions: [{}], plans: [{}], results: [{}] })

describe('desired: ninguém anda até a usuária (AO-95)', () => {
  it('a Luna fica na cadeira, com ou sem item pendente', () => {
    expect(desired({ builtIn: 'luna' })).toBe('seat')
    expect(desired({ builtIn: 'luna' }, { items: pending() })).toBe('seat')
  })

  it('agente com permissão, pergunta ou plano pendente fica na mesa', () => {
    for (const key of ['permissions', 'questions', 'plans'] as const) {
      expect(desired({ project: 'p1' }, { items: { [key]: [{}] } })).toBe('desk')
      expect(desired({}, { items: { [key]: [{}] } })).toBe('desk')
    }
  })

  it('agente esperando a usuária (waiting) também fica na mesa', () => {
    expect(desired({ status: 'waiting' } as Partial<AgentSummary>, { items: pending() })).toBe('desk')
  })

  it('resultado de projeto espera na própria mesa, em qualquer andar', () => {
    expect(desired({ project: 'p1' }, { items: { results: [{}] } })).toBe('desk')
    expect(desired({ project: 'p1' }, { items: { results: [{}] }, floor: 2 })).toBe('desk')
  })

  it('o orquestrador de squad fica na mesa mesmo com resultado pendente', () => {
    expect(desired({ role: 'orchestrator' }, { items: pending() })).toBe('desk')
  })

  it('o morador da Casa fica na mesa da Luna', () => {
    expect(desired({ homeResident: true } as Partial<AgentSummary>, { items: pending() })).toBe('home')
  })

  it('nenhum caso devolve um destino de visita à usuária', () => {
    const cases = [{ builtIn: 'luna' as const }, { project: 'p1' }, { role: 'orchestrator' as const }, { homeResident: true }, {}]
    for (const agent of cases) {
      for (const resting of [false, true]) {
        expect(desired(agent as Partial<AgentSummary>, { items: pending(), resting })).not.toBe('boss')
      }
    }
  })
})

describe('desired: descanso', () => {
  it('descansando no térreo por tempo suficiente vai ao lounge; antes disso fica na mesa', () => {
    expect(desired({}, { resting: true, floor: 0 })).toBe('desk')
    expect(desired({}, { resting: true, floor: 0, actor: { restSince: Date.now() - LOUNGE_AFTER_MS - 1 } })).toBe('hang')
  })

  it('agente de andar de projeto descansa na mesa', () => {
    expect(desired({}, { resting: true, floor: 1, actor: { restSince: Date.now() - LOUNGE_AFTER_MS - 1 } })).toBe('desk')
  })
})
