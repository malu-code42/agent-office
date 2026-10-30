import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { describe, expect, it } from 'vitest'
import { LUNA_AGENT_ID } from '../src/shared/luna'

type Ask = (agent: unknown, tool: string, input: Record<string, unknown>, opts: { signal: AbortSignal }) => Promise<{ behavior: string }>

async function setup() {
  app.setPath('userData', mkdtempSync(join(tmpdir(), 'ao-luna-perm-')))
  const vault = mkdtempSync(join(tmpdir(), 'ao-luna-vault-'))
  const project = mkdtempSync(join(tmpdir(), 'ao-luna-project-'))
  const outside = mkdtempSync(join(tmpdir(), 'ao-luna-outside-'))
  for (const dir of [vault, project, outside]) writeFileSync(join(dir, 'nota.md'), 'sintético')
  mkdirSync(join(project, 'src'))
  const { Store } = await import('../src/main/store')
  const { AgentManager } = await import('../src/main/agents')
  const store = new Store()
  store.settings = { ...store.settings, vaultPath: vault, projects: [{ id: 'p1', name: 'Projeto', cwd: project }] as never }
  const manager = new AgentManager(store)
  const internals = manager as unknown as { agents: Map<string, unknown>; askPlayer: Ask }
  const luna = internals.agents.get(LUNA_AGENT_ID)
  const ask = (tool: string, input: Record<string, unknown>) =>
    internals.askPlayer.call(manager, luna, tool, input, { signal: new AbortController().signal })
  /** Allowed without a card: resolves right away and leaves no pending request. */
  const allowedNow = async (tool: string, input: Record<string, unknown>) => {
    const before = manager.pendingRequests().length
    const answer = ask(tool, input)
    const settled = await Promise.race([answer.then((r) => r.behavior), new Promise((r) => setTimeout(() => r('pending'), 20))])
    const carded = manager.pendingRequests().length > before
    return settled === 'allow' && !carded
  }
  return { manager, store, vault, project, outside, allowedNow }
}

describe('permissões da Luna (#101)', () => {
  it('ferramentas da casa rodam direto, exceto descartar e remover compromisso', async () => {
    const { manager, allowedNow } = await setup()
    expect(await allowedNow('mcp__casa__task_create', { title: 'X', list: 'Casa' })).toBe(true)
    expect(await allowedNow('mcp__casa__agent_call', { task: 'Y' })).toBe(true)
    expect(await allowedNow('mcp__casa__task_discard', { target: 2, reason: 'r' })).toBe(false)
    expect(await allowedNow('mcp__casa__agenda_remove', { day: '2026-10-30', time: '09:00', title: 'D' })).toBe(false)
    // O cartão mostra a entrada exata que vai valer.
    expect(manager.pendingRequests().map((r) => r.input)).toContainEqual({ target: 2, reason: 'r' })
    manager.shutdown()
  })

  it('lê o vault e os andares de projeto sem perguntar; fora deles e escrita vão ao cartão', async () => {
    const { manager, vault, project, outside, allowedNow } = await setup()
    expect(await allowedNow('Read', { file_path: join(vault, 'nota.md') })).toBe(true)
    expect(await allowedNow('Read', { file_path: join(project, 'nota.md') })).toBe(true)
    expect(await allowedNow('Grep', { pattern: 'x', path: join(project, 'src'), glob: '*.ts' })).toBe(true)
    expect(await allowedNow('Read', { file_path: join(outside, 'nota.md') })).toBe(false)
    expect(await allowedNow('Write', { file_path: join(project, 'novo.md'), content: 'x' })).toBe(false)
    manager.shutdown()
  })
})
