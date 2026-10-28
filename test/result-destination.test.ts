import { describe, expect, it } from 'vitest'
import type { AgentResult, AgentSummary } from '@shared/types'
import { latestProjectResult, meetingWaitSpot, resultDestination } from '../src/renderer/src/game/result-destination'

const agent = (project?: string) => ({ project, id: 'agent-1' }) as AgentSummary

describe('project result destination (AO-57)', () => {
  it('routes only project agents to their meeting room', () => {
    expect(resultDestination(agent('project-1'), true)).toBe('meeting')
    expect(resultDestination(agent(), false)).toBe('house')
    expect(resultDestination(agent('removed-project'), false)).toBe('house')
  })

  it('opens the newest pending result belonging to the clicked project only', () => {
    const projectAgent = { ...agent('project-1'), id: 'project-agent' }
    const unrelatedAgent = { ...agent('project-2'), id: 'other-agent' }
    const makeResult = (id: string, agentId: string, createdAt: number): AgentResult => ({
      id,
      agentId,
      createdAt,
      text: 'Resultado sintético',
      isError: false,
      costUsd: 0,
      durationMs: 1,
      turns: 1,
    })
    const oldResult = makeResult('old', 'project-agent', 1)
    const newResult = makeResult('new', 'project-agent', 3)
    const unrelatedResult = makeResult('other', 'other-agent', 9)

    expect(latestProjectResult('project-1', [projectAgent, unrelatedAgent], [oldResult, newResult, unrelatedResult])).toEqual({
      agent: projectAgent,
      result: newResult,
    })
    expect(latestProjectResult('project-3', [projectAgent, unrelatedAgent], [oldResult, newResult, unrelatedResult])).toBeNull()
  })

  it('allocates distinct walkable waiting tiles within the meeting room', () => {
    const occupied: [number, number][] = []
    const walkable = (x: number, z: number) => !(x === 15 && z === 19) && !(x === 14 && z === 19)
    const room: [number, number, number, number] = [11, 16, 20, 24]
    const table = { x: 15.5, z: 19.1 }

    const first = meetingWaitSpot(walkable, occupied, room, table)
    expect(first).not.toBeNull()
    occupied.push(first!)
    const second = meetingWaitSpot(walkable, occupied, room, table)

    expect(second).not.toBeNull()
    expect(second).not.toEqual(first)
    expect(walkable(...second!)).toBe(true)
    expect(second![0]).toBeGreaterThanOrEqual(room[0])
    expect(second![0]).toBeLessThan(room[2])
    expect(second![1]).toBeGreaterThanOrEqual(room[1])
    expect(second![1]).toBeLessThan(room[3])
  })
})
