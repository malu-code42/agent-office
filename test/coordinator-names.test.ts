import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { COORDINATOR_NAMES, pickCoordinatorName } from '../src/shared/coordinator-names'
import type { SquadInfo } from '../src/shared/types'
import type { Agent, Prompt } from '../src/main/agents/types'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }))
const { AgentManager } = await import('../src/main/agents')
const { Store } = await import('../src/main/store')

describe('AO-107: pickCoordinatorName', () => {
  it('a lista tem cerca de 16 nomes, todos distintos', () => {
    expect(COORDINATOR_NAMES.length).toBeGreaterThanOrEqual(16)
    expect(new Set(COORDINATOR_NAMES).size).toBe(COORDINATOR_NAMES.length)
  })

  it('é determinística para o mesmo código de sala e os mesmos nomes ativos', () => {
    expect(pickCoordinatorName('p:sala-1', [])).toBe(pickCoordinatorName('p:sala-1', []))
    expect(COORDINATOR_NAMES).toContain(pickCoordinatorName('p:sala-1', []))
  })

  it('não repete nome entre coordenadores ativos ao mesmo tempo', () => {
    const active: string[] = []
    for (let i = 0; i < COORDINATOR_NAMES.length; i++) {
      // Todas as salas com o mesmo seed forçam a colisão no ponto de partida.
      const name = pickCoordinatorName('mesma-sala', active)
      expect(active).not.toContain(name)
      active.push(name)
    }
    expect(new Set(active)).toEqual(new Set(COORDINATOR_NAMES))
  })

  it('libera o nome de quem saiu: ele volta a ser candidato', () => {
    const first = pickCoordinatorName('sala', [])
    expect(pickCoordinatorName('sala', [first])).not.toBe(first)
    expect(pickCoordinatorName('sala', [])).toBe(first)
  })

  it('lista esgotada reaproveita o primeiro nome livre com sufixo, sem repetir', () => {
    const taken = [...COORDINATOR_NAMES]
    const second = pickCoordinatorName('sala', taken)
    expect(second).toMatch(/^.+ II$/)
    expect(COORDINATOR_NAMES).toContain(second.replace(/ II$/, ''))
    taken.push(second)
    const third = pickCoordinatorName('sala', taken)
    expect(taken).not.toContain(third)
    expect(third).toMatch(/^.+ (II|III)$/)
    const all = new Set(taken)
    for (let i = 0; i < 40; i++) {
      const name = pickCoordinatorName('sala', [...all])
      expect(all.has(name)).toBe(false)
      all.add(name)
    }
  })

  it('nomes legados (do squad) ativos não atrapalham a escolha', () => {
    expect(pickCoordinatorName('sala', ['Produto', 'Marketing'])).toBe(pickCoordinatorName('sala', []))
  })
})

class Office extends AgentManager {
  protected override run(agent: Agent, _prompt: Prompt): void {
    agent.started = true
    agent.summary.status = 'working'
  }
  done(id: string): void {
    this.agents.get(id)!.summary.status = 'done'
  }
}

const brain = { permissionMode: 'default' as const }
let store: InstanceType<typeof Store>
let manager: Office
let cwd: string
const room = (code: string, name = `Grupo ${code}`): SquadInfo => ({ code, name, cwd, icon: 'P', description: '', members: [], steps: [] })

beforeEach(() => {
  app.setPath('userData', mkdtempSync(join(tmpdir(), 'ao-107-data-')))
  cwd = mkdtempSync(join(tmpdir(), 'ao-107-project-'))
  store = new Store()
  store.settings = { ...store.settings, projects: [{ id: 'p1', name: 'Projeto', cwd }], freshSquadCycle: false }
  manager = new Office(store)
})

describe('AO-107: coordenadores das salas de squad', () => {
  it('recebe nome de figura da lista, e não o nome do squad, sem repetir entre salas ativas', () => {
    const names = ['a', 'b', 'c', 'd'].map((code) => manager.runSquad(room(code), 't', 't', brain).name)
    expect(new Set(names).size).toBe(4)
    for (const name of names) expect(COORDINATOR_NAMES).toContain(name)
  })

  it('mantém o nome ao reaproveitar o coordenador entre ciclos (ramo same)', () => {
    const first = manager.runSquad(room('a'), 't1', 't1', brain, undefined, 'ticket-1')
    const name = first.name
    manager.done(first.id)
    const next = manager.runSquad(room('a', 'Outro nome do grupo'), 't2', 't2', brain, undefined, 'ticket-2')
    expect(next.id).toBe(first.id)
    expect(next.name).toBe(name)
  })

  it('mantém o nome depois de reiniciar o app', () => {
    const first = manager.runSquad(room('a'), 't1', 't1', brain, undefined, 'ticket-1')
    manager.done(first.id)
    manager.shutdown()
    store.flush()
    store = new Store()
    manager = new Office(store)
    expect(manager.list().find((a) => a.id === first.id)?.name).toBe(first.name)
    const next = manager.runSquad(room('a'), 't2', 't2', brain, undefined, 'ticket-2')
    expect(next.id).toBe(first.id)
    expect(next.name).toBe(first.name)
  })

  it('coordenador legado com o nome do squad continua com ele até ser recriado', () => {
    const first = manager.runSquad(room('a'), 't1', 't1', brain)
    first.name = 'Grupo a'
    manager.done(first.id)
    expect(manager.runSquad(room('a'), 't2', 't2', brain).name).toBe('Grupo a')
  })
})
