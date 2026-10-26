// What crosses the IPC bridge: the full state, the events and window.office.

import type { AccountStatus, PlanUsage } from './accounts'
import type { AgentBrain, AgentSummary, AgentTemplate, HireRequest, OfficePermissionMode, ResultChanges, SessionEntry } from './agents'
import type { AgentResult, AttachmentInput, LogEntry, PermissionDecision, PermissionRequest } from './conversation'
import type { Ledger, LedgerQuery, LedgerToday } from './ledger'
import type { BridgeStatus, Settings, UpdateInstallResult, UpdateStatus } from './settings'
import type { SquadInfo } from './squads'
import type { SquadProposal, SquadQueue } from './squad-proposals'
import type { MacJob, Routine, RoutineDraft } from './routines'
import type { ClaudeStats } from './stats'
import type { AgendaView } from '../agenda'
import type { RoutineCandidate } from '../routine-personal'
import type { FocusItem } from '../planning'
import type { MediaCreateInput, MediaItemOf, MediaKind, MediaPosterResult, MediaUpdateInput } from '../media'
import type { BarTimerView } from '../barTimer'
import type { IrisResult } from '../iris'
import type { ProfileId } from '../profiles'
import type { Proposal } from '../proposals'
import type { ReviewChoices, ReviewPostpone, ReviewView } from '../review'
import type { Goal, GoalDraft } from '../goals'
import type { NewTaskDraft, ParsedBoard, Task, TaskDiscard, TaskMove, TaskRef, TaskReopen, TaskReschedule } from '../tasks'
import type { PersonalRoutineCreateInput, PersonalRoutineOverview } from '../routine-personal'
import type { DelegateTarget, Ticket, TicketDraft, TicketPatch, TicketStatus } from './tickets'
import type { WritingVersion } from '../writing'
import type { DecodedStudyBank, StudyQuestion } from '../study-questions'
import type { StudyCycleState } from '../study-cycle'
import type { StudyLibrarySearch } from '../study-library'
import type { StudyCardDraft, StudyCardSummary, StudyCardsRead, StudyNotesRead } from '../study-cards'
import type { TelegramAudioErrorNotice, TelegramExpiredNotice, TelegramMessageNotice, TelegramStatus } from '../telegram'

export interface StudyQuestionCandidates {
  token: string
  status: 'found' | 'insufficient' | 'noResults' | 'error' | 'incomplete'
  localScanComplete: boolean
  local: StudyQuestion[]
  sourceCandidates: StudyQuestion[]
  web: StudyQuestion[]
  generated: StudyQuestion[]
  canGenerate: boolean
  warning?: string
}
export interface StudyQuestionGeneration {
  token: string
  status: 'found' | 'noResults' | 'error'
  generated: StudyQuestion[]
  canGenerate: boolean
  warning?: string
}

export interface WritingSnippetView {
  id: string
  title: string
  versions: readonly WritingVersion[]
}
export interface WritingPreviewView {
  token: string
  preview: string
}
export interface WritingDraftView {
  draftToken: string
  snippetId: string
  baseVersionId: string
  originalText: string
  suggestedText: string
}

/** CPU (% of the whole machine) and memory (bytes), as in Activity Monitor. */
export interface SystemStats {
  cpu: number
  memUsed: number
  memTotal: number
  /** This app (the office itself). */
  app: { cpu: number; mem: number }
  /**
   * Claude Code processes: office agents and terminal sessions. On Windows the
   * Claude Desktop app (also claude.exe) is left out. cpu is null until two
   * samples exist, or where it cannot be measured.
   */
  claude: { count: number; cpu: number | null; mem: number }
}

/** How "Open in terminal" opened the session (set only when ok). */
export type TerminalVia = 'terminal-app' | 'windows-terminal' | 'console'

export interface OpenTerminalResult {
  ok: boolean
  /** Error for the user (pt-BR) when ok is false. */
  message?: string
  via?: TerminalVia
}

export interface MediaPosterSelection {
  token: string
  previewDataUrl: string
  extension: 'png' | 'jpeg' | 'webp'
  sizeBytes: number
}

export interface OfficeState {
  agents: AgentSummary[]
  permissions: PermissionRequest[]
  results: AgentResult[]
  tickets: Ticket[]
  bridge: BridgeStatus
  settings: Settings
  platform: string
  /** One per account, in Settings.accounts order. */
  usage: PlanUsage[]
  accounts: AccountStatus[]
  system: SystemStats | null
  /** Squads of every project floor; each one's cwd is its project folder. */
  squads: SquadInfo[]
  /** Squads the player proposed for an empty room and has not approved yet. */
  squadProposals: SquadProposal[]
  /** The queue of every squad: the ticket it works on and the ones waiting. */
  squadQueues: SquadQueue[]
  /** Today's spend per folder, from the cost book. */
  ledgerToday: LedgerToday
  /** Data files found corrupt at startup (restored from a backup, or started over). */
  dataNotices: DataNotice[]
  /** The Mac (or PC) runs on battery now; the scene may switch to Economia. */
  onBattery: boolean
  /** Scheduled tasks, shown on the ground floor totem. */
  routines: Routine[]
  /** Jobs the Mac schedules itself (launchd), shown beside the routines. Empty off macOS. */
  macJobs: MacJob[]
  /** Proposals waiting for a confirmation (AO-10): they show in the caixa de entrada. */
  proposals: Proposal[]
  /** A review of today was started and not confirmed: it shows in the caixa de entrada to resume (AO-12). */
  reviewDraft: boolean
  /** How many tasks are in the focus ("Tarefas em foco"): the dock shows this count. */
  focusCount: number
  /** The Timer of the bar as it reads now, or null when it is stopped; the dock shows it. */
  barTimer?: BarTimerView | null
  /** AGENT_OFFICE_TOUR=1: the guided tour opens even if the player has seen it. */
  forceTour?: boolean
}

/** A data file that did not parse: what happened, for the warning in the renderer. */
export interface DataNotice {
  id: string
  at: number
  /** office.json, tickets.json or tickets-closed.json */
  file: string
  /** restored = a backup loaded; lost = no good copy, started over. */
  kind: 'restored' | 'lost'
  text: string
  /** Where the corrupt file was kept. */
  path: string
}

/** AO-43: the memory of one profile — a short summary written by the person, with the time it was saved. */
export interface ProfileMemoryEntry {
  /** What Luna may read: what the person wrote, already trimmed, never raw prompts or credentials. */
  text: string
  updatedAt: number
}

/** A copy of the data in userData/backups/. */
export interface BackupEntry {
  /** Folder name: AAAA-MM-DD (daily) or antes-<timestamp> (before a restore or import). */
  id: string
  kind: 'daily' | 'snapshot'
  at: number
  /** Bytes, all files together. */
  size: number
  files: string[]
}

export type OfficeEvent =
  | { type: 'agent:upsert'; agent: AgentSummary }
  | { type: 'agent:removed'; agentId: string }
  | { type: 'agent:log'; agentId: string; entry: LogEntry }
  /** New log entries of the agent's subagents, grouped: one event per agent every ~250 ms at most. */
  | { type: 'agent:sublog'; agentId: string; logs: { subId: string; entries: LogEntry[] }[] }
  | { type: 'permission:new'; request: PermissionRequest }
  | { type: 'permission:resolved'; requestId: string; agentId: string }
  | { type: 'result:new'; result: AgentResult }
  | { type: 'result:acked'; resultId: string; agentId: string }
  /** The changed files of a result were worked out, or changed (committed, discarded). */
  | { type: 'result:changes'; resultId: string; agentId: string; changes: ResultChanges }
  | { type: 'bridge:status'; status: BridgeStatus }
  | { type: 'settings'; settings: Settings }
  | { type: 'usage'; usage: PlanUsage[] }
  | { type: 'accounts'; accounts: AccountStatus[] }
  | { type: 'system'; system: SystemStats }
  /** One session messaged another; toId is null when the recipient is not in the office. */
  | { type: 'agent:chat'; fromId: string; toId: string | null; text: string }
  | { type: 'ticket:upsert'; ticket: Ticket }
  | { type: 'ticket:removed'; ticketId: string }
  | { type: 'squads'; squads: SquadInfo[] }
  /** The squads proposed for the empty rooms changed: the whole list. */
  | { type: 'squadProposals'; proposals: SquadProposal[] }
  /** The queue of the squads changed: the whole list. */
  | { type: 'squadQueues'; queues: SquadQueue[] }
  /** A squad member (subagent) finished; failures carry what went wrong. */
  | { type: 'member:ended'; agentId: string; taskId: string; member: string; status: 'completed' | 'failed' | 'stopped'; summary?: string }
  /** The cost book changed, or a new local day began (then costByCwd starts empty). */
  | { type: 'ledger:today'; today: LedgerToday }
  /** Claude Code statistics were read again from disk. */
  | { type: 'stats'; stats: ClaudeStats }
  /** The player clicked a system notification: open the card of that request or result now. */
  | { type: 'notice:open'; agentId: string; itemId: string }
  /** A data file was found corrupt after startup (the closed tickets load on first use). */
  | { type: 'data:notice'; notice: DataNotice }
  | { type: 'update'; update: UpdateStatus }
  /** The charger was plugged in or pulled out. */
  | { type: 'power'; onBattery: boolean }
  /** A routine changed, ran or finished: the whole list. */
  | { type: 'routines'; routines: Routine[] }
  /** The Mac's own scheduled jobs changed (read every minute). */
  | { type: 'macJobs'; jobs: MacJob[] }
  /** The pending proposals changed: the whole list. */
  | { type: 'proposals'; proposals: Proposal[] }
  /** The review of today was saved or cleared: whether a draft to resume exists. */
  | { type: 'review:draft'; draft: boolean }
  /** The focus changed size: how many tasks are in it now (the dock counts them). */
  | { type: 'focus:count'; count: number }
  /** The Timer of the bar changed (AO-64): the whole session as it reads, or null for a stopped Timer. */
  | { type: 'barTimer'; timer: BarTimerView | null }
  | ({ type: 'telegram:message' } & TelegramMessageNotice)
  | ({ type: 'telegram:expired' } & TelegramExpiredNotice)
  | ({ type: 'telegram:audio-error' } & TelegramAudioErrorNotice)
  | { type: 'luna:profile-task'; profile: ProfileId; task: string }
  | { type: 'luna:media-draft'; draft: Extract<IrisResult, { kind: 'media-draft' }>['draft'] }
  | { type: 'luna:transcript'; text: string }

/** A reopen either put the task back (`list` is where it went) or waits for the user to choose one of `lists`. */
export type ReopenResult = { status: 'done'; list: string; board: ParsedBoard; focus: FocusItem[] } | { status: 'choose'; lists: string[] }

/** A proposal open for review: its operations, the titles of its tasks now in tarefas.md (by id), and whether agenda.md exists. */
export interface ProposalReview {
  proposal: Proposal
  titles: Record<string, string>
  agendaFound: boolean
}

/** window.onerror / unhandledrejection, as the page reports them to the log. */
export interface RendererError {
  kind: 'error' | 'rejection'
  message: string
  source?: string
  stack?: string
}

export interface OfficeAPI {
  getState(): Promise<OfficeState>
  /** Opens the native poster picker; returns a short-lived in-memory selection, or null when cancelled. */
  pickMediaPoster(): Promise<MediaPosterSelection | null>
  /** Discards an unconfirmed poster selection. */
  discardMediaPoster(token: string): Promise<void>
  /** Saves one locally reviewed media item; a poster is referenced only by its one-shot token. */
  createMediaItem(input: MediaCreateInput, posterToken?: string): Promise<string>
  /** Re-reads one media library, updating the main-process stale-check snapshot. */
  readMedia(kind: MediaKind): Promise<MediaItemOf<MediaKind>[]>
  /** Applies locally reviewed changes to an item, optionally attaching a selected movie poster. */
  updateMediaItem(input: MediaUpdateInput, posterToken?: string): Promise<void>
  /** Returns a validated image data URL by movie ID; never accepts or returns a filesystem path. */
  readMediaPoster(id: string): Promise<MediaPosterResult>
  /** Lê e interpreta listas de tarefas no vault indicado, sem escrever no arquivo. */
  readTasks(): Promise<ParsedBoard>
  /** Lê o banco de questões canônico do vault configurado; não inicia ciclo de estudo. */
  readStudyQuestions(): Promise<DecodedStudyBank>
  /** Busca no banco primeiro; resultados online/IA são apenas candidatas até seleção explícita. */
  searchStudyQuestions(topic: string, limit?: number): Promise<StudyQuestionCandidates>
  /** Gera candidatas IA somente após a pessoa solicitar, com token de uma busca concluída. */
  generateStudyQuestions(token: string): Promise<StudyQuestionGeneration>
  /** Salva somente candidatas escolhidas pela pessoa, se o banco não mudou desde a busca. */
  saveStudyQuestions(token: string, selection: StudyQuestion[], reviewConfirmed: boolean): Promise<void>
  /** Lê/resume o ciclo local de diagnóstico, sem alterar vault, tarefas ou agentes. */
  readStudyCycle(): Promise<StudyCycleState>
  /** Inicia outro tópico preservando ciclos anteriores; IDs devem pertencer ao banco local atual. */
  startStudyCycle(topic: string, questionIds: string[]): Promise<StudyCycleState>
  /** Salva resposta, incerteza e eventual trecho local que a pessoa escolheu como evidência. */
  answerStudyCycle(questionId: string, response: string, uncertain: boolean, providedExcerpt?: string): Promise<StudyCycleState>
  /** Registra a causa e o próximo passo de um erro ou dúvida já avaliado. */
  reviewStudyGap(questionId: string, cause: string, nextStep: string): Promise<StudyCycleState>
  /** Solicita explicitamente uma avaliação isolada de uma questão pelo Tutor. */
  evaluateStudyAnswer(questionId: string): Promise<StudyCycleState>
  /** Pede a Bonnie para aplicar o gate objetivo do diagnóstico. */
  advanceStudyCycle(): Promise<StudyCycleState>
  /** Desativa a seleção do ciclo, mantendo tópico e evidências no histórico local. */
  resetStudyCycle(): Promise<StudyCycleState>
  /** Busca trechos apenas nos arquivos locais de estudo; nenhum conteúdo é enviado a modelos. */
  searchStudyLibrary(query: string): Promise<StudyLibrarySearch>
  /** Vincula ao ciclo uma fonte pertencente a uma busca local anterior. */
  attachStudySource(questionId: string, token: string, hitId: string): Promise<StudyCycleState>
  /** Salva uma nota autoral no Obsidian e a vincula à lacuna e à fonte consultada. */
  saveStudyCycleNote(questionId: string, token: string, hitId: string, text: string): Promise<StudyCycleState>
  /** Registra a resposta da estudante em uma questão da rodada de prática atual. */
  answerStudyPractice(questionId: string, response: string): Promise<StudyCycleState>
  /** Solicita ao Tutor uma verificação explícita da resposta de prática. */
  evaluateStudyPractice(questionId: string): Promise<StudyCycleState>
  /** Planeja questões novas de prática, ligando cada uma a uma lacuna identificada. */
  startStudyPractice(questions: { id: string; gapQuestionIds: string[] }[]): Promise<StudyCycleState>
  /** Planeja ao menos dez questões novas de reteste com gabaritos conferidos. */
  startStudyRetest(questionIds: string[]): Promise<StudyCycleState>
  /** Salva somente a resposta, sem mostrar gabarito nem avaliação durante o reteste. */
  answerStudyRetest(questionId: string, response: string): Promise<StudyCycleState>
  /** Confere o reteste completo somente após todas as respostas serem salvas. */
  verifyStudyRetest(): Promise<StudyCycleState>
  /** Conclui o ciclo somente com aprovação explícita após o gate de 80%. */
  completeStudyRetest(): Promise<StudyCycleState>
  /** Lê as notas de estudo editáveis e seus hashes de versão, sem enviar conteúdo a modelos. */
  readStudyNotes(): Promise<StudyNotesRead>
  /** Gera um rascunho somente das notas escolhidas; o main guarda os snapshots sob um token curto. */
  generateStudyCardDraft(noteIds: string[]): Promise<{ token: string; draft: StudyCardDraft } | null>
  /** Salva o rascunho aprovado pela estudante como cartão Markdown no Obsidian. */
  saveStudyCardDraft(token: string, draft: Omit<StudyCardDraft, 'sourceSnapshots'>): Promise<StudyCardSummary | null>
  /** Lista cartões e compara as origens com as versões atuais das notas. */
  listStudyCards(): Promise<StudyCardsRead>
  /** Marca manualmente se a cópia física do cartão foi escrita. */
  setStudyCardPhysicalWritten(id: string, written: boolean): Promise<StudyCardSummary>
  /** Estado sanitisado da conta Telegram vinculada; nunca inclui o bot token. */
  telegramStatus(): Promise<TelegramStatus>
  /** Abre o seletor nativo para importar arquivo JSON de token/user ID e vincular o bot. */
  linkTelegram(): Promise<TelegramStatus | null>
  /** Pede confirmação no processo principal, para o polling e remove a credencial criptografada. */
  unlinkTelegram(): Promise<boolean>
  /** Lê objetivos.md e tarefas.md; os objetivos continuam editáveis no Obsidian. */
  readGoals(): Promise<{ goals: Goal[]; tasks: Task[] }>
  /** Cria um objetivo em objetivos.md, sem alterar tarefas.md. */
  createGoal(draft: Omit<GoalDraft, 'id'>): Promise<string>
  /** Marca/desmarca um marco do objetivo em objetivos.md. */
  setGoalMilestone(id: string, index: number, done: boolean): Promise<void>
  /** Vincula uma tarefa canônica uma única vez; não altera a tarefa. */
  linkGoalTask(id: string, taskId: string): Promise<void>
  /** Pede confirmação no processo principal antes de marcar alcançado; false quando cancelada. */
  achieveGoal(id: string): Promise<boolean>
  /** Abre o seletor nativo, valida tarefas.md e salva o vault escolhido. */
  selectTasksVault(): Promise<{ vaultPath: string; board: ParsedBoard } | null>
  /** Cria uma tarefa no fim da lista escolhida do tarefas.md e devolve o id e o quadro lido de novo. */
  createTask(draft: NewTaskDraft): Promise<{ id: string; board: ParsedBoard }>
  /** Move a tarefa da linha dada para o fim da lista escolhida e devolve o quadro lido de novo. */
  moveTask(move: TaskMove): Promise<{ board: ParsedBoard }>
  /** Põe a tarefa da linha dada na data DD.MM.AAAA (só o campo data muda) e devolve o quadro lido de novo. */
  rescheduleTask(change: TaskReschedule): Promise<{ board: ParsedBoard }>
  /** Conclui a tarefa (pela linha ou pelo id): ela vai para o Archive com a data de hoje e sai do foco. Devolve o id, o quadro e o foco. */
  completeTask(target: TaskRef): Promise<{ id: string; board: ParsedBoard; focus: FocusItem[] }>
  /** Desfaz a conclusão feita há até 10 segundos: a tarefa volta à lista de origem e ao foco. Recusa se o tarefas.md mudou. */
  undoCompleteTask(id: string): Promise<{ board: ParsedBoard; focus: FocusItem[] }>
  /** Descarta a tarefa (pela linha ou pelo id) com motivo obrigatório: ela vai para o Archive com ❌, sem ✅, e sai do foco. */
  discardTask(input: TaskDiscard): Promise<{ id: string; board: ParsedBoard; focus: FocusItem[] }>
  /** Reabre a tarefa concluída ou descartada na lista de origem, sem as marcas. Sem origem, devolve as listas para escolher (status choose). */
  reopenTask(input: TaskReopen): Promise<ReopenResult>
  /** Lê o foco: cada tarefa com título e lista de origem, ou marcada como sumida do tarefas.md. */
  readFocus(): Promise<FocusItem[]>
  /** Abre a revisão de uma proposta pendente: as operações e os títulos das tarefas, lidos agora. Nada é escrito. */
  openProposal(id: string): Promise<ProposalReview>
  /** Aplica todas as operações da proposta ou nenhuma. Se uma falhar, nada é escrito e a mensagem diz qual foi. */
  applyProposal(id: string): Promise<void>
  /** Recusa a proposta: ela sai da lista de pendentes. Nenhum arquivo é alterado. */
  rejectProposal(id: string): Promise<void>
  /** Lê os trechos e históricos locais do escrita.md no vault selecionado; nunca escreve. */
  readWriting(): Promise<{ snippets: WritingSnippetView[] }>
  /** Salva um Original somente após a confirmação explícita da pessoa. */
  createWritingOriginal(input: { title: string; body: string }): Promise<string>
  /** Monta a prévia exata da versão e instrução selecionadas, sem chamar Claude. */
  prepareWritingReview(snippetId: string, versionId: string, instruction: string): Promise<WritingPreviewView>
  /** Envia a prévia confirmada e devolve um rascunho efêmero, sem gravar no vault. */
  sendWritingPreview(token: string): Promise<WritingDraftView>
  /** Cancela uma prévia ou chamada de revisão sem gravar. */
  cancelWritingPreview(token: string): Promise<void>
  /** Anexa uma nova versão somente após a confirmação explícita de salvar. */
  saveWritingDraft(draftToken: string, body: string): Promise<void>
  /** Descarta o rascunho efêmero sem gravar. */
  discardWritingDraft(draftToken: string): Promise<void>
  /** Starts the review offer for today, once per local day: true when it should be shown now. Without a vault, false. */
  reviewGate(): Promise<boolean>
  /** The review of today: the draft to resume (or the first step), the agenda of today and the focus as the files say now. Nothing is written. */
  openReview(): Promise<ReviewView>
  /** Keeps the review as it is (step and choices) in planning.json, so it can be resumed today. Nothing else changes. */
  saveReviewDraft(step: number, choices: ReviewChoices): Promise<void>
  /** "Dispensar hoje" (or adiar 1, 2, 3 days or 1 week). Returns the day the offer comes back. */
  postponeReview(option: ReviewPostpone): Promise<{ next: string }>
  /** Applies the review's choices as one proposal, all or none. Returns how many operations were applied. */
  confirmReview(choices: ReviewChoices): Promise<{ applied: number }>
  /** Rotinas pessoais do vault (AO-42): as de hoje e as linhas que precisam do usuário (candidatas da revisão do dia). Só lê rotinas-pessoais.md. */
  routineCandidates(): Promise<RoutineCandidate[]>
  /** Projeta agenda e pendências pessoais da semana local; não altera o estado das ocorrências. */
  personalRoutineOverview(): Promise<PersonalRoutineOverview>
  /** Confirma a distribuição semanal escolhida e materializa as ocorrências selecionadas. */
  confirmPersonalRoutineDistribution(routineId: string, days: number[]): Promise<PersonalRoutineOverview>
  /** Reserva e cria tarefa idempotente para uma ocorrência selecionada; renderer não envia caminho nem ID. */
  createPersonalRoutineTask(input: PersonalRoutineCreateInput): Promise<{ id: string; board: ParsedBoard; focus: FocusItem[] }>
  /** Retoma a tarefa aberta já vinculada, sem criar duplicata. */
  resumePersonalRoutineOccurrence(occurrenceId: string): Promise<{ id: string; board: ParsedBoard; focus: FocusItem[] }>
  /** Opens the configured rotinas-pessoais.md in the user's default editor; the app does not write it. */
  openPersonalRoutines(): Promise<void>
  /** Lê o agenda.md do vault: o dia, a semana (segunda a domingo) e as linhas sem data. Só lê; não escreve em nenhum arquivo. */
  readAgenda(): Promise<AgendaView>
  /** Põe em foco a tarefa da linha dada (ganha um id no tarefas.md se não tiver) e devolve o quadro e o foco. */
  focusTask(line: number): Promise<{ board: ParsedBoard; focus: FocusItem[] }>
  /** Tira do foco a tarefa com esse id. Não escreve no tarefas.md e devolve o foco. */
  unfocusTask(id: string): Promise<FocusItem[]>
  /** Guarda o passo de hoje da tarefa em foco (um por tarefa, do dia de hoje) e devolve o foco. Não escreve no tarefas.md. */
  saveStep(id: string, text: string): Promise<FocusItem[]>
  /** Tira o passo de hoje da tarefa; o de outros dias fica no histórico. Devolve o foco. */
  clearStep(id: string): Promise<FocusItem[]>
  /** Lê o Timer da barra como ele está agora; null quando está Parado. */
  readBarTimer(): Promise<BarTimerView | null>
  /** Começa o intervalo que a popup escolhe (Foco · 25, Pausa curta · 5, Pausa longa · 15), com ou sem tarefa ligada. */
  startBarTimer(mode: number, task?: { id?: string; text?: string } | null): Promise<BarTimerView | null>
  /** Pausa: guarda o tempo restante e para o relógio. */
  pauseBarTimer(): Promise<BarTimerView>
  /** Retoma: o prazo volta a partir do que restava. */
  resumeBarTimer(): Promise<BarTimerView>
  /** Zera o Timer: nada é mantido. */
  resetBarTimer(): Promise<BarTimerView | null>
  /** Troca (ou tira) o rótulo da tarefa ligada; nada guarda quando o Timer está Parado. */
  setBarTimerTask(task: { id?: string; text?: string } | null): Promise<BarTimerView | null>
  // AO-43: memória dos perfis — um resumo curto por perfil, escrito pela pessoa.

  /** A memória de todo perfil que tem uma, no formato { id da profile: entrada }. */
  profileMemoryState(): Promise<Record<string, ProfileMemoryEntry>>
  /** A memória de um perfil; null quando ele não tem nenhuma. */
  readProfileMemory(profileId: string): Promise<ProfileMemoryEntry | null>
  /** Salva (ou reescreve) a memória de um perfil; o texto é cortado nas pontas e não pode ficar vazio. */
  editProfileMemory(profileId: string, text: string): Promise<ProfileMemoryEntry>
  /** Apaga a memória de um perfil, de propósito mesmo. */
  deleteProfileMemory(profileId: string): Promise<void>
  getLog(agentId: string): Promise<LogEntry[]>
  /** The log of one subagent of the agent (running or recently ended); [] when unknown. */
  getSubagentLog(agentId: string, subId: string): Promise<LogEntry[]>
  hire(req: HireRequest): Promise<AgentSummary>
  /** A new agent in this folder with no task yet; it waits for your first message. */
  summon(
    cwd: string,
    permissionMode: OfficePermissionMode,
    brain?: AgentBrain,
    worktree?: boolean,
    confirmPermissionOverride?: boolean,
    engine?: 'claude',
  ): Promise<AgentSummary>
  send(agentId: string, text: string, attachments?: AttachmentInput[]): Promise<void>
  /** Disk path of a picked or dropped file; '' for pasted data. */
  pathForFile(file: File): string
  interrupt(agentId: string): Promise<void>
  /** Summarizes the conversation so far (/compact) to free up context. */
  compact(agentId: string): Promise<void>
  /** Starts a fresh conversation with the same agent. */
  clearContext(agentId: string): Promise<void>
  /** Reads the plan limits again now. */
  refreshUsage(): Promise<PlanUsage[]>
  /** Checks the login of every account (claude auth status). */
  checkAccounts(): Promise<AccountStatus[]>
  /** A new Claude account: makes its config folder; log in next. */
  addAccount(name: string): Promise<Settings>
  /** Forgets the account. Its config folder stays on disk. */
  removeAccount(id: string): Promise<Settings>
  /** Opens a terminal running `claude auth login` for the account (macOS). */
  loginAccount(id: string): Promise<{ ok: boolean; message?: string }>
  /** Accounts of a project floor, or of everything outside the floors (null). Empty = the default. */
  setAccountPool(floorId: string | null, ids: string[]): Promise<Settings>
  /**
   * Before dismissing: an agent with a worktree asks (native dialog) whether to keep or
   * remove its copy. 'plain' = no worktree, confirm as usual; 'confirmed' = asked and ok.
   */
  prepareFire(agentId: string): Promise<'plain' | 'confirmed' | 'cancelled'>
  /** Resolves a note for the toast when the agent's worktree was kept or removed. */
  fire(agentId: string): Promise<string | void>
  /** Whether the folder is inside a git repo (the worktree option starts on). */
  isGitRepo(cwd: string): Promise<boolean>
  /** Unified diff of one file listed in a result's changes. */
  resultDiff(resultId: string, path: string): Promise<string>
  /** Opens the result's folder (and a file of it) in Cursor or VS Code. False when neither is installed. */
  openResultInEditor(resultId: string, path?: string): Promise<boolean>
  /** Puts the files back as they were before the task, after a native confirmation. Null = cancelled. */
  discardResult(resultId: string): Promise<ResultChanges | null>
  /** Commits the listed files with this message. */
  commitResult(resultId: string, message: string): Promise<ResultChanges>
  /** Pushes the worktree branch and opens a PR with gh, after a native confirmation. Null = cancelled. */
  openResultPR(resultId: string, title: string): Promise<string | null>
  /** Recent Claude Code sessions (terminal and office) for the resume center. */
  listSessions(): Promise<SessionEntry[]>
  /** Brings a saved session back to the office as an agent. */
  recall(sessionId: string): Promise<AgentSummary>
  /** Opens `claude --resume` for the session in a terminal (macOS Terminal; Windows Terminal or a console window). */
  openInTerminal(sessionId: string): Promise<OpenTerminalResult>
  /** Stops the claude process behind a terminal agent. */
  closeTerminal(agentId: string): Promise<{ ok: boolean; message?: string }>
  respond(decision: PermissionDecision): Promise<void>
  ackResult(resultId: string): Promise<void>
  /** Resume only on the account fixed to this task; any other account is rejected. */
  continueOn(agentId: string, accountId: string): Promise<void>
  /** AO-42: wait for the current task's fixed Claude account to have quota, then resume only on it. */
  waitOnSameAccount(agentId: string): Promise<void>
  /** Explicitly end a quota-paused task without discarding its result. */
  endQuotaTask(agentId: string): Promise<void>
  pickFolder(defaultPath?: string): Promise<string | null>
  installBridge(): Promise<BridgeStatus>
  uninstallBridge(): Promise<BridgeStatus>
  saveSettings(patch: Partial<Settings> & { confirmPermissionChanges?: boolean }): Promise<Settings>
  /** Opens a user-chosen Claude settings file read-only; returns a preview, never imports it. */
  previewClaudePermissions(): Promise<{ source: string; rules: Array<Pick<import('./settings').AlwaysAllowRule, 'kind' | 'value'>> } | null>
  /** Creates (unknown id) or replaces a template; returns it as stored. */
  saveTemplate(t: AgentTemplate): Promise<AgentTemplate>
  deleteTemplate(id: string): Promise<void>
  createTicket(draft: TicketDraft): Promise<Ticket>
  updateTicket(ticketId: string, patch: TicketPatch): Promise<Ticket>
  /** Moves a ticket to a column, before `beforeId` (or to the end). */
  moveTicket(ticketId: string, status: TicketStatus, beforeId?: string): Promise<void>
  commentTicket(ticketId: string, text: string): Promise<void>
  deleteTicket(ticketId: string): Promise<void>
  /** Closes tickets in "Feito" (all of them when no ids): off the board, into the archive. Resolves how many closed. */
  closeTickets(ticketIds?: string[]): Promise<number>
  /** Closed tickets, newest first, filtered by key, title, description or tag. */
  listClosed(search?: string): Promise<Ticket[]>
  /** Brings a closed ticket back to "A fazer". */
  reopenTicket(ticketId: string): Promise<Ticket>
  /** 'me' = the player takes it; null = nobody (a ticket in "Fazendo" goes back to "A fazer"). */
  assignTicket(ticketId: string, who: 'me' | null): Promise<void>
  /** Hands the ticket to an agent: it gets the full brief and the ticket moves to "Fazendo". */
  delegateTicket(ticketId: string, target: DelegateTarget): Promise<AgentSummary>
  openExternal(url: string): Promise<void>
  revealPath(path: string): Promise<void>
  /** YouTube video ID of the current Claude FM live. */
  radioVideo(): Promise<string>
  /** Squads found in squads/<code>/squad.yaml of a folder; empty when there are none. */
  listSquads(cwd: string): Promise<SquadInfo[]>
  /** An orchestrator that runs one cycle of the squad with its own team only. */
  runSquad(
    cwd: string,
    code: string,
    permissionMode: OfficePermissionMode,
    note?: string,
    confirmPermissionOverride?: boolean,
  ): Promise<AgentSummary>
  /** Proposes a squad for an empty room: the model plans the team, nothing is written yet. */
  proposeSquad(input: { id: string; projectId: string; room: number; brief: string; ticketIds: string[] }): Promise<SquadProposal>
  /** Asks for a new proposal with the player's changes; the brief and the tickets stay. */
  adjustSquadProposal(id: string, adjustment: string, name?: string): Promise<SquadProposal>
  /** Saves the name the player edited in the proposal: it survives the adjustments and the closing of the window. */
  renameSquadProposal(id: string, name: string): Promise<SquadProposal>
  /** Throws the proposal away: nothing was created for it. */
  discardSquadProposal(id: string): Promise<void>
  /** Approves the proposal: the squad is written and the chosen tickets are given to it. */
  approveSquadProposal(id: string, name: string): Promise<SquadInfo>
  /** The queue of a squad: the ticket it works on and the ones waiting. */
  squadQueue(code: string): Promise<SquadQueue | undefined>
  /** Retenta publicar o resultado já salvo do ticket ativo; nunca reexecuta o agente. */
  retrySquadPublication(code: string): Promise<void>
  retrySquadStart(code: string): Promise<void>
  /** The cost book, cut to the days and folder asked for (all of it when empty). */
  getLedger(query?: LedgerQuery): Promise<Ledger>
  /** Claude Code statistics as last read from disk (no API call). A stale copy starts a background read. */
  getStats(): Promise<ClaudeStats>
  /** Reads the new bytes of the transcripts now (disk only, no API call). */
  refreshStats(): Promise<ClaudeStats>
  /** Asks where to save (Save dialog) and writes the Markdown there. Resolves the path, or null if cancelled. */
  saveMarkdown(fileName: string, content: string): Promise<string | null>
  /** Puts text on the system clipboard (works even when the page has no focus). */
  copyText(text: string): Promise<void>
  /** Copies in userData/backups, newest first. */
  listBackups(): Promise<BackupEntry[]>
  /** Asks, saves the current state as a backup, puts the backup in place and restarts. Resolves false if the user said no. */
  restoreBackup(id: string): Promise<boolean>
  openBackupsFolder(): Promise<void>
  /** Saves everything in one file the user picks. Resolves its path, or null if cancelled. */
  exportData(): Promise<string | null>
  /** Picks an export, asks, saves the current state as a backup, replaces the data and restarts. */
  importData(): Promise<boolean>
  /** An error the page did not catch, for the app log (main keeps only short strings). */
  reportError(err: RendererError): void
  /** Opens userData/logs in the file manager. */
  openLogs(): Promise<void>
  /** Puts version, OS, Claude Code version and the last 200 log lines on the clipboard. */
  copyDiagnostics(): Promise<void>
  /** Where the auto-update stands. */
  updateStatus(): Promise<UpdateStatus>
  /** Looks for a new release now (Settings → "Verificar agora"). */
  checkForUpdates(): Promise<UpdateStatus>
  /**
   * Saves the data and restarts into the downloaded version. Without `force` it
   * refuses while agents work or permissions wait, and says how many.
   */
  installUpdate(force?: boolean): Promise<UpdateInstallResult>
  listRoutines(): Promise<Routine[]>
  /** Creates (no id) or replaces a routine; throws a message for the form when something is off. */
  saveRoutine(draft: RoutineDraft): Promise<Routine>
  deleteRoutine(id: string): Promise<void>
  /** Pause (false) or resume (true); resuming counts from now. */
  setRoutineEnabled(id: string, enabled: boolean): Promise<Routine>
  /** A paused copy, without history. */
  duplicateRoutine(id: string): Promise<Routine>
  /** One run now, outside the schedule. */
  runRoutineNow(id: string): Promise<Routine>
  /** Reads the Mac's scheduled jobs again. */
  listMacJobs(): Promise<MacJob[]>
  /** Starts a Mac job now (launchctl kickstart); launchd still owns it. */
  runMacJobNow(label: string): Promise<MacJob[]>
  /** The last lines of a Mac job's log. */
  macJobLog(label: string): Promise<string>
  /** Opens a Mac job's log in the default app. */
  openMacJobLog(label: string): Promise<void>
  onEvent(cb: (e: OfficeEvent) => void): () => void
}
