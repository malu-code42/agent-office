import type { StudyCardSections, StudyCardSummary, StudyNoteSnapshot, StudyNotesRead } from '@shared/study-cards'
import { announce } from './a11y'
import { h } from './dom'
import { cleanError, modal } from './modals/common'
import { dressStudyWindow, STUDY_WHO } from './study-kit'

type Toast = (text: string, kind?: 'info' | 'ok' | 'err') => void
type SectionField = 'information' | 'examplePractice' | 'connections' | 'sources'

const SECTION_LABELS: Record<SectionField, string> = {
  information: 'Informação',
  examplePractice: 'Exemplo/Prática',
  connections: 'Conexões',
  sources: 'Fontes',
}

/** The student writes the idea and the example; Claude only proposes these two sections (plus feedback). */
const ASSISTED: SectionField[] = ['connections', 'sources']

/** Cards are separate Obsidian documents; only selected note snapshots and the student's text enter a Claude request. */
export async function openStudyCards(root: HTMLElement, toast: Toast): Promise<void> {
  let noteLibrary: StudyNotesRead = { notes: [] }
  let cards: StudyCardSummary[] = []
  let warning = ''
  let errorText = ''
  let busy = false
  let looseTitle = ''
  let looseText = ''
  let token = ''
  let sourceSnapshots: StudyNoteSnapshot[] | null = null
  let feedback = ''
  let assisted = false
  let title = ''
  let sections: StudyCardSections | null = null
  const selected = new Set<string>()
  const content = h('div', { class: 'study-cards-content' })
  const actions = h('div', { class: 'review-actions' })

  const refresh = async (): Promise<void> => {
    try {
      const [notes, cardList] = await Promise.all([window.office.readStudyNotes(), window.office.listStudyCards()])
      noteLibrary = notes
      cards = cardList.cards
      warning = [notes.warning, cardList.warning].filter(Boolean).join(' ')
    } catch (error) {
      errorText = cleanError(error)
    }
  }

  const run = async (action: () => Promise<unknown>, success?: string | ((result: unknown) => string | undefined)): Promise<void> => {
    if (busy) return
    busy = true
    errorText = ''
    render()
    try {
      const result = await action()
      const message = typeof success === 'function' ? success(result) : result === null ? undefined : success
      if (message) toast(message, 'ok')
      await refresh()
    } catch (error) {
      errorText = cleanError(error)
      toast(errorText, 'err')
    } finally {
      busy = false
      render()
    }
  }

  const looseForm = (): HTMLElement =>
    h(
      'section',
      { class: 'study-card-section' },
      h('h3', {}, 'Nova nota avulsa'),
      h('p', { class: 'field-hint' }, 'Nota autoral, sem tarefa nem ciclo de estudos. Fica em notas-estudo.md e pode virar cartão.'),
      h('input', {
        class: 'input',
        value: looseTitle,
        maxlength: '200',
        placeholder: 'Título',
        'aria-label': 'Título da nota avulsa',
        disabled: busy || undefined,
        oninput: (event: Event) => (looseTitle = (event.currentTarget as HTMLInputElement).value),
      }),
      h('textarea', {
        class: 'input study-card-section-input',
        rows: '5',
        maxlength: '10000',
        'aria-label': 'Texto da nota avulsa',
        value: looseText,
        disabled: busy || undefined,
        oninput: (event: Event) => (looseText = (event.currentTarget as HTMLTextAreaElement).value),
      }),
      h(
        'button',
        {
          class: 'btn btn-small',
          type: 'button',
          disabled: busy || !looseTitle.trim() || !looseText.trim() || undefined,
          onclick: () =>
            void run(async () => {
              await window.office.saveLooseStudyNote(looseTitle, looseText)
              looseTitle = ''
              looseText = ''
            }, 'Nota avulsa salva em notas-estudo.md.'),
        },
        'Salvar nota avulsa',
      ),
    )

  const notesView = (): HTMLElement[] => [
    looseForm(),
    h(
      'p',
      { class: 'field-hint' },
      'Etapa 1 de 3 · Escolha as notas que sustentam o cartão. Você escreve a ideia e o exemplo; só então o Claude é consultado, com sua confirmação.',
    ),
    ...(warning ? [h('p', { class: 'field-hint', role: 'status' }, warning)] : []),
    ...(noteLibrary.notes.length
      ? noteLibrary.notes.map((note) => noteRow(note))
      : [h('p', { class: 'field-hint' }, 'Não há notas geradas pelo fluxo do Office em notas-estudo.md. Nenhum arquivo foi alterado.')]),
  ]

  const noteRow = (note: StudyNoteSnapshot): HTMLElement =>
    h(
      'label',
      { class: 'study-card-note-row' },
      h('input', {
        type: 'checkbox',
        checked: selected.has(note.id),
        disabled: busy || undefined,
        'aria-label': `Selecionar nota ${note.title}`,
        onchange: (event: Event) => {
          const input = event.currentTarget as HTMLInputElement
          if (input.checked) selected.add(note.id)
          else selected.delete(note.id)
        },
      }),
      h(
        'span',
        {},
        h('strong', {}, note.title),
        h('span', { class: 'study-card-source-ref' }, note.sourceRef),
        h('span', {}, note.text.slice(0, 360)),
      ),
    )

  const field = (section: SectionField, rows: string, hint: string): HTMLElement => {
    const pendingKey = section === 'connections' ? 'connectionsPending' : section === 'sources' ? 'sourcesPending' : null
    return h(
      'section',
      { class: 'study-card-section' },
      h('h3', {}, SECTION_LABELS[section]),
      h('p', { class: 'field-hint' }, hint),
      h('textarea', {
        class: 'input study-card-section-input',
        rows,
        maxlength: '20000',
        'aria-label': SECTION_LABELS[section],
        value: sections![section],
        disabled: busy || undefined,
        oninput: (event: Event) => {
          sections = { ...sections!, [section]: (event.currentTarget as HTMLTextAreaElement).value }
          renderFoot()
        },
      }),
      pendingKey
        ? h(
            'label',
            { class: 'study-card-pending' },
            h('input', {
              type: 'checkbox',
              checked: sections![pendingKey],
              disabled: busy || undefined,
              onchange: (event: Event) => {
                sections = { ...sections!, [pendingKey]: (event.currentTarget as HTMLInputElement).checked }
              },
            }),
            'Ainda precisa de revisão',
          )
        : null,
    )
  }

  const draftView = (): HTMLElement[] => {
    if (!sourceSnapshots || !sections) return []
    return [
      h(
        'p',
        { class: 'field-hint' },
        assisted
          ? 'Etapa 3 de 3 · Revise as conexões e fontes sugeridas, ajuste seu texto com o feedback e salve. Nada é salvo até você aprovar.'
          : 'Etapa 2 de 3 · Escreva o título, a ideia e o exemplo com suas palavras. Depois peça ao Claude conexões, fontes e feedback.',
      ),
      ...sourceSnapshots.map((source) =>
        h('p', { class: 'study-card-source-ref' }, `${source.title} · ${source.sourceRef} · versão ${source.hash.slice(0, 12)}`),
      ),
      h(
        'label',
        { class: 'study-cycle-field' },
        h('span', { class: 'field-label' }, 'Título'),
        h('input', {
          class: 'input',
          value: title,
          maxlength: '200',
          'aria-label': 'Título do cartão',
          disabled: busy || undefined,
          oninput: (event: Event) => {
            title = (event.currentTarget as HTMLInputElement).value
            renderFoot()
          },
        }),
      ),
      field('information', '6', 'Sua ideia, escrita por você.'),
      field('examplePractice', '6', 'Seu exemplo e aplicação, escritos por você.'),
      h(
        'section',
        { class: 'study-card-section' },
        h('h3', {}, 'Ajuda do Claude'),
        h(
          'p',
          { class: 'field-hint' },
          'O Claude sugere conexões (wikilinks para cartões e notas existentes) e fontes, e comenta seu texto sem reescrevê-lo. Você pode pedir de novo depois de editar.',
        ),
        h(
          'button',
          {
            class: 'btn btn-small',
            type: 'button',
            disabled: busy || !authoredReady() || undefined,
            onclick: () => void assist(),
          },
          busy ? 'Consultando…' : assisted ? 'Pedir de novo' : 'Pedir conexões, fontes e feedback',
        ),
        ...(feedback ? [h('p', { class: 'study-card-feedback', role: 'status' }, feedback)] : []),
      ),
      ...(assisted
        ? ASSISTED.map((section) =>
            field(section, '4', section === 'connections' ? 'Sugeridas pelo Claude; ajuste se quiser.' : 'Tiradas das notas escolhidas; ajuste se quiser.'),
          )
        : []),
    ]
  }

  const cardList = (): HTMLElement[] => [
    h(
      'div',
      { class: 'study-cards-list-head' },
      h('h3', {}, 'Cartões digitais'),
      h(
        'button',
        { class: 'btn btn-small', type: 'button', disabled: busy || undefined, onclick: () => void reload() },
        'Recarregar origens',
      ),
    ),
    ...(warning ? [h('p', { class: 'field-hint', role: 'status' }, warning)] : []),
    ...(cards.length
      ? cards.map((card) =>
          h(
            'article',
            { class: 'study-card-row' },
            h('strong', {}, card.title),
            h('span', {}, `Fontes: ${card.sourceRefs.join(' · ')}`),
            card.connectionsPending ? h('span', { class: 'study-card-origin-changed' }, 'Conexões pendentes de revisão') : null,
            card.sourcesPending ? h('span', { class: 'study-card-origin-changed' }, 'Fontes pendentes de revisão') : null,
            card.originChanged
              ? h(
                  'span',
                  { class: 'study-card-origin-changed', role: 'status' },
                  'Origem alterada · o snapshot original do cartão foi preservado.',
                )
              : null,
            h(
              'button',
              {
                class: 'btn btn-small',
                type: 'button',
                disabled: busy || undefined,
                onclick: () =>
                  void run(
                    () => window.office.setStudyCardPhysicalWritten(card.id, !card.physicalWritten),
                    card.physicalWritten ? 'Cópia física desmarcada.' : 'Cópia física marcada como escrita.',
                  ),
              },
              card.physicalWritten ? 'Cópia física escrita · desmarcar' : 'Marquei a cópia física como escrita',
            ),
          ),
        )
      : [h('p', { class: 'field-hint' }, 'Ainda não há cartões digitais salvos.')]),
  ]

  const authoredReady = (): boolean => !!sections && !!title.trim() && !!sections.information.trim() && !!sections.examplePractice.trim()

  const leaveDraft = (): void => {
    sourceSnapshots = null
    sections = null
    token = ''
    feedback = ''
    assisted = false
  }

  const renderFoot = (): void => {
    const footer: HTMLElement[] = []
    if (sourceSnapshots && sections) {
      footer.push(
        h(
          'button',
          {
            class: 'btn btn-primary',
            type: 'button',
            disabled: busy || !authoredReady() || undefined,
            onclick: () => {
              const approved = { title, sections: { ...sections! } }
              void run(async () => {
                const saved = await window.office.saveStudyCardDraft(token, approved)
                if (!saved) return null
                leaveDraft()
                selected.clear()
                return saved
              }, 'Cartão digital salvo no Obsidian. A cópia física continua pendente.')
            },
          },
          'Aprovar e salvar cartão',
        ),
        h(
          'button',
          {
            class: 'btn',
            type: 'button',
            disabled: busy || undefined,
            onclick: () => {
              leaveDraft()
              render()
            },
          },
          'Voltar sem salvar',
        ),
      )
    } else {
      footer.push(
        h(
          'button',
          {
            class: 'btn btn-primary',
            type: 'button',
            disabled: busy || selected.size < 1 || undefined,
            onclick: () => void start(),
          },
          busy ? 'Preparando…' : `Escrever cartão (${selected.size} notas)`,
        ),
      )
    }
    footer.push(h('div', { class: 'grow' }), h('button', { class: 'btn', type: 'button', onclick: () => el.remove() }, 'Fechar'))
    actions.replaceChildren(...footer)
  }

  const render = (): void => {
    content.replaceChildren(
      ...(errorText ? [h('p', { class: 'study-cards-error', role: 'alert' }, errorText)] : []),
      ...(sourceSnapshots && sections ? draftView() : [...notesView(), ...cardList()]),
    )
    renderFoot()
  }

  const reload = async (): Promise<void> => {
    busy = true
    await refresh()
    busy = false
    render()
  }

  /** Step 1 → 2: nothing is sent anywhere; the student starts writing. */
  const start = async (): Promise<void> => {
    if (busy || !selected.size) return
    busy = true
    errorText = ''
    render()
    try {
      const result = await window.office.startStudyCardDraft([...selected])
      token = result.token
      sourceSnapshots = result.sourceSnapshots
      title = ''
      feedback = ''
      assisted = false
      sections = { information: '', examplePractice: '', connections: '', sources: '', connectionsPending: true, sourcesPending: true }
    } catch (error) {
      errorText = cleanError(error)
      toast(errorText, 'err')
    } finally {
      busy = false
      render()
    }
  }

  /** Step 2 → 3: Claude fills connections and sources and comments on the text; the student's own text is never touched. */
  const assist = async (): Promise<void> => {
    if (busy || !sections || !authoredReady()) return
    busy = true
    errorText = ''
    render()
    try {
      const result = await window.office.assistStudyCard(token, {
        title,
        information: sections.information,
        examplePractice: sections.examplePractice,
      })
      if (!result) {
        toast('Pedido cancelado; nada foi enviado.', 'info')
        return
      }
      const { feedback: comments, ...rest } = result
      sections = { ...sections, ...rest }
      feedback = comments
      assisted = true
    } catch (error) {
      errorText = cleanError(error)
      toast(errorText, 'err')
    } finally {
      busy = false
      render()
    }
  }

  const el = modal('Notas e cartões de estudo', [content], [actions], () => el.remove())
  el.querySelector('.modal-foot')?.classList.add('study-modal-foot')
  dressStudyWindow(
    el.querySelector('.modal') as HTMLElement,
    { who: STUDY_WHO.cards, subtitle: 'As notas do ciclo viram cartões · cada cartão é escrito à mão' },
    'l',
  )
  root.append(el)
  await refresh()
  render()
  actions.querySelector<HTMLButtonElement>('button')?.focus()
  announce('Biblioteca de notas e cartões aberta.')
}
