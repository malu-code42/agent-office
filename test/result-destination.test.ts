import { describe, expect, it } from 'vitest'
import type { AgentSummary } from '@shared/types'
import { resultDestination } from '../src/renderer/src/game/result-destination'

const agent = (project?: string) => ({ project, id: 'agent-1' }) as AgentSummary

describe('destino do resultado (AO-105: sem sala de reuniões)', () => {
  it('agente de projeto com andar existente espera na própria mesa', () => {
    expect(resultDestination(agent('project-1'), true)).toBe('desk')
  })

  it('agente fora de projeto, ou de projeto sem andar, segue o fluxo da casa', () => {
    expect(resultDestination(agent(), false)).toBe('house')
    expect(resultDestination(agent(), true)).toBe('house')
    expect(resultDestination(agent('removed-project'), false)).toBe('house')
  })
})
