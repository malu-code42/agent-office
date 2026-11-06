import { describe, expect, it } from 'vitest'
import { autoAckResults } from '../src/renderer/src/ui/result-rules'
import type { AgentResult } from '@shared/types'

const result = (over: Partial<AgentResult>): AgentResult =>
  ({ id: 'r1', agentId: 'a1', text: 'ok', isError: false, costUsd: 0, durationMs: 1, turns: 1, createdAt: 1, ...over }) as AgentResult

describe('autoAckResults', () => {
  const agent = { squad: undefined, role: undefined }

  it('receives a pending result when the conversation of a non-squad agent opens', () => {
    expect(autoAckResults(agent, [result({ id: 'pending' })]).map((r) => r.id)).toEqual(['pending'])
  })

  it('returns nothing for a result already received', () => {
    expect(autoAckResults(agent, [])).toEqual([])
  })

  it('keeps squad deliveries, which wait for their verified PR', () => {
    expect(autoAckResults({ squad: 'sala-2', role: 'orchestrator' }, [result({})])).toEqual([])
  })

  it('keeps errors and results with changes for their card', () => {
    const withChanges = result({ id: 'c', changes: { git: true, files: [] } as unknown as AgentResult['changes'] })
    expect(autoAckResults(agent, [result({ id: 'err', isError: true }), withChanges])).toEqual([])
  })
})
