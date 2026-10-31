import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseTasksFile } from '../src/shared/tasks'
import { createTaskWriter, type TaskCompletion } from '../src/main/tasks-write'
import { createAgendaWriter, planAddCommitment, planRemoveCommitment } from '../src/main/agenda-write'
import { createMediaWriter } from '../src/main/media-write'
import { createGoalsWriter } from '../src/main/goals-write'
import {
  SLASH_COMMANDS,
  filterCommands,
  parseDay,
  parseSlash,
  parseTime,
  resolveTask,
  runSlash,
  slashKey,
  slashQuery,
  splitArgs,
  type CommandApi,
  type Outcome,
} from '../src/renderer/src/ui/luna-commands'

const NOW = new Date(2026, 9, 30, 10)
const TASKS = [
  '## Casa',
  '- [ ] Lavar louça ^tabc123',
  '- [ ] 05.11.2026 | Casa | Pagar conta ^tpag001',
  '- [ ] Ligar para a escola',
  '- [ ] Ligar para o banco',
  '',
  '## Estudos',
  '- [ ] Ler capítulo 3',
  '',
].join('\n')
const AGENDA = ['# Agenda', '', '## 2026-11-02', '- 09:00 Dentista', ''].join('\n')
const GOALS = [
  '## Correr 5 km',
  '- ID: gabc12345',
  '- Alvo: 5 km',
  '- Prazo: 2026-12-31',
  '- Estado: ativo',
  '- Marco: [ ] 2 km',
  '- Marco: [ ] 3 km',
  '',
].join('\n')

let vault: string
let api: CommandApi
const file = (name: string) => readFileSync(join(vault, name), 'utf8')

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), 'ao-luna-cmd-'))
  writeFileSync(join(vault, 'tarefas.md'), TASKS)
  writeFileSync(join(vault, 'agenda.md'), AGENDA)
  writeFileSync(join(vault, 'objetivos.md'), GOALS)
  // The same writers the IPC handlers use, on a synthetic vault.
  const tasks = createTaskWriter({ now: () => NOW })
  const agenda = createAgendaWriter({ now: () => NOW })
  const media = createMediaWriter({ now: () => NOW })
  const goals = createGoalsWriter({ now: () => NOW })
  const done = new Map<string, TaskCompletion>()
  const focus = new Set<string>()
  const board = () => {
    const text = file('tarefas.md')
    tasks.remember(vault, text)
    return parseTasksFile(text)
  }
  const ref = (t: { id: string } | { line: number }) => ('id' in t ? t.id : t.line)
  const commitment = (c: { day: string; time: string; title: string }, plan: typeof planAddCommitment) => {
    agenda.read(vault)
    const before = agenda.current(vault)
    agenda.write(vault, before, plan(before, c))
  }
  api = {
    readTasks: async () => board(),
    createTask: async (draft) => (board(), { id: tasks.create(vault, draft), board: board() }),
    completeTask: async (t) => {
      board()
      const c = tasks.complete(vault, ref(t))
      done.set(c.id, c)
      return { id: c.id, board: board(), focus: [] }
    },
    undoCompleteTask: async (id) => (tasks.undoComplete(vault, done.get(id)!), { board: board(), focus: [] }),
    rescheduleTask: async (c) => (board(), tasks.reschedule(vault, c.line, c.date), { board: board() }),
    focusTask: async (line) => {
      board()
      focus.add(tasks.assignId(vault, line))
      return { board: board(), focus: [] }
    },
    unfocusTask: async (id) => (focus.delete(id), []),
    readFocus: async () => [...focus].map((id) => ({ id }) as never),
    discardTask: async (d) => (board(), { id: tasks.discard(vault, ref(d.target), d.reason).id, board: board(), focus: [] }),
    reopenTask: vi.fn(async () => ({ status: 'done' as const, list: 'Casa', board: board(), focus: [] })),
    startBarTimer: vi.fn(async () => null),
    pauseBarTimer: vi.fn(async () => ({}) as never),
    resumeBarTimer: vi.fn(async () => ({}) as never),
    resetBarTimer: vi.fn(async () => null),
    addCommitment: async (c) => commitment(c, planAddCommitment),
    removeCommitment: async (c) => commitment(c, planRemoveCommitment),
    createMediaItem: async ({ kind, ...draft }) => (media.read(vault, kind), media.create(vault, kind, draft)),
    readGoals: async () => ({ goals: goals.read(vault).goals, tasks: [] }),
    setGoalMilestone: async (id, index, isDone) => (goals.read(vault), goals.setMilestone(vault, id, index, isDone)),
  }
})
afterEach(() => rmSync(vault, { recursive: true, force: true }))

const run = async (text: string) => (await runSlash(text, api, NOW))!
const done = (o: Outcome) => {
  if (o.kind !== 'done') throw new Error(`esperava done, veio ${o.kind}`)
  return o
}
const form = (o: Outcome) => {
  if (o.kind !== 'form') throw new Error(`esperava form, veio ${o.kind}`)
  return o
}

describe('registro dos comandos', () => {
  it('separa diretos e da Luna, e só os da Luna levam mensagem', () => {
    const kinds = Object.fromEntries(SLASH_COMMANDS.map((c) => [c.name, c.kind]))
    expect(kinds).toMatchObject({ tarefa: 'direct', concluir: 'direct', reagendar: 'direct', foco: 'direct', timer: 'direct' })
    expect(kinds).toMatchObject({ compromisso: 'direct', midia: 'direct', objetivo: 'direct', descartar: 'direct' })
    expect(kinds).toMatchObject({ hoje: 'luna', 'montar-foco': 'luna', paradas: 'luna', semana: 'luna', rotinas: 'luna', estudar: 'luna' })
    for (const c of SLASH_COMMANDS) expect(!!c.prompt).toBe(c.kind === 'luna')
  })

  it('um comando da Luna devolve a mensagem preparada; texto comum não é comando', async () => {
    expect(await run('/hoje')).toEqual({ kind: 'luna', prompt: 'Vamos fazer a revisão do dia.' })
    expect(await runSlash('oi Luna', api, NOW)).toBeNull()
    expect(await runSlash('/inexistente x', api, NOW)).toBeNull()
  })
})

describe('parser', () => {
  it('lê nome e resto, sem diferença de acento ou caixa', () => {
    expect(parseSlash('/Mídia livro Duna')).toMatchObject({ cmd: { name: 'midia' }, rest: 'livro Duna' })
    expect(parseSlash('  /concluir   3 ')).toMatchObject({ cmd: { name: 'concluir' }, rest: '3' })
  })

  it('separa os argumentos de cada comando', () => {
    expect(splitArgs('reagendar', 'pagar conta 10/11')).toEqual({ tarefa: 'pagar conta', data: '10/11' })
    expect(splitArgs('compromisso', '02/11 14:30 Reunião da escola')).toEqual({ data: '02/11', hora: '14:30', titulo: 'Reunião da escola' })
    expect(splitArgs('timer', '15 ler capítulo')).toEqual({ acao: '15', tarefa: 'ler capítulo' })
    expect(splitArgs('timer', 'pausar')).toEqual({ acao: 'pausar', tarefa: undefined })
    expect(splitArgs('objetivo', 'progresso correr 5 km 2')).toEqual({ objetivo: 'correr 5 km', marco: '2' })
    expect(splitArgs('midia', 'filme')).toEqual({ tipo: 'filme', titulo: undefined })
  })

  it('datas dd/mm: ano corrente, o próximo para um dia que passou, e nada para dia inexistente', () => {
    expect(parseDay('10/11', NOW)).toEqual({ iso: '2026-11-10', br: '10.11.2026' })
    expect(parseDay('5/1', NOW)).toEqual({ iso: '2027-01-05', br: '05.01.2027' })
    expect(parseDay('30/10', NOW)?.iso).toBe('2026-10-30')
    expect(parseDay('31.12.27', NOW)?.br).toBe('31.12.2027')
    expect(parseDay('amanhã', NOW)?.iso).toBe('2026-10-31')
    expect(parseDay('31/02', NOW)).toBeNull()
    expect(parseDay('ontem', NOW)).toBeNull()
    expect(parseTime('9h')).toBe('09:00')
    expect(parseTime('9h30')).toBe('09:30')
    expect(parseTime('25:00')).toBeNull()
  })

  it('acha a tarefa por id, linha ou texto; ambígua dá as opções', () => {
    const board = parseTasksFile(TASKS)
    expect(resolveTask(board, 'tpag001')).toMatchObject({ task: { text: 'Pagar conta' } })
    expect(resolveTask(board, '2')).toMatchObject({ task: { id: 'tabc123' } })
    expect(resolveTask(board, 'louca')).toMatchObject({ task: { id: 'tabc123' } })
    const amb = resolveTask(board, 'ligar')
    expect('choices' in amb && amb.choices.map((t) => t.text)).toEqual(['Ligar para a escola', 'Ligar para o banco'])
  })
})

describe('lista de autocompletar', () => {
  it('abre só enquanto o nome está sendo digitado e filtra', () => {
    expect(slashQuery('/')).toBe('')
    expect(slashQuery('/con')).toBe('con')
    expect(slashQuery('/concluir 3')).toBeNull()
    expect(slashQuery('oi')).toBeNull()
    expect(filterCommands('').length).toBe(SLASH_COMMANDS.length)
    expect(filterCommands('co').map((c) => c.name)).toEqual(['concluir', 'compromisso', 'foco', 'montar-foco'])
    expect(filterCommands('míd').map((c) => c.name)).toEqual(['midia'])
  })

  it('teclado: setas giram, Enter e Tab escolhem, Esc fecha', () => {
    expect(slashKey(0, 3, 'ArrowDown')).toEqual({ move: 1 })
    expect(slashKey(2, 3, 'ArrowDown')).toEqual({ move: 0 })
    expect(slashKey(0, 3, 'ArrowUp')).toEqual({ move: 2 })
    expect(slashKey(1, 3, 'End')).toEqual({ move: 2 })
    expect(slashKey(1, 3, 'Enter')).toBe('pick')
    expect(slashKey(1, 3, 'Tab')).toBe('pick')
    expect(slashKey(1, 3, 'Escape')).toBe('close')
    expect(slashKey(1, 3, 'a')).toBeNull()
    expect(slashKey(0, 0, 'Enter')).toBeNull()
  })
})

describe('comandos diretos no vault', () => {
  it('/tarefa com a lista no fim cria nela; sem lista abre o formulário', async () => {
    expect(done(await run('/tarefa Comprar pão Estudos')).text).toMatch(/criada em Estudos/)
    expect(file('tarefas.md')).toMatch(/## Estudos\n- \[ \] Ler capítulo 3\n- \[ \] Estudos \| Comprar pão/)
    const f = form(await run('/tarefa Varrer'))
    expect(f.fields.map((x) => x.name)).toEqual(['texto', 'lista'])
    expect(done(await f.submit({ texto: 'Varrer', lista: 'Casa' })).text).toMatch(/criada em Casa/)
  })

  it('/concluir e o Desfazer', async () => {
    const out = done(await run('/concluir louça'))
    expect(file('tarefas.md')).toContain('- [x] Lavar louça')
    expect(await out.undo!()).toMatch(/voltou/)
    expect(file('tarefas.md')).toContain('- [ ] Lavar louça ^tabc123')
  })

  it('/concluir ambíguo pede a tarefa num formulário', async () => {
    const f = form(await run('/concluir ligar'))
    expect(f.error).toMatch(/não aponta para uma só/)
    expect(f.fields[0]!.options!.map((o) => o.label)).toEqual(['Ligar para a escola', 'Ligar para o banco'])
    done(await f.submit({ tarefa: f.fields[0]!.options![1]!.value }))
    expect(file('tarefas.md')).toContain('- [x] Ligar para o banco')
  })

  it('/reagendar escreve DD.MM.AAAA e desfaz para a data de antes', async () => {
    const out = done(await run('/reagendar tpag001 10/11'))
    expect(file('tarefas.md')).toContain('10.11.2026 | Casa | Pagar conta')
    await out.undo!()
    expect(file('tarefas.md')).toContain('05.11.2026 | Casa | Pagar conta')
    expect(form(await run('/reagendar tpag001 31/02')).error).toMatch(/não é uma data/)
  })

  it('/foco põe a tarefa no foco e o Desfazer tira', async () => {
    const out = done(await run('/foco 8'))
    const id = /Ler capítulo 3 \^(t[a-z0-9]{6})/.exec(file('tarefas.md'))![1]!
    expect((await api.readFocus()).map((f) => f.id)).toEqual([id])
    await out.undo!()
    expect(await api.readFocus()).toEqual([])
  })

  it('/descartar sempre confirma com motivo antes de escrever', async () => {
    const f = form(await run('/descartar tabc123'))
    expect(f.danger).toBe(true)
    expect(file('tarefas.md')).toBe(TASKS)
    expect(form(await f.submit({ motivo: '' })).error).toMatch(/motivo/)
    const out = done(await f.submit({ motivo: 'Já não precisa' }))
    expect(file('tarefas.md')).toContain('- [-] Lavar louça')
    await out.undo!()
    expect(api.reopenTask).toHaveBeenCalledWith({ target: { id: 'tabc123' } })
  })

  it('/timer usa os modos da barra', async () => {
    done(await run('/timer 15 louça'))
    expect(api.startBarTimer).toHaveBeenCalledWith(15, { id: 'tabc123', text: 'Lavar louça' })
    done(await run('/timer'))
    expect(api.startBarTimer).toHaveBeenLastCalledWith(25, null)
    done(await run('/timer pausar'))
    expect(api.pauseBarTimer).toHaveBeenCalled()
    expect(form(await run('/timer 50')).error).toMatch(/25, 5, 15/)
  })

  it('/compromisso marca na agenda e o Desfazer tira', async () => {
    const out = done(await run('/compromisso 02/11 14:30 Reunião da escola'))
    expect(file('agenda.md')).toContain('- 14:30 Reunião da escola')
    await out.undo!()
    expect(file('agenda.md')).toBe(AGENDA)
    expect(form(await run('/compromisso 02/11')).fields.map((x) => x.name)).toEqual(['data', 'hora', 'titulo'])
  })

  it('/midia adiciona à biblioteca', async () => {
    done(await run('/midia livro Duna'))
    expect(file('livros.md')).toContain('## Duna')
    expect(form(await run('/midia disco X')).fields[0]!.name).toBe('tipo')
  })

  it('/objetivo progresso marca o marco e desfaz', async () => {
    const out = done(await run('/objetivo progresso correr 2'))
    expect(file('objetivos.md')).toContain('- Marco: [x] 3 km')
    await out.undo!()
    expect(file('objetivos.md')).toContain('- Marco: [ ] 3 km')
    const f = form(await run('/objetivo progresso correr'))
    expect(f.fields[1]!.options!.map((o) => o.value)).toEqual(['1', '2'])
  })
})
