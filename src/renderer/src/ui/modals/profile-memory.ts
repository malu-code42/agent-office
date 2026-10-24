import type { ProfileMemoryEntry } from '@shared/types'
import { PROFILES } from '@shared/profiles'
import { h, icon } from '../dom'
import { cleanError, confirmDialog, field, modal } from './common'

type Toast = (t: string, k?: 'info' | 'ok' | 'err') => void

const WHEN = (ms: number): string =>
  new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

/**
 * Memória dos perfis (AO-43): one short summary per profile, written by the person.
 * The modal is the only way in: the person reads, rewrites or erases each memory, and Luna
 * may read the same text when asked. A task never receives it by itself — nothing is
 * summarized, injected or imported here; the text only goes through the Luna's preview.
 */
export function openProfileMemories(root: HTMLElement, toast: Toast): void {
  window.office
    .profileMemoryState()
    .then((all) => show(root, toast, all))
    .catch((err) => toast(cleanError(err), 'err'))
}

function show(root: HTMLElement, toast: Toast, all: Record<string, ProfileMemoryEntry>): void {
  const close = () => el.remove()
  const body = PROFILES.map((profile) => {
    const entry = all[profile.id]
    const hint = h('span', { class: 'field-hint' }, entry ? `Salva em ${WHEN(entry.updatedAt)}.` : 'Sem memória.')
    const area = h('textarea', {
      class: 'input',
      rows: 3,
      maxlength: 10_000,
      placeholder: `O que jogos ou a Luna no perfil ${profile.name} devem lembrar sempre?`,
    })
    if (entry) area.value = entry.text
    const save = h('button', { class: 'btn btn-primary', type: 'button' }, 'Salvar')
    const drop = h('button', { class: 'btn', type: 'button' }, 'Apagar')
    save.addEventListener('click', () => {
      save.disabled = true
      window.office
        .editProfileMemory(profile.id, area.value)
        .then((saved) => {
          hint.textContent = `Salva em ${WHEN(saved.updatedAt)}.`
          toast('Memória salva.', 'ok')
        })
        .catch((err) => toast(cleanError(err), 'err'))
        .finally(() => (save.disabled = false))
    })
    drop.addEventListener('click', () => {
      confirmDialog(root, {
        title: 'Apagar memória',
        text: `A memória do perfil ${profile.name} sai, e não volta. Continuar?`,
        confirm: 'Apagar',
        cancel: 'Cancelar',
        danger: true,
      }).then((yes) => {
        if (!yes) return
        drop.disabled = true
        window.office
          .deleteProfileMemory(profile.id)
          .then(() => {
            area.value = ''
            hint.textContent = 'Sem memória.'
            toast('Memória apagada.', 'ok')
          })
          .catch((err) => toast(cleanError(err), 'err'))
          .finally(() => (drop.disabled = false))
      })
    })
    return field(`${profile.name} (${profile.id})`, area, hint)
  })
  const el = modal(
    'Memória dos perfis',
    [
      h(
        'div',
        { class: 'field-hint' },
        icon('eye', 14),
        h(
          'span',
          {},
          'A memória fica salva localmente e só entra no contexto da Luna quando você pede uma consulta; nessa consulta, o resumo pode ser enviado ao Claude. Não inclua transcrições brutas, credenciais ou segredos. A validação reconhece alguns formatos, mas não garante que todo segredo seja detectado.',
        ),
      ),
      ...body,
    ],
    [h('button', { class: 'btn', type: 'button', onclick: close }, 'Fechar')],
    close,
  )
  root.append(el)
}
