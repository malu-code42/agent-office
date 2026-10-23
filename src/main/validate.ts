import { randomUUID } from 'node:crypto'
import { basename, isAbsolute } from 'node:path'
import { z } from 'zod'
import { ATTACH_LIMITS } from '@shared/attachments'
import { HAIR_STYLES } from '@shared/describe'
import { IRIS_NOT_UNDERSTOOD, type IrisAnswer } from '@shared/iris'
import { STEP_MAX } from '@shared/planning'
import { isIsoDay, REFUSED_KINDS, REFUSED_MESSAGE, type Proposal, type ProposalOperation } from '@shared/proposals'
import { PROFILE_IDS } from '@shared/profiles'
import { floorNameFor, MAX_PROJECT_FLOORS, projectFor } from '@shared/projects'
import { SQUAD_NAME_MAX, SQUAD_ROOM_COUNT } from '@shared/types'
import { REVIEW_STEPS, type FocusChoice, type ReviewChoices, type ReviewDraft, type ReviewPostpone } from '@shared/review'
import { scheduleError } from '@shared/schedule'
import {
  isDateDDMMAAAA,
  type NewTaskDraft,
  type TaskDiscard,
  type TaskMove,
  type TaskRef,
  type TaskReopen,
  type TaskReschedule,
  TIME_FORMAT,
} from '@shared/tasks'
import { STATUSES } from '@shared/tickets'
import { EFFORT_LEVELS, ROUTINE_LIMITS } from '@shared/types'
import type { VideoSettings } from '@shared/video'
import type {
  Account,
  AgentBrain,
  AgentSummary,
  AttachmentInput,
  DelegateTarget,
  EffortLevel,
  HireRequest,
  AlwaysAllowRule,
  LedgerQuery,
  OfficePermissionMode,
  PermissionDecision,
  ProjectFloor,
  RoutineDraft,
  RoutineWho,
  Schedule,
  Settings,
  TicketDraft,
  TicketPatch,
  TicketStatus,
} from '@shared/types'
import { isDir } from './squads'

// Everything the renderer sends goes through here. The page runs sandboxed, but the
// main process treats it as untrusted anyway: an XSS in an agent's output must not
// reach the SDK, the disk or office.json with values the UI could never send.

export const PERMISSION_MODES: readonly OfficePermissionMode[] = ['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions']
/** Work someone else wrote (tickets, squad cycles) never runs with "bypass". */
const STATUS_VALUES = STATUSES.map((s) => s.value) as [TicketStatus, ...TicketStatus[]]

const MAX_PATH = 4096
const HEX = /^#[0-9a-f]{6}$/i
const MODEL_RE = /^[\w.\-[\]]{1,64}$/

/** Parses or throws a message the player can read. */
export function parse<T>(schema: z.ZodType<T>, raw: unknown, message: string): T {
  const r = schema.safeParse(raw)
  if (!r.success) throw new Error(message)
  return r.data
}

// ---------- small pieces ----------

/** Exportar em Markdown (AO-36): nome sugerido e texto, até 20 MB. O caminho vem do diálogo de salvar, nunca da página. */
export const saveMarkdownArgsSchema = z.tuple([z.string().max(200), z.string().max(20_000_000)])
/** Copiar relatório: texto para o clipboard. */
export const copyTextSchema = z.string().max(2_000_000)

/** Nome sugerido no diálogo de salvar: sem pastas, sem caracteres estranhos, sempre .md. */
export function markdownFileName(raw: string): string {
  const name =
    basename(raw.replace(/\\/g, '/'))
      .replace(/[^\p{L}\p{N}._ -]+/gu, '-')
      .replace(/^[.\s-]+/, '')
      .slice(0, 100) || 'agent-office'
  return name.toLowerCase().endsWith('.md') ? name : `${name}.md`
}

/** Agent, ticket, request and account ids: never empty, never huge. */
export const idSchema = z.string().min(1).max(200)
/** getSubagentLog(agentId, subId) */
export const subagentLogArgsSchema = z.tuple([idSchema, idSchema])
export const pathSchema = z.string().min(1).max(MAX_PATH)
export const vaultPathSchema = pathSchema.refine(isAbsolute, 'O caminho do vault precisa ser absoluto.')
/** A task from the "Nova tarefa" form; the rules for each field are in shared/tasks.ts (taskDraftProblem). */
export const newTaskSchema: z.ZodType<NewTaskDraft> = z.object({
  title: z.string().max(300),
  list: z.string().max(200),
  date: z.string().max(10).optional(),
  time: z.string().max(5).optional(),
  id: z
    .string()
    .regex(/^t[a-z0-9]{6}$/i)
    .optional(),
})
/** A card moved on the board; the line must be a real line number, the list is checked against the file when written. */
export const moveTaskSchema: z.ZodType<TaskMove> = z.object({
  line: z.number().int().min(1).max(10_000_000),
  list: z.string().max(200),
})
/** A task moved to another day: the line as the board read it, the date DD.MM.AAAA for a day that exists. */
export const rescheduleTaskSchema: z.ZodType<TaskReschedule> = z.object({
  line: z.number().int().min(1).max(10_000_000),
  date: z.string().max(10).refine(isDateDDMMAAAA),
})
/** The line of a task put in focus, as the board read it. */
export const taskLineSchema = z.number().int().min(1).max(10_000_000)
/** A task id as tarefas.md writes it: ^t and six letters or digits. */
export const taskIdSchema = z.string().regex(/^t[a-z0-9]{6}$/i)
/** The task to act on: the line as the board read it, or the id of a task in focus. */
export const taskRefSchema: z.ZodType<TaskRef> = z.union([z.object({ line: taskLineSchema }), z.object({ id: taskIdSchema })])
/** The task to complete (see taskRefSchema). */
export const completeTaskSchema = taskRefSchema
/** A task to discard: the reason is checked by planDiscard, with the words the form shows. */
export const discardTaskSchema: z.ZodType<TaskDiscard> = z.object({ target: taskRefSchema, reason: z.string().max(1000) })
/** A task to reopen; the list is only sent when the origin list is gone and the user chose one. */
export const reopenTaskSchema: z.ZodType<TaskReopen> = z.object({ target: taskRefSchema, list: z.string().max(200).optional() })

const isoDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isIsoDay, 'Dia inválido. Use AAAA-MM-DD.')
const timeSchema = z.string().regex(TIME_FORMAT, 'Hora inválida. Use HH:MM.')
/**
 * One change of a proposal. The kinds are closed: "concluir" (or any other kind) is not in the union,
 * so the schema refuses it. A proposal names tasks by id, never by line.
 */
const commitmentTitleSchema = z.string().trim().min(1).max(500)
const commitmentFields = { day: isoDaySchema, time: timeSchema, title: commitmentTitleSchema }
export const proposalOperationSchema: z.ZodType<ProposalOperation> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('focus'), id: taskIdSchema }),
  z.object({ kind: z.literal('unfocus'), id: taskIdSchema }),
  z.object({ kind: z.literal('reschedule'), id: taskIdSchema, date: z.string().max(10).refine(isDateDDMMAAAA) }),
  z.object({ kind: z.literal('discard'), id: taskIdSchema, reason: z.string().max(1000) }),
  z.object({
    kind: z.literal('step'),
    id: taskIdSchema,
    text: z
      .string()
      .trim()
      .min(1)
      .max(STEP_MAX * 4)
      .refine((s) => [...s].length <= STEP_MAX, `O passo de hoje pode ter no máximo ${STEP_MAX} caracteres.`),
  }),
  z.object({
    kind: z.literal('move-commitment'),
    from: z.object(commitmentFields),
    to: z.object({ day: isoDaySchema, time: timeSchema }),
  }),
  z.object({ kind: z.literal('add-commitment'), ...commitmentFields }),
  z.object({ kind: z.literal('remove-commitment'), ...commitmentFields }),
])
export const proposalSchema: z.ZodType<Proposal> = z.object({
  id: idSchema,
  source: z.string().trim().min(1).max(80),
  createdAt: z.number().finite(),
  operations: z.array(proposalOperationSchema).min(1).max(50),
  failure: z.object({ index: z.number().int().min(0), message: z.string().max(2000) }).optional(),
})

/**
 * What the Luna answers (AO-13): operations to propose, or one question. The same operation kinds as a
 * proposal, so "concluir" is refused here too (parseIrisAnswer says so before the schema does). The
 * suggested profile, when one exists, is restricted to the ids of profiles.ts.
 */
/** The suggested profile: only an id of profiles.ts (or none), never invented by the model. */
export const profileIdSchema = z.enum(PROFILE_IDS).nullish()

/**
 * What the Luna answers (AO-13): operations to propose, or one question. The same operation kinds as a
 * proposal, so "concluir" is refused here too (parseIrisAnswer says so before the schema does). The
 * suggested profile, when one exists, is restricted to the ids of profiles.ts.
 */
export const irisAnswerSchema: z.ZodType<IrisAnswer> = z
  .object({
    operations: z.array(proposalOperationSchema).max(50),
    question: z.string().trim().min(1).max(500).nullish(),
    profile: profileIdSchema,
  })
  .refine((a) => !!a.question || a.operations.length > 0 || !!a.profile, 'Resposta sem operações, perfil nem pergunta.')

/** The request box's text: the length the box allows is checked again by IrisDesk, in characters. */
export const irisRequestSchema = z.string().max(20_000)

/** The Luna's answer, parsed. A refused kind gets its own message; any other bad answer is IRIS_NOT_UNDERSTOOD. */
export function parseIrisAnswer(raw: unknown): IrisAnswer {
  const ops = (raw as { operations?: unknown } | null)?.operations
  if (Array.isArray(ops) && ops.some((op) => REFUSED_KINDS.includes(String((op as { kind?: unknown } | null)?.kind)))) {
    throw new Error(REFUSED_MESSAGE)
  }
  return parse(irisAnswerSchema, raw, IRIS_NOT_UNDERSTOOD)
}

/** A choice of the daily review (AO-12). There is no "concluir" kind: the schema refuses it, as proposals do. */
export const focusChoiceSchema: z.ZodType<FocusChoice> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('continuar') }),
  z.object({ kind: z.literal('revisar') }),
  z.object({ kind: z.literal('reagendar'), date: z.string().max(10).refine(isDateDDMMAAAA) }),
  z.object({ kind: z.literal('descartar'), reason: z.string().max(1000) }),
])
export const reviewChoicesSchema: z.ZodType<ReviewChoices> = z
  .record(taskIdSchema, focusChoiceSchema)
  .refine((c) => Object.keys(c).length <= 500, 'Escolhas demais na revisão.')
export const reviewStepSchema = z
  .number()
  .int()
  .min(0)
  .max(REVIEW_STEPS.length - 1)
/** "Dispensar hoje" or adiar by 1, 2, 3 days or 1 week. */
export const reviewPostponeSchema: z.ZodType<ReviewPostpone> = z.union([
  z.literal('dispensar'),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(7),
])
export const reviewDraftSchema: z.ZodType<ReviewDraft> = z.object({
  day: isoDaySchema,
  step: reviewStepSchema,
  choices: reviewChoicesSchema,
})

/** A proposal from the caller (a ticket that proposes changes, or a test): a refused kind gets its own message, the rest the schema's. */
export function parseProposal(raw: unknown): Proposal {
  const ops = (raw as { operations?: unknown } | null)?.operations
  if (Array.isArray(ops) && ops.some((op) => REFUSED_KINDS.includes(String((op as { kind?: unknown } | null)?.kind)))) {
    throw new Error(REFUSED_MESSAGE)
  }
  return parse(proposalSchema, raw, 'Proposta inválida.')
}
/** The text of a "Passo de hoje": trimmed, never empty, at most STEP_MAX characters (counted as characters, not UTF-16 units). */
export const stepTextSchema = z
  .string('O passo de hoje precisa ser um texto.')
  .transform((s) => s.trim())
  .refine((s) => s.length > 0, 'Escreva o passo de hoje.')
  .refine((s) => [...s].length <= STEP_MAX, `O passo de hoje pode ter no máximo ${STEP_MAX} caracteres.`)

/** The step text from the renderer, or throws the message the popup shows. */
export function parseStepText(raw: unknown): string {
  const r = stepTextSchema.safeParse(raw)
  if (!r.success) throw new Error(r.error.issues[0]!.message)
  return r.data
}
export const permissionModeSchema = z.enum(PERMISSION_MODES as [OfficePermissionMode, ...OfficePermissionMode[]])
export const ticketStatusSchema = z.enum(STATUS_VALUES)
/** A message to an agent: long pastes are fine, megabytes of text are not. */
export const messageSchema = z.string().max(2_000_000)
export const commentSchema = z.string().max(100_000)
/** Search box of the closed tickets; anything else = no filter. */
export const searchSchema = z.string().max(200).optional().catch(undefined)
export const ticketIdsSchema = z.array(idSchema).max(10_000).optional()
/** 'me' = the player; null or missing = nobody. */
export const assigneeSchema = z.literal('me').nullish()
/** Web links only: file:// or custom schemes could run things. */
export const externalUrlSchema = z
  .string()
  .max(8192)
  .regex(/^https?:\/\//i)
/** Floor id of setAccountPool; null = folders outside every floor. */
export const floorIdSchema = z.string().min(1).max(40).nullable()
/** A squad code as squads.ts accepts it. */
export const squadCodeSchema = z.string().regex(/^[\w-]{1,64}$/)
export const squadNoteSchema = z.string().max(20_000).optional().catch(undefined)
export const accountNameSchema = z.string().max(200).catch('')

// ---------- squads: a proposal for an empty room (ticket 04) ----------

/** The room of a floor: 0, 1 or 2. */
export const squadRoomSchema = z
  .number()
  .int()
  .min(0)
  .max(SQUAD_ROOM_COUNT - 1)
/** A proposal of a squad: the id, the floor, the room, the brief and the tickets (optional). */
export const squadProposalRequestSchema = z.object({
  /** The id the page chose: it may throw the proposal away while it generates. */
  id: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  projectId: z.string().min(1).max(40),
  room: squadRoomSchema,
  brief: z.string().trim().min(1).max(4_000),
  ticketIds: z.array(idSchema).max(50).default([]),
})
/** The id of a proposal. The page never sends a path: only the proposal it means. */
export const squadProposalIdSchema = z.object({ id: idSchema })
/** What the player asked to change in the proposal. */
export const squadAdjustmentSchema = z.object({
  id: idSchema,
  adjustment: z.string().trim().min(1).max(2_000),
  /** The name the player edited, when it changed: it goes into the proposal before the adjustment. */
  name: z.string().trim().min(1).max(SQUAD_NAME_MAX).optional(),
})
/** The name the player edited in the proposal: it may not be empty. */
export const squadRenameSchema = z.object({ id: idSchema, name: z.string().trim().min(1).max(SQUAD_NAME_MAX) })
/** The approval: the proposal and the name of the squad (it may have been edited). */
export const squadApprovalSchema = z.object({ id: idSchema, name: z.string().trim().min(1).max(SQUAD_NAME_MAX) })

/** Files sent with a message. buildMessage checks the bytes and the limits with friendly messages. */
export const attachmentsSchema: z.ZodType<AttachmentInput[]> = z
  .array(
    z.object({
      name: z.string().max(1000),
      mime: z.string().max(200).optional(),
      path: z.string().max(MAX_PATH).optional(),
      dataBase64: z
        .string()
        .max(Math.ceil((ATTACH_LIMITS.total * 4) / 3) + 16)
        .optional(),
    }),
  )
  .max(100)

/** A permission card's answer. */
export const permissionDecisionSchema: z.ZodType<PermissionDecision> = z.object({
  requestId: idSchema,
  behavior: z.enum(['allow', 'allow_always', 'deny']),
  message: z.string().max(10_000).optional(),
  answers: z
    .record(z.string().max(2000), z.string().max(10_000))
    .refine((a) => Object.keys(a).length <= 50)
    .optional(),
})

// Tickets: tickets.ts trims to its own limits (cleanDraft); these caps only refuse absurd sizes.
const criterionSchema = z.object({ text: z.string().max(2000), done: z.boolean().optional().default(false) })
const ticketFields = {
  type: z.enum(['bug', 'feature', 'improvement', 'task']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  status: ticketStatusSchema.optional(),
  description: z.string().max(100_000).optional(),
  acceptance: z.array(criterionSchema).max(200).optional(),
  cwd: pathSchema.nullable().optional(),
  tags: z.array(z.string().max(100)).max(100).optional(),
  // NaN or Infinity clear it, as cleanDraft does with any number it cannot use.
  estimate: z.number().nullable().optional().catch(null),
  dueDate: z.string().max(10).nullable().optional(),
  blockedBy: z.array(idSchema).max(200).optional(),
}
export const ticketDraftSchema: z.ZodType<TicketDraft> = z.object({ title: z.string().max(2000), ...ticketFields })
export const ticketPatchSchema: z.ZodType<TicketPatch> = z.object({ title: z.string().max(2000).optional(), ...ticketFields })

// ---------- brains, accounts, floors ----------

/** Model, effort and accounts from the renderer: a short model name or id, a known effort level, existing accounts. */
export function cleanBrain(raw: unknown, accounts: Account[]): AgentBrain {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const brain: AgentBrain = {}
  // A key that is present but empty means "Claude Code's default", not the office default.
  if ('model' in r) brain.model = typeof r.model === 'string' && MODEL_RE.test(r.model) ? r.model : undefined
  if ('effort' in r) brain.effort = EFFORT_LEVELS.includes(r.effort as never) ? (r.effort as AgentBrain['effort']) : undefined
  // Empty = the project's accounts.
  if ('accounts' in r) brain.accounts = cleanAccountIds(r.accounts, accounts)
  return brain
}

/** Account ids from the renderer that exist, without repeats. */
export function cleanAccountIds(raw: unknown, accounts: Account[]): string[] {
  const ids = Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string' && accounts.some((a) => a.id === id)) : []
  return [...new Set(ids)]
}

/**
 * Accounts from the renderer: only names, colors and order change here. Ids and
 * config folders come from accounts made by addAccount, never from the page.
 */
export function cleanAccounts(raw: unknown, current: Account[]): Account[] {
  const out: Account[] = []
  for (const item of Array.isArray(raw) ? raw : []) {
    const r = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const known = current.find((a) => a.id === r.id)
    if (!known || out.some((o) => o.id === known.id)) continue
    const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 32) : known.name
    const color = typeof r.color === 'string' && HEX.test(r.color) ? r.color : known.color
    out.push({ ...known, name, color })
  }
  // Removing goes through removeAccount.
  for (const a of current) if (!out.some((o) => o.id === a.id)) out.push(a)
  return out
}

/** Raster logos only (no SVG: it can carry scripts), small enough for office.json. */
const LOGO_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/
export const MAX_LOGO_CHARS = 400_000

// ---------- regras "Sempre permitir" ----------

/** Cap by project: the list has to stay readable in the settings form. */
export const MAX_ALWAYS_ALLOW_RULES = 100
const RULE_VALUE_LIMIT = 500
const RULE_ID_RE = /^[\w-]{1,64}$/

/**
 * The project's "Sempre permitir" rules, with everything bad removed: unknown kind,
 * empty or overlong value, repeated id and repeated action. A rule sent without an id
 * (a new one from the settings form) gets one. Garbage in the place of the list clears
 * nothing: without the key the floor keeps the rules it already had — when the form
 * sends the key again (even empty), the clean result stands.
 */
export function cleanAlwaysAllowRules(raw: unknown, previous: AlwaysAllowRule[] = []): AlwaysAllowRule[] {
  if (!Array.isArray(raw)) return previous.length ? [...previous] : []
  const out: AlwaysAllowRule[] = []
  for (const item of raw) {
    const r = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const kind = r.kind === 'tool' || r.kind === 'command' ? r.kind : undefined
    const value = typeof r.value === 'string' ? r.value.trim().slice(0, RULE_VALUE_LIMIT) : ''
    if (!kind || !value) continue
    if (out.some((o) => o.kind === kind && o.value === value)) continue
    const id = typeof r.id === 'string' && RULE_ID_RE.test(r.id) && !out.some((o) => o.id === r.id) ? r.id : `r-${randomUUID().slice(0, 8)}`
    out.push({
      id,
      createdAt: typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) && r.createdAt >= 0 ? r.createdAt : Date.now(),
      kind,
      value,
    })
  }
  return out.slice(0, MAX_ALWAYS_ALLOW_RULES)
}

function cleanBrand(p: Record<string, unknown>): Pick<ProjectFloor, 'logo' | 'brandColor' | 'uniform'> {
  const out: Pick<ProjectFloor, 'logo' | 'brandColor' | 'uniform'> = {}
  if (typeof p.logo === 'string' && p.logo.length <= MAX_LOGO_CHARS && LOGO_RE.test(p.logo)) out.logo = p.logo
  if (typeof p.brandColor === 'string' && HEX.test(p.brandColor)) out.brandColor = p.brandColor.toLowerCase()
  if (p.uniform === true) out.uniform = true
  return out
}

/**
 * Project floors from the renderer: existing folders only, one floor per folder,
 * a plain id (it becomes part of avatar seeds and lookups) and a short name.
 */
export function cleanProjects(raw: unknown, previous: ProjectFloor[]): ProjectFloor[] {
  const out: ProjectFloor[] = []
  for (const item of Array.isArray(raw) ? raw : []) {
    const p = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const cwd = typeof p.cwd === 'string' ? p.cwd : ''
    if (!isAbsolute(cwd) || !isDir(cwd) || out.some((o) => o.cwd === cwd)) continue
    const id =
      typeof p.id === 'string' && /^[\w-]{1,40}$/.test(p.id) && !out.some((o) => o.id === p.id) ? p.id : `p-${randomUUID().slice(0, 8)}`
    const name = (typeof p.name === 'string' ? p.name.trim().slice(0, 32) : '') || floorNameFor(cwd)
    const known = previous.find((o) => o.id === id)
    const sameProject = known?.cwd === cwd ? known : undefined
    // A floor's accounts change only through setAccountPool: the settings form may hold an old copy.
    const accounts = known?.accounts
    // The project's permission mode follows the same rule: what the form sends stays
    // only when it is on the list; an old form (or a bad value) keeps the floor's own.
    const mode = permissionModeSchema.safeParse(p.permissionMode)
    const modeField = mode.success
      ? { permissionMode: mode.data }
      : sameProject?.permissionMode
        ? { permissionMode: sameProject.permissionMode }
        : {}
    // The rules list is always sent by the new form (clearing sends []); an old form
    // that omits the key leaves the rules that already existed untouched.
    const rules = Object.hasOwn(p, 'alwaysAllow') ? cleanAlwaysAllowRules(p.alwaysAllow) : (sameProject?.alwaysAllow ?? [])
    out.push({
      id,
      name,
      cwd,
      ...(accounts?.length ? { accounts } : {}),
      ...modeField,
      ...(rules.length ? { alwaysAllow: rules } : {}),
      ...cleanBrand(p),
    })
    if (out.length === MAX_PROJECT_FLOORS) break
  }
  return out
}

/** Days as 'YYYY-MM-DD' and an absolute folder; anything else is dropped. */
export function cleanLedgerQuery(raw: unknown): LedgerQuery {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)
  const q: LedgerQuery = {}
  if (day(r.from)) q.from = day(r.from)
  if (day(r.to)) q.to = day(r.to)
  if (typeof r.cwd === 'string' && isAbsolute(r.cwd)) q.cwd = r.cwd
  return q
}

// ---------- requests ----------

/**
 * A hire from the renderer: an existing folder, a task, a short name, a clean brain.
 * A permission mode follows the project: an explicit mode on the list stays (the warning
 * for the most permissive ones is the form's job), otherwise the floor of the folder,
 * and only in the last case the office default.
 */
export function cleanHire(
  raw: unknown,
  settings: Pick<Settings, 'accounts' | 'defaultEngine' | 'defaultPermissionMode' | 'projects'>,
): HireRequest {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const cwd = pathSchema.safeParse(r.cwd)
  if (!cwd.success || !isDir(cwd.data)) throw new Error('Escolha uma pasta de projeto que exista.')
  const task = messageSchema.safeParse(r.task)
  if (!task.success || !task.data.trim()) throw new Error('Descreva a tarefa do agente.')
  const inherited = projectFor(settings.projects, cwd.data)?.permissionMode ?? settings.defaultPermissionMode
  const mode = permissionModeSchema.safeParse(r.permissionMode)
  const requested = mode.success ? mode.data : inherited
  const brain = cleanBrain(r, settings.accounts)
  const profile = profileIdSchema.safeParse(r.profile)
  if (r.profile !== undefined && !profile.success) throw new Error('Esse perfil não existe. Escolha um dos perfis de fábrica.')
  if (modeIsMorePermissive(requested, inherited) && r.confirmPermissionOverride !== true) {
    throw new Error('Confirme explicitamente o modo de permissões mais permissivo que o padrão do projeto.')
  }
  return {
    name: typeof r.name === 'string' ? r.name.slice(0, 40) : '',
    cwd: cwd.data,
    task: task.data,
    engine: 'claude',
    ...brain,
    permissionMode: requested,
    ...(r.confirmPermissionOverride === true ? { confirmPermissionOverride: true } : {}),
    worktree: worktreeFlagSchema.parse(r.worktree),
    ...(profile.success && profile.data ? { profile: profile.data } : {}),
  }
}

// ---------- worktrees and result cards (AO-33, AO-34) ----------

/** "Trabalhar numa cópia isolada": true, false, or missing (= yes in a git repo). */
export const worktreeFlagSchema = z.boolean().optional().catch(undefined)
/** Agent and result ids are randomUUID()s. */
export const uuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
/** A file of a result card: git.ts still checks it is listed and inside the repo. */
export const changedPathSchema = z
  .string()
  .min(1)
  .max(MAX_PATH)
  .refine((p) => !p.includes('\0'))
export const commitMessageSchema = z.string().trim().min(1).max(2000)
/** First line only, short enough for a PR title. */
export const prTitleSchema = z
  .string()
  .transform((s) => s.trim().split('\n')[0].slice(0, 200))
  .pipe(z.string().min(1))

/** Who takes a ticket: an agent already here, or a new hire that never runs with "bypass". */
export function cleanDelegateTarget(raw: unknown, accounts: Account[]): DelegateTarget {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if ('agentId' in r)
    return { agentId: parse(idSchema, r.agentId, 'Agente inválido.'), confirmPermissionOverride: r.confirmPermissionOverride === true }
  const hire = (r.hire && typeof r.hire === 'object' ? r.hire : {}) as Record<string, unknown>
  return {
    hire: {
      ...cleanBrain(hire, accounts),
      engine: 'claude',
      permissionMode: permissionModeSchema.safeParse(hire.permissionMode).success
        ? (hire.permissionMode as OfficePermissionMode)
        : undefined,
      confirmPermissionOverride: hire.confirmPermissionOverride === true,
      worktree: worktreeFlagSchema.parse(hire.worktree),
    },
  }
}

/** A conservative total order: moving right increases the set of actions that can run unattended. */
const MODE_ACCESS: readonly OfficePermissionMode[] = ['plan', 'default', 'acceptEdits', 'auto', 'bypassPermissions']

export function modeIsMorePermissive(candidate: OfficePermissionMode, inherited: OfficePermissionMode): boolean {
  if (candidate === inherited || candidate === 'plan' || inherited === 'bypassPermissions') return false
  // Auto and acceptEdits authorize different action sets; either explicit switch needs consent.
  if ((candidate === 'auto' && inherited === 'acceptEdits') || (candidate === 'acceptEdits' && inherited === 'auto')) return true
  return MODE_ACCESS.indexOf(candidate) > MODE_ACCESS.indexOf(inherited)
}

/** Reject bypass for workflows where the task may originate from another agent or user. */
export function checkedSquadMode(raw: unknown, inherited: OfficePermissionMode, confirmedOverride = false): OfficePermissionMode {
  const parsed = permissionModeSchema.safeParse(raw)
  const mode = parsed.success ? parsed.data : inherited
  if (mode === 'bypassPermissions') throw new Error('Squads nunca podem rodar no modo "Sem pedir nada".')
  if (modeIsMorePermissive(mode, inherited) && !confirmedOverride) {
    throw new Error('Confirme explicitamente o modo de permissões mais permissivo que o padrão do projeto.')
  }
  return mode
}

// ---------- settings ----------

const lookSchema = z.object({
  skin: z.string().regex(HEX),
  hair: z.string().regex(HEX),
  hairStyle: z
    .number()
    .int()
    .min(0)
    .max(HAIR_STYLES - 1),
  shirt: z.string().regex(HEX),
  pants: z.string().regex(HEX),
  shoes: z.string().regex(HEX),
})

/**
 * A number, or a string of digits (an input's value). Not z.coerce: null, '', [] and
 * false would become 0 and true 1, and saving {ticketAutoCloseDays: null} would turn
 * auto-close off. Anything else keeps the current value (AO-44).
 */
const numberField = z.union([
  z.number(),
  z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/)
    .transform(Number),
])

/**
 * One schema per field the settings form may change. bridgePort and the lists
 * (projects, accounts, defaultAccounts) have their own rules in cleanSettings.
 */
const settingsFields = {
  playerName: z.string().trim().min(1).max(32),
  playerLook: lookSchema,
  pixelSize: z.number().int().min(2).max(5),
  defaultModel: z.union([z.literal(''), z.string().regex(MODEL_RE)]),
  defaultEngine: z.literal('claude'),
  defaultEffort: z.union([z.literal(''), z.enum(EFFORT_LEVELS as [EffortLevel, ...EffortLevel[]])]),
  defaultPermissionMode: permissionModeSchema,
  notifications: z.boolean(),
  ticketAutoCloseDays: numberField.pipe(z.number().int().min(0).max(365)),
  maxSubagents: numberField.pipe(z.number().int().min(0).max(100)),
  agentBudgetUsd: numberField.pipe(z.number().finite().min(0).max(100_000)).transform((n) => Math.round(n * 100) / 100),
  updateChannel: z.enum(['stable', 'beta']),
} satisfies { [K in keyof Settings]?: z.ZodType<unknown> }

/** Configurações → Vídeo, one schema per field: a bad one keeps its current value. */
const videoFields = {
  shadows: z.boolean(),
  shadowMapSize: z.union([z.literal(1024), z.literal(2048)]),
  fpsLimit: z.union([z.literal(0), z.literal(30), z.literal(60)]),
  effects: z.enum(['full', 'reduced']),
  batterySaver: z.boolean(),
} satisfies { [K in keyof VideoSettings]: z.ZodType<VideoSettings[K]> }

/** Video settings from the renderer (or an old office.json) laid over `current`; unknown keys are dropped. */
export function cleanVideo(raw: unknown, current: VideoSettings): VideoSettings {
  const patch = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const next: VideoSettings = { ...current }
  const put = next as unknown as Record<string, unknown>
  for (const [key, schema] of Object.entries(videoFields)) {
    if (!Object.hasOwn(patch, key)) continue
    const r = (schema as z.ZodType<unknown>).safeParse(patch[key])
    if (r.success) put[key] = r.data
  }
  return next
}

/**
 * A settings patch from the renderer applied to the current settings. Unknown keys are
 * dropped; a field with the wrong type or out of range keeps its current value.
 */
export function cleanSettings(raw: unknown, current: Settings): Settings {
  const patch = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const next: Settings = { ...current }
  const put = next as unknown as Record<string, unknown>
  for (const [key, schema] of Object.entries(settingsFields)) {
    if (!Object.hasOwn(patch, key)) continue
    const r = (schema as z.ZodType<unknown>).safeParse(patch[key])
    if (r.success) put[key] = r.data
  }
  if (Object.hasOwn(patch, 'accounts')) next.accounts = cleanAccounts(patch.accounts, current.accounts)
  if (Object.hasOwn(patch, 'defaultAccounts')) next.defaultAccounts = cleanAccountIds(patch.defaultAccounts, next.accounts)
  if (Object.hasOwn(patch, 'projects')) next.projects = cleanProjects(patch.projects, current.projects)
  if (patch.confirmPermissionChanges !== true) {
    if (next.defaultPermissionMode === 'bypassPermissions' && current.defaultPermissionMode !== 'bypassPermissions')
      next.defaultPermissionMode = current.defaultPermissionMode
    next.projects = next.projects.map((floor) => {
      const old = current.projects.find((p) => p.id === floor.id)
      return floor.permissionMode === 'bypassPermissions' && old?.permissionMode !== 'bypassPermissions'
        ? { ...floor, permissionMode: old?.permissionMode }
        : floor
    })
  }
  if (Object.hasOwn(patch, 'video')) next.video = cleanVideo(patch.video, current.video)
  return next
}

// ---------- routines ----------

const hhmmSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
/** Shape only: schedule.ts says what is wrong with the values, in words the form shows. */
export const scheduleSchema: z.ZodType<Schedule> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), at: z.string().max(20) }),
  z.object({ kind: z.literal('daily'), time: hhmmSchema }),
  z.object({ kind: z.literal('weekly'), days: z.array(z.number().int().min(0).max(6)).max(7), time: hhmmSchema }),
  z.object({
    kind: z.literal('interval'),
    every: z.number().int().min(1).max(10_080),
    unit: z.enum(['minutes', 'hours']),
    anchor: z.number().int().min(0).max(8_640_000_000_000).optional(),
  }),
  z.object({ kind: z.literal('cron'), expr: z.string().max(200) }),
])

const routineWhoSchema: z.ZodType<RoutineWho> = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('new'),
    name: z.string().max(40).optional(),
    model: z.union([z.literal(''), z.string().regex(MODEL_RE)]).optional(),
    effort: z.enum(EFFORT_LEVELS as [EffortLevel, ...EffortLevel[]]).optional(),
  }),
  z.object({ kind: z.literal('template'), templateId: idSchema }),
  z.object({ kind: z.literal('agent'), agentId: idSchema }),
])

export const routineDraftSchema = z.object({
  id: z
    .string()
    .regex(/^[\w-]{1,64}$/)
    .optional(),
  name: z.string().max(2000),
  prompt: z.string().max(ROUTINE_LIMITS.prompt),
  who: routineWhoSchema,
  cwd: pathSchema.optional(),
  floor: z.string().min(1).max(40).optional(),
  permissionMode: permissionModeSchema.optional(),
  confirmPermissionOverride: z.boolean().optional(),
  schedule: scheduleSchema,
  enabled: z.boolean().optional(),
  missed: z.enum(['run', 'skip']).optional(),
})

/** A routine draft that passed every check: one place to run (cwd, or the floor's), defaults filled. */
export type CleanRoutineDraft = Required<
  Pick<RoutineDraft, 'name' | 'prompt' | 'who' | 'permissionMode' | 'schedule' | 'enabled' | 'missed'>
> &
  Pick<RoutineDraft, 'id' | 'cwd' | 'floor'>

/**
 * A routine from the renderer. Throws a message the form can show: a name, a task, a
 * schedule that runs, a runner that exists and a folder or floor for agents it hires.
 * Nothing says "Sem pedir nada" unless the form sent it (the default is "Pedir permissão").
 */
export function cleanRoutineDraft(
  raw: unknown,
  ctx: { settings: Pick<Settings, 'projects' | 'templates' | 'defaultPermissionMode'>; agents: AgentSummary[]; now?: number },
): CleanRoutineDraft {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const name = typeof r.name === 'string' ? r.name.trim() : ''
  if (!name || name.length > ROUTINE_LIMITS.name) throw new Error(`Dê um nome à rotina (até ${ROUTINE_LIMITS.name} letras).`)
  const d = parse(routineDraftSchema, raw, 'Rotina inválida. Feche e abra o formulário de novo.')
  const who = d.who
  const prompt = d.prompt.trim()
  const template = who.kind === 'template' ? ctx.settings.templates.find((t) => t.id === who.templateId) : undefined
  const existingAgent = who.kind === 'agent' ? ctx.agents.find((a) => a.id === who.agentId) : undefined
  if (who.kind === 'template' && !template) throw new Error('Esse modelo salvo não existe mais. Escolha outro.')
  if (!prompt && !template?.instruction) throw new Error('Descreva a tarefa da rotina.')
  const problem = scheduleError(d.schedule)
  if (problem) throw new Error(problem)
  const schedule: Schedule =
    d.schedule.kind === 'interval'
      ? { ...d.schedule, anchor: d.schedule.anchor ?? Math.floor((ctx.now ?? Date.now()) / 60_000) * 60_000 }
      : d.schedule
  if (schedule.kind === 'weekly') schedule.days = [...new Set(schedule.days)].sort((a, b) => a - b)
  if (schedule.kind === 'cron') schedule.expr = schedule.expr.trim().replace(/\s+/g, ' ')

  const out: CleanRoutineDraft = {
    ...(d.id ? { id: d.id } : {}),
    name,
    prompt,
    who:
      who.kind === 'new'
        ? {
            kind: 'new',
            ...(who.name?.trim() ? { name: who.name.trim() } : {}),
            ...(who.model ? { model: who.model } : {}),
            ...(who.effort ? { effort: who.effort } : {}),
          }
        : who,
    permissionMode:
      existingAgent?.permissionMode ??
      d.permissionMode ??
      (d.floor ? ctx.settings.projects.find((p) => p.id === d.floor)?.permissionMode : undefined) ??
      (d.cwd ? projectFor(ctx.settings.projects, d.cwd)?.permissionMode : undefined) ??
      ctx.settings.defaultPermissionMode,
    schedule,
    enabled: d.enabled ?? true,
    missed: d.missed ?? 'run',
  }
  if (who.kind === 'agent') {
    const a = existingAgent
    if (!a) throw new Error('Esse agente não está mais no escritório. Escolha outro.')
    if (a.source !== 'office') throw new Error('Sessões do terminal não recebem tarefas do escritório. Escolha um agente do escritório.')
    if (a.role === 'orchestrator') throw new Error(`${a.name} só roda o ciclo do squad. Escolha outro agente.`)
    if (d.permissionMode !== undefined && d.permissionMode !== a.permissionMode)
      throw new Error('Uma rotina ligada a um agente existente usa o modo atual dele. Altere o modo do agente separadamente.')
    return out
  }
  if (d.floor) {
    const floor = ctx.settings.projects.find((p) => p.id === d.floor)
    if (!floor) throw new Error('Esse andar não existe mais. Escolha outro.')
    if (
      modeIsMorePermissive(out.permissionMode, floor.permissionMode ?? ctx.settings.defaultPermissionMode) &&
      d.confirmPermissionOverride !== true
    )
      throw new Error('Confirme explicitamente o modo de permissões mais permissivo que o padrão do projeto.')
    return { ...out, floor: d.floor }
  }
  if (!d.cwd || !isAbsolute(d.cwd) || !isDir(d.cwd)) throw new Error('Escolha a pasta (ou o andar) onde a rotina roda.')
  if (
    modeIsMorePermissive(
      out.permissionMode,
      projectFor(ctx.settings.projects, d.cwd)?.permissionMode ?? ctx.settings.defaultPermissionMode,
    ) &&
    d.confirmPermissionOverride !== true
  )
    throw new Error('Confirme explicitamente o modo de permissões mais permissivo que o padrão do projeto.')
  return { ...out, cwd: d.cwd }
}
