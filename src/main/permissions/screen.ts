// AO-109, parte 4: a lógica pura do que a tela "Níveis de permissão" mostra e aceita.
// Sem Electron: recebe a lista de agentes e a lista de contas, devolve linhas, contagens e erros em português.
// NÃO muda regra nenhuma: o nível que vale vem de `effectiveLevel` (levels.ts), o mesmo que o app usa em execução.

import { levelCounts, LEVEL_TEXT, OWNER_ACCOUNT, type LevelChange, type LevelRow } from '@shared/permission-levels'
import type { AgentSummary, PermissionLevel } from '@shared/types'
import { normalizeGithubAccounts } from '../git/owner-gate'
import { cleanLevel, effectiveLevel, PERMISSION_LEVELS } from './levels'

/** Agente com nível dado pela casa: a atribuição ignora o nível salvo (ver `effectiveLevel`). */
export function isFixedLevel(a: Pick<AgentSummary, 'builtIn' | 'squad' | 'role' | 'ticketId'>): boolean {
  return !!a.builtIn || !!a.squad || a.role === 'orchestrator' || !!a.ticketId
}

export function ownerAccountListed(githubAccounts: unknown): boolean {
  return normalizeGithubAccounts(githubAccounts).includes(OWNER_ACCOUNT)
}

const NO_WORKTREE = 'Sem worktree, este agente vale como nível 3 (ou 2 numa rotina).'

/** Avisos de uma linha, nas palavras do design aprovado. */
export function warningsFor(row: Pick<LevelRow, 'hasWorktree' | 'createdByAgent' | 'requested' | 'level' | 'note' | 'fixed'>): string[] {
  if (row.fixed) return [LEVEL_TEXT.fixed]
  const out: string[] = []
  if (row.requested >= 4 && !row.hasWorktree) out.push(NO_WORKTREE)
  if (row.createdByAgent && row.requested > 3) out.push('Agente criado por outro agente vale no máximo como nível 3.')
  if (!out.length && row.note && row.level < row.requested) out.push(row.note)
  return out
}

export function levelRow(a: AgentSummary): LevelRow {
  const fixed = isFixedLevel(a)
  const eff = effectiveLevel({
    level: a.permissionLevel,
    mode: a.permissionMode,
    hasWorktree: !!a.worktree,
    builtIn: a.builtIn,
    squad: !!a.squad || a.role === 'orchestrator',
    ticket: !!a.ticketId,
    createdByAgent: !!a.createdByAgent,
    routine: !!a.routineRun || a.runCap !== undefined,
    ...(a.runCap !== undefined ? { cap: a.runCap } : {}),
  })
  const stored = cleanLevel(a.permissionLevel)
  const base = {
    id: a.id,
    name: a.name,
    ...(stored ? { stored } : {}),
    level: eff.level,
    requested: eff.requested,
    downgraded: eff.downgraded,
    ...(eff.note ? { note: eff.note } : {}),
    hasWorktree: !!a.worktree,
    createdByAgent: !!a.createdByAgent,
    fixed,
  }
  return { ...base, warnings: warningsFor(base) }
}

/** Os agentes do escritório que aparecem na tela (sem sessões de terminal nem quem já saiu). */
export function levelRows(agents: readonly AgentSummary[]): LevelRow[] {
  return agents.filter((a) => a.source === 'office' && !a.departed).map(levelRow)
}

export { levelCounts }

/** Erro (em português) se este nível não pode ser pedido agora; undefined se pode. */
export function levelChoiceError(level: unknown, githubAccounts: unknown): string | undefined {
  if (typeof level !== 'number' || cleanLevel(level) === undefined) return 'Nível inválido: escolha de 1 a 5.'
  if (level === 5 && !ownerAccountListed(githubAccounts)) return LEVEL_TEXT.needOwner
  return undefined
}

export interface LevelManager {
  list(): AgentSummary[]
  setPermissionLevel(id: string, level: PermissionLevel | undefined): void
}

/**
 * Aplica as mudanças da usuária. Tudo ou nada: se qualquer uma for recusada (agente que não existe, nível fixo,
 * nível 5 sem a conta), nada é gravado e o erro diz qual.
 */
export function applyLevelChanges(manager: LevelManager, changes: readonly LevelChange[], githubAccounts: unknown): number {
  const byId = new Map(manager.list().map((a) => [a.id, a]))
  for (const c of changes) {
    const a = byId.get(c.id)
    if (!a || a.source !== 'office') throw new Error('Esse agente não está mais no escritório.')
    if (isFixedLevel(a)) throw new Error(`${a.name}: ${LEVEL_TEXT.fixed}`)
    if (c.level !== null) {
      if (!PERMISSION_LEVELS.includes(c.level)) throw new Error('Nível inválido: escolha de 1 a 5.')
      const err = levelChoiceError(c.level, githubAccounts)
      if (err) throw new Error(`${a.name}: ${err}`)
    }
  }
  for (const c of changes) manager.setPermissionLevel(c.id, c.level ?? undefined)
  return changes.length
}
