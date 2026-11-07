import { join } from 'node:path'
import { z } from 'zod'
import type { AgentStatus, AgentSummary, SquadMember, SquadPhase, SquadPhaseRecord, SquadProgress, TicketStatus } from '@shared/types'
import { loadJson, quarantineParts, writeJsonAtomic } from './fs-safe'
import { log } from './log'

// AO-100: a fase de cada ciclo de squad, em disco, para o squad voltar sozinho ao reabrir o app.
// Fica nos dados do app (como squad-queues.json), nunca na pasta do squad.

export const SQUAD_PHASE_FILE = 'squad-phases.json'

const PHASES = ['iniciando', 'implementando', 'revisando', 'testando', 'trabalhando', 'aguardando', 'concluido'] as const

/** O que cada fase quer dizer em português, para a nota ao orquestrador e para o escritório. */
export const PHASE_LABEL: Record<SquadPhase, string> = {
  iniciando: 'iniciando',
  implementando: 'implementando',
  revisando: 'revisando',
  testando: 'testando',
  trabalhando: 'trabalhando',
  aguardando: 'aguardando a usuária',
  concluido: 'concluído',
}

/** Só estas fases voltam sozinhas: nas outras o ciclo acabou ou espera uma decisão da usuária. */
export function isResumablePhase(phase: SquadPhase): boolean {
  return phase !== 'aguardando' && phase !== 'concluido'
}

const recordSchema = z.object({
  code: z.string().regex(/^[\w-]{1,64}$/),
  ticketId: z.string().min(1).max(200),
  ticketKey: z.string().min(1).max(40).optional(),
  phase: z.enum(PHASES),
  round: z.number().int().min(0).max(1000),
  member: z.string().min(1).max(200).optional(),
  step: z.string().min(1).max(200).optional(),
  updatedAt: z.number().finite(),
})

/**
 * A fase do ciclo a partir do passo de state.json e do estado do orquestrador. undefined quando o
 * estado não diz nada novo (o turno acabou ou parou): a fase guardada continua a última conhecida.
 */
export function squadPhaseOf(
  step: SquadProgress | undefined,
  status: AgentStatus,
  members: Pick<SquadMember, 'id' | 'role'>[],
): SquadPhase | undefined {
  if (status === 'waiting') return 'aguardando'
  if (status === 'done') return 'concluido'
  if (status !== 'working' && status !== 'starting') return undefined
  if (!step || !step.current) return 'iniciando'
  if (step.status === 'completed') return 'concluido'
  if (step.type === 'checkpoint') return 'aguardando'
  const role = members.find((m) => m.id === step.agent)?.role
  if (role === 'implementer') return 'implementando'
  if (role === 'reviewer') return 'revisando'
  if (role === 'tester') return 'testando'
  return 'trabalhando'
}

export class SquadPhaseStore {
  private readonly file: string
  private data: Record<string, SquadPhaseRecord> = {}

  constructor(
    dir: string,
    private readonly now: () => number = Date.now,
  ) {
    this.file = join(dir, SQUAD_PHASE_FILE)
    this.load()
  }

  /** Arquivo ausente ou ilegível: começa vazio. Registro fora do formato: descartado com aviso, guardado à parte. */
  private load(): void {
    let r: ReturnType<typeof loadJson<{ phases?: unknown }>>
    try {
      r = loadJson<{ phases?: unknown }>(this.file, {
        valid: (v): v is { phases?: unknown } => !!v && typeof v === 'object' && !Array.isArray(v),
      })
    } catch (err) {
      log.warn(`Dados: não consegui ler as fases dos squads (${err instanceof Error ? err.message : String(err)}); eles não voltam sozinhos desta vez.`)
      return
    }
    const raw = r.status === 'ok' || r.status === 'restored' ? r.data : {}
    const source = raw.phases && typeof raw.phases === 'object' && !Array.isArray(raw.phases) ? (raw.phases as Record<string, unknown>) : {}
    const dropped: unknown[] = []
    for (const [code, value] of Object.entries(source)) {
      const parsed = recordSchema.safeParse(value)
      if (!parsed.success || parsed.data.code !== code) {
        dropped.push({ code, value })
        continue
      }
      this.data[code] = parsed.data
    }
    if (dropped.length) {
      const kept = quarantineParts(this.file, dropped)
      log.warn(`Dados: ${dropped.length} fase(s) de squad fora do formato foram descartadas${kept ? ` e guardadas em ${kept}` : ''}.`)
    }
    if (r.status === 'lost') log.warn('Dados: o arquivo das fases dos squads estava corrompido e foi guardado à parte; os squads não voltam sozinhos desta vez.')
  }

  get(code: string): SquadPhaseRecord | undefined {
    return this.data[code]
  }

  all(): SquadPhaseRecord[] {
    return Object.values(this.data)
  }

  /**
   * Grava a fase do ciclo do squad. Só escreve quando algo mudou. A rodada de revisão conta cada
   * entrada na fase "revisando" dentro do mesmo ticket; outro ticket recomeça em 0. Depois de retomar
   * (o orquestrador novo passa por "iniciando"), voltar a "revisando" é a mesma rodada, não outra.
   */
  record(input: { code: string; ticketId: string; ticketKey?: string; phase: SquadPhase; member?: string; step?: string }): SquadPhaseRecord {
    const prev = this.data[input.code]
    const same = prev?.ticketId === input.ticketId
    if (same && prev.phase === input.phase && prev.member === input.member && prev.step === input.step) return prev
    const resumedIntoReview = same && prev.phase === 'iniciando' && prev.round > 0
    const entersReview = input.phase === 'revisando' && !(same && prev.phase === 'revisando') && !resumedIntoReview
    const round = (same ? prev.round : 0) + (entersReview ? 1 : 0)
    const next: SquadPhaseRecord = {
      code: input.code,
      ticketId: input.ticketId,
      ...(input.ticketKey ? { ticketKey: input.ticketKey } : {}),
      phase: input.phase,
      round,
      ...(input.member ? { member: input.member } : {}),
      ...(input.step ? { step: input.step } : {}),
      updatedAt: this.now(),
    }
    this.data[input.code] = next
    this.save()
    return next
  }

  clear(code: string): void {
    if (!this.data[code]) return
    delete this.data[code]
    this.save()
  }

  private save(): void {
    try {
      writeJsonAtomic(this.file, { phases: this.data })
    } catch (err) {
      // Guardar a fase é ajuda para retomar; falhar não pode derrubar o ciclo.
      log.warn(`Não consegui guardar a fase do squad: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

export interface PhaseRecorderDeps {
  /** Os membros do squad `code` no projeto `cwd`. */
  members: (cwd: string, code: string) => Pick<SquadMember, 'id' | 'role'>[]
  /** O ticket ativo da fila do squad. */
  activeTicket: (code: string) => string | undefined
  ticketKey: (ticketId: string) => string | undefined
  record: (input: { code: string; ticketId: string; ticketKey?: string; phase: SquadPhase; member?: string; step?: string }) => void
}

/**
 * O gancho que grava a fase a cada mudança do orquestrador (AO-100). Só relê o squad quando o passo ou o
 * estado mudou, ignora quem não é orquestrador de squad e quem não roda o ticket ativo da fila.
 */
export function createPhaseRecorder(deps: PhaseRecorderDeps): (a: Pick<AgentSummary, 'id' | 'role' | 'squad' | 'ticketId' | 'status' | 'squadStep' | 'cwd'>) => void {
  const seen = new Map<string, string>()
  return (a) => {
    if (a.role !== 'orchestrator' || !a.squad || !a.ticketId) return
    const key = `${a.ticketId}|${a.status}|${JSON.stringify(a.squadStep ?? null)}`
    if (seen.get(a.id) === key) return
    seen.set(a.id, key)
    const phase = squadPhaseOf(a.squadStep, a.status, deps.members(a.cwd, a.squad))
    if (!phase) return
    if (deps.activeTicket(a.squad) !== a.ticketId) return
    deps.record({
      code: a.squad,
      ticketId: a.ticketId,
      ticketKey: deps.ticketKey(a.ticketId),
      phase,
      member: a.squadStep?.agent,
      step: a.squadStep?.label || undefined,
    })
  }
}

export interface ResumeFacts {
  /** O ticket ativo da fila do squad. */
  active: string | null
  /** O ticket no quadro; undefined se sumiu. */
  ticket?: { id: string; key: string; status: TicketStatus; closedAt?: number; assignee?: string }
  /** pausado/desativado pela usuária. */
  state?: 'paused' | 'disabled'
}

export type ResumeDecision =
  | { action: 'resume'; record: SquadPhaseRecord }
  | { action: 'skip'; reason: string }
  | { action: 'discard'; reason: string }

/** Decide, para um registro guardado, se o squad volta sozinho, espera a usuária ou o registro é descartado. */
export function decideResume(record: SquadPhaseRecord, facts: ResumeFacts): ResumeDecision {
  const code = record.code
  if (facts.active !== record.ticketId) return { action: 'discard', reason: `o ticket guardado não é mais o ativo do squad ${code}` }
  const t = facts.ticket
  if (!t || t.closedAt || t.status !== 'doing' || t.assignee !== `squad:${code}`)
    return { action: 'discard', reason: `o ticket ${record.ticketKey ?? record.ticketId} não está mais em "fazendo" com o squad ${code}` }
  if (facts.state) return { action: 'skip', reason: `o squad ${code} está ${facts.state === 'paused' ? 'pausado' : 'desativado'}` }
  if (!isResumablePhase(record.phase))
    return { action: 'skip', reason: `o squad ${code} está ${PHASE_LABEL[record.phase]}; não volta sozinho` }
  return { action: 'resume', record }
}

/** A nota ao orquestrador: de onde o ciclo continua. */
export function resumeNote(record: SquadPhaseRecord, members: Pick<SquadMember, 'id' | 'name'>[] = []): string {
  const hour = new Date(record.updatedAt).toLocaleString('pt-BR')
  const who = record.member ? (members.find((m) => m.id === record.member)?.name ?? record.member) : undefined
  const parts = [
    `O Agent Office foi reaberto com este ciclo no meio. Última fase guardada: ${PHASE_LABEL[record.phase]}`,
    record.round ? `rodada de revisão ${record.round}` : '',
    who ? `membro ${who}` : '',
    record.step ? `passo "${record.step}"` : '',
    `guardada em ${hour}`,
  ].filter(Boolean)
  return `${parts.join(', ')}. Continue dessa fase: leia squads/${record.code}/state.json e o que já foi feito na cópia isolada, não refaça o que está pronto e siga o pipeline a partir daí.`
}

export interface ResumeDeps {
  records: () => SquadPhaseRecord[]
  /** Fatos atuais do squad (fila, quadro, pausa) no momento da decisão. */
  facts: (code: string) => ResumeFacts
  discard: (code: string) => void
  /** Inicia o ciclo do ticket ativo (o mesmo caminho do squad_run); `note` vai para o orquestrador. */
  start: (code: string, resume: { record: SquadPhaseRecord; note: string }) => Promise<void>
  members?: (code: string) => Pick<SquadMember, 'id' | 'name'>[]
  warn?: (message: string) => void
}

const resuming = new Set<string>()

/**
 * Ao abrir o app: cada registro de fase vira retomada, espera ou descarte. Nunca dois inícios do mesmo
 * squad ao mesmo tempo. Devolve os códigos que foram retomados.
 */
export async function resumeSquads(deps: ResumeDeps): Promise<string[]> {
  const warn = deps.warn ?? ((m: string) => log.warn(m))
  const resumed: string[] = []
  await Promise.all(
    deps.records().map(async (record) => {
      const code = record.code
      if (resuming.has(code)) return
      const decision = decideResume(record, deps.facts(code))
      if (decision.action === 'discard') {
        warn(`Fase guardada do squad ${code} descartada: ${decision.reason}.`)
        deps.discard(code)
        return
      }
      if (decision.action === 'skip') {
        warn(`Squad ${code} não volta sozinho: ${decision.reason}.`)
        return
      }
      resuming.add(code)
      try {
        await deps.start(code, { record, note: resumeNote(record, deps.members?.(code)) })
        resumed.push(code)
      } catch (err) {
        warn(`Não consegui retomar o squad ${code}: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        resuming.delete(code)
      }
    }),
  )
  return resumed
}
