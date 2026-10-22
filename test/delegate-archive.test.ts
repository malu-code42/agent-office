import { describe, expect, it, vi } from 'vitest'
import type { AgentSummary, Settings, Ticket } from '../src/shared/types'
import { TicketDesk } from '../src/main/delegate'

describe('TicketDesk: OpenCode histórico não recebe tickets', () => {
  it('recusa antes de alterar a atribuição ou o estado do ticket', async () => {
    const archived: AgentSummary = {
      id: 'legacy-agent',
      name: 'Arquivo',
      source: 'office',
      engine: 'opencode',
      cwd: 'C:\\project',
      permissionMode: 'default',
      status: 'stopped',
      activity: 'Registro histórico OpenCode · somente leitura',
      desk: 0,
      look: { skin: '#f2c9a0', hair: '#332211', hairStyle: 0, shirt: '#4a8fe0', pants: '#222222', shoes: '#111111' },
      costUsd: 0,
      createdAt: Date.now(),
    }
    const ticket = { id: 'ticket-1', key: 'AO-1', title: 'Tarefa', status: 'todo', cwd: archived.cwd } as Ticket
    const board = {
      get: vi.fn(() => ticket),
      update: vi.fn(),
      assign: vi.fn(),
      move: vi.fn(),
    }
    const manager = {
      on: vi.fn(),
      list: vi.fn(() => [archived]),
      isBusy: vi.fn(() => false),
      sendMessage: vi.fn(),
    }
    const settings = { projects: [], defaultPermissionMode: 'default' } as unknown as Settings
    const desk = new TicketDesk(board as never, manager as never, () => settings)

    await expect(
      desk.delegate('ticket-1', { agentId: archived.id, confirmPermissionOverride: false }, { kind: 'player', name: 'Malu' }),
    ).rejects.toThrow(/somente para consulta/)
    expect(board.assign).not.toHaveBeenCalled()
    expect(board.move).not.toHaveBeenCalled()
    expect(manager.sendMessage).not.toHaveBeenCalled()
  })
})
