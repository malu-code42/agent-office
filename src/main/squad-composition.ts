import { z } from 'zod'
import { SQUAD_MAX_MEMBERS, SQUAD_MIN_MEMBERS, SQUAD_ROLES, type SquadProposalMember, type SquadRole } from '@shared/types'

// The composition of a squad: what the model proposes and what the office accepts.
// The answer of the model is untrusted: it is parsed, checked here and refused when it
// does not fit the room. Nothing is written before the player approves it.

/** One member as the model proposes it. */
const memberSchema = z.object({
  name: z.string().trim().min(1).max(40),
  role: z.enum(SQUAD_ROLES),
  // The model and the account are optional: missing or null mean the default (the
  // default of Claude Code and the pool of the project). Anything else has to be
  // exactly one of the names the office knows.
  model: z.union([z.string().trim().max(40), z.null()]).optional(),
  account: z.union([z.string().trim().max(40), z.null()]).optional(),
  focus: z.union([z.string().trim().max(240), z.null()]).optional(),
})

/** The composition as the model proposes it: the team, in the order of the desks. */
const compositionSchema = z.object({
  members: z.array(memberSchema).min(SQUAD_MIN_MEMBERS).max(SQUAD_MAX_MEMBERS),
})

/** What the office knows about models and accounts; the answer is checked against it. */
export interface CompositionContext {
  /** Model names the office offers. */
  models: readonly string[]
  /** Account names the office has. */
  accounts: readonly string[]
}

/**
 * The model of a member when the answer does not name one: the default of Claude Code.
 * The empty string is the only value that is always allowed, even with no model
 * configured in the office.
 */
export const DEFAULT_MODEL = ''

/**
 * The account of a member when the answer does not name one: the pool of the project.
 * The empty string is the only value that is always allowed, even with no account
 * configured in the office.
 */
export const DEFAULT_ACCOUNT = ''

/** A ticket of the board, as the prompt shows it. */
export interface CompositionTicket {
  key: string
  title: string
}

export interface CompositionRequest {
  /** Project folder of the squad. */
  cwd: string
  /** What the player asked for. */
  brief: string
  /** Tickets the player chose; they are context, not the squad's job list. */
  tickets: CompositionTicket[]
  /** What the player asked to change, oldest first. */
  adjustments: string[]
  ctx: CompositionContext
}

/** The prompt of the composition. English: it goes to a model, not to the player. */
export function compositionPrompt(req: CompositionRequest): string {
  const tickets = req.tickets.length ? req.tickets.map((t) => `- ${t.key}: ${t.title}`).join('\n') : '- (the player chose no ticket)'
  const adjustments = req.adjustments.length
    ? `\nThe player asked for these changes; honour them:\n${req.adjustments.map((a) => `- ${a}`).join('\n')}\n`
    : ''
  return [
    'You plan the team of one squad room of Agent Office, a Brazilian Portuguese office app.',
    'Answer with ONE JSON object and nothing else. No prose, no markdown fence:',
    '{"members": [{"name": "...", "role": "...", "model": "...", "account": "...", "focus": "..."}]}',
    'Rules:',
    '- "members": 2 to 6 members, in the order their desks are made. The room also has a fixed coordinator desk; do not include a coordinator.',
    '- "role": exactly one "implementer" and exactly one "reviewer", and the "reviewer" comes after the "implementer". The other members use "analyst", "tester", "writer" or "researcher".',
    modelRule(req.ctx.models),
    accountRule(req.ctx.accounts),
    '- "focus": one short line, in Brazilian Portuguese, saying what this member does in this squad.',
    'The brief and the tickets are context: the team serves the brief, and it never invents tickets of its own.',
    adjustments,
    'Brief of the player:',
    req.brief,
    'Tickets the player chose (context only):',
    tickets,
  ].join('\n')
}

/**
 * The rule of the model, in words. With no model configured the office says so: the
 * answer may only be empty then (the default of Claude Code), and any other name is
 * refused instead of being quietly turned into the default.
 */
function modelRule(models: readonly string[]): string {
  if (!models.length) return '- "model": "" only (the default of Claude Code): the office has no other model configured.'
  return `- "model": one of ${models.map((m) => `"${m}"`).join(', ')} ("" means the default of Claude Code).`
}

/** The rule of the account, in words. With no account the only answer is the pool. */
function accountRule(accounts: readonly string[]): string {
  if (!accounts.length) return '- "account": "" only (the pool of the project): the office has no other account configured.'
  return `- "account": one of ${accounts.map((a) => `"${a}"`).join(', ')} ("" means the pool of the project).`
}

/** The JSON inside the answer: a fenced block first, then the outermost braces. */
export function extractJson(text: string): string | undefined {
  if (!text) return undefined
  const candidates: string[] = []
  for (const block of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) candidates.push(block[1] ?? '')
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1))
  for (const candidate of candidates) {
    try {
      JSON.parse(candidate)
      return candidate
    } catch {
      // Not JSON: the next candidate is tried.
    }
  }
  return undefined
}

/** A file-safe id out of a name: it becomes a subagent type and a file name. */
export function memberId(name: string, index: number): string {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return base || `membro-${index + 1}`
}

/**
 * The members of the answer, checked here before anybody sees them. Throws a message
 * the player can read when the answer does not fit the room.
 */
export function parseComposition(text: string, ctx: CompositionContext): SquadProposalMember[] {
  const json = extractJson(text)
  if (!json) throw new Error('A IA não devolveu a composição em JSON. Tente de novo.')
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error('A IA devolveu uma composição ilegível. Tente de novo.')
  }
  const parsed = compositionSchema.safeParse(raw)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new Error(`A composição proposta não cabe na sala: ${first?.message ?? 'formato inválido'}. Pedir ajustes ou tente de novo.`)
  }
  const members: SquadProposalMember[] = []
  const used = new Set<string>()
  for (const [index, m] of parsed.data.members.entries()) {
    let id = memberId(m.name, index)
    let n = 2
    while (used.has(id)) id = `${memberId(m.name, index)}-${n++}`
    used.add(id)
    members.push({
      id,
      name: m.name,
      role: m.role,
      engine: 'claude',
      model: checkedModel(m.model ?? DEFAULT_MODEL, ctx.models),
      account: checkedAccount(m.account ?? DEFAULT_ACCOUNT, ctx.accounts),
      focus: m.focus ?? '',
    })
  }
  // The pipeline runs the implementer and then the reviewer: the room needs both, in this order.
  const implementer = members.findIndex((m) => m.role === 'implementer')
  const reviewer = members.findIndex((m) => m.role === 'reviewer')
  if (implementer < 0 || reviewer < 0)
    throw new Error('A composição precisa de um implementador e de um revisor independente. Pedir ajustes ou tente de novo.')
  if (reviewer < implementer) throw new Error('Na composição, o revisor independente vem depois do implementador. Pedir ajustes.')
  const roles = new Set<SquadRole>(members.map((m) => m.role))
  if (roles.size !== members.length) throw new Error('A composição repete um papel. Pedir ajustes ou tente de novo.')
  return members
}

/**
 * The model of a member. Empty is the default of Claude Code and is always allowed; a
 * model the office does not offer is refused, never turned into the default: the squad
 * would run with a model nobody chose.
 */
function checkedModel(value: string, allowed: readonly string[]): string {
  const model = value.trim()
  if (!model) return DEFAULT_MODEL
  if (!allowed.includes(model)) {
    const known = allowed.filter(Boolean).join(', ')
    throw new Error(
      `A composição propõe o modelo "${model}", que o office não oferece. ${
        known ? `Modelos aceitos: ${known}.` : 'O office não tem modelo configurado.'
      } Pedir ajustes ou tente de novo.`,
    )
  }
  return model
}

/**
 * The account of a member. Empty is the pool of the project and is always allowed; an
 * account the office does not have is refused, never turned into the pool: the member
 * would run on an account nobody chose.
 */
function checkedAccount(value: string, allowed: readonly string[]): string {
  const account = value.trim()
  if (!account) return DEFAULT_ACCOUNT
  if (!allowed.includes(account)) {
    throw new Error(
      `A composição propõe a conta "${account}", que o office não tem. ${
        allowed.length ? `Contas aceitas: ${allowed.join(', ')}.` : 'O office não tem conta configurada: o squad usaria o pool do projeto.'
      } Pedir ajustes ou tente de novo.`,
    )
  }
  return account
}
