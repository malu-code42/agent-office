import type { StudyLibrarySearch, StudySourceInfo, StudySourceInventory, StudySourceStatus } from '@shared/study-library'
import type { StudySourceRecommendation, StudySourceRecommendations } from '@shared/study-sources'
import { announce } from './a11y'
import { h } from './dom'
import { cleanError, modal } from './modals/common'

type Toast = (text: string, kind?: 'info' | 'ok' | 'err') => void

const UNIT: Record<StudySourceRecommendation['kind'], string> = { pdf: 'página', pptx: 'slide', md: 'seção', txt: 'linha' }

/**
 * One of Cora's sources: where to start and where to stop (page, slide, section or line), the
 * relevance scale and, unless `compact`, a short local piece of it. Clicking the title or
 * "Abrir" opens it: a PDF at its start page in the app's viewer, anything else in the system's app.
 */
export function studySourceItem(r: StudySourceRecommendation, toast: Toast, compact = false): HTMLElement {
  const unit = UNIT[r.kind]
  const sections = r.startHeading
    ? ` (${r.startHeading}${r.endHeading && r.endHeading !== r.startHeading ? ` → ${r.endHeading}` : ''})`
    : ''
  const page = r.kind === 'pdf' ? r.start : undefined
  const open = (): void => void window.office.openStudySource(r.path, page).catch((err: unknown) => toast(cleanError(err), 'err'))
  return h(
    'li',
    { class: `study-source study-source-${r.level}` },
    h(
      'div',
      { class: 'study-source-line' },
      h('span', {}, 'Estude: '),
      h('button', { class: 'study-source-title', type: 'button', title: page ? `Abrir na página ${page}` : 'Abrir', onclick: open }, r.title),
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
        onclick: open,
      },
      page ? `Abrir na p. ${page}` : 'Abrir',
    ),
  )
}

const STATUS_LABEL: Record<StudySourceStatus, string> = {
  lida: 'Lida',
  ocr: 'Precisa de OCR',
  lendo: 'Lendo…',
  'so-nome': 'Só pelo nome',
  grande: 'Grande demais',
  ilegivel: 'Ilegível',
}
/** What each state asks of the user, worst first. */
const STATUS_ORDER: StudySourceStatus[] = ['ilegivel', 'ocr', 'lendo', 'grande', 'so-nome', 'lida']

const fileSize = (bytes: number): string => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

function inventoryRow(s: StudySourceInfo): HTMLElement {
  const detail = [s.ext.replace('.', '').toUpperCase() || 'sem extensão', fileSize(s.size)]
  if (s.pages) detail.push(s.blankPages ? `${s.pages} páginas, ${s.blankPages} sem texto` : `${s.pages} páginas`)
  return h(
    'li',
    { class: `study-inv-row study-inv-${s.status}` },
    h('div', { class: 'study-inv-main' }, h('b', {}, s.name), h('span', { class: 'field-hint' }, s.path)),
    h('span', { class: 'study-inv-detail' }, detail.join(' · ')),
    h('span', { class: `study-inv-status study-inv-status-${s.status}` }, STATUS_LABEL[s.status]),
  )
}

/** Every source Cora has, by what is left to do with it, and a button that asks her to check and fix what is pending. */
function inventoryView(inv: StudySourceInventory, verify: () => void, busy: boolean): HTMLElement[] {
  if (inv.missingFolder) return [h('p', { class: 'field-hint' }, 'A pasta “study sources” ainda não existe no vault.')]
  const count = (status: StudySourceStatus) => inv.sources.filter((s) => s.status === status).length
  const pending = count('ocr') + count('lendo')
  const chips = STATUS_ORDER.filter((status) => count(status)).map((status) =>
    h('span', { class: `study-inv-chip study-inv-status-${status}` }, `${count(status)} · ${STATUS_LABEL[status]}`),
  )
  const sorted = [...inv.sources].sort(
    (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.path.localeCompare(b.path, 'pt-BR'),
  )
  return [
    h(
      'div',
      { class: 'study-inv-summary' },
      h('b', {}, `${inv.sources.length} fonte${inv.sources.length === 1 ? '' : 's'}`),
      ...chips,
      h('div', { class: 'grow' }),
      h(
        'button',
        { class: 'btn btn-small btn-primary', type: 'button', disabled: busy, onclick: verify },
        busy ? 'Verificando…' : pending ? `Verificar e integrar (${pending})` : 'Verificar de novo',
      ),
    ),
    inv.complete ? null : h('p', { class: 'field-hint' }, 'Algumas pastas ou atalhos não foram percorridos.'),
    sorted.length ? h('ul', { class: 'study-inv-list' }, ...sorted.map(inventoryRow)) : h('p', { class: 'field-hint' }, 'Nenhum arquivo na pasta.'),
  ]
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
export function openStudyLibrary(root: HTMLElement, toast: Toast, topic = '', mode: 'sources' | 'search' | 'inventory' = 'sources'): void {
  let inventory: StudySourceInventory | null = null
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
  const tabs = (['sources', 'search', 'inventory'] as const).map(
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
        m === 'sources' ? 'Pedir fontes' : m === 'search' ? 'Pesquisar trechos' : 'Fontes disponíveis',
      ) as HTMLButtonElement,
  )

  const render = () => {
    tabs.forEach((tab, i) => tab.setAttribute('aria-selected', String(i === ['sources', 'search', 'inventory'].indexOf(mode))))
    form.hidden = mode === 'inventory'
    if (mode === 'inventory') {
      hint.textContent =
        'Tudo o que há em “study sources” e o que a Cora consegue fazer com cada arquivo. “Verificar e integrar” termina de ler os PDFs novos e manda os escaneados para o OCR, que roda em segundo plano; depois volte aqui para ver o resultado.'
      list.replaceChildren(...(inventory ? inventoryView(inventory, () => void check(true), busy) : [h('p', { class: 'field-hint' }, 'Lendo a pasta…')]))
      if (!inventory && !busy) void check(false)
      return
    }
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

  const check = async (verify: boolean) => {
    if (busy) return
    busy = true
    render()
    try {
      inventory = await window.office.studySourceInventory(verify)
      if (verify) toast(inventory.ocrQueued ? `${inventory.ocrQueued} PDF(s) escaneado(s) no OCR, em segundo plano.` : 'Nada pendente de OCR.', 'ok')
      announce(`${inventory.sources.length} fontes.`)
    } catch (error) {
      toast(cleanError(error), 'err')
    } finally {
      busy = false
      render()
    }
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

  const form: HTMLElement = h(
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
