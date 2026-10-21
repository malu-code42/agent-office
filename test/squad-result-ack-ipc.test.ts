import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerAgentsIpc } from '../src/main/ipc/agents'
import type { IpcContext } from '../src/main/ipc/context'
import { callHandler, ipcMain } from './mocks/electron'

const { remoteHost } = vi.hoisted(() => ({ remoteHost: vi.fn() }))
vi.mock('../src/main/git', () => ({ repoRoot: vi.fn(), pullRequestRemoteHost: remoteHost }))

const result = { id: 'result-1', agentId: 'agent-1', isError: false, text: 'feito' }
const agent = { id: 'agent-1', role: 'orchestrator', squad: 'sala-1', ticketId: 'ticket-1' }
let queue: Record<string, unknown> | undefined
let acked = false
let currentAgent: { id: string; role: string; squad?: string; ticketId?: string; worktree?: { path: string; root: string; repo: string; branch: string; base: string } } = {
  ...agent,
  worktree: { path: 'fake-wt', root: 'fake-wt', repo: 'fake-repo', branch: 'agent/ticket-1', base: 'base' },
}
let currentResult = result

beforeEach(() => {
  acked = false
  currentAgent = {
    ...agent,
    worktree: { path: 'fake-wt', root: 'fake-wt', repo: 'fake-repo', branch: 'agent/ticket-1', base: 'base' },
  }
  remoteHost.mockReset().mockResolvedValue('github.com')
  currentResult = result
  queue = {
    active: 'ticket-1',
    cycle: { ticketId: 'ticket-1', worktree: {} },
    pendingPRs: [],
  }
  ipcMain.handlers.clear()
  registerAgentsIpc({
    manager: {
      result: () => currentResult,
      agent: () => currentAgent,
      ackResult: () => { acked = true },
    },
    creation: { queue: () => queue },
    updateBadge: () => undefined,
  } as unknown as IpcContext)
})

describe('acknowledgment of squad results', () => {
  it('keeps a successful result when its active ticket has no cycle journal', async () => {
    delete queue!.cycle
    await expect(callHandler('office:ackResult', result.id)).rejects.toThrow('PR verificado')
    expect(acked).toBe(false)
  })

  it('keeps a successful result when its queue is missing', async () => {
    queue = undefined
    await expect(callHandler('office:ackResult', result.id)).rejects.toThrow('PR verificado')
    expect(acked).toBe(false)
  })

  it('denies acknowledgment when a recorded PR URL uses the wrong host', async () => {
    queue!.pendingPRs = [{
      ticketId: 'ticket-1',
      ticketKey: 'T-1',
      title: 'Ticket 1',
      url: 'https://attacker.example/org/repo/pull/1',
      branch: 'agent/ticket-1',
      createdAt: 1,
    }]
    await expect(callHandler('office:ackResult', result.id)).rejects.toThrow('PR verificado')
    expect(acked).toBe(false)
  })

  it.each([
    ['github.com', 'https://github.com/org/repo/pull/1'],
    ['git.example.com', 'https://git.example.com/org/repo/pull/1'],
  ])('allows acknowledgment for the selected host %s', async (host, url) => {
    remoteHost.mockResolvedValue(host)
    queue!.pendingPRs = [{
      ticketId: 'ticket-1',
      ticketKey: 'T-1',
      title: 'Ticket 1',
      url,
      branch: 'agent/ticket-1',
      createdAt: 1,
    }]
    await callHandler('office:ackResult', result.id)
    expect(acked).toBe(true)
  })

  it('denies acknowledgment when the worktree has no verifiable remote host', async () => {
    remoteHost.mockRejectedValue(new Error('no remote'))
    queue!.pendingPRs = [{
      ticketId: 'ticket-1',
      ticketKey: 'T-1',
      title: 'Ticket 1',
      url: 'https://github.com/org/repo/pull/1',
      branch: 'agent/ticket-1',
      createdAt: 1,
    }]
    await expect(callHandler('office:ackResult', result.id)).rejects.toThrow('PR verificado')
    expect(acked).toBe(false)
  })

  it('denies acknowledgment when the squad result has no worktree', async () => {
    currentAgent = { ...agent }
    queue!.pendingPRs = [{
      ticketId: 'ticket-1',
      ticketKey: 'T-1',
      title: 'Ticket 1',
      url: 'https://github.com/org/repo/pull/1',
      branch: 'agent/ticket-1',
      createdAt: 1,
    }]
    await expect(callHandler('office:ackResult', result.id)).rejects.toThrow('PR verificado')
    expect(remoteHost).not.toHaveBeenCalled()
    expect(acked).toBe(false)
  })

  it('allows individual agent results to be acknowledged without a squad queue', async () => {
    currentAgent = { id: 'agent-1', role: 'worker' }
    queue = undefined
    await callHandler('office:ackResult', result.id)
    expect(acked).toBe(true)
  })

  it('allows error results to be acknowledged without a squad queue', async () => {
    currentResult = { ...result, isError: true }
    queue = undefined
    await callHandler('office:ackResult', result.id)
    expect(acked).toBe(true)
  })
})
