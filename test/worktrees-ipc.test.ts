import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callHandler, dialog, ipcMain } from './mocks/electron'
import { registerWorktreesIpc } from '../src/main/ipc/worktrees'
import type { IpcContext } from '../src/main/ipc/context'
import { isSquadTicketResultAgent } from '../src/shared/squad-ticket-result'
import type { AgentSummary, AgentResult } from '../src/shared/types'

vi.mock('../src/main/git', () => ({
  commitChanges: vi.fn(),
  discardChanges: vi.fn(),
  fileDiff: vi.fn(),
  insideRoot: vi.fn(),
  openInEditor: vi.fn(),
  openPullRequest: vi.fn(),
  pullRequestRemoteIdentity: vi.fn(),
  pullRequestRemoteIdentityForRepo: vi.fn(),
  pendingLoss: vi.fn(),
  removeWorktree: vi.fn(),
  worktreeState: vi.fn(),
}))

const result = {
  id: '10000000-0000-4000-8000-000000000001',
  agentId: '10000000-0000-4000-8000-000000000002',
  text: 'Pronto',
  isError: false,
  costUsd: 0,
  durationMs: 0,
  turns: 1,
  createdAt: 1,
  changes: { git: true, root: 'C:/repo', files: [{ path: 'src/a.ts', status: 'added' }], branch: 'agent/squad-ticket' },
} as AgentResult
const squadAgent = { id: result.agentId, role: 'orchestrator', squad: 'build', ticketId: 'ticket-1' } as AgentSummary
const individualAgent = { id: result.agentId, role: undefined } as AgentSummary
let agent: AgentSummary

beforeEach(() => {
  agent = squadAgent
  const manager = {
    agent: () => agent,
    result: () => result,
    setChanges: vi.fn(),
    fire: vi.fn(),
    list: () => [],
    pendingResults: () => [],
  }
  ipcMain.handlers.clear()
  registerWorktreesIpc({ manager, win: () => null, nameOf: () => 'Agente' } as unknown as IpcContext)
})

describe('resultado de ticket de squad', () => {
  it('reconhece apenas orquestradores com squad e ticket', () => {
    expect(isSquadTicketResultAgent(squadAgent)).toBe(true)
    expect(isSquadTicketResultAgent({ ...squadAgent, ticketId: undefined })).toBe(false)
    expect(isSquadTicketResultAgent(individualAgent)).toBe(false)
  })

  it.each(['office:commitResult', 'office:openResultPR', 'office:discardResult'])('%s é bloqueado no main IPC', async (channel) => {
    await expect(callHandler(channel, result.id, 'mensagem')).rejects.toThrow('publicados pela fila de PR')
  })

  it('associa ao ticket individual apenas o PR retornado no host do remoto', async () => {
    const url = 'https://github.com/org/repo/pull/42'
    const { openPullRequest, pullRequestRemoteIdentity, pullRequestRemoteIdentityForRepo } = await import('../src/main/git')
    vi.mocked(openPullRequest).mockResolvedValue(url)
    vi.mocked(pullRequestRemoteIdentity).mockResolvedValue({ host: 'github.com', repository: 'org/repo' })
    vi.mocked(pullRequestRemoteIdentityForRepo).mockResolvedValue({ host: 'github.com', repository: 'org/repo' })
    vi.spyOn(dialog, 'showMessageBox').mockResolvedValue({ response: 0 })
    agent = { ...individualAgent, worktree: { path: 'C:/repo/wt', root: 'C:/repo/wt', repo: 'C:/repo', branch: 'agent/task', base: 'a'.repeat(40) } }
    const firstTicket = { id: 'ticket-1', key: 'AO-1', status: 'review', assignee: { kind: 'agent', name: 'Agente', id: result.agentId } }
    const ticket = { id: 'ticket-2', key: 'AO-2', status: 'review', cwd: 'C:/repo', assignee: { kind: 'agent', name: 'Agente', id: result.agentId } }
    const recordPullRequest = vi.fn()
    const reconcileBlockedQueues = vi.fn(() => [])
    registerWorktreesIpc({
      manager: { agent: () => agent, result: () => ({ ...result, ticketId: ticket.id }), setChanges: vi.fn(), fire: vi.fn(), list: () => [], pendingResults: () => [] },
      win: () => ({}), nameOf: () => 'Agente', board: { list: () => [firstTicket, ticket], get: (id: string) => [firstTicket, ticket].find((item) => item.id === id), recordPullRequest, flush: vi.fn() },
      creation: { reconcileBlockedQueues }, startActiveSquadTicket: vi.fn(),
    } as unknown as IpcContext)

    await expect(callHandler('office:openResultPR', result.id, 'Entrega do ticket')).resolves.toBe(url)
    expect(recordPullRequest).toHaveBeenCalledWith(ticket.id, url, { kind: 'agent', name: 'Agente', id: result.agentId })
    expect(reconcileBlockedQueues).toHaveBeenCalledOnce()
  })

  it('não abre PR de worktree antigo se o ticket mudou para outro repositório', async () => {
    const { openPullRequest, pullRequestRemoteIdentity, pullRequestRemoteIdentityForRepo } = await import('../src/main/git')
    vi.mocked(openPullRequest).mockClear()
    vi.mocked(pullRequestRemoteIdentity).mockResolvedValue({ host: 'github.com', repository: 'org/repo' })
    vi.mocked(pullRequestRemoteIdentityForRepo).mockResolvedValue({ host: 'github.com', repository: 'other/repo' })
    agent = { ...individualAgent, worktree: { path: 'C:/repo/wt', root: 'C:/repo/wt', repo: 'C:/repo', branch: 'agent/task', base: 'a'.repeat(40) } }
    const ticket = { id: 'ticket-1', key: 'AO-1', status: 'review', cwd: 'C:/other', blockedBy: ['blocker'], assignee: { kind: 'agent', name: 'Agente', id: result.agentId } }
    const recordPullRequest = vi.fn()
    registerWorktreesIpc({
      manager: { agent: () => agent, result: () => ({ ...result, ticketId: ticket.id }), setChanges: vi.fn(), fire: vi.fn(), list: () => [], pendingResults: () => [] },
      win: () => ({}), nameOf: () => 'Agente', board: { list: () => [ticket], get: () => ticket, recordPullRequest, flush: vi.fn() },
      creation: { reconcileBlockedQueues: vi.fn(() => []) }, startActiveSquadTicket: vi.fn(),
    } as unknown as IpcContext)

    await expect(callHandler('office:openResultPR', result.id, 'Entrega')).rejects.toThrow('repositório errado')
    expect(openPullRequest).not.toHaveBeenCalled()
    expect(recordPullRequest).not.toHaveBeenCalled()
  })
})
