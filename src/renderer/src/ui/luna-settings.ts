import type { Settings } from '@shared/types'
import { h } from './dom'
import { brainFields } from './modals/brain'
import { cleanError, field, modal } from './modals/common'
import { lookEditor } from './templates'
import type { Toast } from './tasks-complete'

/** Edits only Luna's model, effort, and portrait; global defaults are never included in the patch. */
export function openLunaSettings(root: HTMLElement, settings: Settings, toast: Toast): void {
  const look = lookEditor(settings.lunaLook)
  const brain = brainFields({ model: settings.lunaModel, effort: settings.lunaEffort }, true)
  let saving = false
  let done = false
  const finish = () => {
    if (done) return
    done = true
    el.remove()
  }
  const save = async () => {
    if (saving || done) return
    saving = true
    saveButton.disabled = true
    try {
      await window.office.saveSettings({ lunaLook: look.value(), lunaModel: brain.model.value, lunaEffort: brain.value().effort ?? '' })
      toast('Preferências da Luna salvas.', 'ok')
      finish()
    } catch (err) {
      toast(cleanError(err), 'err')
      saving = false
      saveButton.disabled = false
    }
  }
  const saveButton = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => void save() }, 'Salvar preferências')
  const el = modal(
    'Preferências da Luna',
    [
      h('p', { class: 'field-hint' }, 'Estas escolhas valem somente para a Luna e não mudam os padrões dos outros agentes.'),
      look.el,
      field('Modelo', brain.model, brain.hint),
      brain.meter,
    ],
    [h('button', { class: 'btn', type: 'button', onclick: finish }, 'Cancelar'), saveButton],
    finish,
  )
  root.append(el)
  brain.model.focus()
}
