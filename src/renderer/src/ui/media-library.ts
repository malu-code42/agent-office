import {
  bookStatusAfterPrompt,
  needsBookCompletionPrompt,
  needsAgendaConfirmation,
  posterAfterPicker,
  type MediaAgendaLink,
  type MediaCreateInput,
  type MediaItem,
  type MediaKind,
  type MediaStatus,
  type MediaUpdateInput,
} from '@shared/media'
import { h } from './dom'
import { keepFocus } from './a11y'
import { cleanError, confirmDialog, field, modal } from './modals/common'
import type { Toast } from './tasks-complete'
import { readMediaAgendaLinks, sameMediaAgendaLink } from './media-agenda'

const KINDS: MediaKind[] = ['livro', 'filme', 'jogo']
const LABEL: Record<MediaKind, string> = { livro: 'Livros', filme: 'Filmes', jogo: 'Jogos' }
const STATES: MediaStatus[] = ['planejado', 'em andamento', 'concluído']

/** Media library UI; all persistence and poster path resolution stay in main. The house opens it on the clicked tab. */
export async function openMediaLibrary(root: HTMLElement, toast: Toast, initial: MediaKind = 'livro', categoryOnly = false): Promise<void> {
  let active: MediaKind = initial
  let done = false
  const content = h('div', { class: 'media-library-content', 'aria-live': 'polite' })
  const tabs = h('div', { class: 'media-tabs', role: 'tablist', 'aria-label': 'Categorias de mídia' })
  const addButton = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => void create() }, '')
  const itemLabel = () => (active === 'livro' ? 'livro' : active === 'filme' ? 'filme' : 'jogo')
  const redraw = async () => {
    content.replaceChildren(h('p', { class: 'hint' }, `Carregando ${LABEL[active].toLowerCase()}…`))
    try {
      const items = await window.office.readMedia(active)
      if (done) return
      const cards = await Promise.all(items.map((item) => mediaCard(item, () => void edit(item))))
      keepFocus(content, () =>
        content.replaceChildren(
          items.length
            ? h('ul', { class: 'media-list', 'aria-label': LABEL[active] }, ...cards)
            : h('p', { class: 'hint' }, `Ainda não há ${LABEL[active].toLowerCase()}.`),
        ),
      )
    } catch (err) {
      if (!done)
        content.replaceChildren(
          h('p', { class: 'media-error', role: 'alert' }, cleanError(err)),
          h('button', { class: 'btn', type: 'button', onclick: () => void redraw() }, 'Tentar novamente'),
        )
    }
  }
  const tabsDraw = () =>
    tabs.replaceChildren(
      ...KINDS.map((kind) =>
        h(
          'button',
          {
            class: `btn btn-small${active === kind ? ' btn-primary' : ''}`,
            type: 'button',
            role: 'tab',
            'aria-selected': String(active === kind),
            'aria-controls': 'media-library-panel',
            onclick: () => {
              active = kind
              addButton.textContent = `Adicionar ${itemLabel()}`
              tabsDraw()
              void redraw()
            },
          },
          LABEL[kind],
        ),
      ),
    )
  const create = () => void openEditor(root, active, undefined, toast, () => void redraw())
  const finish = () => {
    done = true
    el.remove()
  }
  const el = modal(
    categoryOnly ? LABEL[initial] : 'Biblioteca de mídias',
    [tabs, content],
    [h('button', { class: 'btn', type: 'button', onclick: finish }, 'Fechar'), addButton],
    finish,
  )
  tabs.hidden = categoryOnly
  content.id = 'media-library-panel'
  root.append(el)
  tabsDraw()
  addButton.textContent = `Adicionar ${itemLabel()}`
  await redraw()

  async function edit(item: MediaItem): Promise<void> {
    await openEditor(root, item.kind, item, toast, () => void redraw())
  }
}

async function mediaCard(item: MediaItem, onEdit: () => void): Promise<HTMLElement> {
  const details: (Node | string | null)[] = [h('strong', {}, item.title), h('span', { class: 'hint' }, item.status)]
  if (item.kind === 'livro')
    details.push(h('span', { class: 'hint' }, `${item.pagesRead}${item.totalPages === undefined ? '' : ` / ${item.totalPages}`} páginas`))
  if (item.kind === 'jogo')
    details.push(
      h(
        'span',
        { class: 'hint' },
        `${item.favorite ? 'Favorito' : ''}${item.favorite && item.platinum ? ' · ' : ''}${item.platinum ? 'Platinado' : ''}`,
      ),
    )
  if (item.agenda) details.push(h('span', { class: 'hint' }, `Agenda: ${item.agenda.day} ${item.agenda.time} · ${item.agenda.title}`))
  if (item.kind === 'filme') {
    const poster = await window.office
      .readMediaPoster(item.id)
      .catch(() => ({ dataUrl: null, error: 'Não foi possível exibir este pôster.' }))
    details.unshift(
      poster.dataUrl
        ? h('img', { class: 'media-poster', src: poster.dataUrl, alt: `Pôster de ${item.title}` })
        : h('div', { class: 'media-poster media-poster-placeholder', role: 'img', 'aria-label': 'Sem pôster disponível' }, 'Sem pôster'),
    )
    if (poster.error && (item.posterPath || item.posterError))
      details.push(h('span', { class: 'hint', role: 'status' }, item.posterError ?? poster.error))
  }
  return h(
    'li',
    { class: 'media-card' },
    h('div', { class: 'media-card-details' }, ...details),
    h('button', { class: 'btn btn-small', type: 'button', 'aria-label': `Editar ${item.title}`, onclick: onEdit }, 'Editar'),
  )
}

async function openEditor(root: HTMLElement, kind: MediaKind, item: MediaItem | undefined, toast: Toast, saved: () => void): Promise<void> {
  const agendaLinks = await readMediaAgendaLinks().catch((err) => {
    toast(cleanError(err), 'err')
    return []
  })
  let poster: Awaited<ReturnType<typeof window.office.pickMediaPoster>> = null
  let currentPosterDataUrl: string | null = null
  let done = false
  const title = h('input', {
    type: 'text',
    maxlength: '200',
    required: '',
    value: item?.title ?? '',
    autocomplete: 'off',
  }) as HTMLInputElement
  const status = h(
    'select',
    {},
    ...STATES.map((state) => h('option', { value: state, selected: state === (item?.status ?? 'planejado') }, state)),
  ) as HTMLSelectElement
  const agenda = h(
    'select',
    { 'aria-label': 'Vínculo opcional à agenda' },
    h('option', { value: '' }, 'Sem vínculo'),
    ...agendaLinks.map((link) =>
      h(
        'option',
        { value: JSON.stringify(link), selected: sameMediaAgendaLink(item?.agenda, link) },
        `${link.day} ${link.time} · ${link.title}`,
      ),
    ),
    ...(item?.agenda && !agendaLinks.some((link) => sameMediaAgendaLink(link, item.agenda))
      ? [
          h(
            'option',
            { value: JSON.stringify(item.agenda), selected: true },
            `${item.agenda.day} ${item.agenda.time} · ${item.agenda.title} (vínculo atual)`,
          ),
        ]
      : []),
  ) as HTMLSelectElement
  const body: HTMLElement[] = [field('Título', title), field('Estado', status), field('Agenda (opcional)', agenda)]
  let pagesRead: HTMLInputElement | undefined
  let totalPages: HTMLInputElement | undefined
  let favorite: HTMLInputElement | undefined
  let platinum: HTMLInputElement | undefined
  const posterPreview = h('div', { class: 'media-poster-editor', 'aria-live': 'polite' })
  const drawPoster = (src?: string) =>
    posterPreview.replaceChildren(
      src
        ? h('img', { src, alt: 'Prévia do pôster' })
        : h('span', {}, item?.kind === 'filme' && item.posterPath ? 'Pôster atual mantido' : 'Sem pôster'),
    )
  if (kind === 'livro') {
    const book = item?.kind === 'livro' ? item : undefined
    pagesRead = h('input', { type: 'number', min: '0', step: '1', value: String(book?.pagesRead ?? 0) }) as HTMLInputElement
    totalPages = h('input', {
      type: 'number',
      min: '0',
      step: '1',
      value: book?.totalPages === undefined ? '' : String(book.totalPages),
      placeholder: 'Opcional',
    }) as HTMLInputElement
    body.push(field('Páginas lidas', pagesRead), field('Total de páginas', totalPages))
  } else if (kind === 'jogo') {
    const game = item?.kind === 'jogo' ? item : undefined
    favorite = h('input', { type: 'checkbox', checked: game?.favorite ?? false }) as HTMLInputElement
    platinum = h('input', {
      type: 'checkbox',
      checked: game?.platinum ?? false,
      onchange: () => {
        if (platinum?.checked) status.value = 'concluído'
      },
    }) as HTMLInputElement
    status.addEventListener('change', () => {
      if (status.value !== 'concluído' && platinum?.checked) platinum.checked = false
    })
    body.push(field('Favorito', favorite), field('Platinado', platinum))
  } else {
    drawPoster()
    const choose = h(
      'button',
      { class: 'btn', type: 'button', onclick: () => void pick() },
      item?.kind === 'filme' && item.posterPath ? 'Substituir pôster…' : 'Escolher pôster…',
    ) as HTMLButtonElement
    body.push(field('Pôster local', h('div', { class: 'media-poster-editor-controls' }, posterPreview, choose)))
    if (item?.kind === 'filme' && item.posterPath) {
      const current = await window.office.readMediaPoster(item.id)
      currentPosterDataUrl = current.dataUrl
      if (currentPosterDataUrl) drawPoster(currentPosterDataUrl)
    }
  }
  const finish = () => {
    if (done) return
    done = true
    el.remove()
    if (poster) void window.office.discardMediaPoster(poster.token).catch(() => undefined)
  }
  const save = h(
    'button',
    { class: 'btn btn-primary', type: 'button', onclick: () => void persist() },
    item ? 'Salvar alterações' : 'Adicionar à biblioteca',
  ) as HTMLButtonElement
  const persist = async () => {
    const cleanTitle = title.value.trim()
    if (!cleanTitle || cleanTitle.length > 200 || /[\r\n]/.test(cleanTitle)) {
      toast('O título precisa ter de 1 a 200 caracteres, em uma linha.', 'err')
      title.focus()
      return
    }
    const chosenAgenda = agenda.value ? (JSON.parse(agenda.value) as MediaAgendaLink) : null
    const common = { title: cleanTitle, status: status.value as MediaStatus, agenda: chosenAgenda }
    const createCommon = { title: cleanTitle, status: status.value as MediaStatus, ...(chosenAgenda ? { agenda: chosenAgenda } : {}) }
    let input: MediaCreateInput | MediaUpdateInput
    if (kind === 'livro') {
      const pages = Number(pagesRead?.value)
      const total = totalPages?.value.trim() ? Number(totalPages.value) : null
      if (!Number.isSafeInteger(pages) || pages < 0 || (total !== null && (!Number.isSafeInteger(total) || total < pages))) {
        toast('Confira as páginas lidas e o total de páginas.', 'err')
        pagesRead?.focus()
        return
      }
      let finalStatus = common.status
      if (item?.kind === 'livro') {
        if (needsBookCompletionPrompt(common.status, pages, total ?? undefined)) {
          const confirmed = await confirmDialog(root, {
            title: 'Livro concluído?',
            text: 'Você chegou ao total de páginas. Quer marcar este livro como concluído?',
            confirm: 'Marcar concluído',
            cancel: 'Manter estado',
          })
          finalStatus = bookStatusAfterPrompt(common.status, pages, total ?? undefined, confirmed)
        }
        input = { kind, id: item.id, ...common, status: finalStatus, pagesRead: pages, totalPages: total }
      } else {
        if (needsBookCompletionPrompt(common.status, pages, total ?? undefined)) {
          const confirmed = await confirmDialog(root, {
            title: 'Livro concluído?',
            text: 'Você chegou ao total de páginas. Quer marcar este livro como concluído?',
            confirm: 'Marcar concluído',
            cancel: 'Manter estado',
          })
          finalStatus = bookStatusAfterPrompt(common.status, pages, total ?? undefined, confirmed)
        }
        input = { kind, ...createCommon, status: finalStatus, pagesRead: pages, ...(total === null ? {} : { totalPages: total }) }
      }
    } else if (kind === 'jogo') {
      const platinumValue = platinum!.checked
      const chosenStatus = platinumValue ? 'concluído' : common.status
      if (item?.kind === 'jogo')
        input = { kind, id: item.id, ...common, status: chosenStatus, favorite: favorite!.checked, platinum: platinumValue }
      else input = { kind, ...createCommon, status: chosenStatus, favorite: favorite!.checked, platinum: platinumValue }
    } else {
      if (item?.kind === 'filme') input = { kind, id: item.id, ...common }
      else input = { kind, ...createCommon }
    }
    if (item && needsAgendaConfirmation(item, input as Partial<MediaItem>) && !(await confirmAgenda(root))) return
    save.disabled = true
    try {
      if (item) await window.office.updateMediaItem(input as MediaUpdateInput, poster?.token)
      else await window.office.createMediaItem(input as MediaCreateInput, poster?.token)
      toast('Biblioteca de mídias atualizada.', 'ok')
      done = true
      el.remove()
      saved()
    } catch (err) {
      const failedPoster = poster
      if (failedPoster) {
        poster = null
        await window.office.discardMediaPoster(failedPoster.token).catch(() => undefined)
        drawPoster(currentPosterDataUrl ?? undefined)
        toast(`${cleanError(err)} Se ainda quiser substituir o pôster, selecione-o novamente.`, 'err')
      } else toast(cleanError(err), 'err')
    } finally {
      save.disabled = false
    }
  }
  const pick = async () => {
    try {
      const next = await window.office.pickMediaPoster()
      if (!next || done) {
        poster = posterAfterPicker(poster, next)
        if (next && done) void window.office.discardMediaPoster(next.token).catch(() => undefined)
        return
      }
      if (poster) void window.office.discardMediaPoster(poster.token).catch(() => undefined)
      poster = next
      drawPoster(next.previewDataUrl)
    } catch (err) {
      toast(cleanError(err), 'err')
    }
  }
  const el = modal(
    item
      ? `Editar ${kind === 'livro' ? 'livro' : kind === 'filme' ? 'filme' : 'jogo'}`
      : `Adicionar ${kind === 'livro' ? 'livro' : kind === 'filme' ? 'filme' : 'jogo'}`,
    body,
    [h('button', { class: 'btn', type: 'button', onclick: finish }, 'Cancelar'), save],
    finish,
  )
  root.append(el)
  title.focus()
}

async function confirmAgenda(root: HTMLElement): Promise<boolean> {
  return confirmDialog(root, {
    title: 'Atualizar item vinculado à agenda?',
    text: 'Este item está vinculado à agenda. Confirme explicitamente a alteração de estado ou progresso. A agenda não será modificada.',
    confirm: 'Confirmar alteração',
    cancel: 'Voltar',
  })
}
