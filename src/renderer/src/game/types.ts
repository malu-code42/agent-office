import type { ProjectFloor, SquadMember, SubagentInfo, AgentSummary } from '@shared/types'
import type { Avatar } from '../world2d/avatar'
import * as L from '../world2d/plan'
import type { Tag, BubbleKind } from '../world2d/overlays'
import type { ProjectFloor2d } from '../world2d/floor'
import type { ScreenMode } from '../world2d/floor'
import type { HelperReturn } from './helper-return'
import type { HomeAction } from '../world2d/home-layout'
import type { StudyAct, Teacher } from '../world2d/estudos'

export type Goal = 'desk' | 'boss' | 'meeting' | 'hang' | 'home' | 'leave' | 'chat'

export interface Actor {
  id: string
  avatar: Avatar
  tag: Tag
  goal: Goal | null
  arrived: boolean
  /** Reserved standing tile by a waiting area (House table or project meeting room). */
  spot: [number, number] | null
  /** Reserved lounge spot index. */
  hang: number | null
  waveUntil: number
  /** Struck by the skull: lies still until its session closes (gets back up if closing fails). */
  down: boolean
  /** A short reaction bubble ("Ai!") that overrides the status bubble until this time. */
  shoutUntil: number
  shout: string
  shoutKind: BubbleKind
  /** Walking over to talk to another agent (SendMessage); status changes wait until this time. */
  chatUntil: number
  /** Wall-clock ms since the agent has had nothing to do; null while busy. */
  restSince: number | null
  /** A house resident's place at Luna's table (see homeSpot); kept until it stops living there. */
  homeSeat: number | null
  /** Bumped on every new goal; an elevator ride that ends under an old goal starts over. */
  trip: number
  /** Inside the elevator between floors: goal changes wait for the doors to open. */
  riding: boolean
  /** Project and desk the actor last headed to; a change (floors edited) sends it there. */
  seat: string
}

/** A project floor on screen: floor n is uppers[n - 1]. */
export interface Upper {
  project: ProjectFloor
  scene: ProjectFloor2d
  /** One "Passo 3/6 · Texto" line over each squad room that has a coordinator. */
  stepTags: Tag[]
  /** An account of this floor is at its limit. */
  alarm: boolean
  /** Over the alarm, while an account of this floor is at its limit. */
  alarmTag: Tag
  /** Over the spending board: the exact total. */
  moneyTag: Tag
  /** What does not fit on this floor (more squads than rooms); null when everything fits. */
  issueTag: Tag | null
  /** Over the elevator, while a squad proposal waits for the approval. */
  proposalTag: Tag | null
}

/** A subagent shown as a small copy of its parent, standing by the parent's desk. */
export interface Helper {
  id: string
  parentId: string
  avatar: Avatar
  tag: Tag
  /** The fixed spot beside the owner's desk (0, 1 or 2). */
  slot: number
  /** What the helper is doing; the mini label shows it. */
  task: string
  /** The middle of the owner's desk, where the helper and its cord belong. */
  anchor: { x: number; z: number }
  tile: [number, number] | null
  bornAt: number
  /** Game time when it says goodbye; null while the subagent runs. */
  endAt: number | null
  /** The way back to the desk of the owner; null while it is not going back yet. */
  returning: HelperReturn | null
  gone: boolean
  /** It failed: it walks back and leaves a red mark by the desk. */
  failed: boolean
  /** When the failure happened (wall clock); null while it did not fail. */
  failedAt: number | null
}

/** The red mark left by the helpers of an agent that failed, until its conversation is opened. */
export interface FailureMark {
  /** The owner whose helpers failed. */
  parentId: string
  /** The subagent that failed last. */
  id: string
  /** How many helpers of this owner failed. */
  count: number
  /** The floor the mark stands on. */
  floor: number
  /** Where the pad stands on the floor. */
  x: number
  z: number
  /** The mini label beside it. */
  tag: Tag
}

/**
 * A squad member at work: it comes up in the elevator, sits at a free desk of its
 * squad room (inline members sit beside the coordinator), hands the delivery over at
 * the coordinator's desk and leaves.
 */
export interface Member {
  /** Subagent task id, or inline:<orchestrator>:<member>. */
  id: string
  parentId: string
  info: SquadMember
  avatar: Avatar
  tag: Tag
  inline: boolean
  desk: L.DeskSlot | null
  tile: [number, number] | null
  phase: 'arriving' | 'working' | 'delivering' | 'leaving'
  bornAt: number
  /** Game time when the work is over and the delivery starts; null while it runs. */
  endAt: number | null
  /** What went wrong, for a subagent that failed. */
  failed: string | null
  sub: SubagentInfo | null
  /** Shows what it is doing (after a click) until this time. */
  infoUntil: number
}

export interface GameHooks {
  /** Player clicked an agent (avatar or tag); `helperId` when it was one of its subagents, to open that one's log. */
  onAgentClick(agentId: string, helperId?: string): void
  /** Player is standing next to an agent that came to deliver something. */
  onNear(agentId: string | null): void
  /** Player clicked the skull in the boss office: pick an agent to dismiss. */
  onSkull(): void
  /** Player clicked their own computer: open "Novo agente" on Conversar. */
  onComputer(): void
  /** The player (and the camera) arrived on another floor. */
  onFloor(floor: number): void
  /** Player clicked the lounge TV: Claude FM on/off. */
  onTv(): void
  /** Player clicked the routines totem by their office. */
  onRoutines(): void
  /** Player clicked an interactive object in the ground-floor house. */
  onHomeAction(action: HomeAction): void
  /** Player clicked Luna's tag/bubble in the house: open her conversation and the review of the day. */
  onLunaReview(): void
  /** The floor has more squads than rooms (or a composition that does not fit): the user has to know. */
  onIncompatible?(project: ProjectFloor, issues: { code: string; name: string; reason: string; unplaced?: string[] }[]): void
  /** The player clicked a squad room: an empty room proposes a squad, a room with one opens its squad. */
  onRoomClick?(project: ProjectFloor, room: L.SquadRoom): void
  /** The player clicked the meeting-room label on a project floor. */
  onMeetingRoomClick?(project: ProjectFloor): void
  /** The player clicked the elevator door on a 2D floor. */
  onElevator?(): void
  /** The player clicked something of the study floor (a teacher opens the cycle, with who it is). */
  onStudy?(act: StudyAct, teacher?: Teacher): void
}

/** How much higher (tiles) the HTML tags float than their anchors: over the sprites' pixel bubbles. */
export const TAG_LIFT = 1.2
/** Seconds the camera gets to reach a dismissed agent before the skull drops. */
export const STRIKE_AFTER_S = 0.6
/** An idle agent waits at its desk this long before wandering off to the lounge. */
export const LOUNGE_AFTER_MS = 3 * 60_000

export const HELPER_SCALE = 0.62
/** Subagents can finish in a few seconds; keep each helper on screen at least this long. */
export const HELPER_MIN_S = 4

/** Seconds inside the elevator between floors. */
export const RIDE_S = 1.1
/** Squad people walk briskly between the squad room, the coordinator and the elevator. */
export const SQUAD_SPEED = 4.4
/** A member that finishes in a few seconds still gets to sit down for a moment. */
export const MEMBER_MIN_S = 5
/** Whatever happens, a member leaves the floor this long after its work ends. */
export const MEMBER_EXIT_S = 40
export const center = ([x, z]: [number, number]) => ({ x: x + 0.5, z: z + 0.5 })
export const clip = (text: string, n: number) => (text.length > n ? text.slice(0, n - 1) + '…' : text)
export type Point = { x: number; y: number }
export const tileOf = (p: { x: number; z: number }): [number, number] => [Math.floor(p.x), Math.floor(p.z)]

/** Floor and desk an agent should be at; it changes when its folder moves to another floor. */
export const seatKey = (a: AgentSummary) => `${a.project ?? ''}:${a.desk}`

export function screenMode(a: AgentSummary): ScreenMode {
  switch (a.status) {
    case 'starting':
      return 'boot'
    case 'working':
      return 'working'
    case 'waiting':
      return 'waiting'
    case 'done':
      return 'done'
    case 'error':
      return 'error'
    case 'idle':
      return 'idle'
    default:
      return 'off'
  }
}
