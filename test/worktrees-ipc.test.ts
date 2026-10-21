import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callHandler, ipcMain } from './mocks/electron'
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
})
