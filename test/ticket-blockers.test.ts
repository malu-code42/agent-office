import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TicketBoard } from '../src/main/tickets'
import { firstUnblockedTicketId, isTicketBlocked, validateTicketBlockers } from '../src/shared/ticket-blockers'
import type { ProjectFloor, Ticket } from '../src/shared/types'

const player = { kind: 'player' as const, name: 'Malu' }

function setup() {
  const cwd = mkdtempSync(join(tmpdir(), 'ao-ticket-blockers-'))
  const project: ProjectFloor = { id: 'project', name: 'Projeto', cwd }
  const dataDir = mkdtempSync(join(tmpdir(), 'ao-ticket-data-'))
  const board = new TicketBoard(dataDir, () => [project])
  return { board, project, dataDir }
}

describe('ticket blockers', () => {
  it('aceita dependências só no mesmo projeto e recusa autorreferência e ciclos', () => {
    const { board, project } = setup()
    const otherProject: ProjectFloor = { id: 'other', name: 'Outro', cwd: mkdtempSync(join(tmpdir(), 'ao-other-project-')) }
    const first = board.create({ title: 'Primeiro', cwd: project.cwd }, player)
    const second = board.create({ title: 'Segundo', cwd: project.cwd }, player)
    const outside = board.create({ title: 'Fora do projeto', cwd: otherProject.cwd }, player)
    expect(validateTicketBlockers(second.id, [first.id], board.ticketsForBlockers(), [project, otherProject])).toBeNull()
    expect(validateTicketBlockers(first.id, [first.id], board.ticketsForBlockers(), [project, otherProject])).toContain('si mesmo')
    expect(validateTicketBlockers(second.id, [outside.id], board.ticketsForBlockers(), [project, otherProject])).toContain('mesmo projeto')

    board.update(first.id, { blockedBy: [second.id] }, player)
    expect(validateTicketBlockers(second.id, [first.id], board.ticketsForBlockers(), [project, otherProject])).toContain('ciclo')
  })

  it('recusa mover um ticket quando isso quebraria dependências de outros tickets', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ao-ticket-move-project-'))
    const otherCwd = mkdtempSync(join(tmpdir(), 'ao-ticket-move-other-'))
    const project: ProjectFloor = { id: 'project', name: 'Projeto', cwd }
    const other: ProjectFloor = { id: 'other', name: 'Outro', cwd: otherCwd }
    const board = new TicketBoard(mkdtempSync(join(tmpdir(), 'ao-ticket-move-data-')), () => [project, other])
    const blocker = board.create({ title: 'Bloqueador', cwd }, player)
    const dependent = board.create({ title: 'Dependente', cwd }, player)
    board.update(dependent.id, { blockedBy: [blocker.id] }, player)
    expect(() => board.update(blocker.id, { cwd: otherCwd }, player)).toThrow('bloqueador de')
    expect(board.get(blocker.id)?.cwd).toBe(cwd)
    expect(isTicketBlocked(dependent, board.ticketsForBlockers())).toBe(true)
  })

  it('bloqueia início individual e libera somente após registrar PR verificado', () => {
    const { board, project, dataDir } = setup()
    const blocker = board.create({ title: 'Pré-requisito', cwd: project.cwd }, player)
    const ticket = board.create({ title: 'Implementação', status: 'todo', cwd: project.cwd }, player)
    board.update(ticket.id, { blockedBy: [blocker.id] }, player)

    expect(isTicketBlocked(ticket, board.ticketsForBlockers())).toBe(true)
    expect(() => board.assign(ticket.id, { kind: 'agent', name: 'Ada', id: 'agent-1' }, player)).toThrow('PR confirmado')
    expect(() => board.move(ticket.id, 'doing', undefined, player)).toThrow('PR confirmado')
    expect(() => board.update(ticket.id, { status: 'doing' }, player)).toThrow('PR confirmado')
    expect(() => board.remove(blocker.id)).toThrow('bloqueador')

    board.recordPullRequest(blocker.id, 'https://github.com/org/repo/pull/42', { kind: 'agent', name: 'Ada', id: 'agent-1' })
    board.flush()
    const restarted = new TicketBoard(dataDir, () => [project])
    const restored = restarted.get(ticket.id)!
    expect(isTicketBlocked(restored, restarted.ticketsForBlockers())).toBe(false)
    expect(restored.blockerPRs?.[blocker.id]).toBe('https://github.com/org/repo/pull/42')
    restarted.assign(ticket.id, { kind: 'agent', name: 'Ada', id: 'agent-1' }, player)
    restarted.move(ticket.id, 'doing', undefined, player)
    expect(restarted.get(ticket.id)?.status).toBe('doing')
  })

  it('preserva a resolução do bloqueio depois que o ticket bloqueador é arquivado', () => {
    const { board, project, dataDir } = setup()
    const blocker = board.create({ title: 'Pré-requisito', cwd: project.cwd }, player)
    const ticket = board.create({ title: 'Implementação', cwd: project.cwd }, player)
    board.update(ticket.id, { blockedBy: [blocker.id] }, player)
    board.recordPullRequest(blocker.id, 'https://github.com/org/repo/pull/43', player)
    board.move(blocker.id, 'done', undefined, player)
    board.close([blocker.id], player)
    board.flush()

    const restarted = new TicketBoard(dataDir, () => [project])
    const restored = restarted.get(ticket.id)!
    expect(isTicketBlocked(restored, [restored])).toBe(false)
    expect(restored.blockerPRs?.[blocker.id]).toBe('https://github.com/org/repo/pull/43')
  })

  it('revalida URLs persistidas pelo host e não deixa um host incorreto liberar tickets', async () => {
    const { board, project } = setup()
    const blocker = board.create({ title: 'Pré-requisito', cwd: project.cwd }, player)
    const ticket = board.create({ title: 'Implementação', cwd: project.cwd }, player)
    board.update(ticket.id, { blockedBy: [blocker.id] }, player)
    board.recordPullRequest(blocker.id, 'https://github.com/org/repo/pull/44', player)
    await board.verifySavedPullRequests(async () => ({ host: 'github.com', repository: 'attacker/repo' }))
    expect(board.get(blocker.id)?.pullRequestUrl).toBeUndefined()
    expect(isTicketBlocked(board.get(ticket.id)!, board.ticketsForBlockers())).toBe(true)
  })

  it('normaliza bloqueios persistidos malformados para um estado seguro, sem crash', () => {
    const { board, project, dataDir } = setup()
    const ticket = board.create({ title: 'Dados antigos', cwd: project.cwd }, player)
    board.flush()
    const path = join(dataDir, 'tickets.json')
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { tickets: Array<Record<string, unknown>> }
    raw.tickets[0]!.blockedBy = 42
    writeFileSync(path, JSON.stringify(raw))

    const restarted = new TicketBoard(dataDir, () => [project])
    const restored = restarted.get(ticket.id)!
    expect(() => isTicketBlocked(restored, restarted.ticketsForBlockers())).not.toThrow()
    expect(isTicketBlocked(restored, restarted.ticketsForBlockers())).toBe(true)
    expect(() => restarted.assertCanStart(ticket.id)).toThrow('bloqueado')
  })

  it('não confunde chaves herdadas do protótipo com snapshot de PR verificado', () => {
    const ticket = { id: 'ticket', blockedBy: ['toString'], blockerPRs: {} } as unknown as Ticket
    expect(isTicketBlocked(ticket, [ticket])).toBe(true)
  })

  it('seleciona o primeiro ticket liberado e mantém bloqueados sem promovê-los', () => {
    const { board, project } = setup()
    const blocker = board.create({ title: 'Pré-requisito', cwd: project.cwd }, player)
    const blocked = board.create({ title: 'Bloqueado', cwd: project.cwd }, player)
    const ready = board.create({ title: 'Livre', cwd: project.cwd }, player)
    board.update(blocked.id, { blockedBy: [blocker.id] }, player)
    expect(firstUnblockedTicketId([blocked.id, ready.id], board.ticketsForBlockers())).toBe(ready.id)
    expect(firstUnblockedTicketId([blocked.id], board.ticketsForBlockers())).toBeNull()
  })
})
