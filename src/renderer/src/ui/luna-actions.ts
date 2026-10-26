import { profileById } from '@shared/profiles'
import type { AgentSummary } from '@shared/types'
import { projectFor } from '@shared/projects'
import { LAST_CWD } from './modals/common'

/** Starts the fresh profile conversation suggested by Luna after the user approved its context. */
export async function startLunaProfileTask(profileId: string, task: string): Promise<AgentSummary | null> {
  const profile = profileById(profileId)
  if (!profile) throw new Error('Esse perfil não existe mais. Tente o pedido de novo.')
  let cwd = localStorage.getItem(LAST_CWD) ?? ''
  if (!cwd) cwd = (await window.office.pickFolder()) ?? ''
  if (!cwd) return null
  const state = await window.office.getState()
  const hire = (folder: string) =>
    window.office.hire({
      name: '',
      cwd: folder,
      task,
      profile: profile.id,
      engine: 'claude',
      permissionMode: projectFor(state.settings.projects, folder)?.permissionMode ?? state.settings.defaultPermissionMode,
      model: state.settings.defaultModel || undefined,
      effort: state.settings.defaultEffort || undefined,
    })
  try {
    const agent = await hire(cwd)
    localStorage.setItem(LAST_CWD, cwd)
    return agent
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('Escolha uma pasta de projeto que exista.')) throw error
    const selected = await window.office.pickFolder(cwd)
    if (!selected || selected === cwd) throw error
    const agent = await hire(selected)
    localStorage.setItem(LAST_CWD, selected)
    return agent
  }
}
