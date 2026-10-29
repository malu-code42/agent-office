import { LUNA_AGENT_ID } from '@shared/luna'
import { h, icon } from './dom'
import { cleanError, modal } from './modals'
import type { State } from '../state'
import type { Toast } from './tasks-complete'

type SourceState = { label: string; state: 'loading' | 'ready' | 'empty' | 'missing' | 'error'; detail: string }

const tomorrowKey = (): string => {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const compact = (text: string, limit = 420): string => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text)

/** Starts a planning conversation in a popup; all writes remain exact inbox proposals requiring confirmation. */
export async function openLunaPlan(root: HTMLElement, state: State, toast: Toast): Promise<void> {
  const tomorrow = tomorrowKey()
  let done = false
  let sending = false
  const sources: SourceState[] = [
    {
      label: 'Tarefas em foco',
      state: state.settings.vaultPath ? 'loading' : 'missing',
      detail: state.settings.vaultPath ? 'Lendo…' : 'Configure um vault para consultar tarefas.',
    },
    {
      label: 'Agenda de amanhã',
      state: state.settings.vaultPath ? 'loading' : 'missing',
      detail: state.settings.vaultPath ? 'Lendo…' : 'Configure um vault para consultar compromissos.',
    },
    {
      label: 'Rotinas pessoais',
      state: state.settings.vaultPath ? 'loading' : 'missing',
      detail: state.settings.vaultPath ? 'Lendo…' : 'Configure um vault para consultar rotinas.',
    },
  ]
  const sourceList = h('ul', { class: 'luna-plan-sources', 'aria-live': 'polite' })
  const retryButton = h('button', { class: 'btn btn-small luna-plan-retry', type: 'button', hidden: true }, 'Tentar ler novamente')
  const renderSources = () =>
    sourceList.replaceChildren(
      ...sources.map((source) =>
        h(
          'li',
          { class: `luna-plan-source luna-plan-source-${source.state}` },
          h('strong', {}, source.label),
          h('span', {}, source.detail),
        ),
      ),
    )
  renderSources()
  const request = h('textarea', {
    class: 'input luna-plan-request',
    rows: 4,
    maxlength: '4000',
    placeholder: 'Ex.: quero reservar um bloco para estudar e terminar a tarefa mais urgente.',
    'aria-label': 'Prioridades para amanhã (opcional)',
  }) as HTMLTextAreaElement
  const finish = () => {
    if (done) return
    done = true
    el.remove()
  }
  const send = async () => {
    if (done || sending) return
    if (sources.some((source) => source.state === 'loading' || source.state === 'error')) {
      toast('Leia novamente as fontes que falharam antes de pedir uma proposta.', 'err')
      return
    }
    sending = true
    sendButton.disabled = true
    const additional = request.value.trim()
    const prompt = [
      `Ajude-me a planejar amanhã (${tomorrow}). Use somente tarefas e compromissos que aparecem no contexto disponível. Primeiro apresente uma proposta clara; não invente horários nem tarefas. Se uma alteração de agenda ou tarefa fizer sentido, prepare-a como proposta com operações exatas para minha confirmação explícita.`,
      ...sources.map((source) => `${source.label}: ${source.detail}`),
      additional ? `Minhas prioridades: ${additional}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')
    try {
      await window.office.send(LUNA_AGENT_ID, prompt)
      finish()
    } catch (err) {
      toast(cleanError(err), 'err')
      sending = false
      sendButton.disabled = false
    }
  }
  const sendButton = h(
    'button',
    { class: 'btn btn-primary', type: 'button', disabled: Boolean(state.settings.vaultPath), onclick: () => void send() },
    icon('send', 14),
    'Pedir proposta à Luna',
  )
  const el = modal(
    'Planejar amanhã',
    [
      h(
        'p',
        { class: 'field-hint' },
        'Confira as fontes disponíveis e informe suas prioridades. Pedir uma proposta não altera arquivos; se houver mudanças, a Luna mostrará as operações exatas na caixa de entrada para revisão e confirmação.',
      ),
      h('p', { class: 'field-label' }, `Fontes para ${tomorrow}`),
      sourceList,
      retryButton,
      request,
    ],
    [h('button', { class: 'btn', type: 'button', onclick: finish }, 'Cancelar'), sendButton],
    finish,
  )
  root.append(el)
  request.focus()

  if (!state.settings.vaultPath) return
  const loadSources = async (): Promise<void> => {
    retryButton.disabled = true
    retryButton.hidden = true
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i]!
      if (source.state === 'error') sources[i] = { ...source, state: 'loading', detail: 'Lendo…' }
    }
    renderSources()
    const [focusResult, agendaResult, routinesResult] = await Promise.allSettled([
      window.office.readFocus(),
      window.office.readAgendaForDate(tomorrow),
      window.office.personalRoutineOverview(),
    ])
    if (done) return
    if (focusResult.status === 'fulfilled') {
      const valid = focusResult.value.filter((item) => !item.missing)
      sources[0] = {
        label: 'Tarefas em foco',
        state: valid.length ? 'ready' : 'empty',
        detail: valid.length ? compact(valid.map((item) => item.text).join(' · ')) : 'Nenhuma tarefa válida em foco.',
      }
    } else
      sources[0] = {
        label: 'Tarefas em foco',
        state: 'error',
        detail: 'Falha ao ler tarefas. Tente novamente antes de pedir uma proposta.',
      }

    if (agendaResult.status === 'fulfilled') {
      const agenda = agendaResult.value
      const entries = agenda.today.date === tomorrow ? agenda.today.entries : []
      const detail = agenda.found
        ? entries.length
          ? compact(
              entries
                .map((entry) =>
                  entry.kind === 'commitment' || entry.kind === 'class'
                    ? `${entry.time} ${entry.title}`
                    : entry.kind === 'task'
                      ? `${entry.time} ${entry.text ?? `tarefa ${entry.id}`}`
                      : entry.text,
                )
                .join(' · '),
            )
          : 'Nenhum compromisso registrado para amanhã.'
        : 'O arquivo agenda.md não existe.'
      sources[1] = { label: 'Agenda de amanhã', state: agenda.found ? (entries.length ? 'ready' : 'empty') : 'missing', detail }
    } else
      sources[1] = {
        label: 'Agenda de amanhã',
        state: 'error',
        detail: 'Falha ao ler agenda.md. Tente novamente antes de pedir uma proposta.',
      }

    if (routinesResult.status === 'fulfilled') {
      const overview = routinesResult.value
      const weekday = new Date(`${tomorrow}T12:00:00Z`).getUTCDay()
      const due = overview.rows.filter((row) => row.cadence === 'diária' || (row.days ?? []).includes(weekday))
      sources[2] = {
        label: 'Rotinas pessoais',
        state: due.length ? 'ready' : 'empty',
        detail: due.length
          ? compact(due.map((row) => `${row.title}${row.time ? ` · ${row.time}` : ''}`).join(' · '))
          : 'Nenhuma rotina recorrente identificada para amanhã.',
      }
    } else
      sources[2] = {
        label: 'Rotinas pessoais',
        state: 'error',
        detail: 'Falha ao ler rotinas pessoais. Tente novamente antes de pedir uma proposta.',
      }
    renderSources()
    retryButton.hidden = !sources.some((source) => source.state === 'error')
    retryButton.disabled = false
    sendButton.disabled = sources.some((source) => source.state === 'loading' || source.state === 'error')
  }
  retryButton.addEventListener('click', () => void loadSources())
  void loadSources()
}
