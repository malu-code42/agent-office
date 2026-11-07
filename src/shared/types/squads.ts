// ---------- squads (Opensquad) ----------

/** A member of an Opensquad squad, without its prompt. */
export interface SquadMember {
  id: string
  name: string
  icon: string
  title: string
  /** subagent = called with the Agent tool; inline = the orchestrator plays the part in its own conversation. */
  execution: 'subagent' | 'inline'
  /** The independent delivery responsibility assigned in squad.yaml or member frontmatter. */
  role?: 'implementer' | 'reviewer' | 'tester' | 'analyst' | 'writer' | 'researcher'
  /** Modelo do membro (alias ou id); ausente = herda o do orquestrador, isto é, o do ticket. */
  model?: string
  /** Esforço do membro; ausente = herda o do orquestrador. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  /** Sector on the project floor: `setor:` in squad.yaml, or "Equipe". */
  sector: string
}

export interface SquadStep {
  id: string
  name: string
  type: 'agent' | 'checkpoint'
  agent?: string
}

export interface SquadInfo {
  code: string
  name: string
  icon: string
  description: string
  /** Project folder (the one holding squads/). */
  cwd: string
  members: SquadMember[]
  steps: SquadStep[]
  /** Missing means available for older persisted renderer snapshots. */
  availability?: 'available' | 'unavailable'
  /** AO-108: o estado guardado pelo usuário (pausado ou desativado); ausente = liberado. */
  state?: 'paused' | 'disabled'
  /** Validation reason shown to the user; never includes member prompts. */
  unavailableReason?: string
  /** Canonical file the user can inspect or restore manually. */
  recoveryPath?: string
}

/** AO-100: a fase de um ciclo de squad, guardada em disco para o squad voltar sozinho ao reabrir o app. */
export type SquadPhase = 'iniciando' | 'implementando' | 'revisando' | 'testando' | 'trabalhando' | 'aguardando' | 'concluido'

/** AO-100: o estado mínimo para retomar o ciclo de um squad. */
export interface SquadPhaseRecord {
  code: string
  ticketId: string
  ticketKey?: string
  phase: SquadPhase
  /** Quantas vezes o ciclo entrou na revisão (0 antes da primeira). */
  round: number
  /** Id do membro do passo corrente, quando há. */
  member?: string
  /** Nome do passo corrente ("Revisão"), quando há. */
  step?: string
  updatedAt: number
}

export interface SquadProgress {
  /** 1-based; 0 before the first step. */
  current: number
  total: number
  /** Step name ("Spec"), or the label the runner wrote. */
  label: string
  /** running, completed, failed… as written by the runner. */
  status: string
  type?: 'agent' | 'checkpoint'
  /** Member id of the current step. */
  agent?: string
}
