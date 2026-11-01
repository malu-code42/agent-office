import type { StudyLibrarySearch, StudySourceInfo, StudySourceInventory, StudySourceStatus } from '@shared/study-library'
import type { StudySourceRecommendation, StudySourceRecommendations } from '@shared/study-sources'
import { announce } from './a11y'
import { h } from './dom'
import { cleanError, modal } from './modals/common'
import { dressStudyWindow, STUDY_WHO } from './study-kit'

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
      h(
        'button',
        { class: 'study-source-title', type: 'button', title: page ? `Abrir na página ${page}` : 'Abrir', onclick: open },
        r.title,
      ),
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

const fileSize = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

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
    ...(inv.complete ? [] : [h('p', { class: 'field-hint' }, 'Algumas pastas ou atalhos não foram percorridos.')]),
    ...(sorted.length ? inventoryGroups(sorted) : [h('p', { class: 'field-hint' }, 'Nenhum arquivo na pasta.')]),
  ]
}

const NO_SUBJECT = 'Sem disciplina'

/** The subject is the folder under "course materials" / "textbooks" (study sources/<kind>/<subject>/…). */
const subjectOf = (path: string): string => {
  const parts = path.split(/[\\/]/)
  return parts.length > 3 ? parts[2] : NO_SUBJECT
}

/** Sources split by subject, subjects A–Z with the unfiled ones last; the order inside each is kept. */
function inventoryGroups(sources: StudySourceInfo[]): HTMLElement[] {
  const groups = new Map<string, StudySourceInfo[]>()
  for (const s of sources) {
    const key = subjectOf(s.path)
    groups.set(key, [...(groups.get(key) ?? []), s])
  }
  const names = [...groups.keys()].sort((a, b) => (a === NO_SUBJECT ? 1 : b === NO_SUBJECT ? -1 : a.localeCompare(b, 'pt-BR')))
  return names.flatMap((name) => [
    h('h3', { class: 'study-inv-subject' }, name, h('span', { class: 'field-hint' }, ` ${groups.get(name)!.length}`)),
    h('ul', { class: 'study-inv-list' }, ...groups.get(name)!.map(inventoryRow)),
  ])
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

/** One stacked part of the library: a title, what it is for and its own scrolling list. */
function librarySection(title: string, note: string, list: HTMLElement): HTMLElement {
  return h(
    'section',
    { class: 'study-library-section', 'aria-label': title },
    h('h3', { class: 'study-section-title' }, title),
    h('p', { class: 'field-hint study-note' }, note),
    list,
  )
}

/**
 * Cora's library, opened from her desk or the shelves of the study floor. One request, all local
 * (nothing goes to Claude), fills two lists at once: "Pedir fontes" ranks the sources best to
 * worst, with the start and end page of each; "Pesquisar trechos" finds passages. Below them,
 * "Fontes disponíveis" is the inventory of the folder. Linking a passage to a gap stays in the
 * study cycle, where the gap is.
 */
export function openStudyLibrary(root: HTMLElement, toast: Toast, topic = ''): void {
  let inventory: StudySourceInventory | null = null
  let result: StudyLibrarySearch | null = null
  let sources: StudySourceRecommendations | null = null
  let asking = false
  let checking = false
  const query = h('input', {
    class: 'input',
    maxlength: '200',
    value: topic.replace(/^\s*\[[^\]]+\]\s*/, ''),
    placeholder: 'Ex.: fila, estrutura de dados, introdução para iniciante',
    'aria-label': 'Pedido para a Cora',
  }) as HTMLInputElement
  const button = h('button', { class: 'btn btn-primary', type: 'submit' }) as HTMLButtonElement
  const sourcesList = h('div', { class: 'study-library-list', role: 'status' })
  const hitsList = h('div', { class: 'study-library-list', role: 'status' })
  const inventoryList = h('div', { class: 'study-library-list study-library-inventory', role: 'status' })

  const empty = (text: string) => h('p', { class: 'field-hint study-library-empty' }, text)

  const render = () => {
    button.disabled = asking
    button.textContent = asking ? 'Procurando…' : 'Pedir à Cora'
    sourcesList.replaceChildren(
      sources ? studySourceList(sources, toast) : empty(asking ? 'Procurando fontes…' : 'Faça um pedido para ver as fontes em ordem.'),
    )
    if (!result) hitsList.replaceChildren(empty(asking ? 'Procurando trechos…' : 'Os trechos encontrados aparecem aqui.'))
    else {
      const hits = result.hits.map((hit) =>
        h(
          'article',
          { class: 'study-cycle-source-hit' },
          h('b', {}, hit.title),
          h('p', {}, hit.excerpt),
          h('span', { class: 'field-hint' }, hit.line ? `${hit.sourceRef} · linha ${hit.line}` : hit.sourceRef),
        ),
      )
      hitsList.replaceChildren(
        ...(result.warning ? [h('p', { class: 'field-hint' }, result.warning)] : []),
        ...(hits.length ? hits : [empty('Cora não encontrou trechos locais correspondentes.')]),
      )
    }
    inventoryList.replaceChildren(...(inventory ? inventoryView(inventory, () => void check(true), checking) : [empty('Lendo a pasta…')]))
  }

  const check = async (verify: boolean) => {
    if (checking) return
    checking = true
    render()
    try {
      inventory = await window.office.studySourceInventory(verify)
      if (verify)
        toast(inventory.ocrQueued ? `${inventory.ocrQueued} PDF(s) escaneado(s) no OCR, em segundo plano.` : 'Nada pendente de OCR.', 'ok')
      announce(`${inventory.sources.length} fontes.`)
    } catch (error) {
      toast(cleanError(error), 'err')
    } finally {
      checking = false
      render()
    }
  }

  const ask = async () => {
    const q = query.value.trim()
    if (!q || asking) return
    asking = true
    sources = null
    result = null
    render()
    const fail = (error: unknown) => {
      toast(cleanError(error), 'err')
      return null
    }
    const [found, hits] = await Promise.all([
      window.office.recommendStudySources([q]).then((list) => list[0] ?? null, fail),
      window.office.searchStudyLibrary(q).catch(fail),
    ])
    sources = found
    result = hits
    announce(`${sources?.recommendations.length ?? 0} fontes recomendadas e ${result?.hits.length ?? 0} trechos encontrados.`)
    asking = false
    render()
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
    [
      h(
        'p',
        { class: 'field-hint study-note' },
        'Diga o tema e o que você precisa: Cora ordena as fontes de “study sources” (.md, .txt, .pptx e .pdf) com a página de início e de fim e procura trechos nelas. Nada vai ao Claude.',
      ),
      form,
      librarySection('Pedir fontes', 'Da mais para a menos relevante, com onde começar e onde parar.', sourcesList),
      librarySection('Pesquisar trechos', 'Passagens dos arquivos locais que falam do pedido. Separe termos com vírgula.', hitsList),
      librarySection(
        'Fontes disponíveis',
        '“Verificar e integrar” termina de ler os PDFs novos e manda os escaneados para o OCR, em segundo plano.',
        inventoryList,
      ),
    ],
    [h('div', { class: 'grow' }), h('button', { class: 'btn', type: 'button', onclick: () => el.remove() }, 'Fechar')],
    () => el.remove(),
  )
  el.classList.add('study-library-modal')
  el.querySelector('.modal')?.classList.add('study-popup')
  dressStudyWindow(
    el.querySelector('.modal') as HTMLElement,
    { who: STUDY_WHO.cora, subtitle: 'Bibliotecária · lê só os arquivos locais de “study sources”; nada vai ao Claude' },
    'l',
  )
  root.append(el)
  render()
  query.focus()
  void check(false)
  if (query.value.trim()) void ask()
}
