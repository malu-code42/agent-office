import type { StudyCard, StudyCardSections, StudyCardSummary, StudyNoteSnapshot, StudyNotesRead } from '@shared/study-cards'
import { announce } from './a11y'
import { h } from './dom'
import { cleanError, modal } from './modals/common'
import { dressStudyWindow, STUDY_WHO } from './study-kit'

type Toast = (text: string, kind?: 'info' | 'ok' | 'err') => void
type Tab = 'notes' | 'cards'
type View = { kind: 'list' } | { kind: 'note'; note: StudyNoteSnapshot } | { kind: 'card'; card: StudyCard } | { kind: 'write' }

const NO_TOPIC = 'Sem tópico'
const emptySections = (): StudyCardSections => ({
  information: '',
  examplePractice: '',
  application: '',
  connections: '',
  sources: '',
  connectionsPending: true,
  sourcesPending: true,
})

/** Items grouped by topic, alphabetical, with "Sem tópico" last. */
function byTopic<T>(items: T[], topicOf: (item: T) => string | undefined): [string, T[]][] {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const topic = topicOf(item)?.trim() || NO_TOPIC
    groups.set(topic, [...(groups.get(topic) ?? []), item])
  }
  return [...groups].sort(([a], [b]) => (a === NO_TOPIC ? 1 : b === NO_TOPIC ? -1 : a.localeCompare(b, 'pt-BR')))
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** The student writes the idea, the example and the application; Claude only proposes connections, sources and feedback. */
export async function openStudyCards(root: HTMLElement, toast: Toast): Promise<void> {
  let noteLibrary: StudyNotesRead = { notes: [] }
  let cards: StudyCardSummary[] = []
  let warning = ''
  let errorText = ''
  let busy = false
  let tab: Tab = 'notes'
  let view: View = { kind: 'list' }
  let looseTitle = ''
  let looseText = ''
  let token = ''
  let sourceSnapshots: StudyNoteSnapshot[] | null = null
  let feedback = ''
  let assisted = false
  let title = ''
  let sections: StudyCardSections = emptySections()
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

  const back = (): void => {
    view = { kind: 'list' }
    render()
  }
  const backButton = (): HTMLElement => h('button', { class: 'btn', type: 'button', disabled: busy || undefined, onclick: back }, '‹ Voltar à lista')

  // ---- lista: abas, notas e cartões digitais, em cartões quadrados por tópico ----
  const tabs = (): HTMLElement =>
    h(
      'div',
      { class: 'sc-tabs', role: 'tablist' },
      ...(
        [
          ['notes', 'Notas', noteLibrary.notes.length],
          ['cards', 'Cartões digitais', cards.length],
        ] as const
      ).map(([id, label, count]) =>
        h(
          'button',
          {
            class: 'sc-tab',
            type: 'button',
            role: 'tab',
            'aria-selected': String(tab === id),
            onclick: () => {
              tab = id
              render()
            },
          },
          label,
          h('span', { class: 'sc-count' }, String(count)),
        ),
      ),
    )

  const looseForm = (): HTMLElement =>
    h(
      'section',
      { class: 'sc-box' },
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
        class: 'input',
        rows: '3',
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
          style: 'align-self: flex-start',
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

  const topicHead = (name: string, count: string): HTMLElement => h('div', { class: 'sc-topic' }, h('h3', {}, name), h('span', { class: 'sc-chip' }, count))

  const noteSquare = (note: StudyNoteSnapshot): HTMLElement =>
    h(
      'div',
      { class: `sc-sq${selected.has(note.id) ? ' selected' : ''}` },
      h(
        'button',
        {
          class: 'sc-sq-open',
          type: 'button',
          'aria-label': `Abrir nota ${note.title}`,
          onclick: () => {
            view = { kind: 'note', note }
            render()
          },
        },
        h('span', { class: 'sc-sq-title' }, note.title),
        h('span', { class: 'sc-sq-ref' }, note.sourceRef),
        h('span', { class: 'sc-sq-body' }, h('span', { class: 'sc-sq-label' }, 'Nota'), h('span', { class: 'sc-sq-text' }, noteBody(note))),
        h('span', { class: 'sc-sq-more' }, 'ler tudo ›'),
      ),
      h('input', {
        class: 'sc-sq-check',
        type: 'checkbox',
        checked: selected.has(note.id),
        disabled: busy || undefined,
        'aria-label': `Selecionar nota ${note.title}`,
        onchange: (event: Event) => {
          if ((event.currentTarget as HTMLInputElement).checked) selected.add(note.id)
          else selected.delete(note.id)
          render()
        },
      }),
    )

  const cardSquare = (card: StudyCardSummary): HTMLElement =>
    h(
      'div',
      { class: 'sc-sq' },
      h(
        'button',
        {
          class: 'sc-sq-open',
          type: 'button',
          disabled: busy || undefined,
          'aria-label': `Abrir cartão ${card.title}`,
          onclick: () => void openCard(card.id),
        },
        h('span', { class: 'sc-sq-title' }, card.title),
        h(
          'span',
          { class: 'sc-sq-parts sc-sq-body' },
          ...(
            [
              ['Ideia', card.preview.information],
              ['Exemplo', card.preview.examplePractice],
              ['Aplicação', card.preview.application],
            ] as const
          )
            .filter(([, text]) => text)
            .map(([label, text]) => h('span', {}, h('span', { class: 'sc-sq-label' }, label), h('span', { class: 'sc-sq-text small' }, text))),
        ),
        h(
          'span',
          { class: 'sc-sq-tags' },
          card.connectionsPending ? h('span', { class: 'sc-chip warn' }, 'Conexões pendentes') : null,
          card.sourcesPending ? h('span', { class: 'sc-chip warn' }, 'Fontes pendentes') : null,
          card.originChanged ? h('span', { class: 'sc-chip warn', role: 'status' }, 'Origem alterada') : null,
          card.physicalWritten ? h('span', { class: 'sc-chip ok' }, 'Cópia física') : null,
        ),
        h('span', { class: 'sc-sq-more' }, 'abrir ›'),
      ),
    )

  const listView = (): HTMLElement[] => {
    const notes = byTopic(noteLibrary.notes, (note) => note.topic)
    const digital = byTopic(cards, (card) => card.topic)
    return [
      tabs(),
      ...(warning ? [h('p', { class: 'field-hint', role: 'status' }, warning)] : []),
      ...(tab === 'notes'
        ? [
            looseForm(),
            h('p', { class: 'field-hint' }, 'Escolha as notas que sustentam o cartão. Clique numa nota para lê-la inteira.'),
            ...(notes.length
              ? notes.map(([topic, items]) =>
                  h('div', { class: 'sc-group' }, topicHead(topic, plural(items.length, 'nota', 'notas')), h('div', { class: 'sc-grid' }, ...items.map(noteSquare))),
                )
              : [h('p', { class: 'field-hint' }, 'Não há notas geradas pelo fluxo do Office em notas-estudo.md. Nenhum arquivo foi alterado.')]),
          ]
        : digital.length
          ? digital.map(([topic, items]) =>
              h('div', { class: 'sc-group' }, topicHead(topic, plural(items.length, 'cartão', 'cartões')), h('div', { class: 'sc-grid' }, ...items.map(cardSquare))),
            )
          : [h('p', { class: 'field-hint' }, 'Ainda não há cartões digitais salvos.')]),
    ]
  }

  // ---- nota aberta ----
  const noteView = (note: StudyNoteSnapshot): HTMLElement[] => [
    h('div', { class: 'sc-crumb' }, backButton(), h('h3', {}, note.title), note.topic ? h('span', { class: 'sc-chip' }, note.topic) : null),
    h(
      'div',
      { class: 'sc-blk' },
      h('span', { class: 'sc-bl' }, 'Nota'),
      h('span', { class: 'sc-sq-ref' }, `Fonte: ${note.sourceRef} · versão ${note.hash.slice(0, 12)}`),
      h('div', { class: 'sc-box-tone' }, noteBody(note)),
    ),
    h(
      'label',
      { class: 'sc-pending' },
      h('input', {
        type: 'checkbox',
        checked: selected.has(note.id),
        onchange: (event: Event) => {
          if ((event.currentTarget as HTMLInputElement).checked) selected.add(note.id)
          else selected.delete(note.id)
          renderFoot()
        },
      }),
      'Usar esta nota no cartão',
    ),
  ]

  // ---- cartão digital aberto ----
  const part = (label: string, text: string, tone: string, mono = false): HTMLElement =>
    h(
      'div',
      { class: `sc-blk ${tone}` },
      h('span', { class: 'sc-bl' }, label),
      h('div', { class: `sc-box-tone${mono ? ' sc-mono' : ''}` }, text || '—'),
    )

  const cardView = (card: StudyCard): HTMLElement[] => {
    const summary = cards.find((item) => item.id === card.id)
    const topic = card.sourceSnapshots.find((snapshot) => snapshot.topic)?.topic
    return [
      h('div', { class: 'sc-crumb' }, backButton(), h('h3', {}, card.title), topic ? h('span', { class: 'sc-chip' }, topic) : null),
      h(
        'div',
        { class: 'sc-chips' },
        card.sections.connectionsPending ? h('span', { class: 'sc-chip warn' }, 'Conexões pendentes') : null,
        card.sections.sourcesPending ? h('span', { class: 'sc-chip warn' }, 'Fontes pendentes') : null,
        summary?.originChanged ? h('span', { class: 'sc-chip warn' }, 'Origem alterada · snapshot preservado') : null,
        h('span', { class: 'sc-chip' }, `Criado em ${new Date(card.createdAt).toLocaleDateString('pt-BR')}`),
        h('span', { class: `sc-chip${card.physicalWritten ? ' ok' : ''}` }, card.physicalWritten ? 'Cópia física escrita' : 'Cópia física: não escrita'),
      ),
      h(
        'div',
        { class: 'sc-cg' },
        part('Ideia', card.sections.information, 'k1'),
        part('Exemplo', card.sections.examplePractice, 'k2'),
        part('Aplicação', card.sections.application, 'k3'),
      ),
      part('Conexões · Claude', card.sections.connections, 'k4', true),
      part('Fontes · Claude', card.sections.sources, 'k5', true),
      h(
        'div',
        { class: 'sc-origin' },
        `Notas de origem: ${card.sourceSnapshots.map((source) => `${source.title} · versão ${source.hash.slice(0, 12)}`).join(' · ')} (preservadas)`,
      ),
    ]
  }

  const openCard = async (id: string): Promise<void> => {
    if (busy) return
    busy = true
    errorText = ''
    render()
    try {
      view = { kind: 'card', card: await window.office.readStudyCard(id) }
    } catch (error) {
      errorText = cleanError(error)
      toast(errorText, 'err')
    } finally {
      busy = false
      render()
    }
  }

  // ---- escrever: 1 notas, 2 escrever, 3 conexões e fontes ----
  const authoredReady = (): boolean =>
    !!title.trim() && !!sections.information.trim() && !!sections.examplePractice.trim() && !!sections.application.trim()

  const steps = (): HTMLElement =>
    h(
      'div',
      { class: 'sc-steps' },
      ...(
        [
          ['Notas', `${sourceSnapshots?.length ?? 0} escolhida(s)`],
          ['Escrever', 'ideia, exemplo e aplicação, seus'],
          ['Conexões e fontes', assisted ? 'revise e salve' : 'com ajuda do Claude'],
        ] as const
      ).map(([name, note], index) => {
        const now = index === (assisted ? 2 : 1)
        return h(
          'div',
          { class: `sc-step${now ? ' now' : index < (assisted ? 2 : 1) ? ' done' : ''}` },
          h('span', { class: 'sc-num' }, index < (assisted ? 2 : 1) ? '✓' : String(index + 1)),
          h('span', {}, h('b', {}, name), h('small', {}, note)),
        )
      }),
    )

  const textField = (key: 'information' | 'examplePractice' | 'application' | 'connections' | 'sources', label: string, tone: string, rows: string, mono = false): HTMLElement =>
    h(
      'div',
      { class: `sc-blk ${tone}` },
      h('span', { class: 'sc-bl' }, label),
      h('textarea', {
        class: `sc-box-tone${mono ? ' sc-mono' : ''}`,
        rows,
        maxlength: '20000',
        'aria-label': label,
        value: sections[key],
        disabled: busy || undefined,
        oninput: (event: Event) => {
          sections = { ...sections, [key]: (event.currentTarget as HTMLTextAreaElement).value }
          renderFoot()
        },
      }),
    )

  const pending = (key: 'connectionsPending' | 'sourcesPending'): HTMLElement =>
    h(
      'label',
      { class: 'sc-pending' },
      h('input', {
        type: 'checkbox',
        checked: sections[key],
        disabled: busy || undefined,
        onchange: (event: Event) => {
          sections = { ...sections, [key]: (event.currentTarget as HTMLInputElement).checked }
        },
      }),
      'Ainda precisa de revisão',
    )

  const writeView = (): HTMLElement[] => [
    steps(),
    ...(sourceSnapshots ?? []).map((source) => h('p', { class: 'sc-origin' }, `${source.title} · ${source.sourceRef} · versão ${source.hash.slice(0, 12)}`)),
    h(
      'div',
      { class: 'sc-blk k1' },
      h('span', { class: 'sc-bl' }, 'Título'),
      h('input', {
        class: 'sc-box-tone',
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
    h(
      'div',
      { class: 'sc-cg' },
      textField('information', 'Ideia', 'k1', '9'),
      textField('examplePractice', 'Exemplo', 'k2', '4'),
      textField('application', 'Aplicação', 'k3', '4'),
    ),
    h(
      'div',
      { class: 'sc-help' },
      h(
        'div',
        {},
        h('b', {}, 'Ajuda do Claude'),
        h(
          'div',
          { class: 'field-hint' },
          'Sugere conexões (wikilinks para cartões e notas existentes) e fontes, e comenta seu texto sem reescrevê-lo. Você pode pedir de novo depois de editar.',
        ),
      ),
      h(
        'button',
        { class: 'btn btn-primary', type: 'button', disabled: busy || !authoredReady() || undefined, onclick: () => void assist() },
        busy ? 'Consultando…' : assisted ? 'Pedir feedback de novo' : 'Pedir conexões, fontes e feedback',
      ),
    ),
    ...(feedback
      ? [h('div', { class: 'sc-feedback', role: 'status' }, h('span', { class: 'sc-sq-label' }, 'Feedback do Claude · não é salvo'), h('p', {}, feedback))]
      : []),
    ...(assisted
      ? [
          textField('connections', 'Conexões · Claude', 'k4', '4', true),
          pending('connectionsPending'),
          textField('sources', 'Fontes · Claude', 'k5', '3', true),
          pending('sourcesPending'),
        ]
      : []),
  ]

  const leaveDraft = (): void => {
    sourceSnapshots = null
    sections = emptySections()
    title = ''
    token = ''
    feedback = ''
    assisted = false
  }

  /** Step 1 → 2: nothing is sent anywhere; the student starts writing. */
  const start = async (): Promise<void> => {
    if (busy || !selected.size) return
    busy = true
    errorText = ''
    render()
    try {
      const result = await window.office.startStudyCardDraft([...selected])
      leaveDraft()
      token = result.token
      sourceSnapshots = result.sourceSnapshots
      view = { kind: 'write' }
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
    if (busy || !authoredReady()) return
    busy = true
    errorText = ''
    render()
    try {
      const result = await window.office.assistStudyCard(token, {
        title,
        information: sections.information,
        examplePractice: sections.examplePractice,
        application: sections.application,
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

  const button = (label: string, onclick: () => void, kind = '', disabled = false): HTMLElement =>
    h('button', { class: `btn${kind ? ` ${kind}` : ''}`, type: 'button', disabled: disabled || undefined, onclick }, label)

  const renderFoot = (): void => {
    const footer: HTMLElement[] = []
    if (view.kind === 'write') {
      footer.push(
        button(
          'Aprovar e salvar cartão',
          () => {
            const approved = { title, sections: { ...sections } }
            void run(async () => {
              const saved = await window.office.saveStudyCardDraft(token, approved)
              if (!saved) return null
              leaveDraft()
              selected.clear()
              view = { kind: 'list' }
              tab = 'cards'
              return saved
            }, 'Cartão digital salvo no Obsidian. A cópia física continua pendente.')
          },
          'btn-primary',
          busy || !authoredReady(),
        ),
        button(
          'Voltar sem salvar',
          () => {
            leaveDraft()
            view = { kind: 'list' }
            render()
          },
          '',
          busy,
        ),
      )
    } else if (view.kind === 'card') {
      const card = view.card
      footer.push(
        button(
          card.physicalWritten ? 'Cópia física escrita · desmarcar' : 'Marquei a cópia física como escrita',
          () =>
            void run(async () => {
              const result = await window.office.setStudyCardPhysicalWritten(card.id, !card.physicalWritten)
              view = { kind: 'card', card: await window.office.readStudyCard(card.id) }
              return result
            }, card.physicalWritten ? 'Cópia física desmarcada.' : 'Cópia física marcada como escrita.'),
          '',
          busy,
        ),
        button('Voltar à lista', back, '', busy),
      )
    } else if (view.kind === 'note') {
      footer.push(
        button(`Escrever cartão (${selected.size} ${selected.size === 1 ? 'nota' : 'notas'})`, () => void start(), 'btn-primary', busy || selected.size < 1),
        button('Voltar à lista', back, 'btn-small', busy),
      )
    } else if (tab === 'notes') {
      footer.push(
        button(
          busy ? 'Preparando…' : `Escrever cartão (${selected.size} ${selected.size === 1 ? 'nota' : 'notas'})`,
          () => void start(),
          'btn-primary',
          busy || selected.size < 1,
        ),
      )
    } else {
      footer.push(button('Recarregar origens', () => void reload(), '', busy))
    }
    footer.push(h('div', { class: 'grow' }), button('Fechar', () => el.remove()))
    actions.replaceChildren(...footer)
  }

  const render = (): void => {
    const head =
      view.kind === 'write'
        ? ['Novo cartão', `${sourceSnapshots?.length ?? 0} nota(s) · você escreve, o Claude liga e cita`]
        : view.kind === 'card'
          ? ['Cartão digital', 'cada cartão é escrito à mão']
          : view.kind === 'note'
            ? ['Nota de estudo', 'o texto inteiro da nota']
            : ['Notas e cartões de estudo', 'As notas do ciclo viram cartões · cada cartão é escrito à mão']
    window_.setTitle(head[0]!)
    window_.setSubtitle(head[1]!)
    content.replaceChildren(
      ...(errorText ? [h('p', { class: 'study-cards-error', role: 'alert' }, errorText)] : []),
      ...(view.kind === 'write' ? writeView() : view.kind === 'card' ? cardView(view.card) : view.kind === 'note' ? noteView(view.note) : listView()),
    )
    renderFoot()
  }

  const reload = async (): Promise<void> => {
    busy = true
    await refresh()
    busy = false
    render()
  }

  const el = modal('Notas e cartões de estudo', [content], [actions], () => el.remove())
  el.querySelector('.modal-foot')?.classList.add('study-modal-foot')
  const window_ = dressStudyWindow(
    el.querySelector('.modal') as HTMLElement,
    { who: STUDY_WHO.cards, subtitle: 'As notas do ciclo viram cartões · cada cartão é escrito à mão' },
    'xl',
  )
  root.append(el)
  await refresh()
  render()
  actions.querySelector<HTMLButtonElement>('button')?.focus()
  announce('Biblioteca de notas e cartões aberta.')
}

/** The note without the machine markers: what the student wrote, under its heading. */
function noteBody(note: StudyNoteSnapshot): string {
  return note.text
    .split('\n')
    .filter((line) => !/^<!--/.test(line) && !/^##\s/.test(line) && !/^(Fonte|Tópico):/.test(line))
    .join('\n')
    .trim()
}
