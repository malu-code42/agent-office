import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IrisDesk, IrisUnavailable, type IrisInterpreter } from '../src/main/iris'
import { createAgendaWriter } from '../src/main/agenda-write'
import { PlanningStore } from '../src/main/planning'
import { applyProposal } from '../src/main/proposals'
import { createTaskWriter } from '../src/main/tasks-write'
import { parseIrisAnswer, proposalOperationSchema } from '../src/main/validate'
import { IRIS_NOT_UNDERSTOOD, IRIS_SOURCE } from '../src/shared/iris'
import { describeOperation, REFUSED_MESSAGE } from '../src/shared/proposals'

type Reply = (context: string, signal: AbortSignal) => Promise<string> | string

/**
 * Íris (AO-13). Every test runs against a temporary vault and a temporary planning.json, never the user's data.
 * The interpreter here is an intérprete sintético: it answers what the test scripts and records what it was sent.
 * No test makes a call to Claude or to any AI.
 */

const DAY = new Date(2026, 9, 17, 10, 30)

const TASKS = [
  '## Casa',
  '- [ ] 16.10.2026 | 09:00 | Casa | Lavar roupa ^tabc123',
  '- [ ] Passar pano ^tdef456',
  '## Estudo',
  '- [ ] Ler capítulo 3 ^t1a2b3c',
  'Texto livre SEGREDO-LIVRE',
  '## Archive',
  '- [x] Tarefa antiga ✅ 01.10.2026 ^tzzz999',
  '- [x] SEGREDO-ARQUIVO ✅ 02.10.2026 ^tyyy888',
  '',
].join('\n')

const AGENDA = [
  '# Agenda',
  '',
  '## 2026-10-16',
  '- 09:00 Reunião de pauta',
  '',
  '## 2026-10-17',
  '- 14:00 Dentista',
  '- 10:30 ↦ ^tabc123',
  '',
  '## 2026-10-19',
  '- 15:00 Reunião de alinhamento',
  '- 15:00 Reunião de alinhamento',
  '',
  '## 2026-12-01',
  '- 08:00 SEGREDO-AGENDA-FUTURA',
  '',
].join('\n')

const REQUEST = 'Lavar roupa amanhã às 15h'
const SECRET_REQUEST = 'SEGREDO-PEDIDO reservar a sala'

let vault: string
let data: string
let calls: unknown[][]

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), 'ao-iris-vault-'))
  data = mkdtempSync(join(tmpdir(), 'ao-iris-data-'))
  writeFileSync(join(vault, 'tarefas.md'), TASKS)
  writeFileSync(join(vault, 'agenda.md'), AGENDA)
  writeFileSync(join(vault, 'notas.md'), 'SEGREDO-NOTA: nota solta do vault')
  calls = []
})

afterEach(() => {
  rmSync(vault, { recursive: true, force: true })
  rmSync(data, { recursive: true, force: true })
})

/** An intérprete sintético: answers with `reply` (or what `reply` returns), records each context it gets. */
class SyntheticInterpreter implements IrisInterpreter {
  readonly sent: string[] = []

  constructor(private reply: Reply) {}

  interpret(context: string, signal: AbortSignal): Promise<string> {
    this.sent.push(context)
    return Promise.resolve(this.reply(context, signal))
  }
}

const json = (value: unknown) => JSON.stringify(value)

function setup(reply: Reply = () => json({ operations: [], question: 'Qual?' }), timeoutMs?: number) {
  const planning = new PlanningStore(data, () => DAY.getTime())
  planning.add('tabc123')
  planning.saveStep('tabc123', 'SEGREDO-PASSO de hoje', '2026-10-17')
  const tasks = createTaskWriter({ now: () => DAY })
  const agenda = createAgendaWriter({ now: () => DAY })
  const interpreter = new SyntheticInterpreter(reply)
  let n = 0
  const desk = new IrisDesk({
    planning,
    tasks,
    agenda,
    interpreter,
    log: { warn: (...args: unknown[]) => calls.push(args) },
    now: () => DAY,
    newId: () => `id-${++n}`,
    timeoutMs,
  })
  return { planning, tasks, agenda, interpreter, desk }
}

const tasksFile = () => readFileSync(join(vault, 'tarefas.md'), 'utf8')
const agendaFile = () => readFileSync(join(vault, 'agenda.md'), 'utf8')

describe('contexto da Íris', () => {
  it('leva só o pedido, os compromissos da semana e as tarefas citadas ou parecidas', () => {
    const { desk } = setup()
    const { context } = desk.prepare(vault, REQUEST)

    expect(context).toContain(REQUEST)
    expect(context).toContain('2026-10-17 14:00 Dentista')
    expect(context).toContain('^tabc123 | Casa | 16.10.2026 09:00 | aberta | Lavar roupa')
    // The day before the week and the day after it are out of the context.
    expect(context).not.toContain('Reunião de pauta')
    expect(context).not.toContain('SEGREDO-AGENDA-FUTURA')
    // Tasks the request does not cite or match are out of the context.
    expect(context).not.toContain('Passar pano')
    expect(context).not.toContain('Ler capítulo 3')
  })

  it('não leva o Archive, o histórico de passos, o texto livre do tarefas.md nem as notas do vault', () => {
    const { desk } = setup()
    const { context } = desk.prepare(vault, REQUEST)

    expect(context).not.toContain('SEGREDO-ARQUIVO')
    expect(context).not.toContain('Tarefa antiga')
    expect(context).not.toContain('SEGREDO-PASSO')
    expect(context).not.toContain('SEGREDO-LIVRE')
    expect(context).not.toContain('SEGREDO-NOTA')
    expect(context).not.toContain('## Archive')
  })

  it('o contexto é texto simples, linha a linha, sem JSON, para o usuário ler antes de enviar', () => {
    const { desk } = setup()
    const { context } = desk.prepare(vault, REQUEST)
    expect(context.split('\n')[0]).toBe('Pedido:')
    expect(context).not.toMatch(/[{}"]/)
  })

  it('pedido vazio ou longo demais é recusado antes de qualquer leitura', () => {
    const { desk } = setup()
    expect(() => desk.prepare(vault, '   ')).toThrow('Escreva o pedido para a Íris.')
    expect(() => desk.prepare(vault, 'x'.repeat(2001))).toThrow('O pedido pode ter até 2000 caracteres.')
  })
})

describe('envio só depois da confirmação', () => {
  it('nada é enviado antes do envio explícito', () => {
    const { desk, interpreter } = setup()
    desk.prepare(vault, REQUEST)
    expect(interpreter.sent).toHaveLength(0)
  })

  it('envia exatamente o texto da prévia, e cancelar descarta sem enviar', async () => {
    const { desk, interpreter } = setup()
    const preview = desk.prepare(vault, REQUEST)
    desk.cancel(preview.token)
    await expect(desk.send(preview.token)).rejects.toThrow('Esse envio não existe mais')
    expect(interpreter.sent).toHaveLength(0)
  })

  it('o envio usa o texto da prévia, não um texto refeito depois', async () => {
    const { desk, interpreter } = setup(() => json({ operations: [], question: 'Qual?' }))
    const preview = desk.prepare(vault, REQUEST)
    await desk.send(preview.token)
    expect(interpreter.sent).toEqual([preview.context])
  })

  it('um envio só vale uma vez', async () => {
    const { desk } = setup(() => json({ operations: [], question: 'Qual?' }))
    const preview = desk.prepare(vault, REQUEST)
    await desk.send(preview.token)
    await expect(desk.send(preview.token)).rejects.toThrow('Esse envio não existe mais')
  })
})

describe('resposta da Íris', () => {
  it('uma resposta válida vira proposta pendente com a fonte "Íris"', async () => {
    const { desk, planning } = setup(() =>
      json({
        operations: [
          { kind: 'reschedule', id: 'tabc123', date: '17.10.2026' },
          { kind: 'add-commitment', day: '2026-10-17', time: '16:00', title: 'Lavar roupa' },
        ],
        question: null,
      }),
    )
    const preview = desk.prepare(vault, REQUEST)
    const result = await desk.send(preview.token)

    expect(result.kind).toBe('proposal')
    const pending = planning.pendingProposals()
    expect(pending).toHaveLength(1)
    expect(pending[0]!.source).toBe(IRIS_SOURCE)
    expect(pending[0]!.operations).toHaveLength(2)
  })

  it('tarefas.md e agenda.md ficam byte a byte iguais até uma proposta confirmada', async () => {
    const before = [readFileSync(join(vault, 'tarefas.md')), readFileSync(join(vault, 'agenda.md'))]
    const { desk, planning, tasks, agenda } = setup(() =>
      json({
        operations: [
          { kind: 'reschedule', id: 'tabc123', date: '17.10.2026' },
          { kind: 'add-commitment', day: '2026-10-17', time: '16:00', title: 'Lavar roupa' },
        ],
        question: null,
      }),
    )
    const preview = desk.prepare(vault, REQUEST)
    await desk.send(preview.token)
    expect([readFileSync(join(vault, 'tarefas.md')), readFileSync(join(vault, 'agenda.md'))]).toEqual(before)

    applyProposal(vault, planning.pendingProposals()[0]!, { tasks, agenda, planning, now: () => DAY })
    expect(tasksFile()).toContain('17.10.2026 | 09:00 | Casa | Lavar roupa ^tabc123')
    expect(agendaFile()).toContain('- 16:00 Lavar roupa')
  })

  it('a confirmação aplica tudo ou nada: se uma operação não cabe mais no arquivo, nada é escrito e a proposta fica pendente', async () => {
    const { desk, planning, tasks, agenda } = setup(() =>
      json({
        operations: [
          { kind: 'reschedule', id: 'tabc123', date: '17.10.2026' },
          { kind: 'remove-commitment', day: '2026-10-17', time: '14:00', title: 'Dentista' },
        ],
        question: null,
      }),
    )
    const preview = desk.prepare(vault, REQUEST)
    await desk.send(preview.token)
    const tasksBefore = tasksFile()
    // agenda.md changes after the proposal was made: the confirmation refuses it, and tarefas.md is not touched.
    writeFileSync(join(vault, 'agenda.md'), AGENDA.replace('- 14:00 Dentista\n', ''))
    tasks.remember(vault, tasksBefore)
    agenda.read(vault)
    expect(() => applyProposal(vault, planning.pendingProposals()[0]!, { tasks, agenda, planning, now: () => DAY })).toThrow()
    expect(tasksFile()).toBe(tasksBefore)
    expect(planning.pendingProposals()).toHaveLength(1)
  })

  it('resposta fora do formato é descartada com a mensagem em português e nenhuma proposta', async () => {
    const { desk, planning } = setup(() => 'Claro! Acho que você quer marcar algo amanhã.')
    const preview = desk.prepare(vault, REQUEST)
    await expect(desk.send(preview.token)).rejects.toThrow(IRIS_NOT_UNDERSTOOD)
    expect(planning.pendingProposals()).toHaveLength(0)
  })

  it('JSON sem operações nem pergunta também é descartado', async () => {
    const { desk, planning } = setup(() => json({ operations: [], question: null }))
    const preview = desk.prepare(vault, REQUEST)
    await expect(desk.send(preview.token)).rejects.toThrow(IRIS_NOT_UNDERSTOOD)
    expect(planning.pendingProposals()).toHaveLength(0)
  })

  it('uma operação desconhecida faz a resposta inteira ser descartada', async () => {
    const { desk, planning } = setup(() => json({ operations: [{ kind: 'apagar', id: 'tabc123' }], question: null }))
    const preview = desk.prepare(vault, REQUEST)
    await expect(desk.send(preview.token)).rejects.toThrow(IRIS_NOT_UNDERSTOOD)
    expect(planning.pendingProposals()).toHaveLength(0)
  })

  it('"concluir" é recusado pelo esquema e pelo processo principal, sem proposta', async () => {
    expect(proposalOperationSchema.safeParse({ kind: 'concluir', id: 'tabc123' }).success).toBe(false)
    expect(proposalOperationSchema.safeParse({ kind: 'complete', id: 'tabc123' }).success).toBe(false)
    expect(() => parseIrisAnswer({ operations: [{ kind: 'concluir', id: 'tabc123' }], question: null })).toThrow(REFUSED_MESSAGE)

    const { desk, planning } = setup(() => json({ operations: [{ kind: 'concluir', id: 'tabc123' }], question: null }))
    const preview = desk.prepare(vault, REQUEST)
    await expect(desk.send(preview.token)).rejects.toThrow(REFUSED_MESSAGE)
    expect(planning.pendingProposals()).toHaveLength(0)
    expect(tasksFile()).toContain('- [ ] 16.10.2026 | 09:00 | Casa | Lavar roupa ^tabc123')
  })

  it('pergunta da Íris: nenhuma proposta, e a pergunta volta ao usuário', async () => {
    const { desk, planning } = setup(() => json({ operations: [], question: 'Qual reunião de amanhã você quer mover?' }))
    const preview = desk.prepare(vault, REQUEST)
    const result = await desk.send(preview.token)
    expect(result).toEqual({ kind: 'question', text: 'Qual reunião de amanhã você quer mover?' })
    expect(planning.pendingProposals()).toHaveLength(0)
  })

  it('referência ambígua (dois compromissos iguais): pergunta e nenhuma operação criada', async () => {
    const { desk, planning } = setup(() =>
      json({
        operations: [{ kind: 'remove-commitment', day: '2026-10-19', time: '15:00', title: 'Reunião de alinhamento' }],
        question: null,
      }),
    )
    const preview = desk.prepare(vault, REQUEST)
    const result = await desk.send(preview.token)
    expect(result.kind).toBe('question')
    expect(result.kind === 'question' && result.text).toContain('Há mais de um compromisso')
    expect(planning.pendingProposals()).toHaveLength(0)
    expect(agendaFile()).toBe(AGENDA)
  })

  it('id que não existe no tarefas.md: pergunta e nenhuma operação criada', async () => {
    const { desk, planning } = setup(() => json({ operations: [{ kind: 'focus', id: 'tzzzzzz' }], question: null }))
    const preview = desk.prepare(vault, REQUEST)
    const result = await desk.send(preview.token)
    expect(result.kind).toBe('question')
    expect(planning.pendingProposals()).toHaveLength(0)
  })
})

describe('falhas', () => {
  it('tempo esgotado: mensagem em português, nenhuma proposta, e o pedido pode ser revisto de novo', async () => {
    const { desk, planning } = setup(
      (_context, signal) => new Promise<string>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('abort')))),
      10,
    )
    const preview = desk.prepare(vault, REQUEST)
    await expect(desk.send(preview.token)).rejects.toThrow('A Íris demorou para responder. Tente de novo.')
    expect(planning.pendingProposals()).toHaveLength(0)
    expect(desk.prepare(vault, REQUEST).context).toContain(REQUEST)
  })

  it('sem rede ou erro do SDK: mensagem em português e nada criado', async () => {
    const { desk, planning } = setup(() => {
      throw new Error('getaddrinfo ENOTFOUND api.anthropic.com')
    })
    const preview = desk.prepare(vault, REQUEST)
    await expect(desk.send(preview.token)).rejects.toThrow('Não consegui falar com a Íris agora.')
    expect(planning.pendingProposals()).toHaveLength(0)
  })

  it('sem Claude Code: a mensagem do intérprete chega ao usuário', async () => {
    const { desk } = setup(() => {
      throw new IrisUnavailable('Claude Code não encontrado.')
    })
    const preview = desk.prepare(vault, REQUEST)
    await expect(desk.send(preview.token)).rejects.toThrow('Claude Code não encontrado.')
  })
})

describe('logs da Íris', () => {
  it('nenhum pedido, contexto ou resposta vai para o log, em nenhum caminho', async () => {
    const answer = 'SEGREDO-RESPOSTA com Dentista e Lavar roupa'
    const flows: [Reply, number | undefined][] = [
      [() => json({ operations: [{ kind: 'focus', id: 'tzzzzzz' }], question: null }), undefined],
      [() => answer, undefined],
      [() => json({ operations: [{ kind: 'concluir', id: 'tabc123' }], question: null }), undefined],
      [(_c, signal) => new Promise<string>((_r, rej) => signal.addEventListener('abort', () => rej(new Error('x')))), 10],
      [
        () => {
          throw new Error(`falha com ${answer}`)
        },
        undefined,
      ],
    ]
    for (const [reply, timeoutMs] of flows) {
      const { desk, interpreter } = setup(reply, timeoutMs)
      const preview = desk.prepare(vault, SECRET_REQUEST)
      await desk.send(preview.token).catch(() => undefined)
      const context = interpreter.sent[0]!
      expect(context).toContain('Dentista')
    }

    const logged = JSON.stringify(calls)
    expect(logged).not.toContain('SEGREDO-PEDIDO')
    expect(logged).not.toContain('SEGREDO-RESPOSTA')
    expect(logged).not.toContain('Dentista')
    expect(logged).not.toContain('Lavar roupa')
    expect(logged).not.toContain('reservar a sala')
  })

  it('todo log.warn da Íris é uma frase fixa, sem variável que possa carregar o texto', () => {
    const src = readFileSync(new URL('../src/main/iris.ts', import.meta.url), 'utf8')
    const all = src.match(/\.warn\(/g) ?? []
    const fixed = src.match(/\.warn\('[^'\n]*'\)/g) ?? []
    expect(all.length).toBeGreaterThan(0)
    expect(fixed.length).toBe(all.length)
  })
})

describe('operações novas da proposta', () => {
  it('passo de hoje de tarefa em foco é salvo pela confirmação, sem tocar no tarefas.md', async () => {
    const { desk, planning, tasks, agenda } = setup(() =>
      json({ operations: [{ kind: 'step', id: 'tabc123', text: 'Colocar na máquina' }], question: null }),
    )
    const preview = desk.prepare(vault, REQUEST)
    const before = tasksFile()
    await desk.send(preview.token)
    expect(tasksFile()).toBe(before)
    applyProposal(vault, planning.pendingProposals()[0]!, { tasks, agenda, planning, now: () => DAY })
    expect(planning.todaySteps('2026-10-17').get('tabc123')).toBe('Colocar na máquina')
    expect(tasksFile()).toBe(before)
  })

  it('passo de hoje de tarefa fora do foco é recusado como pergunta', async () => {
    const { desk, planning } = setup(() => json({ operations: [{ kind: 'step', id: 'tdef456', text: 'Passar' }], question: null }))
    const preview = desk.prepare(vault, REQUEST)
    expect((await desk.send(preview.token)).kind).toBe('question')
    expect(planning.pendingProposals()).toHaveLength(0)
  })

  it('acrescentar e tirar compromisso passam pelo mesmo mecanismo de proposta', () => {
    expect(describeOperation({ kind: 'add-commitment', day: '2026-10-17', time: '16:00', title: 'Lavar roupa' }, () => undefined)).toBe(
      'Acrescentar o compromisso “Lavar roupa” em 17.10.2026 às 16:00',
    )
    expect(describeOperation({ kind: 'remove-commitment', day: '2026-10-17', time: '14:00', title: 'Dentista' }, () => undefined)).toBe(
      'Tirar o compromisso “Dentista” de 17.10.2026 às 14:00',
    )
  })
})
