import { describe, expect, it } from 'vitest'
import { competencyProfileIds, getCompetencyProfile, snapshotCompetencyProfile } from '@shared/competency-profiles'

describe('catálogo local de perfis de competência', () => {
  it('inclui especialidades locais pertinentes a squads de desenvolvimento', () => {
    expect(competencyProfileIds).toEqual([
      'tech-lead',
      'backend-engineer',
      'frontend-engineer',
      'qa-engineer',
      'security-engineer',
      'sre',
      'product-manager',
      'ux-designer',
    ])
    for (const id of competencyProfileIds) {
      const profile = getCompetencyProfile(id)
      expect(profile.identity.trim()).not.toBe('')
      expect(profile.scope.trim()).not.toBe('')
      expect(profile.responsibilities.length).toBeGreaterThan(0)
      expect(profile.boundaries.length).toBeGreaterThan(0)
      expect(profile.delivery.length).toBeGreaterThan(0)
      expect(profile.qualityCriteria.length).toBeGreaterThan(0)
      expect(JSON.stringify(profile)).not.toMatch(/permission|tool access|filesystem access/i)
    }
  })

  it('produces an independent snapshot and rejects unknown IDs', () => {
    const first = snapshotCompetencyProfile('backend-engineer')
    const second = snapshotCompetencyProfile('backend-engineer')
    first.responsibilities.push('mutation local de teste')

    expect(second.responsibilities).not.toContain('mutation local de teste')
    expect(() => snapshotCompetencyProfile('paperclip-admin' as never)).toThrow(/perfil local/i)
  })
})
