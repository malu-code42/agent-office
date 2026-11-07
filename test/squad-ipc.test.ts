import { mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callHandler, ipcMain } from './mocks/electron'
import { registerSquadsIpc } from '../src/main/ipc/squads'
import { SquadCreation } from '../src/main/squad-creation'
import { SquadStatusStore } from '../src/main/squad-status'
import { SquadProposalStore } from '../src/main/squad-proposals'
import { SquadQueueStore } from '../src/main/squad-queues'
import { TicketBoard } from '../src/main/tickets'
import type { IpcContext } from '../src/main/ipc/context'
import type { Account, ProjectFloor, Settings, SquadProposalMember } from '@shared/types'
import { worktreeState } from '../src/main/git'
import * as gitModule from '../src/main/git'

// The page sends the id of a proposal and the room it means: never a path. Every
// argument is checked before the office does anything with it.

let project: ProjectFloor
let creation: SquadCreation
let board: TicketBoard
let dataDir: string
let broadcast: unknown[]
let manager: {
  runSquad: (...args: unknown[]) => unknown
  list: () => unknown[]
  pendingResults: () => unknown[]
  reserveSquadStart: (cwd: string, code: string) => (() => void) | undefined
}
let startRetry: ReturnType<typeof import('vitest').vi.fn>
let squadStatus: SquadStatusStore
let baseBrain: { model?: string; effort?: 'low' | 'medium' | 'high' } = {}

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
  const starts = new Set<string>()
  manager = {
    runSquad: () => ({ id: 'agent-1' }),
    list: () => [],
    pendingResults: () => [],
    reserveSquadStart: (cwd, code) => {
      const key = `${cwd}:${code}`
      if (starts.has(key)) return undefined
      starts.add(key)
      return () => {
        starts.delete(key)
      }
    },
  }
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
  squadStatus = new SquadStatusStore(dataDir)
  const ctx = {
    store: { settings: settings() },
    manager,
    board,
    defaultBrain: () => baseBrain,
    creation,
    squadStatus,
    broadcast: (e: unknown) => broadcast.push(e),
    rereadSquads: () => [],
    win: () => null,
    startActiveSquadTicket: startRetry,
    retrySquadPublication: vi.fn(),
  } as unknown as IpcContext
  baseBrain = {}
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

  it('pausar e retomar mudam o estado guardado e avisam a tela (AO-108)', async () => {
    const proposal = await propose('proposta-pausa')
    await callHandler('office:approveSquadProposal', { id: proposal.id, name: 'Equipe da busca' })
    broadcast.length = 0
    await callHandler('office:setSquadPaused', project.cwd, 'sala-1', true)
    expect(squadStatus.get(project.cwd, 'sala-1')).toBe('paused')
    await callHandler('office:setSquadPaused', project.cwd, 'sala-1', false)
    expect(squadStatus.get(project.cwd, 'sala-1')).toBeUndefined()
    expect(broadcast).toHaveLength(2)
  })

  it('pausar recusa pasta fora dos andares, código inválido e squad inexistente', async () => {
    await expect(callHandler('office:setSquadPaused', 'C:/fora', 'sala-1', true)).rejects.toThrow()
    await expect(callHandler('office:setSquadPaused', project.cwd, '../x', true)).rejects.toThrow()
    await expect(callHandler('office:setSquadPaused', project.cwd, 'nao-existe', true)).rejects.toThrow()
    await expect(callHandler('office:setSquadPaused', project.cwd, 'sala-1', 'sim')).rejects.toThrow()
  })

  it('a action de retry de startup chama inicialização do ticket, não publicação', async () => {
    creation.queue = (() => ({
      code: 'sala-1',
      cwd: project.cwd,
      queue: [],
      updatedAt: 1,
      active: 'ticket-1',
      cycle: {
        ticketId: 'ticket-1',
        worktree: { path: 'saved', root: 'saved', repo: 'repo', branch: 'agent/saved', base: 'a'.repeat(40) },
      },
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

  it('squad pausado não cria ciclo: o runSquad recusa antes de qualquer worktree ou agente', async () => {
    const ticket = board.create({ title: 'Refazer a busca', status: 'todo', cwd: project.cwd }, { kind: 'player', name: 'Malu' })
    const proposal = await propose('proposta-8', 0, [ticket.id])
    await creation.approve(proposal.id, 'Equipe da busca')
    const runSquad = vi.fn(() => ({ id: 'agent-1' }))
    manager.runSquad = runSquad
    squadStatus.set(project.cwd, 'sala-1', 'paused')
    let failure: Error | undefined
    try {
      await callHandler('office:runSquad', project.cwd, 'sala-1', 'default', '', false)
    } catch (err) {
      failure = err as Error
    }
    expect(failure?.message).toMatch(/pausado/)
    expect(runSquad).not.toHaveBeenCalled()
    expect(creation.queue('sala-1')?.cycle).toBeUndefined()
  })

  it('AO-54: dois inícios concorrentes não disputam o diário nem criam duas worktrees', async () => {
    const ticket = board.create({ title: 'Ticket sintético', cwd: project.cwd }, { kind: 'player', name: 'Malu' })
    const proposal = await propose('proposta-9', 0, [ticket.id])
    await creation.approve(proposal.id, 'Equipe')
    let finish!: (value: null) => void
    const create = vi
      .spyOn(gitModule, 'createWorktree')
      .mockResolvedValue(null)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      )
    try {
      const first = Promise.resolve(callHandler('office:runSquad', project.cwd, 'sala-1', 'default', '', false)).catch(
        (error: unknown) => error,
      )
      await expect(callHandler('office:runSquad', project.cwd, 'sala-1', 'default', '', false)).rejects.toThrow(/iniciado/)
      expect(create).toHaveBeenCalledOnce()
      finish(null)
      expect(await first).toMatchObject({ message: expect.stringMatching(/repositório git/) })
      // Failure releases the reservation, so retry can prepare the same ticket again.
      create.mockResolvedValue(null)
      await expect(callHandler('office:runSquad', project.cwd, 'sala-1', 'default', '', false)).rejects.toThrow(/repositório git/)
      expect(create).toHaveBeenCalledTimes(2)
    } finally {
      finish(null)
      create.mockRestore()
    }
  })

  it('AO-54: pausa durante a preparação impede envio e preserva o ciclo para retomada', async () => {
    const ticket = board.create({ title: 'Ticket sintético', cwd: project.cwd }, { kind: 'player', name: 'Malu' })
    const proposal = await propose('proposta-10', 0, [ticket.id])
    await creation.approve(proposal.id, 'Equipe')
    const worktree = { path: project.cwd, root: project.cwd, repo: project.cwd, branch: 'agent/sintetico', base: 'a'.repeat(40) }
    const create = vi.spyOn(gitModule, 'createWorktree').mockResolvedValue(worktree)
    const exclude = vi.spyOn(gitModule, 'excludeSquadRuntime').mockImplementation(async () => {
      squadStatus.set(project.cwd, 'sala-1', 'paused')
    })
    mkdirSync(join(project.cwd, '_opensquad', 'core'), { recursive: true })
    writeFileSync(join(project.cwd, '_opensquad', 'core', 'runner.pipeline.md'), 'runner')
    const run = vi.fn(() => ({ id: 'agent-1' }))
    manager.runSquad = run
    try {
      await expect(callHandler('office:runSquad', project.cwd, 'sala-1', 'default', '', false)).rejects.toThrow(/pausado/)
      expect(run).not.toHaveBeenCalled()
      expect(creation.queue('sala-1')?.cycle).toMatchObject({ ticketId: ticket.id, worktree })
      squadStatus.set(project.cwd, 'sala-1', null)
      exclude.mockResolvedValue(undefined)
      await callHandler('office:runSquad', project.cwd, 'sala-1', 'default', '', false)
      expect(run).toHaveBeenCalledOnce()
      expect(create).toHaveBeenCalledOnce()
    } finally {
      create.mockRestore()
      exclude.mockRestore()
    }
  })

  // AO-86 criteria 2 and 3: o par do ticket ativo (ou o padrão das configurações) chega a manager.runSquad.
  describe('modelo e esforço do ciclo avulso', () => {
    const runCycle = async (ticketFields: { model?: string; effort?: 'low' | 'medium' | 'high' }) => {
      const ticket = board.create({ title: 'Ticket sintético', cwd: project.cwd, ...ticketFields }, { kind: 'player', name: 'Malu' })
      const proposal = await propose(`proposta-brain-${ticketFields.model ?? 'sem'}`, 0, [ticket.id])
      await creation.approve(proposal.id, 'Equipe')
      const worktree = { path: project.cwd, root: project.cwd, repo: project.cwd, branch: 'agent/sintetico', base: 'a'.repeat(40) }
      const create = vi.spyOn(gitModule, 'createWorktree').mockResolvedValue(worktree)
      const exclude = vi.spyOn(gitModule, 'excludeSquadRuntime').mockResolvedValue(undefined)
      mkdirSync(join(project.cwd, '_opensquad', 'core'), { recursive: true })
      writeFileSync(join(project.cwd, '_opensquad', 'core', 'runner.pipeline.md'), 'runner')
      const run = vi.fn((..._args: unknown[]) => ({ id: 'agent-1' }))
      manager.runSquad = run
      try {
        await callHandler('office:runSquad', project.cwd, 'sala-1', 'default', '', false)
      } finally {
        create.mockRestore()
        exclude.mockRestore()
      }
      expect(run).toHaveBeenCalledOnce()
      return run.mock.calls[0]![3] as { model?: string; effort?: string; permissionMode?: string }
    }

    it('ticket com opus e high roda o ciclo com esse par, não com o padrão', async () => {
      baseBrain = { model: 'claude-sonnet-5-5', effort: 'low' }
      const brain = await runCycle({ model: 'claude-opus-5-5', effort: 'high' })
      expect(brain).toMatchObject({ model: 'claude-opus-5-5', effort: 'high', permissionMode: 'default' })
    })

    it('ticket sem modelo usa o padrão das configurações', async () => {
      baseBrain = { model: 'claude-sonnet-5-5', effort: 'medium' }
      const brain = await runCycle({})
      expect(brain).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'medium' })
    })
  })
})
