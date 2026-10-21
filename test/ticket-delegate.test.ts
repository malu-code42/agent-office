import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { TicketDesk } from '../src/main/delegate'
import { TicketBoard } from '../src/main/tickets'

describe('individual ticket result attribution', () => {
  it('associates the ticket before a synchronously delivered hire result', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'ao-ticket-result-data-'))
    const cwd = mkdtempSync(join(tmpdir(), 'ao-ticket-result-project-'))
    const board = new TicketBoard(dataDir)
    const ticket = board.create({ title: 'Publicar pré-requisito', cwd }, { kind: 'player', name: 'Malu' })
    const events = new EventEmitter()
    const summary: {
      id: string
      name: string
      source: 'office'
      cwd: string
      status: 'starting'
      activity: string
      desk: number
      permissionMode: 'default'
      costUsd: number
      createdAt: number
      look: Record<string, never>
      ticketId?: string
    } = {
      id: 'agent-1', name: 'Ada', source: 'office', cwd, status: 'starting', activity: '', desk: 0,
      permissionMode: 'default', costUsd: 0, createdAt: 1, look: {},
    }
    const manager = Object.assign(events, {
      list: () => [],
      isBusy: () => false,
      agent: () => summary,
      setTicketId: vi.fn((_id: string, ticketId?: string) => {
        if (ticketId) summary.ticketId = ticketId
        else delete summary.ticketId
      }),
      sendMessage: vi.fn(),
      hire: async (_request: unknown, _display: string, beforeRun?: (agent: typeof summary) => void) => {
        beforeRun?.(summary)
        events.emit('event', {
          type: 'result:new',
          result: { id: 'result-1', agentId: summary.id, ticketId: summary.ticketId, text: 'Pronto', isError: false },
        })
        return summary
      },
    })
    const desk = new TicketDesk(board, manager as never, () => ({
      projects: [], defaultPermissionMode: 'default',
    }) as never)

    await desk.delegate(ticket.id, { hire: { worktree: false, permissionMode: 'default' } }, { kind: 'player', name: 'Malu' })

    expect(board.get(ticket.id)?.status).toBe('review')
    expect(board.get(ticket.id)?.assignee?.id).toBe(summary.id)
    expect(board.get(ticket.id)?.comments.at(-1)?.text).toContain('Relatório de entrega')
    expect(manager.setTicketId).toHaveBeenCalledWith(summary.id, ticket.id)
    expect(manager.setTicketId).toHaveBeenLastCalledWith(summary.id, undefined)
  })
})
