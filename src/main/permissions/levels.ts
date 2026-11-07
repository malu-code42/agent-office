// Os CINCO NÍVEIS de permissão (AO-109, parte 2). Puro (sem Electron nem SDK), como `policy.ts`:
//
//   1 Somente leitura · 2 Leitura e análise · 3 Edição com cartão · 4 Autônomo na própria worktree ·
//   5 Livre dentro das regras (publicar só pelo código do escritório).
//
// O nível é uma CAMADA POR CIMA de `decide()` (policy.ts), que continua sendo quem aplica o piso
// (floor.ts: merge, push, credenciais, zonas protegidas → deny em todo nível). Aqui entram:
//   - a atribuição (do modo antigo, do papel, do tipo de agente), com os tetos de cada porta;
//   - o rebaixamento sem worktree (4 e 5 exigem cópia isolada; senão valem como 3);
//   - a regra de cada nível para edição, terminal, rede, subagente, MCP de terceiros e PR;
//   - "Sempre permitir": só leitura, e só nos níveis 2 e 3.
//
// Na dúvida, negue: valor desconhecido vira o nível mais baixo que a situação admite.

import type { AlwaysAllowRule, OfficePermissionMode, PermissionLevel } from '@shared/types'
import { decide, type PolicyDecision, type PolicyScope } from './policy'

export const PERMISSION_LEVELS: readonly PermissionLevel[] = [1, 2, 3, 4, 5]

/** Nível válido (inteiro de 1 a 5) ou undefined. Aceita número ou texto numérico de dado salvo. */
export function cleanLevel(v: unknown): PermissionLevel | undefined {
  const n = typeof v === 'string' && /^[1-5]$/.test(v) ? Number(v) : v
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 5 ? (n as PermissionLevel) : undefined
}

/**
 * Modo antigo → nível (tabela de migração da proposta): Planejar vira 2; Pedir permissão vira 3;
 * Editar livremente e Automático viram 4 (o rebaixamento sem worktree acontece em `effectiveLevel`).
 * "Sem pedir nada" (bypass) e qualquer valor desconhecido caem em 3, nunca mais alto.
 */
export function levelFromMode(mode: string | undefined): PermissionLevel {
  if (mode === 'plan') return 2
  if (mode === 'acceptEdits' || mode === 'auto') return 4
  return 3
}

/** Os papéis de membro de squad que só leem (revisor, analista, pesquisador) ficam no 2. */
export type MemberRole = 'implementer' | 'reviewer' | 'tester' | 'analyst' | 'writer' | 'researcher'
const READ_ONLY_ROLES = new Set<string>(['reviewer', 'analyst', 'researcher'])

export function isReadOnlyRole(role: string | undefined): boolean {
  return !!role && READ_ONLY_ROLES.has(role)
}

/** Nível padrão por papel: implementador, testador e escritor 4; revisor, analista e pesquisador 2. */
export function roleLevel(role: string | undefined): PermissionLevel | undefined {
  if (!role) return undefined
  if (READ_ONLY_ROLES.has(role)) return 2
  if (role === 'implementer' || role === 'tester' || role === 'writer') return 4
  return undefined
}

export interface LevelInput {
  /** Nível salvo no agente/rotina/modelo; ausente = deriva do modo. */
  level?: PermissionLevel
  mode?: string
  /** O agente trabalha numa cópia isolada (worktree)? */
  hasWorktree: boolean
  /** Luna, Emi, Bonnie: níveis fixos próprios. */
  builtIn?: 'luna' | 'emi' | 'bonnie'
  /** Agente de squad (orquestrador): fixo em 4. */
  squad?: boolean
  /** Agente delegado de ticket: 4. */
  ticket?: boolean
  /** Papel do membro de squad que está pedindo (já resolvido), se houver. */
  memberRole?: string
  /** Agente criado por outro agente (Luna agent_call, Emi agent_create): teto 3. */
  createdByAgent?: boolean
  /** Teto temporário (rotina rodando num agente existente). */
  cap?: PermissionLevel
  /** Rotina: o rebaixamento sem worktree vai a 2 (cartão sem ninguém olhando só trava) e o teto é 4. */
  routine?: boolean
}

export interface EffectiveLevel {
  level: PermissionLevel
  /** O nível pedido, antes do rebaixamento/teto. */
  requested: PermissionLevel
  /** Foi rebaixado (sem worktree) ou limitado (teto da porta)? */
  downgraded: boolean
  /** Frase em português para o crachá/log quando `downgraded`. */
  note?: string
}

/**
 * O nível que vale em execução. Ordem: fixos dos agentes da casa → papel de membro → nível salvo →
 * modo antigo; depois os tetos (avulso 4, criado por agente 3, rotina 4) e a exigência de worktree
 * para 4 e 5 (sem ela, 3; na rotina, 2).
 */
export function effectiveLevel(i: LevelInput): EffectiveLevel {
  let requested: PermissionLevel
  if (i.builtIn === 'bonnie') requested = 1
  else if (i.builtIn === 'luna') requested = 3
  else if (i.builtIn === 'emi') requested = 5
  else if (i.memberRole && roleLevel(i.memberRole)) requested = roleLevel(i.memberRole)!
  else if (i.squad || i.ticket) requested = 4
  else requested = cleanLevel(i.level) ?? levelFromMode(i.mode)
  let level = requested
  let note: string | undefined
  // Tetos das portas de entrada. A Emi (5) é a única que passa de 4; quem é criado por agente fica em 3.
  if (i.builtIn !== 'emi' && level === 5) level = 4
  if (i.createdByAgent && level > 3) level = 3
  if (i.cap !== undefined && level > i.cap) level = i.cap
  if (i.routine) {
    if (level === 3) level = 2 // nunca 3: o cartão ficaria esperando ninguém
    if (level > 4) level = 4
  }
  if (level >= 4 && !i.hasWorktree) {
    level = i.routine ? 2 : 3
    note = i.routine
      ? 'Sem cópia isolada (worktree), a rotina roda no nível 2 (somente leitura e análise).'
      : 'Sem cópia isolada (worktree), este agente trabalha no nível 3: toda edição pede cartão.'
  }
  if (!note && level < requested) note = `Nível limitado a ${level} por regra da casa.`
  return { level, requested, downgraded: level < requested, ...(note ? { note } : {}) }
}

/** Rotina: nível guardado → nível da rotina. Padrão 2, teto 4, nunca 5 e nunca 3. */
export function routineLevel(level: unknown, mode?: string): PermissionLevel {
  const asked = cleanLevel(level) ?? (mode === undefined ? 2 : levelFromMode(mode))
  if (asked >= 4) return 4
  return asked === 1 ? 1 : 2
}

// ---------- decisão por nível ----------

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep'])
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])
const WEB_TOOLS = new Set(['WebFetch', 'WebSearch'])
const SPAWN_TOOLS = new Set(['Agent', 'Task'])

/** Ferramentas de código e sistema que o nível 2 e o 1 não oferecem. */
export const EDIT_TOOL_NAMES: readonly string[] = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']

/** Ferramentas que o Claude nem recebe neste nível (`disallowedTools`): 1 e 2 sem edição; 1 também sem terminal, rede e subagente. */
export function blockedToolsForLevel(level: PermissionLevel): string[] {
  if (level >= 3) return []
  const edits = [...EDIT_TOOL_NAMES]
  return level === 2 ? edits : [...edits, 'Bash', 'PowerShell', 'WebFetch', 'WebSearch', 'Agent', 'Task']
}

/** `ctx_*` (context-mode) executa código arbitrário: vale como Bash. */
function isCodeRunner(tool: string): boolean {
  return (
    /^mcp__[^_]*context-mode[^_]*__ctx_(execute|execute_file|batch_execute)$/.test(tool) ||
    /(^|__)ctx_(execute|execute_file|batch_execute)$/.test(tool)
  )
}

/** Servidores MCP da casa (livres ou com cartão próprio, tratados antes em askPlayer). */
function isHouseTool(tool: string): boolean {
  return /^mcp__(office|casa|emi|estudos)__/.test(tool)
}

function isShell(tool: string): boolean {
  return SHELL_TOOLS.has(tool) || isCodeRunner(tool)
}

/** O comando muda arquivo, instala ou apaga (o nível 2 nega em vez de perguntar). */
const WRITES_FILES =
  /(?<![0-9&<])>{1,2}(?!&)|\b(tee|touch|mkdir|mkfifo|truncate|install|ln|set-content|add-content|out-file|new-item|copy-item|move-item|rename-item|remove-item|clear-content|sc|ac)\b|\bsed\s+(-\w*i|--in-place)|\b(rm|rmdir|del|erase|rd|mv|cp|copy|move|ren)\b/i
const GIT_WRITES =
  /\bgit\b[^|;&]*\b(add|commit|rm|mv|reset|clean|checkout|restore|revert|rebase|cherry-pick|stash|apply|am|tag|branch|switch|pull|fetch|clone|init|submodule)\b/i
const INSTALLS =
  /\b(npm|npx|pnpm|yarn|bun|pip3?|poetry|gem|cargo|brew|apt(-get)?|dnf|pacman|winget|choco|scoop)\b[^|;&]*\b(i|install|add|update|upgrade|remove|uninstall|link|rebuild|ci|publish)\b/i
/** `gh pr create` e afins: abrir ou mexer em PR é só do nível 5 ou da usuária (botão "Abrir PR"). */
const PR_WRITES = /\bgh\b[^|;&]*\bpr\b[^|;&]*\b(create|edit|ready|reopen|close|comment|review)\b/i

/** Caminho de definição de squad que o agente nunca reescreve (nível 4 e 5). */
function squadDefinitionPath(p: string): boolean {
  const s = p.replace(/\\/g, '/').toLowerCase()
  return /(^|\/)(squads|_opensquad)\/.+(\/squad\.yaml|\.agent\.md)$/.test(s)
}

function editedPath(tool: string, input: Record<string, unknown>): string {
  const v = tool === 'NotebookEdit' ? input.notebook_path : input.file_path
  return typeof v === 'string' ? v : ''
}

/** Regras "Sempre permitir" que ainda valem: só as de LEITURA, e só nos níveis 2 e 3. */
export function rulesForLevel(level: PermissionLevel, rules?: AlwaysAllowRule[]): AlwaysAllowRule[] | undefined {
  if (!rules?.length || (level !== 2 && level !== 3)) return undefined
  const kept = rules.filter((r) => r.kind === 'tool' && READ_TOOLS.has(r.value))
  return kept.length ? kept : undefined
}

/**
 * "Sempre permitir" só se oferece para LEITURA, nos níveis 2 e 3: edição, comando e commit nunca,
 * senão o nível 3 viraria 4 sem a usuária perceber. (Comando de leitura da lista já passa sem
 * cartão; a regra de ferramenta cobre Read/Glob/Grep.)
 */
export function canOfferAlwaysAllow(level: PermissionLevel, tool: string): boolean {
  return (level === 2 || level === 3) && READ_TOOLS.has(tool)
}

function modeForLevel(level: PermissionLevel): OfficePermissionMode {
  if (level <= 2) return 'plan'
  if (level === 3) return 'default'
  return 'auto'
}

const deny = (why: string): PolicyDecision => ({ verdict: 'deny', why })

/**
 * A decisão do escritório por nível. O piso corre dentro de `decide`, antes de tudo.
 * `scope.cwd` é a pasta de trabalho (a worktree nos níveis 4 e 5). Devolve allow, ask ou deny.
 */
export function decideByLevel(
  level: PermissionLevel,
  tool: string,
  input: Record<string, unknown> = {},
  scope: PolicyScope = {},
): PolicyDecision {
  const lv = cleanLevel(level) ?? 1
  const command = typeof input.command === 'string' ? input.command : ''

  // O piso primeiro: decide() com qualquer modo já devolve deny para ele; chamamos antes do overlay
  // para que um nível nunca o transforme em ask.
  const base = decide(modeForLevel(lv), tool, input, { ...scope, rules: rulesForLevel(lv, scope.rules) })
  if (base.verdict === 'deny') return base

  // Subir o próprio nível ou o de outro agente: a ferramenta da casa que faça isso nunca existe aqui;
  // só a usuária muda, na tela (parte 4). Nada a negar por nome de ferramenta.

  if (isCodeRunner(tool)) {
    if (lv <= 2) return deny('este nível não executa código')
    return { verdict: 'ask', why: 'executa código' }
  }

  if (EDIT_TOOLS.has(tool)) {
    if (lv <= 2) return deny('este nível não edita arquivos')
    if (lv >= 4 && squadDefinitionPath(editedPath(tool, input))) return deny('a definição de um squad só a usuária altera')
    // Nível 3 sempre pede, mesmo em pasta aberta; 4 e 5 seguem o `auto` do policy (worktree livre, risco pede).
    return lv === 3 ? { verdict: 'ask', why: base.why } : base
  }

  if (isShell(tool)) {
    if (PR_WRITES.test(command))
      return lv >= 5
        ? { verdict: 'ask', why: 'abrir ou alterar PR' }
        : deny('abrir ou alterar PR é do nível 5 ou da usuária (botão "Abrir PR")')
    if (lv === 1) return deny('este nível não roda comandos')
    if (lv === 2) {
      if (base.verdict === 'allow') return base // comando de leitura da lista fechada
      if (WRITES_FILES.test(command) || GIT_WRITES.test(command) || INSTALLS.test(command))
        return deny('este nível não altera arquivos, git nem instala nada')
      return { verdict: 'ask', why: base.why }
    }
    if (lv === 3) {
      // Comando de leitura da lista fechada passa sem cartão (a tabela do nível 3); tudo o mais pede,
      // inclusive npm test e instalar.
      return base.verdict !== 'allow' && decide('plan', tool, input, scope).verdict === 'allow' ? { verdict: 'allow' } : base
    }
    return base // 4 e 5: leitura da lista e npm test/build/lint/typecheck livres; o resto pede
  }

  if (WEB_TOOLS.has(tool)) {
    if (lv === 1) return deny('este nível não acessa a internet')
    if (lv >= 5 && tool === 'WebSearch') return { verdict: 'allow' }
    return { verdict: 'ask', why: 'rede externa' }
  }

  if (SPAWN_TOOLS.has(tool)) {
    if (lv <= 2) return deny('este nível não chama outros agentes')
    return { verdict: 'ask', why: 'chamar outro agente' }
  }

  if (READ_TOOLS.has(tool)) return base

  if (tool.startsWith('mcp__') && !isHouseTool(tool)) {
    if (lv <= 2) return deny('este nível não usa ferramentas de terceiros')
    return { verdict: 'ask', why: base.why }
  }

  // Qualquer outra ferramenta sem classificação: níveis 1 e 2 negam; 3 a 5 pedem.
  if (lv <= 2 && base.verdict !== 'allow') return deny('este nível só lê')
  return base
}
