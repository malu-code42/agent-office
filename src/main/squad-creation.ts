import { EventEmitter } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  SQUAD_MAX_MEMBERS,
  SQUAD_MIN_MEMBERS,
  SQUAD_MODELS,
  SQUAD_NAME_MAX,
  SQUAD_ROOM_COUNT,
  type Actor,
  type ProjectFloor,
  type SquadInfo,
  type SquadProposal,
  type SquadProposalComposition,
  type SquadProposalMember,
  type SquadQueue,
  type Ticket,
} from '@shared/types'
import { squadInRoom } from '@shared/squad-rooms'
import { pendingTickets, orderedTickets } from '@shared/squad-tickets'
import { findSquad, inspectSquads, squadInfo, validateSquad } from './squads'
import { SquadProposalStore } from './squad-proposals'
import { SquadQueueStore } from './squad-queues'
import type { CompositionContext, CompositionRequest } from './squad-composition'
import { cleanStaleReservations, removeSquad, squadCodeFor, squadFilePlan, writeSquad } from './squad-writer'
import type { TicketBoard } from './tickets'
import type { Settings } from '@shared/types'
import { log } from './log'

/** The generator of a composition. The Office asks the approved model; tests give their own. */
export type CompositionGenerator = (req: CompositionRequest, signal: AbortSignal) => Promise<SquadProposalMember[]>

export interface SquadCreationDeps {
  /** The proposals the player has not approved yet. */
  proposals: SquadProposalStore
  /** The queue of each squad. */
  queues: SquadQueueStore
  /** The board the tickets live in. */
  board: TicketBoard
  /** The floors of the office. */
  projects: () => ProjectFloor[]
  /** The settings of the office (the accounts and the models). */
  settings: () => Settings
  /** Who the player is, for the history of the board. */
  player: () => Actor
  /** Generates the composition of a squad. */
  generate?: CompositionGenerator
  /** The clock, for the tests. */
  now?: () => number
}

/**
 * The creation of a squad in an empty room of a project floor: the proposal (nothing is
 * written before the approval), the approval (the squad folder and the tickets) and the
 * queue of each squad. Everything here happens in the main process: the page sends the
 * id of a proposal and the room it means, never a path.
 */
export class SquadCreation extends EventEmitter {
  private running = new Map<string, AbortController>()
  private discarded = new Set<string>()
  private proposalLocks = new Set<string>()
  private approvalLocks = new Set<string>()

  constructor(private deps: SquadCreationDeps) {
    super()
    this.prune()
    this.recover()
  }

  /**
   * The proposals that cannot exist any more: the ones whose generation was cut in the
   * middle (the app closed) and the ones of an andar that is gone.
   */
  private prune(): void {
    for (const proposal of this.deps.proposals.list()) {
      if (proposal.status === 'generating' || !this.deps.projects().some((p) => p.id === proposal.projectId))
        this.deps.proposals.remove(proposal.id)
    }
  }

  /**
   * The creations that were interrupted (the app was closed while a squad was being
   * written) leave a folder with only the marker of the office inside. Those folders
   * are taken back here: nothing of the player is in them. A folder with anything
   * else inside stays where it is, and the office reports it as unavailable.
   */
  private recover(): void {
    for (const project of this.deps.projects()) {
      try {
        cleanStaleReservations(project.cwd)
      } catch {
        // A folder that cannot be read is not ours to fix: the office goes on.
      }
    }
    for (const proposal of this.deps.proposals.list()) {
      if (proposal.status !== 'created' || !proposal.code) continue
      try {
        const squad = findSquad(proposal.cwd, proposal.code)
        if (!squad) {
          proposal.status = 'pending'
          delete proposal.code
          proposal.updatedAt = this.now()
          this.deps.proposals.put(proposal)
          continue
        }
        if (readFileSync(join(proposal.cwd, 'squads', proposal.code, '.agent-office-proposal'), 'utf8').trim() !== proposal.id)
          throw new Error('A pasta do squad não contém o marcador desta transação; pasta preservada.')
        validateSquad(squad)
        const project = this.deps.projects().find((p) => p.id === proposal.projectId && p.cwd === proposal.cwd)
        if (!project) throw new Error('O projeto da proposta não corresponde ao andar atual.')
        const savedQueue = this.deps.queues.get(proposal.code)
        const recoveryIds = savedQueue
          ? [savedQueue.active, ...savedQueue.queue].filter((id): id is string => !!id)
          : this.orderTicketIds(project, proposal.ticketIds)
        if (recoveryIds.some((id) => !proposal.ticketIds.includes(id)))
          throw new Error('A fila referencia tickets fora da proposta; dados preservados.')
        const picked = recoveryIds.map((id) => this.deps.board.get(id)).filter((t): t is Ticket => !!t)
        const actor = { kind: 'agent' as const, name: proposal.name, id: `squad:${proposal.code}` }
        for (const t of picked) {
          if (t.closedAt || (t.assignee && t.assignee.id !== actor.id) || (!t.assignee && !['backlog', 'todo'].includes(t.status)))
            throw new Error(`Conflito no ticket ${t.key}; dados preservados sem alteração.`)
        }
        // The queue is persisted before assigning tickets. This state plus the proposal
        // is the recovery journal; repeating either write is idempotent.
        const expectedQueue = {
          code: proposal.code,
          cwd: proposal.cwd,
          active: picked[0]?.id ?? null,
          queue: picked.slice(1).map((t) => t.id),
          updatedAt: this.now(),
        }
        const existingQueue = this.deps.queues.get(proposal.code)
        if (existingQueue) {
          if (
            existingQueue.cwd !== expectedQueue.cwd ||
            existingQueue.active !== expectedQueue.active ||
            existingQueue.queue.length !== expectedQueue.queue.length ||
            existingQueue.queue.some((id, i) => id !== expectedQueue.queue[i])
          )
            throw new Error('A fila existente não pertence a esta transação; dados preservados.')
        } else this.deps.queues.set(expectedQueue)
        for (const t of picked) if (!t.assignee) this.deps.board.assign(t.id, actor, this.deps.player())
        if (picked[0] && picked[0].status !== 'doing') this.deps.board.move(picked[0].id, 'doing', undefined, this.deps.player())
        this.deps.board.flush()
        proposal.status = 'assigned'
        proposal.updatedAt = this.now()
        this.deps.proposals.put(proposal)
      } catch (err) {
        log.warn(`Aprovação de squad ${proposal.id} requer reparo: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    // Queue persistence is the PR-release journal. Repair board writes if the app died
    // after saving the verified PR URL but before the ticket/history flush completed.
    let repairedBoard = false
    for (const queue of this.deps.queues.all()) {
      const actor = { kind: 'agent' as const, name: `Squad ${queue.code}`, id: `squad:${queue.code}` }
      for (const pr of queue.pendingPRs ?? []) {
        const ticket = this.deps.board.get(pr.ticketId)
        if (!ticket) continue
        const line = `PR para revisão humana: ${pr.url}`
        if (!ticket.comments.some((comment) => comment.text === line)) {
          this.deps.board.comment(ticket.id, line, actor)
          repairedBoard = true
        }
        if (ticket.status === 'doing') {
          this.deps.board.move(ticket.id, 'review', undefined, actor)
          repairedBoard = true
        }
      }
      if (queue.active) {
        const active = this.deps.board.get(queue.active)
        if (active && (active.status === 'backlog' || active.status === 'todo')) {
          this.deps.board.move(active.id, 'doing', undefined, actor)
          repairedBoard = true
        }
      }
    }
    if (repairedBoard) this.deps.board.flush()
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  /** The proposals waiting for an approval. */
  list(): SquadProposal[] {
    return this.deps.proposals.list()
  }

  get(id: string): SquadProposal | undefined {
    return this.deps.proposals.get(id)
  }

  /** The queue of a squad; undefined when it has none. */
  queue(code: string) {
    return this.deps.queues.get(code)
  }

  setCycle(code: string, cycle: SquadQueue['cycle']): void {
    this.deps.queues.setCycle(code, cycle)
    this.changed()
  }

  setPublicationError(code: string, message: string, resultId?: string): void {
    const cycle = this.deps.queues.get(code)?.cycle
    if (!cycle) return
    this.deps.queues.setCycle(code, { ...cycle, ...(resultId ? { resultId } : {}), publicationError: message.slice(0, 2000) })
    this.changed()
  }

  clearPublicationError(code: string): void {
    const cycle = this.deps.queues.get(code)?.cycle
    if (!cycle?.publicationError) return
    const { publicationError: _publicationError, ...next } = cycle
    this.deps.queues.setCycle(code, next)
    this.changed()
  }

  setStartupError(code: string, ticketId: string, message: string): void {
    const queue = this.deps.queues.get(code)
    if (!queue || queue.active !== ticketId) return
    if (!queue.cycle || queue.cycle.ticketId !== ticketId) return
    this.deps.queues.setCycle(code, { ...queue.cycle, startupError: message.slice(0, 2000) })
    this.changed()
  }

  clearStartupError(code: string, ticketId: string): void {
    const cycle = this.deps.queues.get(code)?.cycle
    if (!cycle || cycle.ticketId !== ticketId || !cycle.startupError) return
    const { startupError: _startupError, ...next } = cycle
    this.deps.queues.setCycle(code, next)
    this.changed()
  }

  /**
   * Records a PR only after the caller verified its URL. The active ticket is retained
   * until this single atomic queue write; failures before this point are safe to retry.
   */
  releaseTicketForReview(code: string, pr: NonNullable<SquadQueue['pendingPRs']>[number]): SquadQueue {
    const queue = this.deps.queues.get(code)
    if (!queue) throw new Error(`A fila do squad ${code} não existe.`)
    const existing = queue.pendingPRs?.find((item) => item.ticketId === pr.ticketId || item.branch === pr.branch)
    if (existing) {
      if (existing.url !== pr.url) throw new Error('Este ticket já está associado a outro PR; estado preservado.')
    } else {
      if (queue.active !== pr.ticketId) throw new Error('O ticket do PR não é o ticket ativo do squad; fila preservada.')
      const nextId = queue.queue[0] ?? null
      const next = {
        ...queue,
        active: nextId,
        queue: queue.queue.slice(1),
        pendingPRs: [...(queue.pendingPRs ?? []), pr],
        updatedAt: pr.createdAt,
      }
      delete next.cycle
      // One atomic persisted state is the crash-recovery boundary: it cannot both skip a
      // ticket and lose the review URL, or record the same release twice.
      this.deps.queues.set(next)
    }
    const actor = { kind: 'agent' as const, name: `Squad ${code}`, id: `squad:${code}` }
    const ticket = this.deps.board.get(pr.ticketId)
    if (ticket) {
      if (!ticket.comments.some((comment) => comment.text === `PR para revisão humana: ${pr.url}`))
        this.deps.board.comment(ticket.id, `PR para revisão humana: ${pr.url}`, actor)
      if (ticket.status === 'doing') this.deps.board.move(ticket.id, 'review', undefined, actor)
    }
    if (!existing && queue.queue[0]) {
      const following = this.deps.board.get(queue.queue[0])
      if (following && (following.status === 'backlog' || following.status === 'todo'))
        this.deps.board.move(following.id, 'doing', undefined, actor)
    }
    this.deps.board.flush()
    this.changed()
    return this.deps.queues.get(code)!
  }

  /** The queue of every squad. */
  queues(): SquadQueue[] {
    return this.deps.queues.all()
  }

  /** What the office knows about models and accounts: the answer is checked against it. */
  private context(): CompositionContext {
    const settings = this.deps.settings()
    return { models: SQUAD_MODELS, accounts: settings.accounts.map((a) => a.name) }
  }

  /** The pending tickets of a floor, in the order of the board. */
  pending(project: ProjectFloor): Ticket[] {
    return pendingTickets(this.deps.board.list(), this.deps.projects(), project.id)
  }

  /**
   * The proposal of a room: it asks the model for a composition and keeps it until the
   * player approves. Nothing is written in the project folder.
   */
  async propose(input: { id: string; projectId: string; room: number; brief: string; ticketIds: string[] }): Promise<SquadProposal> {
    const project = this.deps.projects().find((p) => p.id === input.projectId)
    if (!project) throw new Error('Esse andar não existe mais.')
    if (input.room < 0 || input.room >= SQUAD_ROOM_COUNT) throw new Error('Essa sala não existe neste andar.')
    if (this.deps.proposals.get(input.id)) throw new Error('Essa proposta já existe.')
    const squads = inspectSquads(project.cwd)
    if (squadInRoom(squads, input.room)) throw new Error('Esta sala já tem um squad.')
    if (this.deps.proposals.forRoom(project.id, input.room)) throw new Error('Esta sala já tem uma proposta em aberto.')
    const brief = input.brief.trim()
    if (!brief) throw new Error('Escreva o brief da equipe.')
    const now = this.now()
    const proposal: SquadProposal = {
      id: input.id,
      projectId: project.id,
      cwd: project.cwd,
      room: input.room,
      createdAt: now,
      updatedAt: now,
      brief,
      ticketIds: this.orderTicketIds(project, input.ticketIds),
      adjustments: [],
      name: this.suggestedName(input.room),
      composition: null,
      status: 'generating',
    }
    this.deps.proposals.put(proposal)
    const controller = new AbortController()
    this.running.set(proposal.id, controller)
    try {
      const members = await this.generate(proposal, controller.signal)
      if (controller.signal.aborted || this.discarded.has(proposal.id) || this.deps.proposals.get(proposal.id) !== proposal)
        throw new Error('A proposta foi descartada.')
      proposal.composition = { name: proposal.name, members }
      proposal.status = 'pending'
      proposal.updatedAt = this.now()
      this.deps.proposals.put(proposal)
      this.changed()
      return proposal
    } catch (err) {
      // Nothing was created: the proposal leaves no trace.
      this.deps.proposals.remove(proposal.id)
      this.changed()
      throw err
    } finally {
      if (this.running.get(proposal.id) === controller) this.running.delete(proposal.id)
      this.discarded.delete(proposal.id)
    }
  }

  /** The player asked for changes: the model proposes again, with the same brief and tickets. */
  async adjust(id: string, adjustment: string, name?: string): Promise<SquadProposal> {
    const proposal = this.deps.proposals.get(id)
    if (!proposal) throw new Error('Essa proposta não existe mais.')
    if (this.proposalLocks.has(id)) throw new Error('Esta proposta já está em processamento.')
    if (proposal.status !== 'pending') throw new Error('Esta proposta não está pendente para ajuste.')
    if (!proposal.composition) throw new Error('A proposta ainda não tem uma composição.')
    const text = adjustment.trim()
    if (!text) throw new Error('Escreva o que mudar.')
    this.proposalLocks.add(id)
    // The name the player edited goes into the proposal before the new composition:
    // an adjustment never loses it (HANDOFF §3.4.2).
    if (name !== undefined) this.applyName(proposal, name)
    proposal.adjustments = [...proposal.adjustments, text]
    proposal.status = 'generating'
    proposal.updatedAt = this.now()
    this.deps.proposals.put(proposal)
    // A sala continua âmbar durante o ajuste: a proposta já tem a composição.
    this.changed()
    const controller = new AbortController()
    this.running.set(proposal.id, controller)
    try {
      const members = await this.generate(proposal, controller.signal)
      if (controller.signal.aborted || this.discarded.has(proposal.id) || this.deps.proposals.get(proposal.id) !== proposal)
        throw new Error('A proposta foi descartada.')
      // The name the player edited stays: only the team changes.
      proposal.composition = { name: proposal.name, members }
      proposal.status = 'pending'
      proposal.updatedAt = this.now()
      this.deps.proposals.put(proposal)
      this.changed()
      return proposal
    } catch (err) {
      // A proposta descartada no meio não volta: ela some com o ajuste.
      if (!controller.signal.aborted && !this.discarded.has(proposal.id) && this.deps.proposals.get(proposal.id) === proposal) {
        proposal.status = 'pending'
        proposal.updatedAt = this.now()
        this.deps.proposals.put(proposal)
        this.changed()
      }
      throw err
    } finally {
      if (this.running.get(proposal.id) === controller) this.running.delete(proposal.id)
      this.discarded.delete(proposal.id)
      this.proposalLocks.delete(id)
    }
  }

  /**
   * The name the player edited: it stays in the proposal, so it survives the
   * adjustments, the closing of the window and a new reading of the app.
   */
  rename(id: string, name: string): SquadProposal {
    const proposal = this.deps.proposals.get(id)
    if (!proposal) throw new Error('Essa proposta não existe mais.')
    // Depois que o squad foi criado, o nome é o do squad: a proposta não muda mais.
    if (proposal.status === 'assigned' || proposal.status === 'created') throw new Error('Esse squad já foi criado: o nome não muda mais.')
    this.applyName(proposal, name)
    proposal.updatedAt = this.now()
    this.deps.proposals.put(proposal)
    this.changed()
    return proposal
  }

  /** The name of the squad, as the player typed it: it may not be empty. */
  private applyName(proposal: SquadProposal, name: string): void {
    const finalName = name.trim()
    if (!finalName) throw new Error('Dê um nome ao squad.')
    if (finalName.length > SQUAD_NAME_MAX) throw new Error(`O nome do squad tem no máximo ${SQUAD_NAME_MAX} letras.`)
    proposal.name = finalName
    // The composition carries the same name: it is what the player reads.
    if (proposal.composition) proposal.composition = { ...proposal.composition, name: finalName }
  }

  /** The player gave up: the proposal leaves nothing behind. */
  discard(id: string): void {
    const proposal = this.deps.proposals.get(id)
    if (!proposal) return
    if (this.approvalLocks.has(id) || proposal.status === 'created' || proposal.status === 'assigned')
      throw new Error('Esta proposta está em aprovação ou aguardando recuperação; o journal foi preservado.')
    this.discarded.add(proposal.id)
    this.running.get(proposal.id)?.abort()
    this.deps.proposals.remove(id)
    this.changed()
  }

  /**
   * The approval: the squad is written in the project folder and the tickets the player
   * chose are given to it. Everything is checked before anything is written, and a
   * failure leaves the project as it was.
   */
  async approve(id: string, name: string): Promise<{ squad: SquadInfo; queue: SquadQueue | undefined }> {
    if (this.proposalLocks.has(id)) throw new Error('Esta proposta já está em processamento.')
    this.proposalLocks.add(id)
    this.approvalLocks.add(id)
    try {
      return await this.approveLocked(id, name)
    } finally {
      this.proposalLocks.delete(id)
      this.approvalLocks.delete(id)
    }
  }

  private async approveLocked(id: string, name: string): Promise<{ squad: SquadInfo; queue: SquadQueue | undefined }> {
    const proposal = this.deps.proposals.get(id)
    if (!proposal) throw new Error('Essa proposta não existe mais.')
    if (proposal.status === 'pending') {
      // Pending is the only state in which a fresh approval may begin.
    } else if (proposal.status === 'created' && proposal.code) {
      // A durable created journal is intentionally resumable after a crash.
    } else if (proposal.status === 'assigned' && proposal.code) {
      const done = findSquad(proposal.cwd, proposal.code)
      if (done) return { squad: squadInfo(done), queue: this.deps.queues.get(proposal.code) }
      throw new Error('A proposta atribuída não pôde ser reconciliada.')
    } else {
      throw new Error('Esta proposta não está em estado aprovável.')
    }
    if (!proposal.composition) throw new Error('A proposta ainda não tem uma composição.')
    const finalName = name.trim()
    if (!finalName) throw new Error('Dê um nome ao squad.')
    const project = this.deps.projects().find((p) => p.id === proposal.projectId)
    if (!project) throw new Error('Esse andar não existe mais.')
    if (proposal.status === 'created' && proposal.cwd !== project.cwd)
      throw new Error('O journal de criação aponta para outro caminho; a recuperação foi preservada.')
    let composition = proposal.composition
    this.checkComposition(composition)
    // The room must still be empty: a squad may have taken it in the meantime.
    const roomSquad = squadInRoom(inspectSquads(project.cwd), proposal.room)
    if (roomSquad && roomSquad.code !== proposal.code) throw new Error('Esta sala já tem um squad.')

    // The tickets are checked before anything is written: the first in the order of the
    // board works, the others wait in the queue.
    const code = proposal.code ?? squadCodeFor(proposal.room, (c) => existsSync(join(project.cwd, 'squads', c)))
    const picked = this.orderTicketIds(project, proposal.ticketIds)
      .map((tid) => this.deps.board.get(tid))
      .filter((t): t is Ticket => !!t)
    for (const t of picked) {
      // A ticket que já é deste squad (uma aprovação repetida) continua valendo.
      const mine = t.assignee?.id === `squad:${code}`
      if (t.closedAt) throw new Error(`O ticket ${t.key} foi fechado. Escolha outro.`)
      if (!mine && t.status !== 'backlog' && t.status !== 'todo')
        throw new Error(`O ticket ${t.key} não está mais pendente. Escolha outro.`)
      if (t.assignee && !mine) throw new Error(`O ticket ${t.key} já tem responsável. Escolha outro.`)
    }

    // The code of the squad: its folder, created once and never overwritten. The room
    // names it, so the squad keeps its place in the floor.
    const folder = join(project.cwd, 'squads', code)
    const existed = existsSync(folder)
    if (!existed) {
      this.assertApprovalCurrent(proposal, composition, 'pending')
      // The proposal is the durable recovery journal: persist ownership and approved
      // inputs before touching the project folder, so restart can relink the result.
      proposal.code = code
      proposal.name = finalName
      proposal.composition = { ...composition, name: finalName }
      composition = proposal.composition
      proposal.status = 'created'
      proposal.updatedAt = this.now()
      this.deps.proposals.put(proposal)
      const plan = squadFilePlan(composition, finalName, proposal.brief)
      plan.code = code
      plan.proposalId = proposal.id
      try {
        writeSquad(project.cwd, plan)
      } catch (err) {
        proposal.status = 'pending'
        delete proposal.code
        proposal.updatedAt = this.now()
        this.deps.proposals.put(proposal)
        throw err
      }
    }
    // The squad is read again and checked before anybody sees it: a squad that does not
    // pass here is not a squad.
    const squad = findSquad(project.cwd, code)
    if (!squad) {
      if (!existed) removeSquad(project.cwd, code)
      throw new Error(
        existed
          ? `A pasta ${folder} já existia e não é um squad. Nada foi sobrescrito: apague essa pasta ou escolha outra sala.`
          : 'A pasta do squad não pôde ser lida depois de criada. Nada foi publicado.',
      )
    }
    try {
      validateSquad(squad)
    } catch (err) {
      if (!existed) removeSquad(project.cwd, code)
      throw new Error(`O squad criado não passou na validação: ${err instanceof Error ? err.message : String(err)}. Nada foi publicado.`, {
        cause: err,
      })
    }

    const actor = { kind: 'agent' as const, name: finalName, id: `squad:${code}` }
    try {
      this.assertApprovalCurrent(proposal, composition, 'created')
      const queue = {
        code,
        cwd: project.cwd,
        active: picked[0]?.id ?? null,
        queue: picked.slice(1).map((t) => t.id),
        updatedAt: this.now(),
      }
      // Persist queue before ownership changes; recovery uses the same active/waiting
      // split and never advances it automatically.
      const existingQueue = this.deps.queues.get(code)
      if (
        existingQueue &&
        (existingQueue.cwd !== queue.cwd ||
          existingQueue.active !== queue.active ||
          existingQueue.queue.join('\0') !== queue.queue.join('\0'))
      )
        throw new Error('A fila existente não pertence a esta aprovação; dados preservados.')
      this.deps.queues.set(queue)
      for (const t of picked) this.deps.board.assign(t.id, actor, this.deps.player())
      if (picked[0]) this.deps.board.move(picked[0].id, 'doing', undefined, this.deps.player())
      this.deps.board.flush()
    } catch (err) {
      throw new Error(
        `A aprovação ficou registrada para recuperação segura: ${err instanceof Error ? err.message : String(err)}. Reinicie o app para reconciliar.`,
        { cause: err },
      )
    }
    proposal.name = finalName
    proposal.status = 'assigned'
    proposal.updatedAt = this.now()
    this.deps.proposals.put(proposal)
    this.changed()
    return { squad: squadInfo(squad), queue: this.deps.queues.get(code) }
  }

  private assertApprovalCurrent(proposal: SquadProposal, composition: SquadProposalComposition, status: 'pending' | 'created'): void {
    const current = this.deps.proposals.get(proposal.id)
    if (current !== proposal || current.status !== status || current.composition !== composition)
      throw new Error('A proposta mudou durante a aprovação; nenhuma atribuição foi feita.')
  }

  /** The composition has to fit the room: two to six members, with the two roles the pipeline needs. */
  private checkComposition(composition: SquadProposalComposition): void {
    const members = composition.members
    if (members.length < SQUAD_MIN_MEMBERS || members.length > SQUAD_MAX_MEMBERS)
      throw new Error(`A sala comporta de ${SQUAD_MIN_MEMBERS} a ${SQUAD_MAX_MEMBERS} membros.`)
    if (members.filter((m) => m.role === 'implementer').length !== 1) throw new Error('A composição precisa de um implementador.')
    if (members.filter((m) => m.role === 'reviewer').length !== 1) throw new Error('A composição precisa de um revisor independente.')
  }

  /** The name the room suggests: "Squad da Sala N". */
  private suggestedName(room: number): string {
    return `Squad da Sala ${room + 1}`
  }

  /** The tickets the player chose, in the order of the board (and only the pending ones). */
  private orderTicketIds(project: ProjectFloor, ids: string[]): string[] {
    return orderedTickets(this.deps.board.list(), this.deps.projects(), project.id, ids).map((t) => t.id)
  }

  /** Model-backed composition is paused until its Claude-only workflow lands. */
  private async generate(proposal: SquadProposal, signal: AbortSignal): Promise<SquadProposalMember[]> {
    if (this.deps.generate) return this.deps.generate(this.request(proposal), signal)
    throw new Error('A composição automática de squads está pausada durante a aposentadoria do OpenCode; monte ou revise a equipe manualmente.')
  }

  /** What the generator needs to know. */
  private request(proposal: SquadProposal): CompositionRequest {
    const tickets = proposal.ticketIds
      .map((id) => this.deps.board.get(id))
      .filter((t): t is Ticket => !!t)
      .map((t) => ({ key: t.key, title: t.title }))
    return {
      cwd: proposal.cwd,
      brief: proposal.brief,
      tickets,
      adjustments: proposal.adjustments,
      ctx: this.context(),
    }
  }

  private changed(): void {
    this.emit('proposals', this.list())
    this.emit('queues', this.queues())
  }
}
