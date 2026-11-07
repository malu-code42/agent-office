import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SquadInfo, WorktreeInfo } from '../src/shared/types'
import type { Agent, Prompt } from '../src/main/agents/types'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }))
const { AgentManager } = await import('../src/main/agents')
const { Store } = await import('../src/main/store')

/** No CLI, model or account: only the office lifecycle runs. */
class Office extends AgentManager {
  readonly runs: { id: string; sessionId?: string; resumed: boolean; context: unknown; prompt: Prompt }[] = []

  protected override run(agent: Agent, prompt: Prompt): void {
    this.runs.push({ id: agent.summary.id, sessionId: agent.summary.sessionId, resumed: agent.started, context: agent.summary.context, prompt })
    agent.started = true
    agent.summary.status = 'working'
  }

  /** The ticket's cycle ended with a conversation that has grown. */
  finish(id: string): void {
    const agent = this.agents.get(id)!
    agent.summary.status = 'idle'
    agent.summary.context = { used: 500, max: 1000, percent: 50 }
    agent.lastPrompt = 'ticket anterior'
  }
}

const brain = { permissionMode: 'default' as const }
let squad: SquadInfo
let manager: Office
const everyone = () => manager.list().filter((a) => !a.builtIn)
const coordinators = () => everyone().filter((a) => a.role === 'orchestrator')
const worktree = (ticket: string): WorktreeInfo => ({
  path: join(squad.cwd, ticket),
  root: join(squad.cwd, ticket),
  repo: squad.cwd,
  branch: `agent/${ticket}`,
  base: 'a'.repeat(40),
})
const start = (ticket: string) => manager.runSquad(squad, `Execute ${ticket}`, ticket, brain, worktree(ticket), ticket)

beforeEach(() => {
  app.setPath('userData', mkdtempSync(join(tmpdir(), 'ao-113-data-')))
  const cwd = mkdtempSync(join(tmpdir(), 'ao-113-project-'))
  squad = { code: 'produto', name: 'Produto', cwd, icon: 'P', description: '', members: [], steps: [] }
  const store = new Store()
  store.settings = { ...store.settings, projects: [{ id: 'p1', name: 'Projeto', cwd }] }
  manager = new Office(store)
})

describe('AO-113: coordenador fixo, contexto limpo por ticket, até a usuária dispensar', () => {
  it('atende vários tickets com o mesmo agente, sem contratar ninguém por ticket', () => {
    const hire = vi.spyOn(manager, 'hire')
    const first = start('ticket-1')
    const ids = [first.id]
    const sessions = [first.sessionId]
    for (const ticket of ['ticket-2', 'ticket-3', 'ticket-4']) {
      manager.finish(first.id)
      const next = start(ticket)
      ids.push(next.id)
      sessions.push(next.sessionId)
      expect(next.ticketId).toBe(ticket)
      expect(everyone()).toHaveLength(1)
    }
    expect(new Set(ids).size).toBe(1)
    expect(hire).not.toHaveBeenCalled()
    expect(coordinators()).toHaveLength(1)
    expect(manager.runs).toHaveLength(4)
    expect(new Set(sessions).size).toBe(4)
  })

  it('cada ticket começa em sessão nova: sem retomar, sem contexto e sem histórico do ticket anterior', () => {
    const first = start('ticket-1')
    manager.finish(first.id)
    start('ticket-2')
    expect(manager.runs[1]).toMatchObject({ id: first.id, resumed: false, context: undefined, prompt: 'Execute ticket-2' })
    expect(manager.runs[1].sessionId).not.toBe(manager.runs[0].sessionId)
    expect(first.context).toBeUndefined()
  })

  it('um ticket por agente por vez: ocupado, não aceita outro nem cria um segundo', () => {
    const hire = vi.spyOn(manager, 'hire')
    const first = start('ticket-1')
    expect(() => start('ticket-2')).toThrow(/já está rodando/)
    expect(first.ticketId).toBe('ticket-1')
    expect(everyone()).toHaveLength(1)
    expect(hire).not.toHaveBeenCalled()
  })

  it('squads diferentes têm seus próprios coordenadores fixos, sem trocar entre si', () => {
    const other: SquadInfo = { ...squad, code: 'design', name: 'Design' }
    const a = start('ticket-1')
    const b = manager.runSquad(other, 'x', 'x', brain, worktree('ticket-2'), 'ticket-2')
    manager.finish(a.id)
    manager.finish(b.id)
    expect(start('ticket-3').id).toBe(a.id)
    expect(manager.runSquad(other, 'y', 'y', brain, worktree('ticket-4'), 'ticket-4').id).toBe(b.id)
    expect(coordinators()).toHaveLength(2)
  })

  it('o nível de permissão do coordenador fixo continua o mesmo entre tickets e ele não nasce de agente', () => {
    const first = start('ticket-1')
    manager.setPermissionLevel(first.id, 2)
    manager.finish(first.id)
    const next = start('ticket-2')
    expect(next.permissionLevel).toBe(2)
    expect(next.createdByAgent).toBeUndefined()
  })

  it('a usuária dispensa: o agente sai e só o próximo ticket volta a ter um coordenador, um só', () => {
    const first = start('ticket-1')
    manager.finish(first.id)
    manager.fire(first.id)
    expect(coordinators()).toHaveLength(0)
    const next = start('ticket-2')
    expect(next.id).not.toBe(first.id)
    expect(coordinators()).toHaveLength(1)
    manager.finish(next.id)
    expect(start('ticket-3').id).toBe(next.id)
  })
})
