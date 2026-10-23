import { describe, expect, it } from 'vitest'
import { PROFILE_IDS, PROFILES, profileById } from '../src/shared/profiles'
import { profileIdSchema } from '../src/main/validate'

/**
 * The reusable profiles of the Luna (AO-42): only the built-in list matters here, and only what the
 * surfaces show — id, name and scope. New profiles are a separate matter and live outside this file, so
 * nothing else is expected of it: no account, no model, no skills.
 */

describe('perfis de fábrica', () => {
  it('três perfis com nome, escopo e ids fixos, sem nada além disso', () => {
    expect(PROFILES.map((p) => p.id)).toEqual(['tecnica', 'estudo-avulso', 'escrita'])
    for (const p of PROFILES) {
      expect(p.name.length).toBeGreaterThan(0)
      expect(p.scope.length).toBeGreaterThan(0)
    }
    // No profile carries anything about how a conversation runs: only id, name and scope.
    for (const p of PROFILES) {
      expect(Object.keys(p).sort()).toEqual(['id', 'name', 'scope'])
    }
  })

  it('o id informado pelo modelo existe na lista: nenhum perfil é inventado na busca', () => {
    expect(profileById('tecnica')?.name).toBe('Ajuda técnica')
    expect(profileById('estudo-avulso')).toBeDefined()
    expect(profileById('escrita')).toBeDefined()
    expect(profileById('inexistente')).toBeUndefined()
    expect(profileById('')).toBeUndefined()
  })

  it('PROFILE_IDS é a lista de ids, na mesma ordem de PROFILES', () => {
    expect(PROFILE_IDS).toEqual(PROFILES.map((p) => p.id))
  })

  it('o esquema da resposta aceita só ids de perfil de fábrica (ou nulo)', () => {
    for (const id of PROFILE_IDS) {
      const r = profileIdSchema.safeParse(id)
      expect(r.success).toBe(true)
    }
    expect(profileIdSchema.safeParse('inventado').success).toBe(false)
    expect(profileIdSchema.safeParse(null).success).toBe(true)
    expect(profileIdSchema.safeParse(undefined).success).toBe(true)
    expect(profileIdSchema.safeParse(42).success).toBe(false)
  })
})
