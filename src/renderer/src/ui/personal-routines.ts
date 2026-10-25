import {
  routineDistributionStatusFocusKey,
  type PersonalRoutineOverview,
  type PersonalRoutineWeekRow,
  type RoutineCandidate,
} from '@shared/routine-personal'
import { ARCHIVE_LIST, dayLabel, taskDraftProblem } from '@shared/tasks'
import type { OfficeAPI } from '@shared/types/ipc'
import { announce } from './a11y'
import { h } from './dom'
import { cleanError, modal } from './modals/common'
import { openTaskMenu } from './tasks-move'
import { loadPersonalRoutineOverview } from './personal-routines-model'

type Toast = (text: string, kind?: 'info' | 'ok' | 'err') => void
type RoutineAPI = Pick<
  OfficeAPI,
  | 'personalRoutineOverview'
  | 'confirmPersonalRoutineDistribution'
  | 'readTasks'
  | 'createPersonalRoutineTask'
  | 'resumePersonalRoutineOccurrence'
  | 'openPersonalRoutines'
>

interface Addition {
  objective: string
  list: string
  editing: boolean
  busy: boolean
  error?: string
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const dateLabel = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`

/** The personal routines board. It reads its own overview and never enters the daily-review lifecycle. */
export async function openPersonalRoutinesPanel(root: HTMLElement, toast: Toast): Promise<void> {
  const api: RoutineAPI = window.office
  const content = h('div', { class: 'review-content personal-routines' }, h('p', { class: 'review-hint' }, 'Lendo as rotinas pessoais.'))
  const close = () => backdrop.remove()
  const closeButton = h('button', { class: 'btn btn-primary', type: 'button', onclick: close }, 'Fechar')
  const backdrop = modal('Rotinas pessoais', [content], [closeButton], close)
  root.append(backdrop)
  closeButton.focus()

  let overview: PersonalRoutineOverview
  try {
    overview = await loadPersonalRoutineOverview(api)
  } catch (err) {
    content.replaceChildren(h('div', { class: 'dialog-note', role: 'alert' }, cleanError(err)))
    return
  }

  const additions = new Map<string, Addition>()
  let lists: string[] | null = null
  const additionFor = (key: string): Addition => {
    let addition = additions.get(key)
    if (!addition) {
      addition = { objective: '', list: '', editing: false, busy: false }
      additions.set(key, addition)
    }
    return addition
  }

  const refresh = async (): Promise<void> => {
    overview = await loadPersonalRoutineOverview(api)
    render()
  }

  const chooseList = async (key: string, card: HTMLElement, button: HTMLButtonElement): Promise<void> => {
    const addition = additionFor(key)
    if (addition.busy) return
    button.disabled = true
    button.textContent = 'Lendo listas…'
    try {
      lists ??= (await api.readTasks()).lists.map((list) => list.name).filter((name) => name && name !== ARCHIVE_LIST)
      if (!lists.length) {
        toast('Não encontrei listas no tarefas.md para receber a rotina.', 'err')
        return
      }
      openTaskMenu(
        card,
        'Escolher a lista da rotina',
        lists.map((name) => ({
          text: name,
          choose: () => {
            addition.list = name
            render()
          },
        })),
        'Sem listas no tarefas.md.',
        button,
      )
    } catch (err) {
      toast(cleanError(err), 'err')
    } finally {
      if (button.isConnected) {
        button.disabled = false
        button.textContent = addition.list ? `Lista: ${addition.list} · trocar` : 'Escolher lista'
      }
    }
  }

  const createTask = async (candidate: RoutineCandidate, occurrenceId: string): Promise<void> => {
    const addition = additionFor(occurrenceId)
    if (addition.busy || !candidate.item) return
    const input = {
      title: addition.objective.trim(),
      list: addition.list,
      date: dayLabel(new Date()),
      ...(candidate.item.time ? { time: candidate.item.time } : {}),
    }
    const problem = taskDraftProblem(input, lists ?? (addition.list ? [addition.list] : []))
    if (problem) {
      addition.error = problem
      render()
      return
    }
    addition.busy = true
    addition.error = undefined
    render()
    try {
      await api.createPersonalRoutineTask({
        occurrenceId,
        objective: input.title,
        list: input.list,
        ...(input.time ? { time: input.time } : {}),
      })
      additions.delete(occurrenceId)
      await refresh()
      toast('Tarefa criada e adicionada ao foco.', 'ok')
    } catch (err) {
      addition.error = cleanError(err)
      addition.busy = false
      render()
      toast(addition.error, 'err')
    }
  }

  const resumeOccurrence = async (occurrenceId: string): Promise<void> => {
    try {
      await api.resumePersonalRoutineOccurrence(occurrenceId)
      await refresh()
      toast('Tarefa vinculada retomada no foco.', 'ok')
    } catch (err) {
      toast(cleanError(err), 'err')
      try {
        await refresh()
      } catch (refreshError) {
        toast(cleanError(refreshError), 'err')
      }
    }
  }

  const objectiveForm = (candidate: RoutineCandidate, occurrenceId: string, card: HTMLElement): HTMLElement[] => {
    const addition = additionFor(occurrenceId)
    if (!addition.editing) {
      return [
        h(
          'button',
          {
            class: 'btn btn-small',
            type: 'button',
            onclick: () => {
              addition.editing = true
              render()
            },
          },
          'Definir objetivo e lista',
        ),
      ]
    }
    const problemForCurrent = () =>
      taskDraftProblem(
        {
          title: addition.objective.trim(),
          list: addition.list,
          date: dayLabel(new Date()),
          ...(candidate.item?.time ? { time: candidate.item.time } : {}),
        },
        lists ?? (addition.list ? [addition.list] : []),
      )
    const problem = addition.error ?? problemForCurrent()
    const problemEl = h('div', { class: 'field-hint', role: 'alert', hidden: !problem }, problem ?? '')
    const createButton = h(
      'button',
      {
        class: 'btn btn-small btn-primary',
        type: 'button',
        disabled: !!problem || addition.busy || undefined,
        onclick: () => void createTask(candidate, occurrenceId),
      },
      addition.busy ? 'Criando tarefa…' : 'Criar tarefa e adicionar ao foco',
    ) as HTMLButtonElement
    const objective = h('textarea', {
      class: 'input',
      rows: '2',
      maxlength: '200',
      value: addition.objective,
      placeholder: 'O que você pretende fazer?',
      'aria-label': `Objetivo para ${candidate.item?.title ?? candidate.title ?? 'a rotina'}`,
      disabled: addition.busy || undefined,
      oninput: (event: Event) => {
        addition.objective = (event.currentTarget as HTMLTextAreaElement).value
        addition.error = undefined
        const currentProblem = problemForCurrent()
        problemEl.textContent = currentProblem ?? ''
        problemEl.hidden = !currentProblem
        createButton.disabled = !!currentProblem || addition.busy
      },
    })
    const listButton = h(
      'button',
      {
        class: 'btn btn-small',
        type: 'button',
        disabled: addition.busy || undefined,
        onclick: () => void chooseList(occurrenceId, card, listButton),
      },
      addition.list ? `Lista: ${addition.list} · trocar` : 'Escolher lista',
    ) as HTMLButtonElement
    return [
      h('label', { class: 'review-detail' }, h('span', { class: 'field-label' }, 'Objetivo'), objective),
      problemEl,
      listButton,
      createButton,
      h(
        'button',
        {
          class: 'btn btn-small',
          type: 'button',
          disabled: addition.busy || undefined,
          onclick: () => {
            addition.editing = false
            render()
          },
        },
        'Cancelar',
      ),
    ]
  }

  const distributionRow = (row: PersonalRoutineWeekRow): HTMLElement => {
    const selected = new Set(row.days ?? [])
    const dayInputs = WEEKDAYS.map((name, day) =>
      h(
        'label',
        { class: 'review-routine-day' },
        h('input', {
          type: 'checkbox',
          value: String(day),
          checked: selected.has(day),
          disabled: row.confirmed || undefined,
          'aria-label': `${name} para ${row.title}`,
        }),
        h('span', {}, name),
      ),
    )
    const controls: HTMLElement[] = []
    if (!row.confirmed) {
      controls.push(
        h('div', { class: 'review-routine-days', role: 'group', 'aria-label': `Distribuição semanal de ${row.title}` }, ...dayInputs),
        h(
          'button',
          {
            class: 'btn btn-small btn-primary',
            type: 'button',
            onclick: () => {
              const days = dayInputs.flatMap((item, day) => ((item.querySelector('input') as HTMLInputElement).checked ? [day] : []))
              if (days.length !== row.target) {
                toast(`Escolha exatamente ${row.target} dias.`, 'err')
                return
              }
              void api
                .confirmPersonalRoutineDistribution(row.routineId, days)
                .then((next) => {
                  overview = next
                  render()
                  content.querySelector<HTMLElement>(`[data-focus-key="${routineDistributionStatusFocusKey(row.routineId)}"]`)?.focus({
                    preventScroll: true,
                  })
                  announce(`Distribuição semanal de ${row.title} confirmada.`)
                })
                .catch((err) => toast(cleanError(err), 'err'))
            },
          },
          'Confirmar distribuição da semana',
        ),
      )
    } else {
      const status = row.fixedSchedule
        ? `Dias definidos na nota; ${row.completed} de ${row.target} ocorrências concluídas manualmente.`
        : `Distribuição confirmada; meta de ${row.target}, ${row.completed} concluídas manualmente.`
      controls.push(
        h('div', { class: 'review-routine-days', role: 'group', 'aria-label': `Dias escolhidos para ${row.title}` }, ...dayInputs),
        h(
          'div',
          { class: 'field-hint', role: 'status', tabindex: '-1', 'data-focus-key': routineDistributionStatusFocusKey(row.routineId) },
          status,
        ),
        h(
          'ul',
          { class: 'review-routine-calendar', 'aria-label': `Ocorrências da semana para ${row.title}` },
          ...row.occurrenceIds.map((id) => h('li', {}, dateLabel(id.split(':')[1] ?? id))),
        ),
      )
    }
    return h(
      'section',
      { class: 'review-task', 'aria-label': `Agenda semanal: ${row.title}` },
      h('h3', { class: 'review-task-title' }, row.fixedSchedule ? `${row.title} · dias definidos` : `${row.title} · meta ${row.target}`),
      ...controls,
    )
  }

  const render = (): void => {
    const pendingById = new Map(overview.pending.map((item) => [item.occurrenceId, item]))
    const weekly = overview.rows.filter((row) => row.cadence === 'semanal')
    const daily = overview.rows.filter((row) => row.cadence === 'diária')
    const candidates = overview.candidates
      .filter((candidate) => !candidate.occurrenceId || !pendingById.get(candidate.occurrenceId)?.taskId)
      .map((candidate) => {
        const title = candidate.item?.title ?? candidate.title ?? `Linha ${candidate.line} de rotinas-pessoais.md`
        const card = h('article', { class: `review-task${candidate.kind === 'needsInput' ? ' review-task-missing' : ''}` })
        card.append(h('h3', { class: 'review-task-title' }, title))
        if (candidate.kind === 'needsInput') {
          if (candidate.reason) card.append(h('p', { class: 'field-hint' }, candidate.reason))
          card.append(
            h(
              'button',
              {
                class: 'btn btn-small',
                type: 'button',
                onclick: async () => {
                  try {
                    await api.openPersonalRoutines()
                  } catch (err) {
                    toast(cleanError(err), 'err')
                  }
                },
              },
              'Abrir a nota para corrigir',
            ),
          )
        } else if (candidate.item) {
          const occurrenceId = candidate.occurrenceId
          if (candidate.item.time) card.append(h('p', { class: 'field-hint' }, `Horário: ${candidate.item.time}`))
          if (occurrenceId) card.append(...objectiveForm(candidate, occurrenceId, card))
        }
        return card
      })
    const pending = overview.pending.map((occurrence) => {
      const routine = overview.rows.find((row) => row.routineId === occurrence.routineId)
      const title = routine?.title ?? 'Rotina pessoal'
      const card = h(
        'article',
        { class: 'review-task' },
        h('h3', { class: 'review-task-title' }, `${title} · pendente de ${dateLabel(occurrence.day)}`),
      )
      if (occurrence.taskId) {
        card.append(
          h(
            'button',
            { class: 'btn btn-small', type: 'button', onclick: () => void resumeOccurrence(occurrence.occurrenceId) },
            'Retomar tarefa vinculada',
          ),
        )
      } else {
        const candidate = overview.candidates.find((item) => item.occurrenceId === occurrence.occurrenceId) ?? {
          line: routine?.line ?? 1,
          title,
          kind: 'due' as const,
          item: { title, cadence: routine?.cadence ?? 'diária', ...(routine?.time ? { time: routine.time } : {}) },
          occurrenceId: occurrence.occurrenceId,
        }
        card.append(...objectiveForm(candidate, occurrence.occurrenceId, card))
      }
      return card
    })
    const sections: HTMLElement[] = [
      h(
        'p',
        { class: 'review-hint' },
        `Agenda semanal de ocorrências · ${dateLabel(overview.weekStart)}–${dateLabel(overview.weekEnd)}. A distribuição é sua; só a conclusão manual conta.`,
      ),
      h('h2', {}, 'Agenda semanal'),
      ...(weekly.length ? weekly.map(distributionRow) : [h('p', { class: 'field-hint' }, 'Nenhuma rotina semanal definida.')]),
    ]
    if (daily.length)
      sections.push(
        h('h2', {}, 'Hábitos diários'),
        ...daily.map((row) =>
          h(
            'section',
            { class: 'review-task', 'aria-label': `Rotina diária: ${row.title}` },
            h('h3', { class: 'review-task-title' }, row.title),
            h(
              'p',
              { class: 'field-hint', role: 'status' },
              row.completed ? 'Concluída manualmente hoje.' : 'Aguardando conclusão manual da tarefa vinculada.',
            ),
          ),
        ),
      )
    if (candidates.length) sections.push(h('h2', {}, 'Sugestões e definições que precisam de atenção'), ...candidates)
    if (pending.length) sections.push(h('h2', {}, 'Ocorrências pendentes'), ...pending)
    if (!weekly.length && !daily.length && !candidates.length && !pending.length)
      sections.push(h('p', { class: 'hint' }, 'Nenhuma rotina pessoal precisa de atenção nesta semana.'))
    content.replaceChildren(...sections)
  }

  render()
}
