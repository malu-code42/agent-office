import type { ProjectFloor, SquadInfo, SquadQueue } from '@shared/types'
import type { ProjectPlan } from '../world/layout'

/** The logo of a project, as a short key: the data URL itself is long. */
const logoKey = (p: ProjectFloor) => (p.logo ? `${p.logo.length}:${p.logo.slice(-48)}` : '')

/**
 * The key of the project floors: when it changes, the floors are built again.
 *
 * It carries more than the counts: the name of every squad room, the members of each
 * room and the whole text of every issue. A squad renamed (or another one in its
 * place, with the same number of members) changes the key, so the floor is built
 * again and the notice of the floor appears once more.
 *
 * The order is the order of the data: the projects as they come, the rooms and the
 * issues as the plan lists them. The same data always gives the same key.
 */
export function floorsKey(projects: ProjectFloor[], squads: SquadInfo[], plans: ProjectPlan[], queues: SquadQueue[] = []): string {
  return JSON.stringify(
    projects.map((p, i) => {
      const plan = plans[i]
      const codes = squads.filter((q) => q.cwd === p.cwd).map((q) => q.code)
      return [
        p.id,
        p.name,
        squads.filter((q) => q.cwd === p.cwd).length,
        plan.rooms.map((r) => [r.squad, r.name, r.desks.length, r.members.join(','), r.state]),
        // The queue of each squad: the plate of the room says which ticket it works on.
        codes.map((code) => {
          const queue = queues.find((q) => q.code === code)
          return [code, queue?.active ?? '', queue?.queue.join(',') ?? '']
        }),
        plan.issues.map((issue) => [issue.code, issue.name, issue.reason]),
        logoKey(p),
        p.brandColor,
        !!p.uniform,
      ]
    }),
  )
}

/** What the notice of a floor says about a project. */
export interface FloorIssue {
  /** Squad code. */
  code: string
  /** Name on the room plate. */
  name: string
  /** What does not fit, in pt-BR. */
  reason: string
  /** The members with no place in the scene. */
  unplaced?: string[]
}

/**
 * The token of a notice: it says what the notice says. The squad, its text and the
 * members with no place are all in it, so a squad renamed (or another one in its
 * place) announces itself again instead of staying silent.
 */
export function issuesToken(issues: FloorIssue[]): string {
  return issues.map((issue) => `${issue.code}:${issue.name}:${issue.reason}:${(issue.unplaced ?? []).join(',')}`).join(',')
}
