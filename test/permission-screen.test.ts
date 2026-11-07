import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LEVEL_INFO, LEVEL_TEXT, OWNER_ACCOUNT, levelCounts } from '../src/shared/permission-levels'
import type { AgentSummary, PermissionLevel } from '../src/shared/types'
import {
  applyLevelChanges,
  isFixedLevel,
  levelChoiceError,
  levelRow,
  levelRows,
  ownerAccountListed,
  type LevelManager,
} from '../src/main/permissions/screen'
import { cleanHire, setPermissionLevelsArgsSchema } from '../src/main/validate'

// AO-109, parte 4: a tela "Níveis de permissão". (A) lógica pura do que ela mostra, (B) validação e IPC em processo
// principal, (C) textos, (D) estático: nenhuma ferramenta de agente muda nível.

const ipc = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>() }))
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => ipc.handlers.set(channel, handler) },
  dialog: {},
  app: { getPath: () => tmpdir() },
}))
const { registerAgentsIpc } = await import('../src/main/ipc/agents')
const invoke = (channel: string, ...args: unknown[]): unknown => ipc.handlers.get(channel)!(undefined, ...args)

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const agent = (n: number, extra: Partial<AgentSummary> = {}): AgentSummary =>
  ({ id: ID(n), name: `Agente ${n}`, source: 'office', permissionMode: 'default', worktree: { path: 'C:/w', branch: 'b' }, ...extra }) as AgentSummary

describe('A) o que a tela mostra: nível efetivo e avisos', () => {
  it('agente salvo sem nível continua valendo pelo modo (migração)', () => {
    const r = levelRow(agent(1, { permissionMode: 'acceptEdits' }))
    expect(r.stored).toBeUndefined()
    expect(r.level).toBe(4)
    expect(r.requested).toBe(4)
    expect(levelRow(agent(2, { permissionMode: 'plan' })).level).toBe(2)
    expect(levelRow(agent(3, { permissionMode: 'default' })).level).toBe(3)
  })

  it('nível salvo manda sobre o modo, e um valor salvo inválido some', () => {
    expect(levelRow(agent(1, { permissionMode: 'default', permissionLevel: 2 })).level).toBe(2)
    const bad = levelRow(agent(2, { permissionMode: 'default', permissionLevel: 9 as PermissionLevel }))
    expect(bad.stored).toBeUndefined()
    expect(bad.level).toBe(3)
  })

  it('sem worktree os níveis 4 e 5 valem como 3, com aviso', () => {
    const r = levelRow(agent(1, { permissionLevel: 4, worktree: undefined }))
    expect(r.level).toBe(3)
    expect(r.downgraded).toBe(true)
    expect(r.hasWorktree).toBe(false)
    expect(r.warnings.join(' ')).toMatch(/Sem worktree/)
  })

  it('agente criado por outro agente tem teto 3', () => {
    const r = levelRow(agent(1, { permissionLevel: 4, createdByAgent: true }))
    expect(r.level).toBe(3)
    expect(r.warnings.join(' ')).toMatch(/criado por outro agente/)
  })

  it('o nível 5 não passa de 4 para agente avulso (só a Emi)', () => {
    const r = levelRow(agent(1, { permissionLevel: 5 }))
    expect(r.level).toBe(4)
    expect(r.requested).toBe(5)
    expect(r.downgraded).toBe(true)
  })

  it('agentes da casa têm nível fixo e a tela não deixa mudar', () => {
    for (const [extra, level] of [
      [{ builtIn: 'bonnie' }, 1],
      [{ builtIn: 'luna' }, 3],
      [{ builtIn: 'emi' }, 5],
      [{ role: 'orchestrator' }, 4],
      [{ ticketId: 't' }, 4],
    ] as const) {
      const r = levelRow(agent(1, { ...(extra as Partial<AgentSummary>), permissionLevel: 2 }))
      expect(r.fixed).toBe(true)
      expect(r.level).toBe(level)
      expect(r.warnings).toEqual([LEVEL_TEXT.fixed])
    }
    expect(isFixedLevel(agent(1))).toBe(false)
  })

  it('só agentes do escritório que não saíram aparecem; as contagens somam o nível que vale', () => {
    const rows = levelRows([
      agent(1, { permissionMode: 'plan' }),
      agent(2, { permissionMode: 'acceptEdits' }),
      agent(3, { permissionMode: 'acceptEdits', worktree: undefined }),
      agent(4, { source: 'terminal' as never }),
      agent(5, { departed: true }),
    ])
    expect(rows.map((r) => r.id)).toEqual([ID(1), ID(2), ID(3)])
    expect(levelCounts(rows)).toEqual({ 1: 0, 2: 1, 3: 1, 4: 1, 5: 0 })
  })

  it('o nível 5 exige a conta malu-code42 na lista', () => {
    expect(OWNER_ACCOUNT).toBe('malu-code42')
    expect(ownerAccountListed(undefined)).toBe(true) // padrão
    expect(ownerAccountListed(['malu-code42'])).toBe(true)
    expect(ownerAccountListed(['MALU-CODE42'])).toBe(true)
    expect(ownerAccountListed([])).toBe(false)
    expect(ownerAccountListed(['outra'])).toBe(false)
    expect(levelChoiceError(5, ['outra'])).toBe(LEVEL_TEXT.needOwner)
    expect(levelChoiceError(5, undefined)).toBeUndefined()
    expect(levelChoiceError(4, [])).toBeUndefined()
  })

  it('nível inválido é recusado', () => {
    for (const bad of [0, 6, 2.5, -1, '3', null, undefined, NaN, {}]) expect(levelChoiceError(bad, undefined)).toMatch(/inválido/)
  })
})

describe('B) validação e IPC no processo principal', () => {
  it('o esquema só aceita lote de ids válidos com nível 1 a 5 ou null', () => {
    const ok = (v: unknown) => setPermissionLevelsArgsSchema.safeParse([v]).success
    expect(ok([{ id: ID(1), level: 3 }])).toBe(true)
    expect(ok([{ id: ID(1), level: null }])).toBe(true)
    expect(ok([])).toBe(false)
    expect(ok([{ id: ID(1), level: 0 }])).toBe(false)
    expect(ok([{ id: ID(1), level: 6 }])).toBe(false)
    expect(ok([{ id: ID(1), level: 2.5 }])).toBe(false)
    expect(ok([{ id: ID(1), level: '3' }])).toBe(false)
    expect(ok([{ id: '', level: 3 }])).toBe(false)
    expect(ok([{ id: ID(1), level: 3, extra: 1 }])).toBe(false)
    expect(ok('3')).toBe(false)
  })

  let agents: AgentSummary[]
  let settings: { githubAccounts?: string[] }
  let manager: LevelManager & { setPermissionLevel: ReturnType<typeof vi.fn> }
  beforeEach(() => {
    ipc.handlers.clear()
    agents = [agent(1), agent(2, { builtIn: 'luna' }), agent(3, { permissionMode: 'plan' })]
    settings = {}
    manager = {
      list: () => agents,
      setPermissionLevel: vi.fn((id: string, level: PermissionLevel | undefined) => {
        const a = agents.find((x) => x.id === id)!
        if (level === undefined) delete a.permissionLevel
        else a.permissionLevel = level
      }),
    }
    registerAgentsIpc({ store: { get settings() { return settings } }, manager } as never)
  })

  it('office:permissionLevels devolve as linhas e a lista de contas', () => {
    const snap = invoke('office:permissionLevels') as { rows: { id: string; level: number }[]; githubAccounts: string[] }
    expect(snap.rows.map((r) => r.level)).toEqual([3, 3, 2])
    expect(snap.githubAccounts).toEqual(['malu-code42'])
  })

  it('office:setPermissionLevels grava e devolve o nível novo já considerando o rebaixamento', () => {
    const snap = invoke('office:setPermissionLevels', [{ id: ID(1), level: 4 }, { id: ID(3), level: null }]) as {
      rows: { id: string; level: number }[]
    }
    expect(manager.setPermissionLevel).toHaveBeenCalledWith(ID(1), 4)
    expect(manager.setPermissionLevel).toHaveBeenCalledWith(ID(3), undefined)
    expect(snap.rows.find((r) => r.id === ID(1))!.level).toBe(4)
  })

  it('nível inválido recusa o lote inteiro e nada é gravado', () => {
    expect(() => invoke('office:setPermissionLevels', [{ id: ID(1), level: 4 }, { id: ID(3), level: 9 }])).toThrow(/inválido/)
    expect(() => invoke('office:setPermissionLevels', 'lixo')).toThrow()
    expect(manager.setPermissionLevel).not.toHaveBeenCalled()
  })

  it('agente de nível fixo, agente que não existe e o 5 sem a conta são recusados sem gravar nada', () => {
    expect(() => invoke('office:setPermissionLevels', [{ id: ID(1), level: 4 }, { id: ID(2), level: 1 }])).toThrow(/fixo/)
    expect(() => invoke('office:setPermissionLevels', [{ id: ID(9), level: 4 }])).toThrow(/não está mais/)
    settings = { githubAccounts: ['outra'] }
    expect(() => invoke('office:setPermissionLevels', [{ id: ID(1), level: 5 }])).toThrow(/malu-code42/)
    expect(manager.setPermissionLevel).not.toHaveBeenCalled()
    settings = { githubAccounts: ['malu-code42'] }
    invoke('office:setPermissionLevels', [{ id: ID(1), level: 5 }])
    expect(manager.setPermissionLevel).toHaveBeenCalledWith(ID(1), 5)
  })

  it('applyLevelChanges é tudo ou nada', () => {
    expect(() => applyLevelChanges(manager, [{ id: ID(1), level: 3 }, { id: ID(2), level: 3 }], undefined)).toThrow()
    expect(manager.setPermissionLevel).not.toHaveBeenCalled()
  })

  describe('contratação com nível (Novo agente)', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ao-nivel-hire-'))
    const base = { accounts: [], defaultEngine: 'claude', defaultPermissionMode: 'default', projects: [] } as never
    const hire = (extra: Record<string, unknown>, githubAccounts?: string[]) =>
      cleanHire({ cwd, task: 'x', ...extra }, { ...(base as object), githubAccounts } as never)

    it('aceita 1 a 4, e sem nível não manda nada (vale pelo modo)', () => {
      expect(hire({ permissionLevel: 4 }).permissionLevel).toBe(4)
      expect(hire({ permissionLevel: 1 }).permissionLevel).toBe(1)
      expect('permissionLevel' in hire({})).toBe(false)
    })
    it('recusa nível inválido e o 5 sem a conta do dono', () => {
      for (const bad of [0, 6, '3', 2.5, null]) expect(() => hire({ permissionLevel: bad })).toThrow(/inválido/)
      expect(() => hire({ permissionLevel: 5 }, ['outra'])).toThrow(/malu-code42/)
      expect(hire({ permissionLevel: 5 }, ['malu-code42']).permissionLevel).toBe(5)
    })
  })
})

describe('C) textos', () => {
  it('são cinco níveis, do mais rígido ao mais livre, com os nomes do design aprovado', () => {
    expect(LEVEL_INFO.map((i) => i.level)).toEqual([1, 2, 3, 4, 5])
    expect(LEVEL_INFO.map((i) => i.name)).toEqual([
      'Somente leitura',
      'Leitura e análise',
      'Edição com cartão',
      'Autônomo na worktree',
      'Livre, regras do AO-99',
    ])
  })
  it('os avisos e os botões dizem o que o design aprovado diz', () => {
    expect(LEVEL_TEXT.windowTitle).toBe('Níveis de permissão')
    expect(LEVEL_TEXT.cancel).toBe('Cancelar')
    expect(LEVEL_TEXT.save).toBe('Salvar níveis')
    expect(LEVEL_TEXT.rules).toMatch(/Sem worktree, os níveis 4 e 5 valem como 3/)
    expect(LEVEL_TEXT.rules).toMatch(/no máximo no nível 3/)
    expect(LEVEL_TEXT.rules).toMatch(/malu-code42/)
    expect(LEVEL_TEXT.floor).toMatch(/merge, push na main, leitura de credenciais/)
  })
})

describe('D) só a usuária muda o nível', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f)
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []
    })
  it('setPermissionLevel só é chamado pelo canal IPC da tela (e definido no gerenciador)', () => {
    const users = walk(join(__dirname, '..', 'src'))
      .filter((p) => /setPermissionLevel/.test(readFileSync(p, 'utf8')))
      .map((p) => relative(join(__dirname, '..', 'src'), p).replace(/\\/g, '/'))
      .sort()
    expect(users).toEqual([
      'main/agents/office.ts',
      'main/ipc/agents.ts',
      'main/permissions/screen.ts',
      'main/validate.ts',
      'preload/index.ts',
      'renderer/src/ui/modals/levels.ts',
      'shared/types/ipc.ts',
    ])
    for (const tools of ['luna-tools.ts', 'emi-tools.ts', 'bonnie-tools.ts', 'merge-tools.ts', 'bridge.ts'])
      expect(readFileSync(join(__dirname, '..', 'src', 'main', tools), 'utf8')).not.toMatch(/setPermissionLevel/)
  })
})
