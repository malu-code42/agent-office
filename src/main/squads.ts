import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import type { AgentDefinition, HookCallbackMatcher } from '@anthropic-ai/claude-agent-sdk'
import { parse } from 'yaml'
import type { SquadInfo, SquadMember, SquadProgress, SquadStep } from '@shared/types'
import { clearReservation, reservationState } from './squad-reservation'

// Opensquad squads: squads/<code>/squad.yaml + agents/<id>.agent.md + pipeline/pipeline.yaml.
// Read as they are; the office never writes to a squad folder.

export const DEFAULT_SECTOR = 'Equipe'
const RUNNER = '_opensquad/core/runner.pipeline.md'
/**
 * Squad folder names, codes and member ids: letters, digits, _ and -. No /, \, .., NUL or
 * leading dot, so none of them can climb out when it becomes part of a path.
 */
const SAFE_NAME = /^[\w-]{1,64}$/
/** Tools that start a subagent (Agent; Task in older Claude Code builds). */
const SPAWN_TOOLS = new Set(['Agent', 'Task'])

export interface SquadDefinition extends SquadInfo {
  /** Member id -> body of its .agent.md (persona, principles). */
  prompts: Record<string, string>
}

/**
 * Every squad under `cwd`/squads. A folder without squads gives an empty list, never an error.
 *
 * A folder that is being written right now (the office is creating that squad) is not
 * a squad yet and is not listed: it is a creation in progress, not a broken squad.
 */
export function loadSquads(cwd: string): SquadDefinition[] {
  const root = join(cwd, 'squads')
  let dirs: string[]
  try {
    dirs = readdirSync(root)
      .filter((d) => SAFE_NAME.test(d) && existsSync(join(root, d, 'squad.yaml')))
      .filter((d) => {
        const state = reservationState(join(root, d))
        // A squad whose cleanup was lost is whole: it is recovered and listed.
        if (state === 'complete') {
          clearReservation(join(root, d))
          return true
        }
        return state === 'none'
      })
  } catch {
    return []
  }
  const out: SquadDefinition[] = []
  for (const d of dirs.sort()) {
    try {
      out.push(loadSquad(cwd, join(root, d)))
    } catch (err) {
      console.error(`squads: ignoring ${d}:`, err instanceof Error ? err.message : err)
    }
  }
  return out
}

/** User-facing catalogue: broken or missing definitions remain visible, but are never runnable. */
export function inspectSquads(cwd: string): SquadInfo[] {
  const root = join(cwd, 'squads')
  let dirs: string[]
  try {
    dirs = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && SAFE_NAME.test(d.name))
      .map((d) => d.name)
      .sort()
  } catch {
    return []
  }
  const out: SquadInfo[] = []
  for (const code of dirs) {
    const recoveryPath = join(root, code, 'squad.yaml')
    const dir = join(root, code)
    const reservation = reservationState(dir)
    // A creation in progress is not a squad: it is not shown as broken either.
    if (reservation === 'active') continue
    // A squad whose cleanup was lost is whole: the leftover marker goes away.
    if (reservation === 'complete') {
      clearReservation(dir)
    } else if (reservation === 'stale') {
      // The creation was interrupted: the player has to know and to clean it up.
      out.push({
        code,
        name: code,
        icon: '⚠️',
        description: '',
        cwd,
        members: [],
        steps: [],
        availability: 'unavailable',
        unavailableReason:
          'A criação deste squad foi interrompida e a pasta ficou pela metade. Apague a pasta (ou o marcador .reserva dentro dela) e tente de novo.',
        recoveryPath,
      })
      continue
    }
    try {
      const squad = loadSquad(cwd, dir)
      validateSquad(squad)
      out.push({ ...squadInfo(squad), availability: 'available' })
    } catch (err) {
      out.push({
        code,
        name: code,
        icon: '⚠️',
        description: '',
        cwd,
        members: [],
        steps: [],
        availability: 'unavailable',
        unavailableReason: err instanceof Error ? err.message : String(err),
        recoveryPath,
      })
    }
  }
  return out
}

/** Fail closed before execution; catalog inspection uses the same rule for its status. */
export function validateSquad(s: SquadDefinition): void {
  if (!SAFE_NAME.test(s.code)) throw new Error(`código inválido: ${s.code}`)
  const roles = new Map<string, string>()
  for (const m of s.members) {
    if (m.role) {
      if (roles.has(m.role)) throw new Error(`mais de um membro está definido como ${m.role}`)
      roles.set(m.role, m.id)
    }
  }
  const implementer = roles.get('implementer')
  const reviewer = roles.get('reviewer')
  if (!implementer || !reviewer || implementer === reviewer)
    throw new Error('defina membros independentes com os papéis implementer e reviewer; o orquestrador é o coordenador')
  const executableSteps = s.steps.filter((step) => step.type === 'agent')
  if (!executableSteps.length) throw new Error('pipeline sem passos de agente válidos')
  for (const step of s.steps) {
    if (step.type === 'agent' && step.agent && !s.members.some((m) => m.id === step.agent))
      throw new Error(`passo ${step.name} não aponta para um membro definido`)
  }
  if (!executableSteps.some((step) => step.agent === implementer)) throw new Error('pipeline não executa o implementer')
  if (!executableSteps.some((step) => step.agent === reviewer)) throw new Error('pipeline não executa o reviewer')
  const implementAt = executableSteps.findIndex((step) => step.agent === implementer)
  const reviewAt = executableSteps.findIndex((step) => step.agent === reviewer)
  if (reviewAt < implementAt) throw new Error('o passo do reviewer deve vir depois do implementer')
}

export function findSquad(cwd: string, code: string): SquadDefinition | undefined {
  return typeof code === 'string' && SAFE_NAME.test(code) ? loadSquads(cwd).find((s) => s.code === code) : undefined
}

/** What the renderer gets: no prompts. */
export function squadInfo(s: SquadDefinition): SquadInfo {
  const { prompts: _prompts, ...info } = s
  return info
}

function loadSquad(cwd: string, dir: string): SquadDefinition {
  // squads/ must live in the project and the squad folder in squads/ (no squads/x -> /somewhere/else).
  const realRoot = realpathSync(join(cwd, 'squads'))
  if (!within(realpathSync(cwd), realRoot) || !within(realRoot, realpathSync(dir)))
    throw new Error('squad folder points outside the project')
  const yaml = inside(dir, 'squad.yaml')
  if (!yaml) throw new Error('squad.yaml points outside the squad folder')
  const y = (parse(readSmall(yaml)) ?? {}) as Record<string, unknown>
  // The code builds paths (state.json, the watcher) and goes into the orchestrator prompt: keep it plain.
  const folder = basename(dir)
  const hasDeclaredCode = Object.hasOwn(y, 'code')
  const declaredCode = hasDeclaredCode ? (typeof y.code === 'string' ? y.code : '') : folder
  if (hasDeclaredCode && !SAFE_NAME.test(declaredCode)) throw new Error(`código inválido: ${declaredCode || '(vazio)'}`)
  if (declaredCode !== folder) throw new Error(`o código ${declaredCode} não corresponde à pasta canônica ${folder}`)
  const code = folder
  const members: SquadMember[] = []
  const prompts: Record<string, string> = {}
  for (const raw of Array.isArray(y.agents) ? y.agents : []) {
    const a = (raw ?? {}) as Record<string, unknown>
    const id = str(a.id)
    // The id becomes a subagent type and a file name: keep it plain.
    if (!SAFE_NAME.test(id) || members.some((m) => m.id === id)) continue
    const file = inside(dir, str(a.file) || `agents/${id}.agent.md`)
    const { meta, body } = file && existsSync(file) ? frontmatter(readSmallOr(file)) : { meta: {}, body: '' }
    members.push({
      id,
      name: str(a.name) || str(meta.name) || id,
      icon: str(a.icon) || str(meta.icon) || '•',
      title: str(meta.title),
      execution: str(meta.execution) === 'inline' ? 'inline' : 'subagent',
      role:
        (str(a.role) || str(meta.role)) === 'implementer' || (str(a.role) || str(meta.role)) === 'reviewer'
          ? ((str(a.role) || str(meta.role)) as 'implementer' | 'reviewer')
          : undefined,
      sector: str(a.setor) || DEFAULT_SECTOR,
    })
    prompts[id] = body.trim() || `Você é ${str(a.name) || id}, membro do squad ${str(y.name) || code}.`
  }
  return {
    code,
    name: str(y.name) || code,
    icon: str(y.icon) || '🧩',
    description: str(y.description).trim(),
    cwd,
    members,
    steps: loadSteps(dir, y),
    prompts,
  }
}

function loadSteps(dir: string, y: Record<string, unknown>): SquadStep[] {
  const pipe = (y.pipeline ?? {}) as Record<string, unknown>
  const file = inside(dir, str(pipe.entry) || 'pipeline/pipeline.yaml')
  if (!file || !existsSync(file)) return []
  const p = (parse(readSmall(file)) ?? {}) as Record<string, unknown>
  return (Array.isArray(p.steps) ? p.steps : []).map((raw, i) => {
    const s = (raw ?? {}) as Record<string, unknown>
    return {
      id: str(s.id) || `step-${i + 1}`,
      name: str(s.name) || str(s.id) || `Passo ${i + 1}`,
      type: str(s.type) === 'checkpoint' ? 'checkpoint' : 'agent',
      agent: str(s.agent) || undefined,
    }
  })
}

/** Subagent definitions for the members that run as subagents. */
export function memberAgents(s: SquadDefinition): Record<string, AgentDefinition> {
  const out: Record<string, AgentDefinition> = {}
  for (const m of s.members) {
    if (m.execution !== 'subagent') continue
    out[m.id] = {
      description: `${m.icon} ${m.name}${m.title ? `, ${m.title}` : ''}${m.role ? ` (${m.role})` : ''}. Membro do squad ${s.name}.`,
      prompt: `${s.prompts[m.id]}${m.role === 'implementer' ? '\n\nVocê é o implementador independente do squad; implemente a tarefa atribuída e registre decisões técnicas.' : m.role === 'reviewer' ? '\n\nVocê é o revisor independente do squad; revise criticamente o trabalho entregue e reporte problemas sem assumir a implementação.' : ''}`,
      // Members do their own step; only the orchestrator hands out work.
      disallowedTools: [...SPAWN_TOOLS],
    }
  }
  return out
}

/** Why a subagent call is refused, or null when it is a member of the team. */
export function outsideTeam(s: SquadDefinition, tool: string, input: unknown): string | null {
  if (!SPAWN_TOOLS.has(tool)) return null
  const type = String((input as { subagent_type?: unknown } | null)?.subagent_type ?? '') || 'general-purpose'
  const m = s.members.find((x) => x.id === type)
  if (m?.execution === 'subagent') return null
  const team = s.members
    .filter((x) => x.execution === 'subagent')
    .map((x) => x.id)
    .join(', ')
  if (m) return `${m.name} (${m.id}) é membro inline: faça o passo dele aqui mesmo, nesta conversa, sem chamar subagente.`
  return `Bloqueado pelo Agent Office: "${type}" não é da equipe do squad ${s.name}. Chame só membros do squad pelo id (subagent_type): ${team}.`
}

/**
 * Runs before every subagent call, whatever the permission mode: blocks anyone from
 * outside the team and keeps members in the foreground, so the orchestrator waits for
 * each delivery as the runner expects (calls sent in one message still run in parallel).
 */
export function teamGuard(s: SquadDefinition): HookCallbackMatcher[] {
  return [
    {
      matcher: '^(Agent|Task)$',
      hooks: [
        async (input) => {
          if (input.hook_event_name !== 'PreToolUse') return {}
          const why = outsideTeam(s, input.tool_name, input.tool_input)
          if (why) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: why } }
          const updatedInput = { ...(input.tool_input as Record<string, unknown>), run_in_background: false }
          return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput } }
        },
      ],
    },
  ]
}

/** Appended to the orchestrator's system prompt. */
export function orchestratorPrompt(s: SquadDefinition): string {
  const runner = existsSync(join(s.cwd, RUNNER)) ? `\`${RUNNER}\`` : 'the Opensquad pipeline runner'
  const line = (m: SquadMember) => `- ${m.id}: ${m.icon} ${m.name}${m.title ? ` (${m.title})` : ''}`
  const subs = s.members.filter((m) => m.execution === 'subagent')
  const inline = s.members.filter((m) => m.execution === 'inline')
  return [
    `You are the orchestrator of the Opensquad squad "${s.name}" (code ${s.code}). Your only job is to run its cycle: follow ${runner} and \`squads/${s.code}/squad.yaml\` + \`squads/${s.code}/pipeline/pipeline.yaml\` step by step.`,
    "Your team is closed. Call members as subagents with the Agent tool, subagent_type = member id; any other subagent type (general-purpose, Explore, fork…) is blocked. Wherever the runner says to dispatch with the Task tool, use the Agent tool with the step agent's id. The member already has its .agent.md as system prompt, so your prompt carries the step: task files, inputs, transformed output paths, veto conditions, company context and squad memory. Members run in the foreground and you wait for each delivery; when steps can run in parallel, send all their Agent calls in one message.",
    `Subagent members:\n${subs.map(line).join('\n') || '- (none)'}`,
    inline.length
      ? `Inline members (you play them yourself, in this conversation, never as subagents):\n${inline.map(line).join('\n')}`
      : '',
    'Checkpoints: present EVERY checkpoint step (type: checkpoint) and every choice the runner asks the user for with the AskUserQuestion tool, never as plain text or a numbered list in a message. Put the step name in the question, keep the options short, and include the paths of files the user must review. Never pick an answer yourself or skip a checkpoint: without an answer the cycle waits. If the question is cancelled, stop and wait for instructions.',
    `Write \`squads/${s.code}/state.json\` exactly when the runner says to: the office reads it to show the current step.`,
    'Talk to the user in Brazilian Portuguese.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Progress of a running cycle, from squads/<code>/state.json; undefined when there is none. */
export function readProgress(s: SquadInfo): SquadProgress | undefined {
  let raw: Record<string, unknown>
  try {
    if (!SAFE_NAME.test(s.code)) return undefined
    const file = inside(join(s.cwd, 'squads', s.code), 'state.json')
    if (!file) return undefined
    raw = JSON.parse(readSmall(file))
  } catch {
    return undefined
  }
  const step = (raw.step ?? {}) as Record<string, unknown>
  const current = Number(step.current) || 0
  const def = s.steps[current - 1]
  const label = str(step.label)
  // The runner may write the step id as label; the pipeline has the readable name.
  const byLabel = s.steps.find((x) => x.id === label)
  const at = byLabel ?? def
  return {
    current,
    total: Number(step.total) || s.steps.length,
    label: at?.name ?? label,
    status: str(raw.status) || 'running',
    type: at?.type,
    agent: at?.agent,
  }
}

export function squadDir(s: SquadInfo): string {
  return join(s.cwd, 'squads', s.code)
}

/**
 * Copies the canonical, possibly-untracked squad runtime into an isolated worktree.
 * Symlinks and special files fail closed; mutable runtime state and reservation markers
 * are intentionally excluded. The canonical project definition is never written.
 */
export function copySquadRuntime(cwd: string, code: string, worktreeRoot: string): void {
  if (!SAFE_NAME.test(code)) throw new Error('Código de squad inválido para a cópia isolada.')
  const project = realpathSync(cwd)
  const sourceSquad = join(project, 'squads', code)
  if (!existsSync(sourceSquad)) throw new Error(`A definição canônica squads/${code} não existe.`)
  const destination = realpathSync(worktreeRoot)
  const total = { bytes: 0, files: 0 }
  const targetSquad = join(destination, 'squads', code)
  copyTree(project, destination, sourceSquad, targetSquad, total, true)
  const runner = join(project, '_opensquad')
  const targetRunner = join(destination, '_opensquad')
  if (!existsSync(join(destination, RUNNER)) && existsSync(runner)) {
    copyTree(project, destination, runner, targetRunner, total, false)
  }
  if (!existsSync(join(destination, RUNNER))) throw new Error(`O runner ${RUNNER} não está disponível no projeto.`)
}

function copyTree(
  project: string,
  destination: string,
  source: string,
  target: string,
  total: { bytes: number; files: number },
  squad: boolean,
): void {
  const relativeSource = relative(project, source)
  if (!relativeSource || relativeSource.startsWith('..') || isAbsolute(relativeSource))
    throw new Error('Definição fora da pasta do projeto.')
  assertCopyDestination(destination, target)
  const stat = lstatSync(source)
  if (stat.isSymbolicLink()) throw new Error(`Symlink recusado na definição do squad: ${relativeSource}`)
  if (stat.isDirectory()) {
    if (existsSync(target)) {
      const existing = lstatSync(target)
      if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error(`Destino incompatível na cópia da definição: ${target}`)
    }
    mkdirSync(target, { recursive: true })
    for (const name of readdirSync(source)) {
      if (squad && (name === 'state.json' || name === '.agent-office-proposal' || name === '.reserva')) continue
      if (name.startsWith('.') || /(?:^|[._-])(secret|credential|token|private-key)(?:[._-]|$)/i.test(name))
        throw new Error(`Arquivo oculto/sensível recusado na definição do squad: ${join(source, name)}`)
      copyTree(project, destination, join(source, name), join(target, name), total, false)
    }
    return
  }
  if (!stat.isFile()) throw new Error(`Arquivo especial recusado na definição do squad: ${relativeSource}`)
  if (/\.(?:pem|key|p12|pfx|keystore|sqlite|db)$/i.test(source))
    throw new Error(`Arquivo potencialmente sensível recusado na definição do squad: ${relativeSource}`)
  total.bytes += stat.size
  total.files++
  if (total.bytes > 10 * 1024 * 1024 || total.files > 500) throw new Error('A definição/runner do squad excede o limite seguro de cópia.')
  mkdirSync(join(target, '..'), { recursive: true })
  if (existsSync(target)) {
    const existing = lstatSync(target)
    if (!existing.isFile() || existing.isSymbolicLink() || !readFileSync(source).equals(readFileSync(target)))
      throw new Error(`O destino já tem conteúdo diferente; nada foi sobrescrito: ${target}`)
    return
  }
  copyFileSync(source, target)
}

function assertCopyDestination(root: string, target: string): void {
  const rel = relative(root, target)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Destino da cópia fora do worktree.')
  let cursor = root
  for (const part of rel.split(sep)) {
    cursor = join(cursor, part)
    if (!existsSync(cursor)) continue
    const st = lstatSync(cursor)
    if (st.isSymbolicLink()) throw new Error(`Symlink recusado no destino da definição: ${cursor}`)
    if (cursor !== target && !st.isDirectory()) throw new Error(`Componente inválido no destino da definição: ${cursor}`)
  }
}

export function isDir(p: unknown): p is string {
  try {
    return typeof p === 'string' && statSync(p).isDirectory()
  } catch {
    return false
  }
}

function frontmatter(text: string): { meta: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!m) return { meta: {}, body: text }
  let meta: Record<string, unknown> = {}
  try {
    meta = (parse(m[1]) ?? {}) as Record<string, unknown>
  } catch {
    // a broken header still leaves a usable persona
  }
  return { meta, body: text.slice(m[0].length) }
}

/** A squad file bigger than this is not read (a persona or a pipeline is a few KB). */
const MAX_SQUAD_FILE = 512 * 1024

/**
 * Resolves a path from squad.yaml to a regular file inside the squad folder, or null.
 * Refused: absolute paths, `\`, NUL, `..` or empty segments, a file that is a symlink
 * (lstat), and anything whose real path (realpath, so a symlinked folder on the way counts)
 * is not under the real squad folder + separator (squads/a ≠ squads/a-evil). A file that
 * does not exist gives null too: there is nothing to read.
 */
function inside(dir: string, rel: string): string | null {
  if (!rel || rel.length > 1024 || /[\\\0]/.test(rel) || isAbsolute(rel)) return null
  if (rel.split('/').some((s) => !s || s === '..')) return null
  try {
    const realDir = realpathSync(dir)
    const p = join(dir, rel)
    if (lstatSync(p).isSymbolicLink()) return null
    const real = realpathSync(p)
    return within(realDir, real) && statSync(real).isFile() ? real : null
  } catch {
    return null
  }
}

/** `p` is strictly below `dir` (both already real paths), compared with the separator. */
function within(dir: string, p: string): boolean {
  const base = dir.endsWith(sep) ? dir : dir + sep
  return p.length > base.length && p.startsWith(base)
}

/** Text of a squad file, refusing anything past MAX_SQUAD_FILE. */
function readSmall(file: string): string {
  if (statSync(file).size > MAX_SQUAD_FILE) throw new Error(`${file} is too big`)
  return readFileSync(file, 'utf8')
}

/** readSmall, or '' when the file can't be read (a member keeps its default persona). */
function readSmallOr(file: string): string {
  try {
    return readSmall(file)
  } catch {
    return ''
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
}
