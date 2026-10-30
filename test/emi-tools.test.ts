import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from './mocks/electron'
import { describePermission } from '../src/shared/describe'
import type { ProjectFloor, Settings, SquadProposalMember } from '../src/shared/types'
import type { IpcContext } from '../src/main/ipc/context'
import { EMI_CONFIRM_TOOLS, emiToolDefs, type EmiToolDeps } from '../src/main/emi-tools'

// The server only wraps the definitions: here it hands back the deps the IPC built, so the
// test calls the real handlers against the real stores and writers.
vi.mock('../src/main/emi-tools', async (original) => ({
  ...(await original<object>()),
  emiTools: (deps: unknown) => deps,
}))

const { registerSquadsIpc } = await import('../src/main/ipc/squads')
const { SquadCreation } = await import('../src/main/squad-creation')
const { SquadProposalStore } = await import('../src/main/squad-proposals')
const { SquadQueueStore } = await import('../src/main/squad-queues')
const { TicketBoard } = await import('../src/main/tickets')
const { ProjectWorkflowStore } = await import('../src/main/project-workflows')

const team = (): SquadProposalMember[] => [
  { id: 'maya', name: 'Maya', role: 'implementer', engine: 'claude', model: 'sonnet', account: '', focus: 'Implementa a busca' },
  { id: 'caio', name: 'Caio', role: 'reviewer', engine: 'claude', model: 'opus', account: '', focus: 'Revisa com olhar independente' },
]

async function call(deps: EmiToolDeps, name: string, args: Record<string, unknown> = {}) {
  const def = emiToolDefs(deps).find((t) => t.name === name)!
  const out = (await def.handler(args as never, {} as never)) as { content: { text: string }[]; isError?: boolean }
  return { text: out.content[0]!.text, isError: out.isError === true }
}

describe('ferramentas da Emi', () => {
  let project: ProjectFloor
  let deps: EmiToolDeps
  let board: InstanceType<typeof TicketBoard>
  let creation: InstanceType<typeof SquadCreation>
  let broadcast: unknown[]

  beforeEach(() => {
    const cwd = mkdtempSync(join(tmpdir(), 'ao-emi-project-'))
    const data = mkdtempSync(join(tmpdir(), 'ao-emi-data-'))
    project = { id: 'p1', name: 'Loja Aurora', cwd }
    const settings = { playerName: 'Malu', projects: [project], accounts: [], defaultPermissionMode: 'default' } as unknown as Settings
    board = new TicketBoard(data)
    const workflows = new ProjectWorkflowStore(data)
    creation = new SquadCreation({
      proposals: new SquadProposalStore(data),
      queues: new SquadQueueStore(data),
      board,
      projects: () => [project],
      settings: () => settings,
      player: () => ({ kind: 'player', name: 'Malu' }),
      workflows,
    })
    broadcast = []
    const manager = { list: () => [], pendingResults: () => [] } as unknown as IpcContext['manager']
    ipcMain.handlers.clear()
    registerSquadsIpc({
      store: { settings },
      manager,
      board,
      creation,
      projectWorkflows: workflows,
      player: () => ({ kind: 'player', name: 'Malu' }),
      broadcast: (e: unknown) => broadcast.push(e),
      rereadSquads: () => [],
      defaultBrain: () => ({}),
      win: () => null,
    } as unknown as IpcContext)
    deps = manager.emiTools!('p1') as unknown as EmiToolDeps
  })

  const ticket = (title: string) =>
    board.create({ title, description: 'x', acceptance: [], cwd: project.cwd }, { kind: 'player', name: 'Malu' })
  const plan = (tickets: string[]) => ({
    goal: 'Busca melhor',
    grill: 'Decidimos refazer a busca.',
    spec: '# Busca\nResultados em menos de 1 s.',
    criteria: ['Busca responde em menos de 1 s'],
    tickets,
  })

  it('aprovar o plano e criar o squad usam o mesmo caminho do "Criar squad"', async () => {
    const a = ticket('Indexar produtos')
    const b = ticket('Tela de busca')
    expect((await call(deps, 'squads_list')).text).toBe('Este andar ainda não tem squads.')
    expect((await call(deps, 'plan_get')).text).toBe('Este andar ainda não tem plano aprovado.')

    const approved = await call(deps, 'plan_approve', plan([a.key, b.key]))
    expect(approved).toEqual({ isError: false, text: 'Plano do andar Loja Aurora aprovado, com 2 tickets.' })
    expect((await call(deps, 'plan_get')).text).toContain(`${a.key} · Indexar produtos`)

    const created = await call(deps, 'squad_create', {
      name: 'Equipe da busca',
      brief: 'Refazer a busca',
      tickets: [a.key, b.key],
      members: team(),
    })
    expect(created).toEqual({ isError: false, text: expect.stringContaining('criado em squads/sala-1') })
    expect(existsSync(join(project.cwd, 'squads', 'sala-1', 'squad.yaml'))).toBe(true)
    expect(board.get(a.id)?.assignee?.id).toBe('squad:sala-1')
    expect(broadcast).toEqual([{ type: 'squads', squads: [] }])
    expect((await call(deps, 'squads_list')).text).toContain('Equipe da busca (squads/sala-1)')
  })

  it('sem plano aprovado, ou com equipe inválida, nada é escrito e a sala fica livre', async () => {
    const a = ticket('Indexar produtos')
    const early = await call(deps, 'squad_create', { name: 'X', brief: 'Y', tickets: [a.key], members: team() })
    expect(early.isError).toBe(true)
    expect(early.text).toMatch(/Aprove o grill/)

    await call(deps, 'plan_approve', plan([a.key]))
    const twoImplementers = team().map((m) => ({ ...m, role: 'implementer' as const }))
    const bad = await call(deps, 'squad_create', { name: 'X', brief: 'Y', tickets: [a.key], members: twoImplementers })
    expect(bad.isError).toBe(true)
    expect(creation.list()).toEqual([])
    expect(existsSync(join(project.cwd, 'squads'))).toBe(false)
  })

  it('ticket desconhecido ou de outro andar é recusado no plano', async () => {
    expect((await call(deps, 'plan_approve', plan(['AO-999']))).text).toMatch(/Não achei o ticket aberto AO-999/)
    const elsewhere = board.create({ title: 'Outro', description: '', acceptance: [], cwd: tmpdir() }, { kind: 'player', name: 'Malu' })
    expect((await call(deps, 'plan_approve', plan([elsewhere.key]))).text).toMatch(/pertencer a este andar/)
  })

  it('só aprovar o plano e criar squad pedem o cartão, que mostra a equipe exata', () => {
    const names = emiToolDefs(deps).map((t) => `mcp__emi__${t.name}`)
    expect(names.filter((n) => EMI_CONFIRM_TOOLS.has(n)).sort()).toEqual(['mcp__emi__plan_approve', 'mcp__emi__squad_create'])
    const card = describePermission('mcp__emi__squad_create', {
      name: 'Equipe da busca',
      brief: 'Refazer',
      tickets: ['AO-1'],
      members: team(),
    })
    expect(card.title).toBe('Posso criar o squad Equipe da busca?')
    expect(card.detail).toContain('- Maya · Implementador · modelo sonnet')
    expect(card.detail).toContain('- Caio · Revisor independente · modelo opus')
  })
})
