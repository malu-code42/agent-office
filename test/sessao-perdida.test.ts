import { describe, expect, it } from 'vitest'
import { isLostSession } from '../src/main/agents/sdk'

describe('sessão perdida', () => {
  it('reconhece o erro do Claude Code quando a conversa salva sumiu', () => {
    expect(isLostSession('Claude Code returned an error result: No conversation found with session ID: da3fca2f')).toBe(true)
    expect(isLostSession('rate limit')).toBe(false)
  })
})
