import type { StudyLibrarySearch } from '@shared/study-library'
import { announce } from './a11y'
import { h } from './dom'
import { cleanError, modal } from './modals/common'

type Toast = (text: string, kind?: 'info' | 'ok' | 'err') => void

/**
 * Cora's library, opened from her desk or the shelves of the study floor: a local search
 * in the vault's study sources (nothing goes to Claude). Linking a passage to a gap stays in
 * the study cycle, where the gap is.
 */
export function openStudyLibrary(root: HTMLElement, toast: Toast, topic = ''): void {
  let result: StudyLibrarySearch | null = null
  let busy = false
  const query = h('input', {
    class: 'input',
    maxlength: '200',
    value: topic,
    'aria-label': 'Pesquisar na biblioteca local com Cora',
    placeholder: 'Tópico ou conceito nas fontes locais',
  }) as HTMLInputElement
  const button = h('button', { class: 'btn btn-small', type: 'submit' }, 'Pesquisar com Cora') as HTMLButtonElement
  const list = h('div', { class: 'study-cycle-content', role: 'status' })

  const render = () => {
    button.disabled = busy
    button.textContent = busy ? 'Buscando…' : 'Pesquisar com Cora'
    if (!result) return list.replaceChildren()
    const hits = result.hits.map((hit) =>
      h(
        'article',
        { class: 'study-cycle-source-hit' },
        h('b', {}, hit.title),
        h('p', {}, hit.excerpt),
        h('span', { class: 'field-hint' }, `${hit.sourceRef} · linha ${hit.line}`),
      ),
    )
    list.replaceChildren(
      ...(result.warning ? [h('p', { class: 'field-hint' }, result.warning)] : []),
      ...(hits.length ? hits : [h('p', { class: 'field-hint' }, 'Cora não encontrou trechos locais correspondentes.')]),
    )
  }

  const search = async () => {
    const q = query.value.trim()
    if (!q || busy) return
    busy = true
    render()
    try {
      result = await window.office.searchStudyLibrary(q)
      announce(`${result.hits.length} trechos encontrados.`)
    } catch (error) {
      toast(cleanError(error), 'err')
    } finally {
      busy = false
      render()
    }
  }

  const form = h(
    'form',
    {
      class: 'study-cycle-library-search',
      onsubmit: (e: Event) => {
        e.preventDefault()
        void search()
      },
    },
    query,
    button,
  )
  const el = modal(
    'Biblioteca · Cora',
    [
      h('p', { class: 'field-hint' }, 'A busca lê apenas os arquivos locais em “study sources”. O conteúdo não é enviado ao Claude.'),
      form,
      list,
    ],
    [h('div', { class: 'grow' }), h('button', { class: 'btn', type: 'button', onclick: () => el.remove() }, 'Fechar')],
    () => el.remove(),
  )
  root.append(el)
  query.focus()
  if (topic) void search()
}
