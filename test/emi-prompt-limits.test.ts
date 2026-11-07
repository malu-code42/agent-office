import { describe, expect, it } from 'vitest'
import { emiPrompt } from '../src/main/emi-prompt'
import { SQUAD_MAX_COMPOSED, SQUAD_MIN_MEMBERS } from '../src/shared/types'

// AO-106: the member limits of the Emi prompt are the constants, not a number written by hand.
describe('limites de squad no prompt da Emi', () => {
  it('usa as constantes e proíbe repetir papel para encher mesa', () => {
    const prompt = emiPrompt({ name: 'Loja', cwd: '/tmp/loja' })
    expect(prompt).toContain(`A squad has ${SQUAD_MIN_MEMBERS} to ${SQUAD_MAX_COMPOSED} members`)
    expect(prompt).toContain('each role at most once')
    expect(prompt).toContain('never add a member just to fill a desk')
    expect(prompt).not.toContain('2 to 6')
  })
})
