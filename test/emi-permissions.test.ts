import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { describe, expect, it } from 'vitest'
import { emiAgentId } from '../src/shared/emi'

type Ask = (agent: unknown, tool: string, input: Record<string, unknown>, opts: { signal: AbortSignal }) => Promise<{ behavior: string }>

async function setup(permissionMode?: string) {
  app.setPath('userData', mkdtempSync(join(tmpdir(), 'ao-emi-perm-')))
  const project = mkdtempSync(join(tmpdir(), 'ao-emi-project-'))
  const outside = mkdtempSync(join(tmpdir(), 'ao-emi-outside-'))
  for (const dir of [project, outside]) writeFileSync(join(dir, 'nota.md'), 'sintético')
  mkdirSync(join(project, 'src'))
  const { Store } = await import('../src/main/store')
  const { AgentManager } = await import('../src/main/agents')
  const store = new Store()
  store.settings = { ...store.settings, projects: [{ id: 'p1', name: 'Projeto', cwd: project, permissionMode }] as never }
  const manager = new AgentManager(store)
  const internals = manager as unknown as { agents: Map<string, unknown>; askPlayer: Ask }
  const emi = internals.agents.get(emiAgentId('p1'))
  const ask = (tool: string, input: Record<string, unknown>) =>
    internals.askPlayer.call(manager, emi, tool, input, { signal: new AbortController().signal })
  /** Allowed without a card: resolves right away and leaves no pending request. */
  const allowedNow = async (tool: string, input: Record<string, unknown>) => {
    const before = manager.pendingRequests().length
    const answer = ask(tool, input)
    const settled = await Promise.race([answer.then((r) => r.behavior), new Promise((r) => setTimeout(() => r('pending'), 20))])
    const carded = manager.pendingRequests().length > before
    return settled === 'allow' && !carded
  }
  return { manager, project, outside, allowedNow }
}

const squad = {
  name: 'Equipe',
  brief: 'Busca',
  tickets: ['AO-1'],
  members: [{ id: 'maya', name: 'Maya', role: 'implementer', engine: 'claude', model: 'sonnet', account: '', focus: 'Faz' }],
}

describe('permissões da Emi', () => {
  it('leituras do plano e dos squads rodam direto; aprovar o plano e criar squad vão ao cartão', async () => {
    const { manager, allowedNow } = await setup()
    expect(await allowedNow('mcp__emi__squads_list', {})).toBe(true)
    expect(await allowedNow('mcp__emi__plan_get', {})).toBe(true)
    expect(await allowedNow('mcp__emi__plan_approve', { goal: 'G' })).toBe(false)
    expect(await allowedNow('mcp__emi__squad_create', squad)).toBe(false)
    const card = manager.pendingRequests().find((r) => r.toolName === 'mcp__emi__squad_create')!
    // O cartão leva a entrada exata e nunca oferece "sempre permitir".
    expect(card.input).toEqual(squad)
    expect(card.canAlwaysAllow).toBe(false)
    expect(card.detail).toContain('Maya · Implementador · modelo sonnet')
    manager.shutdown()
  })

  it('mesmo num andar em modo automático, criar squad pede o cartão', async () => {
    const { manager, allowedNow } = await setup('auto')
    expect(await allowedNow('mcp__emi__squad_create', squad)).toBe(false)
    manager.shutdown()
  })

  it('lê o projeto do andar sem perguntar; fora dele e escrita vão ao cartão', async () => {
    const { manager, project, outside, allowedNow } = await setup()
    expect(await allowedNow('Read', { file_path: join(project, 'nota.md') })).toBe(true)
    expect(await allowedNow('Grep', { pattern: 'x', path: join(project, 'src'), glob: '*.ts' })).toBe(true)
    expect(await allowedNow('Read', { file_path: join(outside, 'nota.md') })).toBe(false)
    expect(await allowedNow('Write', { file_path: join(project, 'novo.md'), content: 'x' })).toBe(false)
    manager.shutdown()
  })
})
