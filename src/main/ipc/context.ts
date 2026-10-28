import type { BrowserWindow } from 'electron'
import { dialog } from 'electron'
import type { Actor, AgentBrain, OfficeEvent, SquadInfo } from '@shared/types'
import type { Accounts } from '../accounts'
import type { AgentManager } from '../agents'
import type { Bridge } from '../bridge'
import type { TicketDesk } from '../delegate'
import type { CostBook } from '../ledger'
import type { MacJobs } from '../mac-jobs'
import type { PlanningStore } from '../planning'
import type { RoutineScheduler } from '../routines'
import type { SquadCreation } from '../squad-creation'
import type { StatsReader } from '../stats'
import type { Store } from '../store'
import type { SystemMonitor } from '../system'
import type { TicketBoard } from '../tickets'
import type { BarTimerStore } from '../bar-timer-store'
import type { ProfileMemoryStore } from '../profile-memory'
import type { ProjectWorkflowStore } from '../project-workflows'
import type { UsageMonitor } from '../usage'
import type { WritingAssistant } from '../writing-assistant'
import type { WritingWriter } from '../writing-write'
import type { WorkflowGenerator } from '../project-workflow-claude'
import type { MediaPosters } from '../media-posters'
import type { MediaWriter } from '../media-write'
import type { TelegramAudioDisposition, TelegramAudioPayload } from '../telegram'
import { idSchema, parse } from '../validate'

/** What the IPC handlers (ipc/*.ts) share; built once in index.ts when the app is ready. */
export interface IpcContext {
  /** The office window right now (null while closed on macOS). */
  win(): BrowserWindow | null
  store: Store
  manager: AgentManager
  board: TicketBoard
  /** The focus set of the Tarefas (planning.json). */
  planning: PlanningStore
  /** The Timer of the bar (AO-64), its own session in timer.json. */
  barTimer: BarTimerStore
  /** The memory of the profiles (AO-43), one short summary per profile in profile-memory.json. */
  profileMemory: ProfileMemoryStore
  projectWorkflows: ProjectWorkflowStore
  projectWorkflowGenerator: WorkflowGenerator
  writing: WritingWriter
  writingAssistant: WritingAssistant
  mediaPosters: MediaPosters
  mediaWriter: MediaWriter
  book: CostBook
  desk: TicketDesk
  routines: RoutineScheduler
  macJobs: MacJobs
  bridge: Bridge
  usage: UsageMonitor
  accounts: Accounts
  system: SystemMonitor
  stats: StatsReader
  broadcast(e: OfficeEvent): void
  updateBadge(): void
  nameOf(agentId: string): string
  player(): Actor
  defaultBrain(): AgentBrain
  /** Squads of the project floors, as last read. */
  squads(): SquadInfo[]
  /** Reads the squads again (the floors changed) and returns them. */
  rereadSquads(): SquadInfo[]
  /** The proposals of squads the player has not approved yet. */
  creation: SquadCreation
  retrySquadPublication(code: string): Promise<void>
  startActiveSquadTicket(code: string): Promise<void>
  onBattery(): boolean
  /** Audio is handed to Luna after Telegram authorization; the callback is registered with the task IPC. */
  onTelegramAudio?: (audio: TelegramAudioPayload) => TelegramAudioDisposition | void | Promise<TelegramAudioDisposition | void>
}

// Every argument from the renderer passes through validate.ts first.

export const id = (raw: unknown) => parse(idSchema, raw, 'ID inválido.')
export const ticketId = (raw: unknown) => parse(idSchema, raw, 'Esse ticket não existe mais.')

/** Confirmation happens in the main process; renderer-provided booleans are not trusted. */
export async function confirmPermissionOverride(win: BrowserWindow | null, detail: string, dangerous = false): Promise<boolean> {
  if (!win) return false
  const result = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Confirmar modo', 'Cancelar'],
    defaultId: 1,
    cancelId: 1,
    message: dangerous
      ? 'PERIGOSO: “Sem pedir nada” deixa o agente executar qualquer ação sem perguntar.'
      : 'Este modo de permissões é mais permissivo que o padrão do projeto.',
    detail,
  })
  return result.response === 0
}
