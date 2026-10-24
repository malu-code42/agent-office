import {
  bookStatusAfterPrompt,
  needsBookCompletionPrompt,
  type MediaAgendaLink,
  type MediaCreateInput,
  type MediaKind,
  type MediaStatus,
} from '@shared/media'
import type { IrisAnswer } from '@shared/iris'
import type { MediaPosterSelection } from '@shared/types'
import { h } from '../dom'
import { readMediaAgendaLinks } from '../media-agenda'
import { cleanError, confirmDialog, field, modal } from './common'

type Toast = (text: string, kind?: 'info' | 'ok' | 'err') => void
type Draft = NonNullable<IrisAnswer['mediaDraft']>
const STATUSES: MediaStatus[] = ['planejado', 'em andamento', 'concluído']
const LABEL: Record<MediaKind, string> = { livro: 'livro', filme: 'filme', jogo: 'jogo' }

/** Local confirmation editor for one Iris suggestion. It writes only after the explicit save action. */
export function openMediaDraft(root: HTMLElement, draft: Draft, toast: Toast): void {
  let done = false
  let poster: MediaPosterSelection | null = null
  const title = h('input', { type: 'text', maxlength: '200', value: draft.title, required: '', autocomplete: 'off' })
  const status = h('select', {}, ...STATUSES.map((value) => h('option', { value, selected: value === 'planejado' }, value)))
  const agenda = h('select', { 'aria-label': 'Vínculo opcional à agenda' }, h('option', { value: '' }, 'Carregando compromissos…'))
  const agendaError = h('div', { class: 'media-error hidden', role: 'alert' })
  const agendaRetry = h(
    'button',
    { class: 'btn btn-small hidden', type: 'button', onclick: () => void loadAgenda() },
    'Tentar carregar novamente',
  )
  const saveError = h('p', { class: 'media-error hidden', role: 'alert' })
  const preview = h('div', { class: 'media-draft-poster-preview hidden' })
  const save = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => void confirm() }, 'Salvar item')

  const finish = (saved: boolean) => {
    if (done) return
    done = true
    el.remove()
    if (!saved && poster) void window.office.discardMediaPoster(poster.token).catch(() => undefined)
  }
  const close = () => finish(false)

  const posterControls = () => {
    const choose = h('button', { class: 'btn', type: 'button', onclick: () => void pickPoster() }, 'Escolher pôster…')
    const clear = h(
      'button',
      {
        class: 'btn media-draft-poster-clear',
        type: 'button',
        onclick: () => {
          if (poster) void window.office.discardMediaPoster(poster.token).catch(() => undefined)
          poster = null
          preview.replaceChildren()
          preview.classList.add('hidden')
        },
      },
      'Remover pôster',
    )
    return [choose, clear, preview]
  }

  const body: HTMLElement[] = [
    h('p', { class: 'hint' }, `A Luna sugeriu incluir este ${LABEL[draft.kind]}. Revise os dados; nada será gravado até você salvar.`),
    field('Título', title),
    field('Estado', status),
    field('Agenda (opcional)', agenda),
    agendaError,
    agendaRetry,
    saveError,
  ]
  let pagesRead: HTMLInputElement | undefined
  let totalPages: HTMLInputElement | undefined
  let favorite: HTMLInputElement | undefined
  let platinum: HTMLInputElement | undefined
  if (draft.kind === 'livro') {
    pagesRead = h('input', { type: 'number', min: '0', step: '1', value: '0' })
    totalPages = h('input', { type: 'number', min: '0', step: '1', placeholder: 'Opcional' })
    body.push(field('Páginas lidas', pagesRead), field('Total de páginas', totalPages))
  } else if (draft.kind === 'jogo') {
    favorite = h('input', { type: 'checkbox' })
    platinum = h('input', {
      type: 'checkbox',
      onchange: () => {
        if (platinum?.checked) status.value = 'concluído'
      },
    })
    status.addEventListener('change', () => {
      if (status.value !== 'concluído' && platinum?.checked) platinum.checked = false
    })
    body.push(field('Favorito', favorite), field('Platinado', platinum))
  } else {
    body.push(field('Pôster (opcional)', h('div', { class: 'media-draft-poster-controls' }, ...posterControls())))
  }

  const confirm = async () => {
    const cleanTitle = title.value.trim()
    if (!cleanTitle || /[\r\n]/.test(cleanTitle)) {
      toast('O título precisa ter de 1 a 200 caracteres, em uma linha.', 'err')
      title.focus()
      return
    }
    let input: MediaCreateInput
    if (draft.kind === 'livro') {
      const pages = Number(pagesRead?.value)
      const total = totalPages?.value.trim() ? Number(totalPages.value) : undefined
      if (!Number.isSafeInteger(pages) || pages < 0 || (total !== undefined && (!Number.isSafeInteger(total) || total < pages))) {
        toast('Confira as páginas lidas e o total de páginas.', 'err')
        pagesRead?.focus()
        return
      }
      input = {
        kind: 'livro',
        title: cleanTitle,
        status: status.value as MediaStatus,
        pagesRead: pages,
        ...(total === undefined ? {} : { totalPages: total }),
      }
    } else if (draft.kind === 'jogo') {
      input = {
        kind: 'jogo',
        title: cleanTitle,
        status: status.value as MediaStatus,
        favorite: favorite!.checked,
        platinum: platinum!.checked,
      }
    } else {
      input = { kind: 'filme', title: cleanTitle, status: status.value as MediaStatus }
    }
    save.setAttribute('disabled', '')
    saveError.classList.add('hidden')
    try {
      if (draft.kind === 'livro' && input.kind === 'livro' && needsBookCompletionPrompt(input.status, input.pagesRead, input.totalPages)) {
        const confirmed = await confirmDialog(root, {
          title: 'Livro concluído?',
          text: 'Você chegou ao total de páginas. Quer marcar este livro como concluído?',
          confirm: 'Marcar concluído',
          cancel: 'Manter estado',
        })
        input = {
          ...input,
          status: bookStatusAfterPrompt(input.status, input.pagesRead, input.totalPages, confirmed),
        }
      }
      const chosenAgenda = agenda.value ? (JSON.parse(agenda.value) as MediaAgendaLink) : undefined
      if (chosenAgenda) input = { ...input, agenda: chosenAgenda }
      await window.office.createMediaItem(input, poster?.token)
      toast('Item adicionado à biblioteca de mídias.', 'ok')
      finish(true)
    } catch (err) {
      const message = cleanError(err)
      saveError.textContent = `Não foi possível salvar o item: ${message}`
      saveError.classList.remove('hidden')
      toast(message, 'err')
      if (poster) {
        void window.office.discardMediaPoster(poster.token).catch(() => undefined)
        poster = null
        preview.replaceChildren()
        preview.classList.add('hidden')
      }
    } finally {
      save.removeAttribute('disabled')
    }
  }

  const loadAgenda = async () => {
    agendaRetry.classList.add('hidden')
    agendaError.classList.add('hidden')
    agenda.replaceChildren(h('option', { value: '' }, 'Carregando compromissos…'))
    try {
      const links = await readMediaAgendaLinks()
      if (done) return
      agenda.replaceChildren(
        h('option', { value: '' }, 'Sem vínculo'),
        ...links.map((link) => h('option', { value: JSON.stringify(link) }, `${link.day} ${link.time} · ${link.title}`)),
      )
    } catch (err) {
      if (done) return
      agendaError.textContent = `Não foi possível carregar os compromissos: ${cleanError(err)}`
      agendaError.classList.remove('hidden')
      agendaRetry.classList.remove('hidden')
      agenda.replaceChildren(h('option', { value: '' }, 'Agenda indisponível'))
    }
  }

  const pickPoster = async () => {
    try {
      const selected = await window.office.pickMediaPoster()
      if (!selected) return
      if (done) {
        void window.office.discardMediaPoster(selected.token).catch(() => undefined)
        return
      }
      if (poster) void window.office.discardMediaPoster(poster.token).catch(() => undefined)
      poster = selected
      preview.replaceChildren(
        h('img', { src: selected.previewDataUrl, alt: 'Prévia do pôster escolhido' }),
        h('span', {}, `${selected.extension.toUpperCase()} · ${Math.ceil(selected.sizeBytes / 1024)} KB`),
      )
      preview.classList.remove('hidden')
    } catch (err) {
      toast(cleanError(err), 'err')
    }
  }

  const el = modal('Revisar item de mídia', body, [h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancelar'), save], close)
  root.append(el)
  title.focus()
  void loadAgenda()
}
