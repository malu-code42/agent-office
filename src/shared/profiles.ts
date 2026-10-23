/**
 * Reusable profiles (AO-42): the fixed configuration a task's fresh conversation starts with. Here lives only
 * the list itself — id, name and scope —, used by the Luna's context and by the surfaces that show a profile.
 * Nothing about accounts, models or skills is in it: those stay managed by the office, and a profile never
 * changes them by itself.
 */

export interface UserProfile {
  id: string
  name: string
  /** What the profile serves for, in one line the user can read before choosing it. */
  scope: string
}

/**
 * The profiles that exist from the start. They are enough to begin: one for the technical requests,
 * one for study outside a study cycle, one for writing. New profiles are a separate matter: they exist
 * only where the app can review them, and this file is not it.
 */
export const PROFILES: UserProfile[] = [
  {
    id: 'tecnica',
    name: 'Ajuda técnica',
    scope: 'resolver um problema técnico pontual, sem virar estudo nem projeto',
  },
  {
    id: 'estudo-avulso',
    name: 'Estudo avulso',
    scope: 'estudar por conta própria, fora de qualquer ciclo de estudos em andamento',
  },
  {
    id: 'escrita',
    name: 'Escrita',
    scope: 'produzir e revisar textos',
  },
]

/** The ids the Luna may suggest and the schema may accept, in the order of PROFILES. */
export const PROFILE_IDS = PROFILES.map((p) => p.id) as [string, ...string[]]

export type ProfileId = (typeof PROFILES)[number]['id']

/** The profile with id `id`, or undefined when there is no such profile (nothing invented here). */
export function profileById(id: string): UserProfile | undefined {
  return PROFILES.find((p) => p.id === id)
}

/** Fixed scope instructions added to a fresh task; caller must validate the id against PROFILE_IDS first. */
export function profileTaskInstructions(id: ProfileId): string {
  switch (id) {
    case 'tecnica':
      return 'Work as Ajuda técnica: solve the concrete technical request directly. Do not turn a one-off fix into a study cycle or a broader project.'
    case 'estudo-avulso':
      return 'Work as Estudo avulso: answer or teach this standalone question only, outside any active study cycle. Do not advance or replace a Bonnie-led cycle.'
    case 'escrita':
      return 'Work as Escrita only because the user requested writing help. Review or edit the requested text and propose a new version; never overwrite the original.'
    default:
      throw new Error('Perfil desconhecido.')
  }
}
