// AO-109, parte 4: os textos e os formatos que a tela "Níveis de permissão" e o seletor de "Novo agente" compartilham.
// Sem lógica de regra: quem decide é src/main/permissions/levels.ts. Aqui só o que se mostra.

import type { PermissionLevel } from './types'

export interface LevelInfo {
  level: PermissionLevel
  name: string
  description: string
}

/** Os cinco níveis, do mais rígido ao mais livre (texto do design aprovado). */
export const LEVEL_INFO: readonly LevelInfo[] = [
  { level: 1, name: 'Somente leitura', description: 'Lê arquivos. Não edita e não usa terminal.' },
  { level: 2, name: 'Leitura e análise', description: 'Lê e roda comandos de leitura. Não edita. Pede cartão para o resto.' },
  { level: 3, name: 'Edição com cartão', description: 'Cada edição, comando e commit pedem o seu OK.' },
  { level: 4, name: 'Autônomo na worktree', description: 'Edita e faz commit na própria cópia, sem pedir. Precisa de worktree.' },
  { level: 5, name: 'Livre, regras do AO-99', description: 'Tudo do 4, mais enviar ao seu GitHub. O merge continua seu, com cartão reforçado.' },
]

export const OWNER_ACCOUNT = 'malu-code42'

export const LEVEL_TEXT = {
  windowTitle: 'Níveis de permissão',
  subtitle: 'Aberto pelos Ajustes · só você muda um nível',
  navTitle: 'AGENTES E NÍVEL QUE VALE AGORA',
  navNote: 'O número à direita já considera o rebaixamento.',
  pickHint: 'Escolha o nível. A mudança vale na próxima ação do agente.',
  withWorktree: 'Com worktree',
  withoutWorktree: 'Sem worktree',
  fixed: 'Este agente tem um nível padrão da casa. Escolha outro nível para trocar; sem escolha, vale o padrão.',
  floor: 'em nenhum nível há merge, push na main, leitura de credenciais nem edição de ~/.claude*.',
  rules:
    'Sem worktree, os níveis 4 e 5 valem como 3. Agente criado por outro agente nasce no máximo no nível 3. O nível 5 só liga com a conta malu-code42.',
  needOwner: 'O nível 5 só liga com a conta malu-code42 na lista de contas autorizadas.',
  cancel: 'Cancelar',
  save: 'Salvar níveis',
  saved: 'Níveis salvos.',
  nothingToSave: 'Nenhuma mudança para salvar.',
  fieldLabel: 'Nível de permissão',
  newAgentHint: 'O nível 4 precisa de worktree; sem ela vale como 3. Você muda depois em Ajustes, Níveis de permissão.',
  settingsHint: 'Um nível de 1 a 5 por agente: do só leitura ao livre dentro das regras. O piso vale em todos.',
  routineLabel: 'Nível de permissão da rotina',
  routineHint: 'Padrão 2, no máximo 4. O nível 3 vale como 2 e o 5 como 4. Sem worktree, a rotina roda no nível 2.',
  settingsButton: 'Níveis de permissão',
  accountsTitle: 'Contas do GitHub autorizadas',
  accountsHint: 'Só estas contas publicam e mesclam pelo escritório. Adicionar uma conta pede a sua confirmação numa janela do sistema.',
} as const

/** Uma linha da lista de agentes, já com o nível que vale agora. Calculada no processo principal. */
export interface LevelRow {
  id: string
  name: string
  /** O que está salvo no agente (ausente = vale pelo modo antigo). */
  stored?: PermissionLevel
  /** O que vale agora, já com rebaixamento e tetos. */
  level: PermissionLevel
  /** O que o agente pede (salvo, ou derivado do modo). */
  requested: PermissionLevel
  downgraded: boolean
  note?: string
  hasWorktree: boolean
  createdByAgent: boolean
  /** Agente com nível padrão da casa (Luna, Emi, Bonnie, squad, ticket): a escolha da usuária vale sobre o padrão. */
  fixed: boolean
  /** Frases de aviso para este agente, em português. */
  warnings: string[]
}

export interface LevelsSnapshot {
  rows: LevelRow[]
  githubAccounts: string[]
}

export interface LevelChange {
  id: string
  /** null = tirar o nível salvo (volta a valer pelo modo). */
  level: PermissionLevel | null
}

/** Quantos agentes valem em cada nível (os cinco números do topo da tela). */
export function levelCounts(rows: readonly Pick<LevelRow, 'level'>[]): Record<PermissionLevel, number> {
  const counts: Record<PermissionLevel, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (const r of rows) counts[r.level] += 1
  return counts
}
