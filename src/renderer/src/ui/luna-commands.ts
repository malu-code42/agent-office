// Luna's slash commands: the registry, the parsing of their arguments and the direct ones' run.
// No DOM here (the panel draws the list, the forms and the result lines), so tests run it in node.
// Direct commands call the same IPC the Tarefas board, the Timer, the agenda, the libraries and the
// Objetivos window use; Luna commands only send a prepared message to her normal session.

import type { OfficeAPI } from '@shared/types'
import { ARCHIVE_LIST, type ParsedBoard, type Task } from '@shared/tasks'
import { BAR_MODES, type BarMode } from '@shared/barTimer'

/** panel = acts on the agent's session (every agent has them); direct/luna = Luna only. */
export type CommandKind = 'direct' | 'luna' | 'panel'

export interface SlashCommand {
  name: string
  kind: CommandKind
  /** The arguments, as the list shows them. */
  args: string
  hint: string
  /** Luna commands: the message sent to her. */
  prompt?: string
}

export const PANEL_COMMANDS: readonly SlashCommand[] = [
  { name: 'clear', kind: 'panel', args: '', hint: 'Limpa a conversa e começa uma sessão nova' },
  { name: 'compact', kind: 'panel', args: '', hint: 'Resume a conversa para liberar memória' },
]

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: 'tarefa', kind: 'direct', args: '<texto> [lista]', hint: 'Cria uma tarefa no tarefas.md' },
  { name: 'concluir', kind: 'direct', args: '<id|nº|texto>', hint: 'Conclui uma tarefa' },
  { name: 'reagendar', kind: 'direct', args: '<id|nº|texto> <dd/mm>', hint: 'Muda a data de uma tarefa' },
  { name: 'foco', kind: 'direct', args: '<id|nº|texto>', hint: 'Põe uma tarefa no foco' },
  { name: 'descartar', kind: 'direct', args: '<id|nº|texto>', hint: 'Descarta uma tarefa, com motivo' },
  { name: 'timer', kind: 'direct', args: '[25|5|15|pausar|continuar|parar] [tarefa]', hint: 'Timer da barra' },
  { name: 'compromisso', kind: 'direct', args: '<dd/mm> <hh:mm> <título>', hint: 'Marca um compromisso na agenda' },
  { name: 'midia', kind: 'direct', args: '<livro|filme|jogo> <título>', hint: 'Adiciona à biblioteca' },
  { name: 'objetivo', kind: 'direct', args: 'progresso <objetivo> <marco nº>', hint: 'Marca um marco como feito' },
  { name: 'hoje', kind: 'luna', args: '', hint: 'Revisão do dia com a Luna', prompt: 'Vamos fazer a revisão do dia.' },
  {
    name: 'montar-foco',
    kind: 'luna',
    args: '',
    hint: 'Luna sugere o foco de hoje',
    prompt:
      'Vamos montar o foco de hoje: leia minhas tarefas e a agenda de hoje e sugira até 3 tarefas para o foco, com o motivo de cada uma. ' +
      'Eu ponho no foco com /foco; não mude nada sem eu pedir.',
  },
  {
    name: 'paradas',
    kind: 'luna',
    args: '',
    hint: 'Tarefas paradas: atrasadas, foco sem avanço, sem data',
    prompt:
      'Liste minhas tarefas paradas: as com data que já passou, as do foco há 3 dias ou mais sem avanço e as sem data há mais de 14 dias. ' +
      'Para cada uma, sugira concluir, reagendar ou descartar, e espere minha resposta antes de mudar algo.',
  },
  {
    name: 'semana',
    kind: 'luna',
    args: '',
    hint: 'Planejar a semana com a Luna',
    prompt:
      'Vamos planejar a semana: leia a agenda dos próximos 7 dias, as tarefas com data e as rotinas pessoais da semana e me proponha uma distribuição. ' +
      'Não mude nada sem eu confirmar.',
  },
  {
    name: 'rotinas',
    kind: 'luna',
    args: '',
    hint: 'Rotinas pessoais da semana',
    prompt:
      'Vamos ver minhas rotinas pessoais desta semana: o que falta distribuir e o que já foi feito. Proponha os dias e só distribua quando eu confirmar.',
  },
  {
    name: 'estudar',
    kind: 'luna',
    args: '',
    hint: 'O que estudar agora',
    prompt:
      'Quero estudar agora: olhe minhas tarefas e a agenda de hoje e sugira o que estudar e por quanto tempo (25, 5 ou 15 minutos no Timer). Não mude nada sem eu pedir.',
  },
]

/** The commands an agent's chat offers: Luna has all of them, every other agent only the panel ones. */
export function commandsFor(builtIn?: string): readonly SlashCommand[] {
  return builtIn === 'luna' ? [...SLASH_COMMANDS, ...PANEL_COMMANDS] : PANEL_COMMANDS
}

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** The text after "/" while the user is still typing the name (no space yet); null closes the list. */
export function slashQuery(text: string): string | null {
  const m = /^\/([^\s/]*)$/.exec(text)
  return m ? m[1]! : null
}

/** Commands for the typed part: names that start with it first, then those that contain it. */
export function filterCommands(query: string, list: readonly SlashCommand[] = SLASH_COMMANDS): SlashCommand[] {
  const q = fold(query)
  const starts = list.filter((c) => c.name.startsWith(q))
  return [...starts, ...list.filter((c) => !starts.includes(c) && c.name.includes(q))]
}

export type SlashKey = { move: number } | 'pick' | 'close' | null

/** A key in the list: arrows move (wrapping), Enter and Tab pick, Esc closes; anything else is typing. */
export function slashKey(index: number, count: number, key: string): SlashKey {
  if (key === 'Escape') return 'close'
  if (!count) return null
  if (key === 'ArrowDown') return { move: (index + 1) % count }
  if (key === 'ArrowUp') return { move: (index - 1 + count) % count }
  if (key === 'Home') return { move: 0 }
  if (key === 'End') return { move: count - 1 }
  if (key === 'Enter' || key === 'Tab') return 'pick'
  return null
}

/** "/nome resto" → the command and its argument text; null when it is not a command (it goes to Luna as is). */
export function parseSlash(text: string, list: readonly SlashCommand[] = SLASH_COMMANDS): { cmd: SlashCommand; rest: string } | null {
  const m = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim())
  if (!m) return null
  const name = fold(m[1]!)
  const cmd = list.find((c) => c.name === name)
  return cmd ? { cmd, rest: (m[2] ?? '').trim() } : null
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** A day as the agenda (AAAA-MM-DD) and tarefas.md (DD.MM.AAAA) write it. */
export interface Day {
  iso: string
  br: string
}

/**
 * dd/mm (or dd.mm, with an optional year), "hoje" or "amanhã". Without a year, a day that already
 * passed this year is the next one's. Null for a day the calendar does not have.
 */
export function parseDay(s: string, now: Date): Day | null {
  const word = fold(s.trim())
  let d: Date
  if (word === 'hoje' || word === 'amanha') {
    d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (word === 'hoje' ? 0 : 1))
  } else {
    const m = /^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2}|\d{4}))?$/.exec(s.trim())
    if (!m) return null
    const day = Number(m[1])
    const month = Number(m[2])
    let year = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : now.getFullYear()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    if (!m[3] && new Date(year, month - 1, day) < today) year++
    d = new Date(year, month - 1, day)
    if (d.getDate() !== day || d.getMonth() !== month - 1) return null
  }
  const [y, mo, da] = [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())]
  return { iso: `${y}-${mo}-${da}`, br: `${da}.${mo}.${y}` }
}

/** 9h, 9h30, 09:30 → "09:30"; null for anything else. */
export function parseTime(s: string): string | null {
  const m = /^(\d{1,2})(?::(\d{2})|h(\d{2})?)$/i.exec(s.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2] ?? m[3] ?? 0)
  return h < 24 && min < 60 ? `${pad(h)}:${pad(min)}` : null
}

/** Open tasks outside the Archive, in board order: what the commands can act on. */
export function openTasks(board: Pick<ParsedBoard, 'lists'>): Task[] {
  return board.lists.filter((l) => l.name !== ARCHIVE_LIST).flatMap((l) => l.tasks.filter((t) => t.status === 'open'))
}

/**
 * A task by id (t + 6), by its line in tarefas.md (the "linha" Luna shows), or by part of its text.
 * One match is the task; none or several give the choices for the form.
 */
export function resolveTask(board: Pick<ParsedBoard, 'lists'>, ref: string): { task: Task } | { choices: Task[] } {
  const open = openTasks(board)
  const r = ref.trim()
  let found: Task[]
  if (/^t[a-z0-9]{6}$/i.test(r)) found = open.filter((t) => t.id?.toLowerCase() === r.toLowerCase())
  else if (/^\d+$/.test(r)) found = open.filter((t) => t.line === Number(r))
  else found = r ? open.filter((t) => fold(t.text).includes(fold(r))) : []
  return found.length === 1 ? { task: found[0]! } : { choices: found.length ? found : open }
}

/** How a task is referred to again (form option, undo): its id when it has one, else its line. */
const refOf = (t: Task): string => t.id ?? String(t.line)

export interface FormField {
  name: string
  label: string
  value?: string
  placeholder?: string
  /** A select instead of a text box. */
  options?: { value: string; label: string }[]
}

export type Outcome =
  | { kind: 'done'; text: string; undo?: () => Promise<string> }
  | {
      kind: 'form'
      title: string
      fields: FormField[]
      confirm: string
      /** Takes something away: the confirm button is red. */
      danger?: boolean
      error?: string
      submit: (values: Record<string, string>) => Promise<Outcome>
    }
  | { kind: 'luna'; prompt: string }

/** What the direct commands use from window.office. */
export type CommandApi = Pick<
  OfficeAPI,
  | 'readTasks'
  | 'createTask'
  | 'completeTask'
  | 'undoCompleteTask'
  | 'rescheduleTask'
  | 'focusTask'
  | 'unfocusTask'
  | 'readFocus'
  | 'discardTask'
  | 'reopenTask'
  | 'startBarTimer'
  | 'pauseBarTimer'
  | 'resumeBarTimer'
  | 'resetBarTimer'
  | 'addCommitment'
  | 'removeCommitment'
  | 'createMediaItem'
  | 'readGoals'
  | 'setGoalMilestone'
>

type Values = Record<string, string | undefined>
type Run = (v: Values, api: CommandApi, now: Date) => Promise<Outcome>

const taskOptions = (tasks: Task[]) => tasks.map((t) => ({ value: refOf(t), label: t.text }))

/** The form for a task that was not found or is ambiguous: the choices, plus the other fields. */
const pickTask = (
  title: string,
  confirm: string,
  choices: Task[],
  ref: string | undefined,
  again: (v: Values) => Promise<Outcome>,
  extra: FormField[] = [],
  danger = false,
): Outcome => ({
  kind: 'form',
  title,
  confirm,
  danger,
  ...(ref ? { error: choices.length ? `“${ref}” não aponta para uma só tarefa aberta: escolha.` : 'Não há tarefas abertas.' } : {}),
  fields: [{ name: 'tarefa', label: 'Tarefa', options: taskOptions(choices) }, ...extra],
  submit: (values) => again(values),
})

const task = async (api: CommandApi, ref: string | undefined) => resolveTask(await api.readTasks(), ref ?? '')

const RUN: Record<string, Run> = {
  async tarefa(v, api) {
    const board = await api.readTasks()
    const lists = board.lists.map((l) => l.name).filter((n) => n !== ARCHIVE_LIST)
    let title = (v.texto ?? '').trim()
    let list = v.lista?.trim()
    if (!list) {
      // "/tarefa comprar pão Casa": a list name at the end is the list.
      const tail = [...lists].sort((a, b) => b.length - a.length).find((n) => fold(title).endsWith(` ${fold(n)}`))
      if (tail) {
        list = tail
        title = title.slice(0, title.length - tail.length).trim()
      } else if (lists.length === 1) list = lists[0]
    }
    if (!title || !list || !lists.includes(list))
      return {
        kind: 'form',
        title: 'Nova tarefa',
        confirm: 'Criar',
        ...(list && !lists.includes(list) ? { error: `A lista “${list}” não existe.` } : {}),
        fields: [
          { name: 'texto', label: 'Tarefa', value: title, placeholder: 'O que fazer' },
          {
            name: 'lista',
            label: 'Lista',
            value: lists.includes(list ?? '') ? list : lists[0],
            options: lists.map((n) => ({ value: n, label: n })),
          },
        ],
        submit: (values) => RUN.tarefa!(values, api, new Date()),
      }
    const { id } = await api.createTask({ title, list })
    return { kind: 'done', text: `Tarefa “${title}” criada em ${list} (${id}).` }
  },

  async concluir(v, api, now) {
    const found = await task(api, v.tarefa)
    if (!('task' in found)) return pickTask('Concluir tarefa', 'Concluir', found.choices, v.tarefa, (x) => RUN.concluir!(x, api, now))
    const { id } = await api.completeTask(found.task.id ? { id: found.task.id } : { line: found.task.line })
    return {
      kind: 'done',
      text: `Concluída: “${found.task.text}”.`,
      undo: async () => (await api.undoCompleteTask(id), `“${found.task.text}” voltou para a lista.`),
    }
  },

  async reagendar(v, api, now) {
    const day = v.data ? parseDay(v.data, now) : null
    const found = await task(api, v.tarefa)
    const dateField: FormField = { name: 'data', label: 'Nova data (dd/mm)', value: v.data ?? '', placeholder: 'dd/mm' }
    if (!('task' in found))
      return pickTask('Reagendar tarefa', 'Reagendar', found.choices, v.tarefa, (x) => RUN.reagendar!(x, api, now), [dateField])
    if (!day)
      return {
        kind: 'form',
        title: 'Reagendar tarefa',
        confirm: 'Reagendar',
        ...(v.data ? { error: `“${v.data}” não é uma data: use dd/mm.` } : {}),
        fields: [{ name: 'tarefa', label: 'Tarefa', value: refOf(found.task), options: taskOptions([found.task]) }, dateField],
        submit: (values) => RUN.reagendar!(values, api, now),
      }
    const before = found.task.date
    await api.rescheduleTask({ line: found.task.line, date: day.br })
    const line = found.task.line
    return {
      kind: 'done',
      text: `“${found.task.text}” reagendada para ${day.br}.`,
      // Only a full date can be written back: the board writes DD.MM.AAAA.
      ...(before && /^\d{2}\.\d{2}\.\d{4}$/.test(before)
        ? { undo: async () => (await api.rescheduleTask({ line, date: before }), `“${found.task.text}” voltou para ${before}.`) }
        : {}),
    }
  },

  async foco(v, api, now) {
    const found = await task(api, v.tarefa)
    if (!('task' in found)) return pickTask('Pôr no foco', 'Pôr no foco', found.choices, v.tarefa, (x) => RUN.foco!(x, api, now))
    const wasIn = !!found.task.id && (await api.readFocus()).some((f) => f.id === found.task.id)
    if (wasIn) return { kind: 'done', text: `“${found.task.text}” já está no foco.` }
    const { board } = await api.focusTask(found.task.line)
    const id = board.lists.flatMap((l) => l.tasks).find((t) => t.line === found.task.line)?.id
    return {
      kind: 'done',
      text: `“${found.task.text}” está no foco.`,
      ...(id ? { undo: async () => (await api.unfocusTask(id), `“${found.task.text}” saiu do foco.`) } : {}),
    }
  },

  async descartar(v, api, now) {
    const found = await task(api, v.tarefa)
    const reason: FormField = { name: 'motivo', label: 'Motivo', value: v.motivo ?? '', placeholder: 'Por que sai da lista' }
    const again = (x: Values) => RUN.descartar!(x, api, now)
    if (!('task' in found)) return pickTask('Descartar tarefa', 'Descartar', found.choices, v.tarefa, again, [reason], true)
    // Always confirmed in the chat, with the reason the board also asks for.
    if (!v.motivo?.trim() || v.confirmado !== 'sim')
      return {
        kind: 'form',
        title: `Descartar “${found.task.text}”?`,
        confirm: 'Descartar',
        danger: true,
        ...(v.confirmado === 'sim' ? { error: 'Escreva o motivo.' } : {}),
        fields: [reason],
        submit: (values) => again({ ...values, tarefa: refOf(found.task), confirmado: 'sim' }),
      }
    const { id } = await api.discardTask({
      target: found.task.id ? { id: found.task.id } : { line: found.task.line },
      reason: v.motivo.trim(),
    })
    return {
      kind: 'done',
      text: `Descartada: “${found.task.text}”.`,
      undo: async () => {
        const r = await api.reopenTask({ target: { id } })
        if (r.status !== 'done') throw new Error('A lista de origem não existe mais: reabra pelo quadro de Tarefas.')
        return `“${found.task.text}” voltou para ${r.list}.`
      },
    }
  },

  async timer(v, api) {
    const word = fold(v.acao ?? '')
    if (word === 'pausar') return (await api.pauseBarTimer(), { kind: 'done', text: 'Timer pausado.' })
    if (word === 'continuar') return (await api.resumeBarTimer(), { kind: 'done', text: 'Timer continua.' })
    if (word === 'parar') return (await api.resetBarTimer(), { kind: 'done', text: 'Timer parado.' })
    const mode = (word ? Number(word) : 25) as BarMode
    if (!(BAR_MODES as readonly number[]).includes(mode))
      return {
        kind: 'form',
        title: 'Timer',
        confirm: 'Começar',
        error: `O Timer tem ${BAR_MODES.join(', ')} minutos.`,
        fields: [
          { name: 'acao', label: 'Minutos', value: '25', options: BAR_MODES.map((m) => ({ value: String(m), label: `${m} min` })) },
          { name: 'tarefa', label: 'Tarefa (opcional)', value: v.tarefa ?? '' },
        ],
        submit: (values) => RUN.timer!(values, api, new Date()),
      }
    let label: { id?: string; text: string } | null = null
    if (v.tarefa?.trim()) {
      const found = resolveTask(await api.readTasks(), v.tarefa)
      label = 'task' in found ? { ...(found.task.id ? { id: found.task.id } : {}), text: found.task.text } : { text: v.tarefa.trim() }
    }
    await api.startBarTimer(mode, label)
    return { kind: 'done', text: `Timer de ${mode} min começou${label ? `: ${label.text}` : ''}.` }
  },

  async compromisso(v, api, now) {
    const day = v.data ? parseDay(v.data, now) : null
    const time = v.hora ? parseTime(v.hora) : null
    const title = (v.titulo ?? '').trim()
    if (!day || !time || !title)
      return {
        kind: 'form',
        title: 'Novo compromisso',
        confirm: 'Marcar',
        ...((v.data && !day) || (v.hora && !time) ? { error: 'Use a data como dd/mm e a hora como hh:mm.' } : {}),
        fields: [
          { name: 'data', label: 'Data (dd/mm)', value: v.data ?? '', placeholder: 'dd/mm' },
          { name: 'hora', label: 'Hora', value: v.hora ?? '', placeholder: 'hh:mm' },
          { name: 'titulo', label: 'Título', value: title },
        ],
        submit: (values) => RUN.compromisso!(values, api, now),
      }
    const c = { day: day.iso, time, title }
    await api.addCommitment(c)
    return {
      kind: 'done',
      text: `Compromisso marcado: ${day.br.slice(0, 5)} ${time} · ${title}.`,
      undo: async () => (await api.removeCommitment(c), `Compromisso “${title}” tirado da agenda.`),
    }
  },

  async midia(v, api) {
    const kind = fold(v.tipo ?? '')
    const title = (v.titulo ?? '').trim()
    if ((kind !== 'livro' && kind !== 'filme' && kind !== 'jogo') || !title)
      return {
        kind: 'form',
        title: 'Nova mídia',
        confirm: 'Adicionar',
        fields: [
          {
            name: 'tipo',
            label: 'Tipo',
            value: kind === 'filme' || kind === 'jogo' ? kind : 'livro',
            options: ['livro', 'filme', 'jogo'].map((k) => ({ value: k, label: k })),
          },
          { name: 'titulo', label: 'Título', value: title },
        ],
        submit: (values) => RUN.midia!(values, api, new Date()),
      }
    const base = { title, status: 'planejado' as const }
    await api.createMediaItem(
      kind === 'livro'
        ? { kind, ...base, pagesRead: 0 }
        : kind === 'jogo'
          ? { kind, ...base, favorite: false, platinum: false }
          : { kind, ...base },
    )
    return { kind: 'done', text: `${kind[0]!.toUpperCase()}${kind.slice(1)} “${title}” adicionado à biblioteca.` }
  },

  async objetivo(v, api, now) {
    const { goals } = await api.readGoals()
    const open = goals.filter((g) => !g.achieved)
    const ref = fold(v.objetivo ?? '')
    const matches = ref ? open.filter((g) => g.id === v.objetivo || fold(g.title).includes(ref)) : []
    const goal = matches.length === 1 ? matches[0]! : null
    const n = Number(v.marco)
    const milestone = goal && Number.isInteger(n) && n >= 1 ? goal.milestones[n - 1] : undefined
    if (!goal || !milestone || milestone.done)
      return {
        kind: 'form',
        title: 'Progresso de objetivo',
        confirm: 'Marcar feito',
        ...(goal && milestone?.done
          ? { error: `O marco ${n} já está feito.` }
          : !open.length
            ? { error: 'Não há objetivos em andamento.' }
            : {}),
        fields: [
          {
            name: 'objetivo',
            label: 'Objetivo',
            value: goal?.id ?? open[0]?.id,
            options: (matches.length ? matches : open).map((g) => ({ value: g.id, label: g.title })),
          },
          {
            name: 'marco',
            label: 'Marco',
            value: v.marco ?? '',
            ...(goal
              ? { options: goal.milestones.flatMap((m, i) => (m.done ? [] : [{ value: String(i + 1), label: `${i + 1}. ${m.text}` }])) }
              : { placeholder: 'nº do marco' }),
          },
        ],
        submit: (values) => RUN.objetivo!(values, api, now),
      }
    await api.setGoalMilestone(goal.id, n - 1, true)
    return {
      kind: 'done',
      text: `Marco feito em “${goal.title}”: ${milestone.text}.`,
      undo: async () => (await api.setGoalMilestone(goal.id, n - 1, false), `Marco “${milestone.text}” reaberto.`),
    }
  },
}

/** The argument text of a direct command, split into its named values (missing ones stay out). */
export function splitArgs(name: string, rest: string): Values {
  const words = rest.split(/\s+/).filter(Boolean)
  switch (name) {
    case 'tarefa':
      return { texto: rest }
    case 'concluir':
    case 'foco':
    case 'descartar':
      return { tarefa: rest || undefined }
    case 'reagendar': {
      const last = words.at(-1)
      return words.length > 1 ? { tarefa: words.slice(0, -1).join(' '), data: last } : { tarefa: rest || undefined }
    }
    case 'timer': {
      const first = fold(words[0] ?? '')
      return /^\d+$/.test(first) || ['pausar', 'continuar', 'parar'].includes(first)
        ? { acao: first, tarefa: words.slice(1).join(' ') || undefined }
        : { tarefa: rest || undefined }
    }
    case 'compromisso':
      return { data: words[0], hora: words[1], titulo: words.slice(2).join(' ') || undefined }
    case 'midia':
      return { tipo: words[0], titulo: words.slice(1).join(' ') || undefined }
    case 'objetivo': {
      // "progresso <objetivo> <marco>": the last number is the milestone, the words between are the goal.
      const args = fold(words[0] ?? '') === 'progresso' ? words.slice(1) : words
      const n = args.length > 1 && /^\d+$/.test(args.at(-1)!) ? args.at(-1) : undefined
      return { objetivo: (n ? args.slice(0, -1) : args).join(' ') || undefined, marco: n }
    }
  }
  return {}
}

/** Runs what the user typed: null when it is not a command (it goes to Luna as a normal message). */
export async function runSlash(text: string, api: CommandApi, now = new Date()): Promise<Outcome | null> {
  const parsed = parseSlash(text)
  if (!parsed) return null
  if (parsed.cmd.kind === 'luna') return { kind: 'luna', prompt: parsed.cmd.prompt! }
  return RUN[parsed.cmd.name]!(splitArgs(parsed.cmd.name, parsed.rest), api, now)
}
