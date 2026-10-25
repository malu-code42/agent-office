import { describe, expect, it } from 'vitest'
import { heldRooms, holdsRoom, type ProjectFloor, type SquadInfo, type SquadProposal } from '@shared/types'
import { floorsKey, issuesToken } from '../src/renderer/src/game/floor-key'
import { Grid } from '../src/renderer/src/world/pathfinding'
import { PARTITIONS, projectPlan, rideBetween, SPAWN_TILE, UPPER_SPAWN_TILE } from '../src/renderer/src/world/layout'

/** A squad of the project, with the given members. */
function squad(code: string, name: string, members: string[]): SquadInfo {
  return {
    code,
    name,
    icon: '•',
    description: '',
    cwd: '/proj',
    members: members.map((id) => ({ id, name: id, icon: '•', title: '', execution: 'subagent', sector: 'Equipe' })),
    steps: [],
  }
}

const project: ProjectFloor = { id: 'p1', name: 'Projeto', cwd: '/proj' }

/** The key of one project floor with the given squads. */
const key = (squads: SquadInfo[]) => floorsKey([project], squads, [projectPlan(squads)])

describe('the ride between floors', () => {
  it('walks to the elevator of the floor the agent is on', () => {
    const up = rideBetween(0, 1)
    expect(up.from).toEqual(SPAWN_TILE)
    expect(up.at).toEqual({ x: 13.5, z: 0.45 })
    const down = rideBetween(1, 0)
    expect(down.from).toEqual(UPPER_SPAWN_TILE)
    expect(down.at).toEqual({ x: 15.5, z: 0.45 })
  })

  it('steps out of the elevator of the floor the agent is going to', () => {
    expect(rideBetween(0, 1).to).toEqual({ x: 15.5, z: 0.45 })
    expect(rideBetween(1, 0).to).toEqual({ x: 13.5, z: 0.45 })
  })

  it('never mixes the two ends: the walk belongs to the floor it leaves', () => {
    const up = rideBetween(0, 1)
    // The tile it walks to is the ground floor's elevator, not the one upstairs.
    expect(up.from).not.toEqual(UPPER_SPAWN_TILE)
    expect(up.from).toEqual(SPAWN_TILE)
  })

  it('the elevator of every floor can be reached on foot', () => {
    // Ground floor: from the boss office to the elevator, through the glass door.
    const ground = new Grid(32, 24)
    for (const p of PARTITIONS) block(ground, p)
    expect(ground.findPath(4, 5, ...SPAWN_TILE)).not.toBeNull()
    // Project floor: from the hall to the elevator of the floor.
    const upper = new Grid(32, 24)
    for (const p of projectPlan([]).partitions) block(upper, p)
    expect(upper.findPath(15, 12, ...UPPER_SPAWN_TILE)).not.toBeNull()
  })
})

/** Puts the walls of a plan into a grid. */
function block(grid: Grid, p: { axis: 'x' | 'z'; at: number; from: number; to: number; doors: number[] }): void {
  for (let i = p.from; i < p.to; i++) {
    if (p.doors.includes(i)) continue
    if (p.axis === 'x') grid.blockEdgeX(p.at, i)
    else grid.blockEdgeZ(p.at, i)
  }
}

describe('the key of the project floors', () => {
  it('is the same for the same data', () => {
    const squads = [squad('alfa', 'Alfa', ['m1', 'm2', 'm3'])]
    expect(key(squads)).toBe(key([squad('alfa', 'Alfa', ['m1', 'm2', 'm3'])]))
  })

  it('changes when a squad is renamed', () => {
    const before = key([squad('alfa', 'Alfa', ['m1', 'm2', 'm3'])])
    const after = key([squad('alfa', 'Alfa da Equipe', ['m1', 'm2', 'm3'])])
    expect(after).not.toBe(before)
  })

  it('changes when the members of a room change', () => {
    const before = key([squad('alfa', 'Alfa', ['m1', 'm2', 'm3'])])
    const after = key([squad('alfa', 'Alfa', ['m1', 'm2', 'm4'])])
    expect(after).not.toBe(before)
  })

  it('changes when an overflow squad is replaced by another one with the same size', () => {
    const rooms = [squad('a', 'A', ['m1', 'm2', 'm3']), squad('b', 'B', ['m1', 'm2', 'm3']), squad('c', 'C', ['m1', 'm2', 'm3'])]
    const before = key([...rooms, squad('delta', 'Delta', ['m1', 'm2', 'm3'])])
    const after = key([...rooms, squad('epsilon', 'Epsilon', ['m1', 'm2', 'm3'])])
    // Same number of squads, same number of members: only the squad itself changed.
    expect(after).not.toBe(before)
  })

  it('says which squad has no room, and what it says', () => {
    const rooms = [squad('a', 'A', ['m1', 'm2', 'm3']), squad('b', 'B', ['m1', 'm2', 'm3']), squad('c', 'C', ['m1', 'm2', 'm3'])]
    const plan = projectPlan([...rooms, squad('delta', 'Delta', ['m1', 'm2', 'm3'])])
    expect(plan.issues.map((i) => i.code)).toEqual(['delta'])
    expect(plan.issues[0].reason).toContain('Delta')
  })

  it('changes when a room turns into a waiting proposal', () => {
    const squads = [squad('alfa', 'Alfa', ['m1', 'm2', 'm3'])]
    const before = floorsKey([project], squads, [projectPlan(squads)])
    const after = floorsKey([project], squads, [projectPlan(squads, [1])])
    expect(after).not.toBe(before)
  })

  it('changes when the queue of a squad changes', () => {
    const squads = [squad('alfa', 'Alfa', ['m1', 'm2', 'm3'])]
    const plans = [projectPlan(squads)]
    const before = floorsKey([project], squads, plans, [])
    const after = floorsKey([project], squads, plans, [{ code: 'alfa', cwd: '/proj', active: 't1', queue: [], updatedAt: 1 }])
    expect(after).not.toBe(before)
  })
})

describe('the room of a proposed squad', () => {
  /** A proposal as the office keeps it. */
  const proposal = (over: Partial<SquadProposal> = {}): SquadProposal => ({
    id: 'prop-1',
    projectId: 'p1',
    cwd: '/proj',
    room: 0,
    createdAt: 1,
    updatedAt: 1,
    brief: 'Refazer a busca da loja',
    ticketIds: [],
    adjustments: [],
    name: 'Squad da Sala 1',
    composition: { name: 'Squad da Sala 1', members: [] },
    status: 'pending',
    ...over,
  })

  it('stays amber while the composition is redone', () => {
    // During the adjustment the proposal is "generating", but it already has the
    // composition: the room cannot go dark under the player's finger.
    const adjusting = proposal({ status: 'generating' })
    expect(holdsRoom(adjusting)).toBe(true)
    expect(heldRooms('p1', [adjusting])).toEqual([0])
    const plan = projectPlan([], heldRooms('p1', [adjusting]))
    expect(plan.rooms[0]!.state).toBe('proposed')
  })

  it('stays dark on the first generation: there is no composition yet', () => {
    const generating = proposal({ status: 'generating', composition: null })
    expect(holdsRoom(generating)).toBe(false)
    expect(heldRooms('p1', [generating])).toEqual([])
    const plan = projectPlan([], heldRooms('p1', [generating]))
    expect(plan.rooms[0]!.state).toBe('empty')
  })

  it('a proposal already published does not hold the room', () => {
    expect(holdsRoom(proposal({ status: 'assigned' }))).toBe(false)
    expect(holdsRoom(proposal({ status: 'created' }))).toBe(false)
  })

  it('a waiting proposal keeps the room amber', () => {
    const waiting = proposal({ status: 'pending' })
    expect(holdsRoom(waiting)).toBe(true)
    expect(projectPlan([], heldRooms('p1', [waiting])).rooms[0]!.state).toBe('proposed')
  })
})

describe('the token of the notice of a floor', () => {
  it('is the same for the same notice', () => {
    const issues = [{ code: 'delta', name: 'Delta', reason: 'ficou sem sala', unplaced: [] }]
    expect(issuesToken(issues)).toBe(issuesToken([{ ...issues[0] }]))
  })

  it('changes when the squad is renamed', () => {
    const before = issuesToken([{ code: 'delta', name: 'Delta', reason: 'ficou sem sala', unplaced: [] }])
    const after = issuesToken([{ code: 'delta', name: 'Delta da Equipe', reason: 'ficou sem sala', unplaced: [] }])
    expect(after).not.toBe(before)
  })

  it('changes when another squad takes its place', () => {
    const before = issuesToken([{ code: 'delta', name: 'Delta', reason: 'ficou sem sala', unplaced: [] }])
    const after = issuesToken([{ code: 'epsilon', name: 'Epsilon', reason: 'ficou sem sala', unplaced: [] }])
    expect(after).not.toBe(before)
  })

  it('changes when a member has no place in the scene', () => {
    const before = issuesToken([{ code: 'delta', name: 'Delta', reason: 'ficou sem sala', unplaced: [] }])
    const after = issuesToken([{ code: 'delta', name: 'Delta', reason: 'ficou sem sala', unplaced: ['Ana'] }])
    expect(after).not.toBe(before)
  })
})
