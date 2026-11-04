import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
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
const { SquadStatusStore } = await import('../src/main/squad-status')

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
  let squadStatus: InstanceType<typeof SquadStatusStore>
  let agents: { id: string; name: string; cwd: string; status: string; role?: string; squad?: string }[]
  let fired: string[]
  let hired: { name: string; cwd: string; permissionMode: string }[]

  beforeEach(() => {
    fired = []
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
    agents = []
    hired = []
    const manager = {
      list: () => agents,
      pendingResults: () => [],
      fire: (id: string) => {
        fired.push(id)
        agents = agents.filter((a) => a.id !== id)
      },
      hire: async (req: { name: string; cwd: string; permissionMode: string }) => {
        hired.push(req)
        return { id: `new-${req.name}`, name: req.name }
      },
    } as unknown as IpcContext['manager']
    ipcMain.handlers.clear()
    squadStatus = new SquadStatusStore(data)
    registerSquadsIpc({
      store: { settings },
      manager,
      board,
      creation,
      squadStatus,
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
    bootstrap: 'skipped' as const,
    brainstorm: 'Decidimos refazer a busca.',
    design: '# Busca\nResultados em menos de 1 s.',
    designPath: 'docs/designs/busca.md',
    criteria: ['Busca responde em menos de 1 s'],
    review: 'Tratado: o zoom-out pediu limite de resultados.',
    tickets,
  })

  it('aprovar o plano e criar o squad usam o mesmo caminho do "Criar squad"', async () => {
    const a = ticket('Indexar produtos')
    const b = ticket('Tela de busca')
    expect((await call(deps, 'squads_list')).text).toBe('Este andar ainda não tem squads.')
    expect((await call(deps, 'plan_get')).text).toBe('Este andar ainda não tem plano aprovado. Bootstrap EGM: pendente.')

    const approved = await call(deps, 'plan_approve', plan([a.key, b.key]))
    expect(approved).toEqual({ isError: false, text: 'Plano do andar Loja Aurora aprovado, com 2 tickets.' })
    const shown = (await call(deps, 'plan_get')).text
    expect(shown).toContain(`${a.key} · Indexar produtos`)
    expect(shown).toContain('Bootstrap: pulado · Brainstorm: aprovado · Design: aprovado · Revisão Goldfish: aprovado · Tickets: aprovados')
    expect(shown).toContain('Design doc (docs/designs/busca.md):')

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
    expect(early.text).toMatch(/Aprove o brainstorm, o design, a Revisão Goldfish/)

    await call(deps, 'plan_approve', plan([a.key]))
    const twoImplementers = team().map((m) => ({ ...m, role: 'implementer' as const }))
    const bad = await call(deps, 'squad_create', { name: 'X', brief: 'Y', tickets: [a.key], members: twoImplementers })
    expect(bad.isError).toBe(true)
    expect(creation.list()).toEqual([])
    expect(existsSync(join(project.cwd, 'squads'))).toBe(false)
  })

  it('squad_message sem ciclo rodando é recusado; squad_run de squad inexistente também', async () => {
    const msg = await call(deps, 'squad_message', { code: 'sala-1', text: 'Priorize a busca' })
    expect(msg).toEqual({ isError: true, text: expect.stringContaining('não está rodando') })
    expect((await call(deps, 'squad_run', { code: 'sala-1' })).isError).toBe(true)
  })

  it('o relatório de drift fica registrado sem cartão e sem mudar etapas', async () => {
    const a = ticket('Indexar produtos')
    expect((await call(deps, 'drift_report_save', { summary: 'Busca sem limite de resultados.' })).isError).toBe(true)
    await call(deps, 'plan_approve', plan([a.key]))
    const saved = await call(deps, 'drift_report_save', { summary: 'Busca sem limite de resultados.' })
    expect(saved).toEqual({ isError: false, text: expect.stringContaining('Relatório de drift registrado') })
    const shown = (await call(deps, 'plan_get')).text
    expect(shown).toContain('Último relatório de drift')
    expect(shown).toContain('Tickets: aprovados')
    expect(EMI_CONFIRM_TOOLS.has('mcp__emi__drift_report_save')).toBe(false)
  })

  it('o cartão do plano mostra as etapas do EGM inteiras', () => {
    const card = describePermission('mcp__emi__plan_approve', plan(['AO-1']))
    expect(card.detail).toContain('Bootstrap EGM: pulado')
    expect(card.detail).toContain('Rascunho do design (docs/designs/busca.md):')
    expect(card.detail).toContain('Revisão Goldfish:\nTratado: o zoom-out pediu limite de resultados.')
  })

  it('ticket desconhecido ou de outro andar é recusado no plano', async () => {
    expect((await call(deps, 'plan_approve', plan(['AO-999']))).text).toMatch(/Não achei o ticket aberto AO-999/)
    const elsewhere = board.create({ title: 'Outro', description: '', acceptance: [], cwd: tmpdir() }, { kind: 'player', name: 'Malu' })
    expect((await call(deps, 'plan_approve', plan([elsewhere.key]))).text).toMatch(/pertencer a este andar/)
  })

  it('só aprovar o plano e criar squad pedem o cartão, que mostra a equipe exata', () => {
    const names = emiToolDefs(deps).map((t) => `mcp__emi__${t.name}`)
    expect(names.filter((n) => EMI_CONFIRM_TOOLS.has(n)).sort()).toEqual([
      'mcp__emi__agent_delete',
      'mcp__emi__plan_approve',
      'mcp__emi__squad_create',
      'mcp__emi__squad_delete',
      'mcp__emi__squad_run',
    ])
    for (const free of ['squad_pause', 'squad_resume', 'squad_disable', 'agent_create'])
      expect(EMI_CONFIRM_TOOLS.has(`mcp__emi__${free}`)).toBe(false)
    expect(describePermission('mcp__emi__squad_run', { code: 'sala-1' }).title).toBe('Posso iniciar o squad sala-1?')
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

  // AO-60: the floor's squads and agents, changed by Emi.
  const makeSquad = async () => {
    const a = ticket('Indexar produtos')
    await call(deps, 'plan_approve', plan([a.key]))
    const created = await call(deps, 'squad_create', { name: 'Equipe da busca', brief: 'Refazer', tickets: [a.key], members: team() })
    expect(created.isError).toBe(false)
    return join(project.cwd, 'squads', 'sala-1')
  }

  it('pausar, desativar e retomar um squad não pedem cartão e não mexem em squads/', async () => {
    const dir = await makeSquad()
    const before = readFileSync(join(dir, 'squad.yaml'), 'utf8')

    expect((await call(deps, 'squad_pause', { code: 'sala-1' })).text).toMatch(/pausado/)
    expect(squadStatus.get(project.cwd, 'sala-1')).toBe('paused')
    expect((await call(deps, 'squads_list')).text).toContain('Pausado: retome o squad')
    expect(await call(deps, 'squad_run', { code: 'sala-1' })).toEqual({ isError: true, text: expect.stringContaining('pausado') })

    expect((await call(deps, 'squad_disable', { code: 'sala-1' })).text).toMatch(/desativado/)
    expect(squadStatus.get(project.cwd, 'sala-1')).toBe('disabled')
    expect((await call(deps, 'squad_resume', { code: 'sala-1' })).text).toMatch(/retomado/)
    expect(squadStatus.get(project.cwd, 'sala-1')).toBeUndefined()
    expect((await call(deps, 'squads_list')).text).not.toContain('indisponível')

    expect(readFileSync(join(dir, 'squad.yaml'), 'utf8')).toBe(before)
  })

  it('pausar squad inexistente é recusado e não grava estado', async () => {
    const r = await call(deps, 'squad_pause', { code: 'sala-9' })
    expect(r.isError).toBe(true)
    expect(squadStatus.get(project.cwd, 'sala-9')).toBeUndefined()
  })

  it('excluir squad apaga só a pasta dele e recusa quando há agente ou ticket rodando', async () => {
    const dir = await makeSquad()
    agents = [{ id: 'o1', name: 'Orq', cwd: project.cwd, status: 'working', role: 'orchestrator', squad: 'sala-1' }]
    const busy = await call(deps, 'squad_delete', { code: 'sala-1' })
    expect(busy).toEqual({ isError: true, text: expect.stringContaining('ainda está rodando') })
    expect(existsSync(dir)).toBe(true)

    agents = []
    expect((await call(deps, 'squad_delete', { code: 'sala-1' })).text).toMatch(/atribuído/)
    expect(existsSync(dir)).toBe(true)
    // The squad's queue holds its assigned ticket; with nothing assigned and nothing running, delete goes through.
    vi.spyOn(creation, 'queue').mockReturnValue(undefined)
    expect((await call(deps, 'squad_delete', { code: 'sala-1' })).text).toMatch(/excluído/)
    expect(existsSync(dir)).toBe(false)
    expect(existsSync(join(project.cwd, 'squads'))).toBe(true)
    expect(broadcast.at(-1)).toEqual({ type: 'squads', squads: [] })
  })

  it('excluir squad com código inválido é recusado antes de tocar em disco', async () => {
    const r = await call(deps, 'squad_delete', { code: '../x' })
    expect(r.isError).toBe(true)
  })

  it('dispensar agente: só parado, do andar, sem nome ambíguo', async () => {
    agents = [
      { id: 'a1', name: 'Ada', cwd: project.cwd, status: 'idle' },
      { id: 'a2', name: 'Bob', cwd: project.cwd, status: 'working' },
      { id: 'a3', name: 'Dup', cwd: project.cwd, status: 'idle' },
      { id: 'a4', name: 'Dup', cwd: project.cwd, status: 'idle' },
      { id: 'a5', name: 'Eva', cwd: tmpdir(), status: 'idle' },
    ]
    expect((await call(deps, 'agent_delete', { agent: 'Bob' })).isError).toBe(true)
    expect((await call(deps, 'agent_delete', { agent: 'Dup' })).text).toMatch(/use o id/)
    expect((await call(deps, 'agent_delete', { agent: 'Eva' })).isError).toBe(true)
    expect(fired).toEqual([])

    expect((await call(deps, 'agent_delete', { agent: 'Ada' })).text).toMatch(/dispensado/)
    expect((await call(deps, 'agent_delete', { agent: 'a3' })).isError).toBe(false)
    expect(fired).toEqual(['a1', 'a3'])
  })

  it('contratar agente usa a pasta do andar e o modo padrão, mesmo se o andar for mais permissivo', async () => {
    project.permissionMode = 'bypassPermissions'
    const r = await call(deps, 'agent_create', { name: 'Iris', task: 'Revisar a busca' })
    expect(r).toEqual({ isError: false, text: expect.stringContaining('Iris') })
    expect(hired).toEqual([expect.objectContaining({ name: 'Iris', cwd: project.cwd, permissionMode: 'default' })])
  })
})
