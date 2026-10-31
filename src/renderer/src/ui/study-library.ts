import type { StudyLibrarySearch } from '@shared/study-library'
import type { StudySourceRecommendation, StudySourceRecommendations } from '@shared/study-sources'
import { announce } from './a11y'
import { h } from './dom'
import { cleanError, modal } from './modals/common'

type Toast = (text: string, kind?: 'info' | 'ok' | 'err') => void

const UNIT: Record<StudySourceRecommendation['kind'], string> = { pdf: 'página', pptx: 'slide', md: 'seção', txt: 'linha' }

/**
 * One of Cora's sources: where to start and where to stop (page, slide, section or line), the
 * relevance scale and, unless `compact`, a short local piece of it. "Abrir" opens the file in
 * the system's app (at its start: page anchors depend on the viewer).
 */
export function studySourceItem(r: StudySourceRecommendation, toast: Toast, compact = false): HTMLElement {
  const unit = UNIT[r.kind]
  const sections = r.startHeading
    ? ` (${r.startHeading}${r.endHeading && r.endHeading !== r.startHeading ? ` → ${r.endHeading}` : ''})`
    : ''
  return h(
    'li',
    { class: `study-source study-source-${r.level}` },
    h(
      'div',
      { class: 'study-source-line' },
      h('span', {}, 'Estude: '),
      h('b', {}, r.title),
      h('span', {}, `, ${r.range}${sections}`),
      h('span', { class: `study-source-level study-source-level-${r.level}`, title: `Pontuação local ${r.score}/100` }, r.label),
    ),
    compact
      ? null
      : h(
          'div',
          { class: 'study-source-range' },
          h('span', {}, `Comece: ${unit} ${r.start}`),
          h('span', {}, `Pare: ${unit} ${r.end}`),
          h('span', { class: 'field-hint' }, r.path),
        ),
    compact ? null : h('p', { class: 'study-source-snippet' }, r.snippet),
    h(
      'button',
      {
        class: 'btn btn-small',
        type: 'button',
        onclick: () => void window.office.openStudySource(r.path).catch((err: unknown) => toast(cleanError(err), 'err')),
      },
      'Abrir',
    ),
  )
}

/** Cora's ranked list for one request, best to worst, or why there is none. */
export function studySourceList(result: StudySourceRecommendations, toast: Toast, compact = false, limit = 12): HTMLElement {
  if (!result.recommendations.length)
    return h(
      'p',
      { class: 'field-hint' },
      `Cora não encontrou fontes locais para “${result.query}”.${result.warning ? ` ${result.warning}` : ''}`,
    )
  return h(
    'div',
    {},
    h('ol', { class: 'study-sources-list' }, ...result.recommendations.slice(0, limit).map((r) => studySourceItem(r, toast, compact))),
    result.warning && !compact ? h('p', { class: 'field-hint' }, result.warning) : null,
  )
}

/**
 * Cora's library, opened from her desk or the shelves of the study floor. Two modes, both local
 * (nothing goes to Claude): "Pedir fontes" ranks the sources for a study request, best to worst,
 * with the start and end page of each; "Pesquisar trechos" finds passages. Linking a passage to a
 * gap stays in the study cycle, where the gap is.
 */
export function openStudyLibrary(root: HTMLElement, toast: Toast, topic = '', mode: 'sources' | 'search' = 'sources'): void {
  let result: StudyLibrarySearch | null = null
  let sources: StudySourceRecommendations | null = null
  let busy = false
  const query = h('input', {
    class: 'input',
    maxlength: '200',
    value: topic.replace(/^\s*\[[^\]]+\]\s*/, ''),
    'aria-label': 'Pedido para a Cora',
  }) as HTMLInputElement
  const button = h('button', { class: 'btn btn-small btn-primary', type: 'submit' }) as HTMLButtonElement
  const list = h('div', { class: 'study-cycle-content', role: 'status' })
  const hint = h('p', { class: 'field-hint' })
  const tabs = (['sources', 'search'] as const).map(
    (m) =>
      h(
        'button',
        {
          class: 'study-library-tab',
          type: 'button',
          role: 'tab',
          onclick: () => {
            mode = m
            render()
            query.focus()
          },
        },
        m === 'sources' ? 'Pedir fontes' : 'Pesquisar trechos',
      ) as HTMLButtonElement,
  )

  const render = () => {
    tabs.forEach((tab, i) => tab.setAttribute('aria-selected', String((i === 0) === (mode === 'sources'))))
    query.placeholder = mode === 'sources' ? 'Ex.: fila, estrutura de dados, introdução para iniciante' : 'Ex.: fila, estrutura de dados'
    hint.textContent =
      mode === 'sources'
        ? 'Diga o tema e o que você precisa. Cora ordena as fontes locais da mais para a menos relevante, com a página (slide ou seção) de início e de fim. Lê .md, .txt, .pptx e .pdf de “study sources”; nada vai ao Claude.'
        : 'Busca trechos nos arquivos locais em “study sources” (.md, .txt, .pptx e .pdf; outros formatos pelo nome). Separe termos com vírgula. O conteúdo não é enviado ao Claude.'
    button.disabled = busy
    button.textContent = busy ? 'Procurando…' : mode === 'sources' ? 'Pedir fontes à Cora' : 'Pesquisar com Cora'
    if (mode === 'sources') {
      list.replaceChildren(...(sources ? [studySourceList(sources, toast)] : []))
      return
    }
    if (!result) return list.replaceChildren()
    const hits = result.hits.map((hit) =>
      h(
        'article',
        { class: 'study-cycle-source-hit' },
        h('b', {}, hit.title),
        h('p', {}, hit.excerpt),
        h('span', { class: 'field-hint' }, hit.line ? `${hit.sourceRef} · linha ${hit.line}` : hit.sourceRef),
      ),
    )
    list.replaceChildren(
      ...(result.warning ? [h('p', { class: 'field-hint' }, result.warning)] : []),
      ...(hits.length ? hits : [h('p', { class: 'field-hint' }, 'Cora não encontrou trechos locais correspondentes.')]),
    )
  }

  const ask = async () => {
    const q = query.value.trim()
    if (!q || busy) return
    busy = true
    render()
    try {
      if (mode === 'sources') {
        sources = (await window.office.recommendStudySources([q]))[0] ?? null
        announce(`${sources?.recommendations.length ?? 0} fontes recomendadas.`)
      } else {
        result = await window.office.searchStudyLibrary(q)
        announce(`${result.hits.length} trechos encontrados.`)
      }
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
        void ask()
      },
    },
    query,
    button,
  )
  const el = modal(
    'Biblioteca · Cora',
    [h('div', { class: 'study-library-tabs', role: 'tablist', 'aria-label': 'O que pedir à Cora' }, ...tabs), hint, form, list],
    [h('div', { class: 'grow' }), h('button', { class: 'btn', type: 'button', onclick: () => el.remove() }, 'Fechar')],
    () => el.remove(),
  )
  el.classList.add('study-library-modal')
  root.append(el)
  render()
  query.focus()
  if (query.value.trim()) void ask()
}
