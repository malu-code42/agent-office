import { mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callHandler, ipcMain } from './mocks/electron'
import { registerSquadsIpc } from '../src/main/ipc/squads'
import { SquadCreation } from '../src/main/squad-creation'
import { SquadProposalStore } from '../src/main/squad-proposals'
import { SquadQueueStore } from '../src/main/squad-queues'
import { TicketBoard } from '../src/main/tickets'
import type { IpcContext } from '../src/main/ipc/context'
import type { Account, ProjectFloor, Settings, SquadProposalMember } from '@shared/types'
import { worktreeState } from '../src/main/git'

// The page sends the id of a proposal and the room it means: never a path. Every
// argument is checked before the office does anything with it.

let project: ProjectFloor
let creation: SquadCreation
let board: TicketBoard
let dataDir: string
let broadcast: unknown[]
let manager: { runSquad: (...args: unknown[]) => unknown; list: () => unknown[]; pendingResults: () => unknown[] }
let startRetry: ReturnType<typeof import('vitest').vi.fn>

const team = (): SquadProposalMember[] => [
  { id: 'maya', name: 'Maya', role: 'implementer', engine: 'claude', model: '', account: '', focus: 'Implementa' },
  { id: 'caio', name: 'Caio', role: 'reviewer', engine: 'claude', model: '', account: '', focus: 'Revisa' },
]

const settings = (): Settings =>
  ({
    playerName: 'Malu',
    projects: [project],
    accounts: [{ id: 'a1', name: 'pessoal' } as Account],
    defaultPermissionMode: 'default',
  }) as unknown as Settings

const propose = (id: string, room = 0, ticketIds: string[] = []) =>
  callHandler('office:proposeSquad', { id, projectId: 'p1', room, brief: 'Refazer a busca', ticketIds }) as Promise<{
    id: string
    status: string
  }>

beforeEach(() => {
  const cwd = mkdtempSync(join(tmpdir(), 'ao-squad-ipc-'))
  dataDir = mkdtempSync(join(tmpdir(), 'ao-squad-ipc-data-'))
  project = { id: 'p1', name: 'Loja Aurora', cwd }
  board = new TicketBoard(dataDir)
  broadcast = []
  manager = { runSquad: () => ({ id: 'agent-1' }), list: () => [], pendingResults: () => [] }
  startRetry = vi.fn(async () => undefined)
  creation = new SquadCreation({
    proposals: new SquadProposalStore(dataDir),
    queues: new SquadQueueStore(dataDir),
    board,
    projects: () => [project],
    settings,
    player: () => ({ kind: 'player', name: 'Malu' }),
    generate: async () => team(),
  })
  const ctx = {
    store: { settings: settings() },
    manager,
    board,
    defaultBrain: () => ({}),
    creation,
    broadcast: (e: unknown) => broadcast.push(e),
    rereadSquads: () => [],
    win: () => null,
    startActiveSquadTicket: startRetry,
    retrySquadPublication: vi.fn(),
  } as unknown as IpcContext
  ipcMain.handlers.clear()
  registerSquadsIpc(ctx)
})

describe('os canais de squad', () => {
  it('a proposta vem pelo id, pelo andar e pela sala', async () => {
    const proposal = await propose('proposta-1')
    expect(proposal.id).toBe('proposta-1')
    expect(proposal.status).toBe('pending')
  })

  it('uma sala fora do andar é recusada', async () => {
    await expect(
      callHandler('office:proposeSquad', { id: 'proposta-2', projectId: 'p1', room: 7, brief: 'x', ticketIds: [] }),
    ).rejects.toThrow()
  })

  it('um brief vazio é recusado', async () => {
    await expect(
      callHandler('office:proposeSquad', { id: 'proposta-3', projectId: 'p1', room: 0, brief: '   ', ticketIds: [] }),
    ).rejects.toThrow()
  })

  it('a aprovação exige um nome', async () => {
    const proposal = await propose('proposta-4')
    await expect(callHandler('office:approveSquadProposal', { id: proposal.id, name: '   ' })).rejects.toThrow()
  })

  it('a aprovação publica o squad e avisa a sala', async () => {
    const proposal = await propose('proposta-5')
    const squad = (await callHandler('office:approveSquadProposal', { id: proposal.id, name: 'Equipe da busca' })) as {
      code: string
    }
    expect(squad.code).toBe('sala-1')
    expect(broadcast).toEqual([{ type: 'squads', squads: [] }])
  })

  it('descartar a proposta não deixa nada', async () => {
    const proposal = await propose('proposta-6')
    await callHandler('office:discardSquadProposal', { id: proposal.id })
    expect(creation.list()).toEqual([])
  })

  it('o nome editado fica na proposta', async () => {
    const proposal = await propose('proposta-8')
    const renamed = (await callHandler('office:renameSquadProposal', { id: proposal.id, name: 'Equipe da busca' })) as {
      name: string
    }
    expect(renamed.name).toBe('Equipe da busca')
    expect(creation.get(proposal.id)?.name).toBe('Equipe da busca')
  })

  it('um nome vazio é recusado', async () => {
    const proposal = await propose('proposta-9')
    await expect(callHandler('office:renameSquadProposal', { id: proposal.id, name: '   ' })).rejects.toThrow()
    expect(creation.get(proposal.id)?.name).toBe('Squad da Sala 1')
  })

  it('o ajuste leva o nome que a pessoa editou', async () => {
    const proposal = await propose('proposta-10')
    const adjusted = (await callHandler('office:adjustSquadProposal', {
      id: proposal.id,
      adjustment: 'Inclua um testador',
      name: 'Equipe da busca',
    })) as { name: string }
    expect(adjusted.name).toBe('Equipe da busca')
    expect(creation.get(proposal.id)?.name).toBe('Equipe da busca')
  })

  it('a fila de um código que não é nome de squad é nada', async () => {
    expect(await callHandler('office:squadQueue', '../../etc/passwd')).toBeUndefined()
  })

  it('a action de retry de startup chama inicialização do ticket, não publicação', async () => {
    creation.queue = (() => ({
      code: 'sala-1', cwd: project.cwd, queue: [], updatedAt: 1,
      active: 'ticket-1',
      cycle: { ticketId: 'ticket-1', worktree: { path: 'saved', root: 'saved', repo: 'repo', branch: 'agent/saved', base: 'a'.repeat(40) } },
    })) as typeof creation.queue
    await callHandler('office:retrySquadStart', 'sala-1')
    expect(startRetry).toHaveBeenCalledWith('sala-1')
  })

  it('o ciclo do squad começa pelo ticket que ele tem', async () => {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: project.cwd, encoding: 'utf8' })
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'teste@exemplo.com')
    git('config', 'user.name', 'Teste')
    mkdirSync(join(project.cwd, '_opensquad', 'core'), { recursive: true })
    writeFileSync(join(project.cwd, '_opensquad', 'core', 'runner.pipeline.md'), 'runner')
    git('add', '.')
    git('commit', '-qm', 'init')
    const ticket = board.create({ title: 'Refazer a busca', status: 'todo', cwd: project.cwd }, { kind: 'player', name: 'Malu' })
    const proposal = await propose('proposta-7', 0, [ticket.id])
    await creation.approve(proposal.id, 'Equipe da busca')
    const prompts: string[] = []
    let runArgs: unknown[] = []
    manager.runSquad = (...args: unknown[]) => {
      prompts.push(String(args[1]))
      runArgs = args
      return { id: 'agent-1' }
    }
    await callHandler('office:runSquad', project.cwd, 'sala-1', 'default', '', false)
    expect(prompts[0]).toContain('squads/sala-1')
    expect(prompts[0]).toContain(ticket.key)
    expect(runArgs[4]).toMatchObject({ branch: expect.stringMatching(/^agent\//), path: expect.stringContaining('.agent-office') })
    expect(runArgs[5]).toBe(ticket.id)
    expect(creation.queue('sala-1')?.cycle?.ticketId).toBe(ticket.id)
    const worktree = runArgs[4] as Parameters<typeof worktreeState>[0]
    expect(worktree.base).toBe(git('rev-parse', 'HEAD').trim())
    expect(await worktreeState(worktree)).toMatchObject({ dirty: 0, ignored: expect.any(Number) })
  })
})
