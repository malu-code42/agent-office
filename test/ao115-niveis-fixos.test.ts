import { readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { AgentSummary, PermissionLevel } from '../src/shared/types'
import { cleanLevel, effectiveLevel, routineLevel } from '../src/main/permissions/levels'
import { applyLevelChanges, levelRow, type LevelManager } from '../src/main/permissions/screen'
import { cleanRoutineDraft } from '../src/main/validate'

// AO-115: os agentes de nível da casa (Luna, Emi, Bonnie, orquestrador, agente de ticket) e as rotinas ganham seletor.
// Só a usuária troca (IPC da tela); nenhuma ferramenta de agente chega no gravador.

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, dialog: {}, app: { getPath: () => tmpdir() } }))

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const agent = (n: number, extra: Partial<AgentSummary> = {}): AgentSummary =>
  ({ id: ID(n), name: `Agente ${n}`, source: 'office', permissionMode: 'default', worktree: { path: 'C:/w', branch: 'b' }, ...extra }) as AgentSummary

const KINDS: [string, Partial<AgentSummary>, PermissionLevel][] = [
  ['Luna', { builtIn: 'luna' }, 3],
  ['Emi', { builtIn: 'emi' }, 5],
  ['Bonnie', { builtIn: 'bonnie' }, 1],
  ['orquestrador', { role: 'orchestrator' }, 4],
  ['agente de ticket', { ticketId: 't1' }, 4],
]

describe('AO-115: padrão da casa quando nada foi escolhido (comportamento igual ao de antes)', () => {
  for (const [name, extra, dflt] of KINDS) {
    it(`${name} vale ${dflt} sem escolha, mesmo com permissionLevel salvo de outra coisa`, () => {
      const r = levelRow(agent(1, { ...extra, permissionLevel: 2 }))
      expect(r.level).toBe(dflt)
      expect(r.stored).toBeUndefined()
    })
  }
})

describe('AO-115: troca de cada tipo', () => {
  for (const [name, extra] of KINDS) {
    it(`${name}: a escolha vale na próxima decisão`, () => {
      const r = levelRow(agent(1, { ...extra, chosenLevel: 2 }))
      expect(r.level).toBe(2)
      expect(r.stored).toBe(2)
      expect(r.fixed).toBe(true)
    })
    it(`${name}: a tela aceita a troca e "null" volta ao padrão`, () => {
      const a = agent(1, extra)
      const set = vi.fn()
      const m: LevelManager = { list: () => [a], setPermissionLevel: set }
      expect(applyLevelChanges(m, [{ id: a.id, level: 2 }], undefined)).toBe(1)
      expect(set).toHaveBeenCalledWith(a.id, 2)
      applyLevelChanges(m, [{ id: a.id, level: null }], undefined)
      expect(set).toHaveBeenLastCalledWith(a.id, undefined)
    })
  }

  it('o gerenciador grava o agente da casa em chosenLevel e o avulso em permissionLevel', async () => {
    const { AgentOffice } = await import('../src/main/agents/office')
    const proto = AgentOffice.prototype as unknown as {
      setPermissionLevel(this: unknown, id: string, l: PermissionLevel | undefined): void
    }
    const luna = { summary: agent(1, { builtIn: 'luna' }) }
    const plain = { summary: agent(2) }
    const self = {
      agents: new Map([
        [ID(1), luna],
        [ID(2), plain],
      ]),
      upsert: vi.fn(),
    }
    proto.setPermissionLevel.call(self, ID(1), 4)
    proto.setPermissionLevel.call(self, ID(2), 4)
    expect(luna.summary.chosenLevel).toBe(4)
    expect(luna.summary.permissionLevel).toBeUndefined()
    expect(plain.summary.permissionLevel).toBe(4)
    expect(plain.summary.chosenLevel).toBeUndefined()
    proto.setPermissionLevel.call(self, ID(1), undefined)
    expect(luna.summary.chosenLevel).toBeUndefined()
    expect(() => proto.setPermissionLevel.call(self, ID(9), 3)).toThrow(/não está mais/)
  })
})

describe('AO-115: regras mantidas', () => {
  it('sem worktree, 4 e 5 escolhidos valem 3 (Luna, Emi, orquestrador, ticket)', () => {
    for (const [, extra] of KINDS.filter(([n]) => n !== 'Bonnie')) {
      for (const lvl of [4, 5] as const) {
        const r = levelRow(agent(1, { ...extra, chosenLevel: lvl, worktree: undefined }))
        expect(r.level).toBe(3)
        expect(r.downgraded).toBe(true)
      }
    }
  })
  it('nível 5 só com a conta malu-code42, também para agente da casa', () => {
    const a = agent(1, { builtIn: 'luna' })
    const m: LevelManager = { list: () => [a], setPermissionLevel: vi.fn() }
    expect(() => applyLevelChanges(m, [{ id: a.id, level: 5 }], ['outra'])).toThrow(/malu-code42/)
    expect(m.setPermissionLevel).not.toHaveBeenCalled()
    expect(applyLevelChanges(m, [{ id: a.id, level: 5 }], ['malu-code42'])).toBe(1)
  })
  it('agente criado por agente continua com teto 3 e só a Emi passa de 4', () => {
    expect(levelRow(agent(1, { ticketId: 't', chosenLevel: 4, createdByAgent: true })).level).toBe(3)
    expect(levelRow(agent(1, { builtIn: 'luna', chosenLevel: 5 })).level).toBe(4)
    expect(levelRow(agent(1, { builtIn: 'emi', chosenLevel: 5 })).level).toBe(5)
  })
  it('escolha inválida salva é ignorada (vale o padrão)', () => {
    expect(effectiveLevel({ builtIn: 'bonnie', hasWorktree: true, chosen: 9 as PermissionLevel }).level).toBe(1)
  })
  it('o lote todo é recusado se um item é inválido', () => {
    const a = agent(1, { builtIn: 'emi' })
    const set = vi.fn()
    const m: LevelManager = { list: () => [a], setPermissionLevel: set }
    expect(() => applyLevelChanges(m, [{ id: a.id, level: 2 }, { id: ID(9), level: 2 }], undefined)).toThrow(/não está mais/)
    expect(() => applyLevelChanges(m, [{ id: a.id, level: 7 as PermissionLevel }], undefined)).toThrow(/inválido/)
    expect(set).not.toHaveBeenCalled()
  })
})

describe('AO-115: rotinas', () => {
  it('padrão 2, teto 4, o 3 vale 2 e o 5 vale 4', () => {
    expect(routineLevel(undefined)).toBe(2)
    expect(routineLevel(1)).toBe(1)
    expect(routineLevel(2)).toBe(2)
    expect(routineLevel(3)).toBe(2)
    expect(routineLevel(4)).toBe(4)
    expect(routineLevel(5)).toBe(4)
  })
  it('o rascunho da rotina leva o nível escolhido e o limita', () => {
    const ctx = { settings: { projects: [], templates: [], defaultPermissionMode: 'default' as const }, agents: [] }
    const d = (lvl?: number) =>
      cleanRoutineDraft(
        { name: 'r', prompt: 'x', who: { kind: 'new' }, cwd: tmpdir(), schedule: { kind: 'daily', time: '09:00' }, permissionLevel: lvl },
        ctx,
      ).permissionLevel
    expect(d(1)).toBe(1)
    expect(d(4)).toBe(4)
    expect(d(5)).toBe(4)
    expect(d()).toBe(2)
  })
  it('sem worktree a rotina de nível 4 roda no 2', () => {
    expect(effectiveLevel({ hasWorktree: false, level: 4, routine: true }).level).toBe(2)
  })
})

describe('AO-115: migração', () => {
  it('chosenLevel é opcional: ausente ou inválido vira sem escolha, e o carregador da loja o limpa', () => {
    expect(cleanLevel(undefined)).toBeUndefined()
    expect(cleanLevel(9)).toBeUndefined()
    expect(cleanLevel(2)).toBe(2)
    const src = readFileSync(join(__dirname, '..', 'src', 'main', 'store.ts'), 'utf8')
    expect(src).toMatch(/chosenLevel: cleanLevel\(agent\.summary\.chosenLevel\)/)
    // agente salvo antes do campo: nada escolhido, vale o padrão da casa
    expect(levelRow(agent(1, { builtIn: 'bonnie' })).level).toBe(1)
  })
})

describe('AO-115: nenhum agente muda nível', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f)
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []
    })
  it('chosenLevel só é escrito pelo gerenciador e lido onde o nível é calculado', () => {
    const root = join(__dirname, '..', 'src')
    const users = walk(root)
      .filter((p) => /chosenLevel/.test(readFileSync(p, 'utf8')))
      .map((p) => relative(root, p).replace(/\\/g, '/'))
      .sort()
    expect(users).toEqual([
      'main/agents/office.ts',
      'main/agents/sdk.ts',
      'main/permissions/screen.ts',
      'main/store.ts',
      'shared/types/agents.ts',
    ])
    for (const tools of ['luna-tools.ts', 'emi-tools.ts', 'bonnie-tools.ts', 'merge-tools.ts', 'bridge.ts'])
      expect(readFileSync(join(root, 'main', tools), 'utf8')).not.toMatch(/chosenLevel|setPermissionLevel/)
  })
})
