import type { StudyCardDraft, StudyCardSections, StudyCardSummary, StudyNoteSnapshot, StudyNotesRead } from '@shared/study-cards'
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

/** Cards are separate Obsidian documents; only selected note snapshots enter a Claude draft. */
export async function openStudyCards(root: HTMLElement, toast: Toast): Promise<void> {
  let noteLibrary: StudyNotesRead = { notes: [] }
  let cards: StudyCardSummary[] = []
  let warning = ''
  let errorText = ''
  let busy = false
  let looseTitle = ''
  let looseText = ''
  let token = ''
  let draft: StudyCardDraft | null = null
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
      'Selecione uma ou mais notas. O processo principal pedirá confirmação antes de enviar apenas os snapshots selecionados ao Claude.',
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

  const draftView = (): HTMLElement[] => {
    if (!draft || !sections) return []
    const titleInput = h('input', {
      class: 'input',
      value: title,
      maxlength: '200',
      'aria-label': 'Título do cartão',
      disabled: busy || undefined,
      oninput: (event: Event) => (title = (event.currentTarget as HTMLInputElement).value),
    })
    const fields = (Object.keys(SECTION_LABELS) as SectionField[]).map((section) => {
      const control = h('textarea', {
        class: 'input study-card-section-input',
        rows: section === 'information' || section === 'examplePractice' ? '6' : '4',
        maxlength: '20000',
        'aria-label': SECTION_LABELS[section],
        value: sections![section],
        disabled: busy || undefined,
        oninput: (event: Event) => {
          sections = { ...sections!, [section]: (event.currentTarget as HTMLTextAreaElement).value }
        },
      })
      const pendingKey = section === 'connections' ? 'connectionsPending' : section === 'sources' ? 'sourcesPending' : null
      return h(
        'section',
        { class: 'study-card-section' },
        h('h3', {}, SECTION_LABELS[section]),
        control,
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
    })
    return [
      h(
        'p',
        { class: 'field-hint' },
        'Revise e edite o rascunho. Conexões e fontes sem evidência ficam marcadas como pendentes. Nada é salvo até você aprovar.',
      ),
      ...draft.sourceSnapshots.map((source) =>
        h('p', { class: 'study-card-source-ref' }, `${source.title} · ${source.sourceRef} · versão ${source.hash.slice(0, 12)}`),
      ),
      h('label', { class: 'study-cycle-field' }, h('span', { class: 'field-label' }, 'Título'), titleInput),
      ...fields,
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

  const render = (): void => {
    content.replaceChildren(
      ...(errorText ? [h('p', { class: 'study-cards-error', role: 'alert' }, errorText)] : []),
      ...(draft && sections ? draftView() : [...notesView(), ...cardList()]),
    )
    const footer: HTMLElement[] = []
    if (draft && sections) {
      footer.push(
        h(
          'button',
          {
            class: 'btn btn-primary',
            type: 'button',
            disabled: busy || !title.trim() || !sections.information.trim() || !sections.examplePractice.trim() || undefined,
            onclick: () => {
              const approved = { title, sections: { ...sections! } }
              void run(async () => {
                const saved = await window.office.saveStudyCardDraft(token, approved)
                if (!saved) return null
                draft = null
                sections = null
                token = ''
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
              draft = null
              sections = null
              token = ''
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
            onclick: () => void generate(),
          },
          busy ? 'Preparando…' : `Gerar rascunho (${selected.size} notas)`,
        ),
      )
    }
    footer.push(h('div', { class: 'grow' }), h('button', { class: 'btn', type: 'button', onclick: () => el.remove() }, 'Fechar'))
    actions.replaceChildren(...footer)
  }

  const reload = async (): Promise<void> => {
    busy = true
    await refresh()
    busy = false
    render()
  }

  const generate = async (): Promise<void> => {
    if (busy || !selected.size) return
    busy = true
    errorText = ''
    render()
    try {
      const result = await window.office.generateStudyCardDraft([...selected])
      if (!result) {
        toast('Geração cancelada; nenhuma nota foi enviada.', 'info')
        return
      }
      token = result.token
      draft = result.draft
      sections = { ...result.draft.sections }
      title = result.draft.title
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
