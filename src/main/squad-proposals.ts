import { join } from 'node:path'
import { z } from 'zod'
import {
  SQUAD_MAX_MEMBERS,
  SQUAD_MIN_MEMBERS,
  SQUAD_MODELS,
  SQUAD_NAME_MAX,
  SQUAD_ROOM_COUNT,
  SQUAD_ROLES,
  type SquadProposal,
} from '@shared/types'
import { backupCopies, shapeOf } from './backups'
import { loadJson, quarantineParts, reportLoad, writeJsonAtomic } from './fs-safe'
import { log } from './log'

// The proposals of squads the player asked for and has not approved yet. They live in
// the app's data, apart from the squads of the projects: a proposal is not a squad and
// nothing it says exists in the project folder until the approval.

interface Data {
  proposals: SquadProposal[]
}

/**
 * The shape of a proposal that came back from the disk. A record that does not fit
 * (null, a field of the wrong type, a role that does not exist) is dropped: it can
 * never reach the renderer, and it never brings the office down at startup.
 */
const memberSchema = z.object({
  id: z.string().regex(/^[\w-]{1,64}$/),
  name: z.string().trim().min(1).max(40),
  role: z.enum(SQUAD_ROLES),
  engine: z.literal('claude'),
  model: z.enum(SQUAD_MODELS),
  account: z.string().max(64),
  focus: z.string().max(240),
})

const compositionSchema = z.object({
  name: z.string().trim().min(1).max(SQUAD_NAME_MAX),
  members: z.array(memberSchema).min(SQUAD_MIN_MEMBERS).max(SQUAD_MAX_MEMBERS),
})

const proposalSchema = z
  .object({
    id: z.string().regex(/^[\w-]{1,64}$/),
    projectId: z.string().min(1).max(64),
    cwd: z.string().max(4096),
    room: z
      .number()
      .int()
      .min(0)
      .max(SQUAD_ROOM_COUNT - 1),
    createdAt: z.number().finite(),
    updatedAt: z.number().finite(),
    brief: z.string().trim().min(1).max(8000),
    ticketIds: z
      .array(z.string().min(1).max(200))
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length),
    adjustments: z.array(z.string().trim().min(1).max(4000)).max(1000),
    name: z.string().trim().min(1).max(SQUAD_NAME_MAX),
    composition: compositionSchema.nullable(),
    status: z.enum(['generating', 'pending', 'created', 'assigned']),
    code: z
      .string()
      .regex(/^[\w-]{1,64}$/)
      .optional(),
  })
  .superRefine((proposal, ctx) => {
    if (proposal.status !== 'generating' && proposal.composition === null)
      ctx.addIssue({ code: 'custom', path: ['composition'], message: 'composition required' })
    if (proposal.status === 'assigned' && !proposal.code)
      ctx.addIssue({ code: 'custom', path: ['code'], message: 'assigned proposal needs a squad code' })
    if (proposal.composition && proposal.composition.name !== proposal.name)
      ctx.addIssue({ code: 'custom', path: ['composition', 'name'], message: 'proposal name mismatch' })
    if (proposal.composition) {
      const ids = new Set<string>()
      const roles = new Set<string>()
      for (const [index, member] of proposal.composition.members.entries()) {
        if (ids.has(member.id)) ctx.addIssue({ code: 'custom', path: ['composition', 'members', index, 'id'], message: 'duplicate id' })
        if (roles.has(member.role))
          ctx.addIssue({ code: 'custom', path: ['composition', 'members', index, 'role'], message: 'duplicate role' })
        ids.add(member.id)
        roles.add(member.role)
      }
      if (!roles.has('implementer') || !roles.has('reviewer'))
        ctx.addIssue({ code: 'custom', path: ['composition', 'members'], message: 'required roles missing' })
      if (
        proposal.composition.members.findIndex((m) => m.role === 'reviewer') <
        proposal.composition.members.findIndex((m) => m.role === 'implementer')
      )
        ctx.addIssue({ code: 'custom', path: ['composition', 'members'], message: 'reviewer must follow implementer' })
    }
  })

export class SquadProposalStore {
  private file: string
  private dir: string
  private data: Data

  constructor(dir: string) {
    this.dir = dir
    this.file = join(dir, 'squad-proposals.json')
    this.data = this.load()
  }

  private load(): Data {
    const r = loadJson<Partial<Data>>(this.file, {
      valid: shapeOf('squad-proposals.json'),
      fallbacks: backupCopies(this.dir, 'squad-proposals.json'),
    })
    reportLoad(this.file, r)
    const raw: Partial<Data> = r.status === 'ok' || r.status === 'restored' ? r.data : {}
    const list = Array.isArray(raw.proposals) ? raw.proposals : []
    const proposals: SquadProposal[] = []
    const dropped: unknown[] = []
    for (const item of list) {
      const parsed = proposalSchema.safeParse(item)
      if (parsed.success) proposals.push(parsed.data)
      else dropped.push(item)
    }
    // A record that does not fit is left out, not used: the office opens with the
    // proposals it can trust. What was left out is kept aside, for the player.
    if (dropped.length) {
      const kept = quarantineParts(this.file, dropped)
      log.warn(`Dados: ${dropped.length} proposta(s) de squad fora do formato foram descartadas${kept ? ` e guardadas em ${kept}` : ''}.`)
    }
    return { proposals }
  }

  /** Every proposal, newest first. */
  list(): SquadProposal[] {
    return [...this.data.proposals].sort((a, b) => b.createdAt - a.createdAt)
  }

  get(id: string): SquadProposal | undefined {
    return this.data.proposals.find((p) => p.id === id)
  }

  /** The proposal of a room of a floor, when there is one. */
  forRoom(projectId: string, room: number): SquadProposal | undefined {
    return this.data.proposals.find((p) => p.projectId === projectId && p.room === room && p.status !== 'assigned')
  }

  /** Saves a proposal (new or changed). */
  put(proposal: SquadProposal): void {
    const i = this.data.proposals.findIndex((p) => p.id === proposal.id)
    if (i < 0) this.data.proposals.push(proposal)
    else this.data.proposals[i] = proposal
    this.save()
  }

  /** Forgets a proposal: nothing was created for it. */
  remove(id: string): void {
    const before = this.data.proposals.length
    this.data.proposals = this.data.proposals.filter((p) => p.id !== id)
    if (this.data.proposals.length !== before) this.save()
  }

  private save(): void {
    writeJsonAtomic(this.file, this.data)
  }
}
