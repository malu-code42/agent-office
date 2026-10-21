import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { SquadCreation } from '../src/main/squad-creation'
import { SquadProposalStore } from '../src/main/squad-proposals'
import { SquadQueueStore } from '../src/main/squad-queues'
import { findSquad, inspectSquads } from '../src/main/squads'
import { TicketBoard } from '../src/main/tickets'
import { holdsRoom } from '@shared/types'
import { squadFilePlan, writeSquad } from '../src/main/squad-writer'
import { squadInRoom } from '@shared/squad-rooms'
import type { Account, ProjectFloor, Settings, SquadProposal, SquadProposalMember } from '@shared/types'

// The proposal is not a squad: nothing is written in the project before the approval,
// and the approval gives the chosen tickets to the squad that was just created.

let project: ProjectFloor
let board: TicketBoard
let creation: SquadCreation
let queues: SquadQueueStore
let dataDir: string
let calls: number

const team = (): SquadProposalMember[] => [
  { id: 'maya', name: 'Maya', role: 'implementer', engine: 'claude', model: 'opus', account: '', focus: 'Implementa' },
  { id: 'caio', name: 'Caio', role: 'reviewer', engine: 'claude', model: '', account: '', focus: 'Revisa' },
]

const settings = (): Settings =>
  ({
    playerName: 'Malu',
    projects: [project],
    accounts: [{ id: 'a1', name: 'pessoal' } as Account],
  }) as unknown as Settings

beforeEach(() => {
  const cwd = mkdtempSync(join(tmpdir(), 'ao-squad-cwd-'))
  dataDir = mkdtempSync(join(tmpdir(), 'ao-squad-data-'))
  project = { id: 'p1', name: 'Loja Aurora', cwd }
  board = new TicketBoard(dataDir, () => [project])
  calls = 0
  queues = new SquadQueueStore(dataDir)
  creation = new SquadCreation({
    proposals: new SquadProposalStore(dataDir),
    queues,
    board,
    projects: () => [project],
    settings,
    player: () => ({ kind: 'player', name: 'Malu' }),
    generate: async () => {
      calls++
      return team()
    },
  })
})

const propose = (room = 0, ticketIds: string[] = []) =>
  creation.propose({ id: 'prop-1', projectId: 'p1', room, brief: 'Refazer a busca da loja', ticketIds })

describe('a proposta', () => {
  it('guarda e limpa erro de startup no ciclo ativo sem perder o worktree salvo', () => {
    const ticket = board.create({ title: 'Retomar ciclo', status: 'doing', cwd: project.cwd }, { kind: 'player', name: 'Malu' })
    const worktree = {
      path: 'C:/repo/.agent-office/worktrees/t1', root: 'C:/repo/.agent-office/worktrees/t1', repo: 'C:/repo',
      branch: 'agent/squad-t1', base: 'a'.repeat(40),
    }
    queues.set({ code: 'squad-1', cwd: project.cwd, active: ticket.id, queue: [], cycle: { ticketId: ticket.id, worktree }, updatedAt: 1 })

    creation.setStartupError('squad-1', ticket.id, 'não conseguiu preparar o runner')
    expect(new SquadQueueStore(dataDir).get('squad-1')?.cycle).toMatchObject({
      ticketId: ticket.id, startupError: 'não conseguiu preparar o runner', worktree,
    })

    creation.clearStartupError('squad-1', ticket.id)
    expect(new SquadQueueStore(dataDir).get('squad-1')?.cycle).toEqual({ ticketId: ticket.id, worktree })
  })

  it('libera o ticket ativo para revisão só com URL real e promove o próximo atomicamente', () => {
    const player = { kind: 'player' as const, name: 'Malu' }
    const first = board.create({ title: 'Primeiro', status: 'doing', cwd: project.cwd }, player)
    const second = board.create({ title: 'Segundo', status: 'todo', cwd: project.cwd }, player)
    const queues = new SquadQueueStore(dataDir)
    queues.set({ code: 'squad-1', cwd: project.cwd, active: first.id, queue: [second.id], updatedAt: 1 })
    const lifecycle = new SquadCreation({
      proposals: new SquadProposalStore(dataDir),
      queues,
      board,
      projects: () => [project],
      settings,
      player: () => ({ kind: 'player', name: 'Malu' }),
      generate: async () => team(),
    })
    const moved = lifecycle.releaseTicketForReview('squad-1', {
      ticketId: first.id,
      ticketKey: first.key,
      title: first.title,
      url: 'https://github.com/org/repo/pull/1',
      branch: 'agent/squad-1-first',
      createdAt: 2,
    })
    expect(moved).toMatchObject({ active: second.id, queue: [], pendingPRs: [{ ticketId: first.id }] })
    expect(board.get(first.id)?.status).toBe('review')
    expect(board.get(first.id)?.comments.at(-1)?.text).toContain('https://github.com/org/repo/pull/1')
    expect(board.get(second.id)?.status).toBe('doing')
    expect(() =>
      lifecycle.releaseTicketForReview('squad-1', {
        ticketId: first.id,
        ticketKey: first.key,
        title: first.title,
        url: 'https://github.com/org/repo/pull/1',
        branch: 'agent/squad-1-first',
        createdAt: 3,
      }),
    ).not.toThrow()
    expect(new SquadQueueStore(dataDir).get('squad-1')?.pendingPRs).toHaveLength(1)
  })

  it('pula tickets bloqueados e os promove quando o bloqueador recebe PR confirmado', () => {
    const player = { kind: 'player' as const, name: 'Malu' }
    const first = board.create({ title: 'Ticket ativo', status: 'doing', cwd: project.cwd }, player)
    const blocker = board.create({ title: 'Pré-requisito', status: 'review', cwd: project.cwd }, player)
    const blocked = board.create({ title: 'Ticket bloqueado', status: 'todo', cwd: project.cwd }, player)
    const free = board.create({ title: 'Ticket livre', status: 'todo', cwd: project.cwd }, player)
    board.update(blocked.id, { blockedBy: [blocker.id] }, player)
    for (const ticket of [blocked, free]) board.assign(ticket.id, { kind: 'agent', name: 'Squad 1', id: 'squad:squad-1' }, player)
    const queues = new SquadQueueStore(dataDir)
    queues.set({ code: 'squad-1', cwd: project.cwd, active: first.id, queue: [blocked.id, free.id], updatedAt: 1 })
    const lifecycle = new SquadCreation({ proposals: new SquadProposalStore(dataDir), queues, board, projects: () => [project], settings, player: () => player })

    const moved = lifecycle.releaseTicketForReview('squad-1', {
      ticketId: first.id,
      ticketKey: first.key,
      title: first.title,
      url: 'https://github.com/org/repo/pull/10',
      branch: 'agent/squad-1-first',
      createdAt: 10,
    })
    expect(moved).toMatchObject({ active: free.id, queue: [blocked.id] })
    expect(board.get(blocked.id)?.status).toBe('todo')
    expect(board.get(free.id)?.status).toBe('doing')

    board.recordPullRequest(blocker.id, 'https://github.com/org/repo/pull/11', { kind: 'agent', name: 'Malu' })
    expect(lifecycle.reconcileBlockedQueues()).toEqual([])
    expect(queues.get('squad-1')?.active).toBe(free.id)
    lifecycle.releaseTicketForReview('squad-1', {
      ticketId: free.id,
      ticketKey: free.key,
      title: free.title,
      url: 'https://github.com/org/repo/pull/12',
      branch: 'agent/squad-1-free',
      createdAt: 12,
    })
    expect(queues.get('squad-1')?.active).toBe(blocked.id)
    expect(board.get(blocked.id)?.status).toBe('doing')
  })

  it('mantém todos os tickets bloqueados em espera e os reavalia quando o PR chega', () => {
    const player = { kind: 'player' as const, name: 'Malu' }
    const first = board.create({ title: 'Ticket ativo', status: 'doing', cwd: project.cwd }, player)
    const blocker = board.create({ title: 'Pré-requisito', status: 'review', cwd: project.cwd }, player)
    const blocked = board.create({ title: 'Ticket bloqueado', status: 'todo', cwd: project.cwd }, player)
    board.update(blocked.id, { blockedBy: [blocker.id] }, player)
    board.assign(blocked.id, { kind: 'agent', name: 'Squad 1', id: 'squad:squad-1' }, player)
    const queues = new SquadQueueStore(dataDir)
    queues.set({ code: 'squad-1', cwd: project.cwd, active: first.id, queue: [blocked.id], updatedAt: 1 })
    const lifecycle = new SquadCreation({ proposals: new SquadProposalStore(dataDir), queues, board, projects: () => [project], settings, player: () => player })

    lifecycle.releaseTicketForReview('squad-1', {
      ticketId: first.id, ticketKey: first.key, title: first.title,
      url: 'https://github.com/org/repo/pull/20', branch: 'agent/squad-1-first', createdAt: 20,
    })
    expect(queues.get('squad-1')).toMatchObject({ active: null, queue: [blocked.id] })
    expect(board.get(blocked.id)?.status).toBe('todo')

    board.recordPullRequest(blocker.id, 'https://github.com/org/repo/pull/21', { kind: 'agent', name: 'Malu' })
    expect(lifecycle.reconcileBlockedQueues()).toEqual(['squad-1'])
    expect(queues.get('squad-1')).toMatchObject({ active: blocked.id, queue: [] })
    expect(board.get(blocked.id)?.status).toBe('doing')
  })

  it('não confia em PR salvo de outro repositório no mesmo host durante a recuperação', async () => {
    const player = { kind: 'player' as const, name: 'Malu' }
    const blocker = board.create({ title: 'Pré-requisito', status: 'review', cwd: project.cwd }, player)
    const blocked = board.create({ title: 'Aguardando', status: 'todo', cwd: project.cwd }, player)
    board.update(blocked.id, { blockedBy: [blocker.id] }, player)
    const queues = new SquadQueueStore(dataDir)
    queues.set({
      code: 'squad-1', cwd: project.cwd, active: null, queue: [blocked.id],
      pendingPRs: [{ ticketId: blocker.id, ticketKey: blocker.key, title: blocker.title, url: 'https://github.com/attacker/repo/pull/1', branch: 'agent/blocker', createdAt: 1 }],
      updatedAt: 1,
    })
    const lifecycle = new SquadCreation({ proposals: new SquadProposalStore(dataDir), queues, board, projects: () => [project], settings, player: () => player })

    await lifecycle.verifyPendingPRs(async () => ({ host: 'github.com', repository: 'org/repo' }))
    expect(board.get(blocker.id)?.pullRequestUrl).toBeUndefined()
    expect(queues.get('squad-1')?.active).toBeNull()

    queues.set({
      ...queues.get('squad-1')!,
      pendingPRs: [{ ticketId: blocker.id, ticketKey: blocker.key, title: blocker.title, url: 'https://github.com/org/repo/pull/1', branch: 'agent/blocker', createdAt: 1 }],
    })
    await lifecycle.verifyPendingPRs(async () => ({ host: 'github.com', repository: 'org/repo' }))
    expect(board.get(blocker.id)?.pullRequestUrl).toBe('https://github.com/org/repo/pull/1')
    expect(queues.get('squad-1')?.active).toBe(blocked.id)
  })

  it('não associa PR de uma fila a ticket de outro projeto', async () => {
    const player = { kind: 'player' as const, name: 'Malu' }
    const otherProject: ProjectFloor = { id: 'other', name: 'Outro projeto', cwd: mkdtempSync(join(tmpdir(), 'ao-other-floor-')) }
    const ticket = board.create({ title: 'Ticket de outro andar', status: 'review', cwd: otherProject.cwd }, player)
    const queues = new SquadQueueStore(dataDir)
    queues.set({
      code: 'squad-1', cwd: project.cwd, active: null, queue: [],
      pendingPRs: [{ ticketId: ticket.id, ticketKey: ticket.key, title: ticket.title, url: 'https://github.com/org/repo/pull/2', branch: 'agent/wrong-floor', createdAt: 2 }],
      updatedAt: 2,
    })
    const lifecycle = new SquadCreation({
      proposals: new SquadProposalStore(dataDir), queues, board,
      projects: () => [project, otherProject], settings, player: () => player,
    })
    await lifecycle.verifyPendingPRs(async () => ({ host: 'github.com', repository: 'org/repo' }))
    expect(board.get(ticket.id)?.pullRequestUrl).toBeUndefined()
  })

  it('reconcilia a revisão e o ticket promovido após crash depois de verificar o host do PR', async () => {
    const player = { kind: 'player' as const, name: 'Malu' }
    const first = board.create({ title: 'Primeiro', status: 'doing', cwd: project.cwd }, player)
    const second = board.create({ title: 'Segundo', status: 'todo', cwd: project.cwd }, player)
    board.flush()
    const pr = {
      ticketId: first.id,
      ticketKey: first.key,
      title: first.title,
      url: 'https://github.com/org/repo/pull/17',
      branch: 'agent/squad-pr-recovery',
      createdAt: 17,
    }
    new SquadQueueStore(dataDir).set({ code: 'squad-1', cwd: project.cwd, active: second.id, queue: [], pendingPRs: [pr], updatedAt: 17 })
    const recoveredBoard = new TicketBoard(dataDir, () => [project])
    const recovered = new SquadCreation({
      proposals: new SquadProposalStore(dataDir),
      queues: new SquadQueueStore(dataDir),
      board: recoveredBoard,
      projects: () => [project],
      settings,
      player: () => player,
      generate: async () => team(),
    })
    await recovered.verifyPendingPRs(async () => ({ host: 'github.com', repository: 'org/repo' }))
    expect(recoveredBoard.get(first.id)?.status).toBe('review')
    expect(recoveredBoard.get(first.id)?.comments.at(-1)?.text).toContain(pr.url)
    expect(recoveredBoard.get(second.id)?.status).toBe('doing')
  })

  it('não cria nada no projeto antes da aprovação', async () => {
    const proposal = await propose()
    expect(proposal.status).toBe('pending')
    expect(proposal.composition?.members).toHaveLength(2)
    expect(proposal.name).toBe('Squad da Sala 1')
    expect(existsSync(join(project.cwd, 'squads'))).toBe(false)
    expect(creation.list()).toHaveLength(1)
  })

  it('uma proposta por sala: a segunda é recusada', async () => {
    await propose(0)
    await expect(creation.propose({ id: 'prop-2', projectId: 'p1', room: 0, brief: 'Outro', ticketIds: [] })).rejects.toThrow(
      /já tem uma proposta/,
    )
  })

  it('a sala não existe fora das três do andar', async () => {
    await expect(creation.propose({ id: 'prop-3', projectId: 'p1', room: 3, brief: 'x', ticketIds: [] })).rejects.toThrow(/sala/)
  })

  it('quando a geração falha, nada fica guardado', async () => {
    const broken = new SquadCreation({
      proposals: new SquadProposalStore(dataDir),
      queues: new SquadQueueStore(dataDir),
      board,
      projects: () => [project],
      settings,
      player: () => ({ kind: 'player', name: 'Malu' }),
      generate: async () => {
        throw new Error('A IA não respondeu a tempo.')
      },
    })
    await expect(broken.propose({ id: 'prop-4', projectId: 'p1', room: 0, brief: 'x', ticketIds: [] })).rejects.toThrow(/não respondeu/)
    expect(broken.list()).toEqual([])
    expect(existsSync(join(project.cwd, 'squads'))).toBe(false)
  })

  it('os ajustes refazem a equipe e guardam o nome que a pessoa editou', async () => {
    const proposal = await propose()
    await creation.adjust(proposal.id, 'Inclua um testador')
    const after = creation.get(proposal.id)!
    expect(after.adjustments).toEqual(['Inclua um testador'])
    expect(after.name).toBe('Squad da Sala 1')
    expect(after.status).toBe('pending')
  })

  it('descartar a proposta não deixa rastro', async () => {
    const proposal = await propose()
    creation.discard(proposal.id)
    expect(creation.list()).toEqual([])
    expect(existsSync(join(project.cwd, 'squads'))).toBe(false)
  })

  it('closing during adjustment aborts and a late generator result cannot restore the proposal', async () => {
    let finish!: (members: SquadProposalMember[]) => void
    let signal: AbortSignal | undefined
    let generation = 0
    const slow = new SquadCreation({
      proposals: new SquadProposalStore(dataDir),
      queues: new SquadQueueStore(dataDir),
      board,
      projects: () => [project],
      settings,
      player: () => ({ kind: 'player', name: 'Malu' }),
      generate: async (_req, abortSignal) => {
        if (generation++ === 0) return team()
        signal = abortSignal
        return new Promise((resolve) => (finish = resolve))
      },
    })
    const proposal = await slow.propose({ id: 'prop-close-adjust', projectId: 'p1', room: 0, brief: 'x', ticketIds: [] })
    const adjusting = slow.adjust(proposal.id, 'Troque o revisor')
    expect(slow.get(proposal.id)?.status).toBe('generating')
    slow.discard(proposal.id)
    expect(signal?.aborted).toBe(true)
    finish(team()) // Simulate an implementation that resolves despite AbortSignal.
    await expect(adjusting).rejects.toThrow(/descartada/)
    expect(slow.get(proposal.id)).toBeUndefined()
    expect(slow.list()).toEqual([])
  })

  it('cannot approve the previous composition while an adjustment is generating', async () => {
    let finish!: (members: SquadProposalMember[]) => void
    let generation = 0
    const slow = new SquadCreation({
      proposals: new SquadProposalStore(dataDir),
      queues: new SquadQueueStore(dataDir),
      board,
      projects: () => [project],
      settings,
      player: () => ({ kind: 'player', name: 'Malu' }),
      generate: async () => (generation++ === 0 ? team() : new Promise((resolve) => (finish = resolve))),
    })
    const proposal = await slow.propose({ id: 'prop-adjust-approve', projectId: 'p1', room: 0, brief: 'x', ticketIds: [] })
    const adjusting = slow.adjust(proposal.id, 'Troque a equipe')
    await expect(slow.approve(proposal.id, 'Equipe antiga')).rejects.toThrow(/gerando|pendente|aprovar|processamento/i)
    expect(existsSync(join(project.cwd, 'squads'))).toBe(false)
    finish(team())
    await adjusting
    expect((await slow.approve(proposal.id, 'Equipe nova')).squad.name).toBe('Equipe nova')
  })

  it('rejects a second adjustment for the same proposal while generation is pending', async () => {
    let finish!: (members: SquadProposalMember[]) => void
    let generation = 0
    const slow = new SquadCreation({
      proposals: new SquadProposalStore(dataDir),
      queues: new SquadQueueStore(dataDir),
      board,
      projects: () => [project],
      settings,
      player: () => ({ kind: 'player', name: 'Malu' }),
      generate: async () => {
        if (generation++ === 0) return team()
        return new Promise((resolve) => (finish = resolve))
      },
    })
    const proposal = await slow.propose({ id: 'prop-two-adjusts', projectId: 'p1', room: 0, brief: 'x', ticketIds: [] })
    const first = slow.adjust(proposal.id, 'Primeiro ajuste')
    await expect(slow.adjust(proposal.id, 'Segundo ajuste')).rejects.toThrow(/andamento|processamento|já está/i)
    expect(slow.get(proposal.id)?.adjustments).toEqual(['Primeiro ajuste'])
    finish(team())
    await first
  })
})

describe('o nome que a pessoa editou', () => {
  it('fica na proposta e na composição', async () => {
    const proposal = await propose()
    const renamed = creation.rename(proposal.id, 'Equipe da busca')
    expect(renamed.name).toBe('Equipe da busca')
    expect(renamed.composition?.name).toBe('Equipe da busca')
  })

  it('sobrevive ao ajuste', async () => {
    const proposal = await propose()
    creation.rename(proposal.id, 'Equipe da busca')
    await creation.adjust(proposal.id, 'Inclua um testador')
    const after = creation.get(proposal.id)!
    expect(after.name).toBe('Equipe da busca')
    expect(after.composition?.name).toBe('Equipe da busca')
  })

  it('o ajuste leva o nome junto, mesmo sem o office saber dele antes', async () => {
    const proposal = await propose()
    await creation.adjust(proposal.id, 'Inclua um testador', 'Equipe da busca')
    const after = creation.get(proposal.id)!
    expect(after.name).toBe('Equipe da busca')
    expect(after.composition?.name).toBe('Equipe da busca')
  })

  it('continua na proposta depois de fechar e abrir a janela de novo', async () => {
    const proposal = await propose()
    creation.rename(proposal.id, 'Equipe da busca')
    // A janela fecha e abre de novo: o office lê as propostas do disco de novo.
    const reopened = new SquadCreation({
      proposals: new SquadProposalStore(dataDir),
      queues: new SquadQueueStore(dataDir),
      board,
      projects: () => [project],
      settings,
      player: () => ({ kind: 'player', name: 'Malu' }),
      generate: async () => team(),
    })
    const again = reopened.get(proposal.id)
    expect(again?.name).toBe('Equipe da busca')
  })

  it('um nome vazio não é aceito', async () => {
    const proposal = await propose()
    expect(() => creation.rename(proposal.id, '   ')).toThrow(/nome/)
    expect(creation.get(proposal.id)?.name).toBe('Squad da Sala 1')
  })

  it('um nome vazio não aprova o squad', async () => {
    const proposal = await propose()
    await expect(creation.approve(proposal.id, '   ')).rejects.toThrow(/nome/)
    // Nada foi criado: a sala continua vazia.
    expect(existsSync(join(project.cwd, 'squads'))).toBe(false)
    expect(creation.get(proposal.id)?.status).toBe('pending')
  })

  it('depois que o squad foi criado, o nome da proposta não muda mais', async () => {
    const proposal = await propose()
    await creation.approve(proposal.id, 'Equipe da busca')
    expect(() => creation.rename(proposal.id, 'Outro nome')).toThrow(/já foi criado/)
    expect(creation.get(proposal.id)?.name).toBe('Equipe da busca')
  })

  it('o nome do squad continua o que a pessoa escreveu na aprovação', async () => {
    const proposal = await propose()
    creation.rename(proposal.id, 'Equipe da busca')
    const { squad } = await creation.approve(proposal.id, 'Equipe da busca')
    expect(squad.name).toBe('Equipe da busca')
  })

  it('a proposta continua com a composição enquanto a nova é gerada', async () => {
    // É isso que mantém a sala âmbar durante o ajuste: a proposta tem composição.
    let during: SquadProposal | undefined
    const slow = new SquadCreation({
      proposals: new SquadProposalStore(dataDir),
      queues: new SquadQueueStore(dataDir),
      board,
      projects: () => [project],
      settings,
      player: () => ({ kind: 'player', name: 'Malu' }),
      generate: async () => {
        // A cópia: a proposta muda no lugar depois.
        during = { ...slow.get('prop-ajuste')! }
        return team()
      },
    })
    const proposal = await slow.propose({ id: 'prop-ajuste', projectId: 'p1', room: 0, brief: 'Refazer a busca', ticketIds: [] })
    await slow.adjust(proposal.id, 'Inclua um testador')
    expect(during?.status).toBe('generating')
    expect(during?.composition?.members).toHaveLength(2)
  })

  it('a sala continua âmbar durante o ajuste', async () => {
    // A sala fica âmbar enquanto a nova composição é gerada: a proposta antiga
    // continua segurando a sala (holdsRoom).
    let held: boolean | undefined
    const slow = new SquadCreation({
      proposals: new SquadProposalStore(dataDir),
      queues: new SquadQueueStore(dataDir),
      board,
      projects: () => [project],
      settings,
      player: () => ({ kind: 'player', name: 'Malu' }),
      generate: async () => {
        held = holdsRoom(slow.get('prop-ajuste')!)
        return team()
      },
    })
    const proposal = await slow.propose({ id: 'prop-ajuste', projectId: 'p1', room: 0, brief: 'Refazer a busca', ticketIds: [] })
    await slow.adjust(proposal.id, 'Inclua um testador')
    expect(held).toBe(true)
    // E a sala continua âmbar com a proposta nova, esperando a aprovação.
    expect(holdsRoom(slow.get('prop-ajuste')!)).toBe(true)
  })

  it('o nome sobrevive a um ajuste que falha', async () => {
    let failNext = false
    const broken = new SquadCreation({
      proposals: new SquadProposalStore(dataDir),
      queues: new SquadQueueStore(dataDir),
      board,
      projects: () => [project],
      settings,
      player: () => ({ kind: 'player', name: 'Malu' }),
      generate: async () => {
        if (failNext) throw new Error('a IA não respondeu')
        return team()
      },
    })
    const proposal = await broken.propose({ id: 'prop-1', projectId: 'p1', room: 0, brief: 'Refazer a busca', ticketIds: [] })
    await broken.rename(proposal.id, 'Equipe da busca')
    failNext = true
    await expect(broken.adjust(proposal.id, 'Inclua um testador')).rejects.toThrow(/não respondeu/)
    const after = broken.get(proposal.id)!
    // A proposta volta a ficar pendente, com o nome que a pessoa escreveu.
    expect(after.status).toBe('pending')
    expect(after.name).toBe('Equipe da busca')
    expect(after.composition?.name).toBe('Equipe da busca')
    expect(after.composition?.members).toHaveLength(2)
  })

  it('o nome sobrevive ao cancelamento e à reabertura da janela', async () => {
    const proposal = await propose()
    creation.rename(proposal.id, 'Equipe da busca')
    // A pessoa fecha a janela (sem cancelar) e abre de novo: a proposta continua.
    const reopened = new SquadCreation({
      proposals: new SquadProposalStore(dataDir),
      queues: new SquadQueueStore(dataDir),
      board,
      projects: () => [project],
      settings,
      player: () => ({ kind: 'player', name: 'Malu' }),
      generate: async () => team(),
    })
    expect(reopened.get(proposal.id)?.name).toBe('Equipe da busca')
    expect(reopened.get(proposal.id)?.composition?.name).toBe('Equipe da busca')
  })
})

describe('a aprovação', () => {
  it('rejects generating and other non-approvable statuses even if a composition exists', async () => {
    const proposal = await propose()
    const stored = creation.get(proposal.id)!
    stored.status = 'generating'
    new SquadProposalStore(dataDir).put(stored)
    await expect(creation.approve(proposal.id, 'Equipe antiga')).rejects.toThrow(/gerando|pendente|aprovar|aprovável/i)
    expect(existsSync(join(project.cwd, 'squads'))).toBe(false)
    stored.status = 'created'
    delete stored.code
    new SquadProposalStore(dataDir).put(stored)
    await expect(creation.approve(proposal.id, 'Equipe antiga')).rejects.toThrow(/recuper|criado|aprovar|status|aprovável/i)
  })

  it('reconciles a durable created proposal after restart without changing queue order', async () => {
    const first = board.create({ title: 'Primeiro', status: 'todo', cwd: project.cwd }, { kind: 'player', name: 'Malu' })
    const second = board.create({ title: 'Segundo', status: 'todo', cwd: project.cwd }, { kind: 'player', name: 'Malu' })
    board.flush()
    const proposal = await propose(0, [first.id, second.id])
    const durableProposal = creation.get(proposal.id)!
    durableProposal.code = 'sala-1'
    durableProposal.status = 'created'
    durableProposal.name = 'Equipe da busca'
    durableProposal.composition = { ...durableProposal.composition!, name: durableProposal.name }
    new SquadProposalStore(dataDir).put(durableProposal)
    const plan = squadFilePlan(durableProposal.composition!, durableProposal.name, durableProposal.brief)
    plan.code = 'sala-1'
    plan.proposalId = durableProposal.id
    writeSquad(project.cwd, plan)
    board.flush()

    const restartedBoard = new TicketBoard(dataDir)
    const restarted = new SquadCreation({
      proposals: new SquadProposalStore(dataDir),
      queues: new SquadQueueStore(dataDir),
      board: restartedBoard,
      projects: () => [project],
      settings,
      player: () => ({ kind: 'player', name: 'Malu' }),
      generate: async () => team(),
    })
    expect(restarted.get(proposal.id)?.status).toBe('assigned')
    expect(restarted.queues()[0]).toMatchObject({ active: first.id, queue: [second.id] })
    expect(restartedBoard.get(first.id)?.status).toBe('doing')
    expect(restartedBoard.get(first.id)?.assignee?.id).toBe('squad:sala-1')
    expect(restartedBoard.get(second.id)?.assignee?.id).toBe('squad:sala-1')
  })

  it.each(['queue saved before assignment', 'one ticket durably assigned'])(
    'retries safely when crash occurs with %s',
    async (crashPoint) => {
      const first = board.create({ title: 'Primeiro', status: 'todo', cwd: project.cwd }, { kind: 'player', name: 'Malu' })
      const second = board.create({ title: 'Segundo', status: 'todo', cwd: project.cwd }, { kind: 'player', name: 'Malu' })
      board.flush()
      const proposal = await propose(0, [first.id, second.id])
      const durable = creation.get(proposal.id)!
      durable.code = 'sala-1'
      durable.name = 'Equipe da busca'
      durable.status = 'created'
      durable.ticketIds = [first.id, second.id]
      durable.composition = { ...durable.composition!, name: durable.name }
      new SquadProposalStore(dataDir).put(durable)
      const plan = squadFilePlan(durable.composition!, durable.name, durable.brief)
      plan.code = 'sala-1'
      plan.proposalId = durable.id
      writeSquad(project.cwd, plan)
      const queues = new SquadQueueStore(dataDir)
      queues.set({ code: 'sala-1', cwd: project.cwd, active: first.id, queue: [second.id], updatedAt: Date.now() })
      if (crashPoint === 'one ticket durably assigned') {
        board.assign(first.id, { kind: 'agent', name: durable.name, id: 'squad:sala-1' }, { kind: 'player', name: 'Malu' })
        board.move(first.id, 'doing', undefined, { kind: 'player', name: 'Malu' })
        board.flush()
      }
      const restartedBoard = new TicketBoard(dataDir)
      const restarted = new SquadCreation({
        proposals: new SquadProposalStore(dataDir),
        queues: new SquadQueueStore(dataDir),
        board: restartedBoard,
        projects: () => [project],
        settings,
        player: () => ({ kind: 'player', name: 'Malu' }),
        generate: async () => team(),
      })
      expect(restarted.get(proposal.id)?.status).toBe('assigned')
      expect(restarted.queues()[0]).toMatchObject({ active: first.id, queue: [second.id] })
      expect(restartedBoard.get(first.id)?.assignee?.id).toBe('squad:sala-1')
      expect(restartedBoard.get(second.id)?.assignee?.id).toBe('squad:sala-1')
      // Retry after reconciliation is idempotent and leaves the initial queue unchanged.
      const result = await restarted.approve(proposal.id, durable.name)
      expect(result.queue).toMatchObject({ active: first.id, queue: [second.id] })
    },
  )

  it('cria a pasta do squad, que passa na validação do office', async () => {
    const proposal = await propose()
    const { squad } = await creation.approve(proposal.id, 'Equipe da busca')
    expect(squad.code).toBe('sala-1')
    expect(squad.name).toBe('Equipe da busca')
    const found = findSquad(project.cwd, 'sala-1')
    expect(found).toBeDefined()
    expect(found!.members.map((m) => m.id)).toEqual(['maya', 'caio'])
  })

  it('sem tickets, o squad nasce disponível e a fila fica vazia', async () => {
    const proposal = await propose()
    const { queue } = await creation.approve(proposal.id, 'Equipe da busca')
    expect(queue?.active).toBeNull()
    expect(queue?.queue).toEqual([])
  })

  it('o primeiro ticket da ordem do quadro fica ativo e os outros na fila', async () => {
    const first = board.create({ title: 'Buscar', status: 'todo', cwd: project.cwd }, { kind: 'player', name: 'Malu' })
    const second = board.create({ title: 'Filtrar', status: 'todo', cwd: project.cwd }, { kind: 'player', name: 'Malu' })
    const third = board.create({ title: 'Testar', status: 'backlog', cwd: project.cwd }, { kind: 'player', name: 'Malu' })
    const proposal = await propose(0, [third.id, second.id, first.id])
    const { queue } = await creation.approve(proposal.id, 'Equipe da busca')
    // The order of the board decides: the backlog comes before "A fazer".
    expect(queue?.active).toBe(third.id)
    expect(queue?.queue).toEqual([first.id, second.id])
    expect(board.get(third.id)?.status).toBe('doing')
    expect(board.get(third.id)?.assignee).toMatchObject({ kind: 'agent', name: 'Equipe da busca', id: 'squad:sala-1' })
    // The waiting tickets stay in their column, with the squad as the responsible.
    expect(board.get(first.id)?.status).toBe('todo')
    expect(board.get(first.id)?.assignee?.id).toBe('squad:sala-1')
    expect(board.get(second.id)?.status).toBe('todo')
  })

  it('aprovação pula o primeiro ticket bloqueado e deixa-o na fila', async () => {
    const blocker = board.create({ title: 'Pré-requisito', status: 'review', cwd: project.cwd }, { kind: 'player', name: 'Malu' })
    const blocked = board.create({ title: 'Bloqueado', status: 'todo', cwd: project.cwd }, { kind: 'player', name: 'Malu' })
    const ready = board.create({ title: 'Livre', status: 'todo', cwd: project.cwd }, { kind: 'player', name: 'Malu' })
    board.update(blocked.id, { blockedBy: [blocker.id] }, { kind: 'player', name: 'Malu' })
    const proposal = await propose(0, [blocked.id, ready.id])
    const { queue } = await creation.approve(proposal.id, 'Equipe da busca')
    expect(queue).toMatchObject({ active: ready.id, queue: [blocked.id] })
    expect(board.get(blocked.id)?.status).toBe('todo')
    expect(board.get(blocked.id)?.assignee?.id).toBe('squad:sala-1')
    expect(board.get(ready.id)?.status).toBe('doing')
  })

  it('um ticket que já tem responsável não é roubado', async () => {
    const taken = board.create({ title: 'Já é de alguém', status: 'todo', cwd: project.cwd }, { kind: 'player', name: 'Malu' })
    board.assign(taken.id, { kind: 'agent', name: 'Ada', id: 'agent-1' }, { kind: 'player', name: 'Malu' })
    const proposal = await propose(0, [taken.id])
    await expect(creation.approve(proposal.id, 'Equipe da busca')).rejects.toThrow(/responsável/)
    // Nothing was created: the squad does not exist.
    expect(existsSync(join(project.cwd, 'squads', 'sala-1'))).toBe(false)
  })

  it('aprovar duas vezes não cria dois squads', async () => {
    const proposal = await propose()
    const first = await creation.approve(proposal.id, 'Equipe da busca')
    const second = await creation.approve(proposal.id, 'Equipe da busca')
    expect(second.squad.code).toBe(first.squad.code)
    expect(creation.list().filter((p) => p.status === 'assigned')).toHaveLength(1)
  })

  it('rejects a simultaneous second approval for the same proposal', async () => {
    const proposal = await propose()
    const [first, second] = await Promise.allSettled([
      creation.approve(proposal.id, 'Equipe da busca'),
      creation.approve(proposal.id, 'Equipe duplicada'),
    ])
    expect(first.status).toBe('fulfilled')
    expect(second.status).toBe('rejected')
    expect(creation.list().filter((p) => p.status === 'assigned')).toHaveLength(1)
    expect(findSquad(project.cwd, 'sala-1')?.name).toBe('Equipe da busca')
  })

  it('preserves the approval journal when discard races a queue failure and recovery completes it', async () => {
    const ticket = board.create({ title: 'Buscar', status: 'todo', cwd: project.cwd }, { kind: 'player', name: 'Malu' })
    const proposal = await propose(0, [ticket.id])
    const proposals = new SquadProposalStore(dataDir)
    proposals.put(creation.get(proposal.id)!)
    const queues = new SquadQueueStore(dataDir)
    const setQueue = queues.set.bind(queues)
    queues.set = () => {
      throw new Error('falha de fila injetada')
    }
    const approving = new SquadCreation({
      proposals,
      queues,
      board,
      projects: () => [project],
      settings,
      player: () => ({ kind: 'player', name: 'Malu' }),
      generate: async () => team(),
    })
    const approval = approving.approve(proposal.id, 'Equipe da busca')
    expect(() => approving.discard(proposal.id)).toThrow(/aprovação|recuperação/)
    await expect(approval).rejects.toThrow(/recuperação segura/)
    expect(approving.get(proposal.id)).toMatchObject({ status: 'created', code: 'sala-1' })
    expect(findSquad(project.cwd, 'sala-1')).toBeDefined()

    queues.set = setQueue
    const recovered = new SquadCreation({
      proposals: new SquadProposalStore(dataDir),
      queues,
      board,
      projects: () => [project],
      settings,
      player: () => ({ kind: 'player', name: 'Malu' }),
      generate: async () => team(),
    })
    expect(recovered.get(proposal.id)?.status).toBe('assigned')
    expect(queues.get('sala-1')).toMatchObject({ active: ticket.id, queue: [] })
    expect(board.get(ticket.id)?.assignee?.id).toBe('squad:sala-1')
    expect(findSquad(project.cwd, 'sala-1')).toBeDefined()
  })

  it('aprovar de novo com os mesmos tickets não duplica a fila', async () => {
    const ticket = board.create({ title: 'Buscar', status: 'todo', cwd: project.cwd }, { kind: 'player', name: 'Malu' })
    const proposal = await propose(0, [ticket.id])
    const first = await creation.approve(proposal.id, 'Equipe da busca')
    const second = await creation.approve(proposal.id, 'Equipe da busca')
    expect(second.queue?.active).toBe(first.queue?.active)
    expect(second.queue?.queue).toEqual([])
    expect(board.get(ticket.id)?.status).toBe('doing')
  })

  it('a sala fica com o squad: outra proposta é recusada', async () => {
    const proposal = await propose()
    await creation.approve(proposal.id, 'Equipe da busca')
    await expect(creation.propose({ id: 'prop-9', projectId: 'p1', room: 0, brief: 'x', ticketIds: [] })).rejects.toThrow(/já tem um squad/)
  })

  it('a fila do squad sobrevive a uma nova leitura do app', async () => {
    const ticket = board.create({ title: 'Buscar', status: 'todo', cwd: project.cwd }, { kind: 'player', name: 'Malu' })
    const proposal = await propose(0, [ticket.id])
    await creation.approve(proposal.id, 'Equipe da busca')
    const again = new SquadQueueStore(dataDir)
    expect(again.get('sala-1')?.active).toBe(ticket.id)
  })

  it('a proposta aprovada some da lista de pendentes', async () => {
    const proposal = await propose()
    await creation.approve(proposal.id, 'Equipe da busca')
    expect(creation.list().filter((p) => p.status === 'pending')).toHaveLength(0)
  })

  it('o squad criado aparece na sala, disponível para o popup de squads', async () => {
    // A aprovação não abre o popup de squads: o squad nasce na sala e o popup
    // existente (o da sala com squad) passa a mostrá-lo.
    const proposal = await propose()
    await creation.approve(proposal.id, 'Equipe da busca')
    const shown = inspectSquads(project.cwd)
    expect(shown).toHaveLength(1)
    expect(shown[0]?.code).toBe('sala-1')
    expect(shown[0]?.availability).toBe('available')
    expect(shown[0]?.name).toBe('Equipe da busca')
  })

  it('a sala é do squad depois da aprovação: a proposta não segura mais a sala', async () => {
    const proposal = await propose()
    await creation.approve(proposal.id, 'Equipe da busca')
    expect(holdsRoom(creation.get(proposal.id)!)).toBe(false)
    // E a sala mostra o squad, não uma equipe proposta.
    expect(squadInRoom(inspectSquads(project.cwd), 0)?.code).toBe('sala-1')
  })
})

describe('a geração', () => {
  it('o office pede a equipe ao gerador com o brief e os tickets', async () => {
    const seen: { brief: string; tickets: { key: string }[] }[] = []
    const spy = new SquadCreation({
      proposals: new SquadProposalStore(dataDir),
      queues: new SquadQueueStore(dataDir),
      board,
      projects: () => [project],
      settings,
      player: () => ({ kind: 'player', name: 'Malu' }),
      generate: async (req) => {
        seen.push({ brief: req.brief, tickets: req.tickets })
        return team()
      },
    })
    const ticket = board.create({ title: 'Buscar', status: 'todo', cwd: project.cwd }, { kind: 'player', name: 'Malu' })
    await spy.propose({ id: 'prop-5', projectId: 'p1', room: 0, brief: 'Refazer a busca', ticketIds: [ticket.id] })
    expect(seen[0]?.brief).toBe('Refazer a busca')
    expect(seen[0]?.tickets[0]?.key).toBe('AO-1')
    expect(calls).toBe(0)
  })
})
