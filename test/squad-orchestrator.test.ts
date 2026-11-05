import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SquadInfo, WorktreeInfo } from '../src/shared/types'
import type { Agent, Prompt } from '../src/main/agents/types'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }))
const { AgentManager } = await import('../src/main/agents')
const { Store } = await import('../src/main/store')

/** Exercise the office lifecycle without a CLI, model, account directory or real project. */
class Office extends AgentManager {
  readonly runs: { id: string; sessionId?: string; resumed: boolean; context: unknown; query: unknown; task: unknown; prompt: Prompt }[] =
    []

  protected override run(agent: Agent, prompt: Prompt): void {
    this.runs.push({
      id: agent.summary.id,
      sessionId: agent.summary.sessionId,
      resumed: agent.started,
      context: agent.summary.context,
      query: agent.query,
      task: agent.task,
      prompt,
    })
    agent.started = true
    agent.summary.status = 'working'
  }

  done(id: string): void {
    const agent = this.agents.get(id)!
    agent.summary.status = 'done'
    agent.summary.context = { used: 200, max: 1000, percent: 20 }
    agent.lastPrompt = 'ticket anterior'
    agent.task = { snapshot: Promise.resolve(null), touched: new Map() }
  }

  consumeFor(id: string, query: Query): Promise<void> {
    const agent = this.agents.get(id)!
    agent.query = query
    return this.consume(agent, query)
  }
}

const brain = { permissionMode: 'default' as const }
let squad: SquadInfo
let store: InstanceType<typeof Store>
let manager: Office
const coordinators = () => manager.list().filter((agent) => agent.role === 'orchestrator')
const worktree = (ticket: string): WorktreeInfo => ({
  path: join(squad.cwd, ticket),
  root: join(squad.cwd, ticket),
  repo: squad.cwd,
  branch: `agent/${ticket}`,
  base: 'a'.repeat(40),
})
const start = (ticket: string) => manager.runSquad(squad, `Execute ${ticket}`, ticket, brain, worktree(ticket), ticket)

beforeEach(() => {
  app.setPath('userData', mkdtempSync(join(tmpdir(), 'ao-54-data-')))
  const cwd = mkdtempSync(join(tmpdir(), 'ao-54-project-'))
  squad = { code: 'produto', name: 'Produto', cwd, icon: 'P', description: '', members: [], steps: [] }
  store = new Store()
  store.settings = { ...store.settings, projects: [{ id: 'p1', name: 'Projeto', cwd }], freshSquadCycle: false }
  manager = new Office(store)
})

describe('AO-54: um coordenador por squad, contexto novo por ticket', () => {
  it('reserva o início antes dos awaits, por projeto e squad, com liberação idempotente', () => {
    const release = manager.reserveSquadStart(squad.cwd, squad.code)!
    expect(manager.reserveSquadStart(squad.cwd, squad.code)).toBeUndefined()
    expect(manager.reserveSquadStart(squad.cwd, 'outro')).toBeTypeOf('function')
    expect(manager.reserveSquadStart('outro-projeto', squad.code)).toBeTypeOf('function')
    release()
    const nextRelease = manager.reserveSquadStart(squad.cwd, squad.code)!
    release()
    expect(manager.reserveSquadStart(squad.cwd, squad.code)).toBeUndefined()
    nextRelease()
  })

  it('reutiliza identidade e limpa a sessão antes de enviar outro ticket, mesmo com economia desligada', () => {
    const first = start('ticket-1')
    const session = first.sessionId
    manager.done(first.id)
    const next = start('ticket-2')
    expect(coordinators()).toHaveLength(1)
    expect(next.id).toBe(first.id)
    expect(next.sessionId).not.toBe(session)
    expect(next).toMatchObject({ ticketId: 'ticket-2', worktree: worktree('ticket-2') })
    expect(manager.runs[1]).toMatchObject({
      id: first.id,
      resumed: false,
      context: undefined,
      query: undefined,
      task: undefined,
      prompt: 'Execute ticket-2',
    })
    const log = manager.getLog(first.id)
    expect(log.at(-2)?.kind).toBe('system')
    expect(log.at(-1)?.text).toBe('ticket-2')
  })

  it.each(['starting', 'working', 'waiting'] as const)('recusa outro ticket enquanto o coordenador está %s, sem duplicar', (status) => {
    const first = start('ticket-1')
    first.status = status
    expect(() => start('ticket-2')).toThrow(/já está rodando/)
    expect(coordinators()).toHaveLength(1)
    expect(manager.runs).toHaveLength(1)
    expect(first.ticketId).toBe('ticket-1')
  })

  it('recusa substituir um ticket pausado pela cota, preservando conta e sessão', () => {
    const first = start('ticket-1')
    manager.done(first.id)
    first.account = 'conta-fixa'
    first.quotaPaused = { accountId: 'conta-fixa' }
    const session = first.sessionId
    expect(() => start('ticket-2')).toThrow(/cota/)
    expect(coordinators()).toHaveLength(1)
    expect(first).toMatchObject({
      sessionId: session,
      account: 'conta-fixa',
      ticketId: 'ticket-1',
      quotaPaused: { accountId: 'conta-fixa' },
    })
    expect(manager.runs).toHaveLength(1)
    expect(manager.finishSquadTicket(first.id, 'ticket-1')).toBe(false)
  })

  it('reinicia o mesmo ticket sem trocar identidade ou aceitar outro branch', () => {
    const first = start('ticket-1')
    const session = first.sessionId
    manager.done(first.id)
    expect(start('ticket-1').id).toBe(first.id)
    expect(first.sessionId).not.toBe(session)
    manager.done(first.id)
    expect(() => manager.runSquad(squad, 'x', 'x', brain, worktree('outro'), 'ticket-1')).toThrow(/outra cópia isolada/)
    expect(coordinators()).toHaveLength(1)
  })

  it('reabre o Office e retoma o próximo ticket com o mesmo coordenador', () => {
    const first = start('ticket-1')
    manager.done(first.id)
    manager.shutdown()
    store.flush()
    store = new Store()
    manager = new Office(store)
    const next = start('ticket-2')
    expect(next.id).toBe(first.id)
    expect(next.sessionId).not.toBe(first.sessionId)
    expect(coordinators()).toHaveLength(1)
    expect(manager.runs[0].resumed).toBe(false)
  })

  it('limpa ao concluir o grupo sem apagar o relatório nem o branch entregue', () => {
    const first = start('ticket-1')
    const session = first.sessionId
    manager.done(first.id)
    store.results = []
    manager.terminalResult(first.id, 'Relatório publicado')
    const result = manager.pendingResults()[0]
    expect(manager.finishSquadTicket(first.id, 'outro-ticket')).toBe(false)
    expect(manager.finishSquadTicket(first.id, 'ticket-1')).toBe(true)
    expect(first).toMatchObject({ id: first.id, ticketId: 'ticket-1', worktree: worktree('ticket-1'), context: undefined, status: 'idle' })
    expect(first.sessionId).not.toBe(session)
    expect(manager.pendingResults()).toContain(result)
    expect(manager.runs).toHaveLength(1)
  })

  it.each(['erro', 'mensagem'] as const)('ignora %s tardio da sessão fechada durante a troca de ticket', async (kind) => {
    const first = start('ticket-1')
    manager.done(first.id)
    let resolve!: (value: IteratorResult<SDKMessage>) => void
    let reject!: (error: Error) => void
    const close = vi.fn()
    const next = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<IteratorResult<SDKMessage>>((yes, no) => {
            resolve = yes
            reject = no
          }),
      )
      .mockResolvedValue({ done: true })
    const query = {
      close,
      [Symbol.asyncIterator]: () => ({ next }),
    } as unknown as Query
    const consuming = manager.consumeFor(first.id, query)
    start('ticket-2')
    if (kind === 'erro') reject(new Error('Falha tardia da sessão anterior'))
    else resolve({ done: false, value: { type: 'system', subtype: 'status', status: 'compacting' } as SDKMessage })
    await consuming
    expect(close).toHaveBeenCalledOnce()
    expect(manager.pendingResults()).toEqual([])
    expect(first.ticketId).toBe('ticket-2')
    expect(first.status).toBe('working')
    expect(manager.getLog(first.id).some((line) => /Falha tardia|Organizando a memória/.test(line.text))).toBe(false)
  })
})
