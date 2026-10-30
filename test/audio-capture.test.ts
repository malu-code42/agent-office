import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AudioPlan } from '../src/shared/audio'
import { AudioCaptureWorkflow } from '../src/main/audio-capture'
import { AudioDictionaryStore } from '../src/main/audio-dictionary'
import { createTaskWriter } from '../src/main/tasks-write'

const dirs: string[] = []
function fixture(
  transcript = { language: 'pt', text: 'Comprar leite', segments: [{ start: 0, end: 1, text: 'Comprar leite', uncertain: false }] },
  plan: AudioPlan = {
    groups: [{ kind: 'tasks', list: 'Compras', tasks: [{ title: 'Comprar leite', date: '27.10.2026' }] }],
  },
) {
  const root = mkdtempSync(join(tmpdir(), 'ao-audio-capture-'))
  dirs.push(root)
  const data = join(root, 'data')
  const vault = join(root, 'vault')
  const taskFile = join(vault, 'tarefas.md')
  const text = '# Tarefas\n\n## Compras\n\n## Casa\n'
  mkdirSync(data, { recursive: true })
  mkdirSync(vault, { recursive: true })
  writeFileSync(taskFile, text)
  const answers: (string | null)[] = []
  const host = {
    dataDirectory: () => data,
    vault: () => vault,
    log: vi.fn(),
    transcript: vi.fn(),
    status: vi.fn(),
    confirmContext: vi.fn(async () => true),
    ask: vi.fn(async () => answers.shift() ?? null),
    routeGroup: vi.fn(async (_domain: string, _text: string, _groupId: string) => true),
    saveWriting: vi.fn(async () => true),
  }
  const dictionary = new AudioDictionaryStore(data)
  const workflow = new AudioCaptureWorkflow(
    {
      transcribe: vi.fn(async () => transcript),
    },
    dictionary,
    { interpret: vi.fn(async () => JSON.stringify(plan)) },
    createTaskWriter({
      now: () => new Date(2026, 9, 26),
      newId: (() => {
        let id = 0
        return () => `t00000${id++}`
      })(),
    }),
    host,
    () => new Date(2026, 9, 26),
  )
  const attachment = { name: 'memo.wav', mime: 'audio/wav', dataBase64: Buffer.from('synthetic audio').toString('base64') }
  return { workflow, host, answers, taskFile, attachment, data, dictionary }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('captura de áudio e gravação por grupo', () => {
  it('transcreve em arquivo temporário e grava as tarefas só após aprovar o grupo', async () => {
    const { workflow, host, answers, taskFile, attachment, data } = fixture()
    answers.push('Aprovar e gravar grupo')
    await workflow.processAttachment(attachment, '')

    expect(host.confirmContext).toHaveBeenCalledOnce()
    expect(host.ask).toHaveBeenCalledOnce()
    expect(readFileSync(taskFile, 'utf8')).toContain('Comprar leite')
    expect(readdirSync(join(data, 'audio-pending'))).toEqual([])
    expect(readFileSync(join(data, 'audio-dictionary.json'), 'utf8')).toContain('"entries": []')
    expect(host.transcript).toHaveBeenCalledWith('00:00 Comprar leite')
    expect(host.log).not.toHaveBeenCalledWith('assistant', expect.stringContaining('Transcrição local corrigida'))
  })

  it('rejeitar deixa tarefas.md byte-identical', async () => {
    const { workflow, host, answers, taskFile, attachment } = fixture()
    const before = readFileSync(taskFile)
    answers.push('Rejeitar grupo')
    await workflow.processAttachment(attachment, '')

    expect(readFileSync(taskFile)).toEqual(before)
    expect(host.log).toHaveBeenCalledWith(
      'assistant',
      'A captura terminou. Grupos aprovados foram processados; grupos rejeitados não foram alterados.',
    )
  })

  it('edição invalida o primeiro plano e exige nova aprovação antes da gravação', async () => {
    const { workflow, host, answers, taskFile, attachment } = fixture()
    answers.push('Editar grupo', 'Comprar chá | 28.10.2026', 'Aprovar e gravar grupo')
    await workflow.processAttachment(attachment, '')

    const saved = readFileSync(taskFile, 'utf8')
    expect(saved).toContain('Comprar chá')
    expect(saved).toContain('28.10.2026')
    expect(saved).not.toContain('Comprar leite')
    expect(host.ask).toHaveBeenCalledTimes(3)
  })

  it('confirma correções incertas no dicionário local antes de aprovar o grupo', async () => {
    const transcript = { language: 'pt', text: 'Leta', segments: [{ start: 0, end: 1, text: 'Leta', uncertain: true }] }
    const { workflow, host, answers, dictionary, attachment } = fixture(transcript)
    answers.push('Leite', 'Aprovar e gravar grupo')
    await workflow.processAttachment(attachment, '')

    expect(dictionary.find('Leta')).toEqual([{ heard: 'Leta', correction: 'Leite', context: 'Leta', updatedAt: expect.any(Number) }])
    expect(host.transcript).toHaveBeenCalledWith('00:00 Leite')
  })

  it('usa correção conhecida automaticamente só quando o contexto local corresponde', async () => {
    const transcript = { language: 'pt', text: 'Leta', segments: [{ start: 0, end: 1, text: 'Leta', uncertain: true }] }
    const { workflow, host, answers, dictionary, attachment } = fixture(transcript)
    dictionary.remember('Leta', 'Leite', 'Leta')
    answers.push('Aprovar e gravar grupo')
    await workflow.processAttachment(attachment, '')

    expect(host.ask).toHaveBeenCalledOnce()
    expect(host.transcript).toHaveBeenCalledWith('00:00 Leite')
  })

  it('repetir o mesmo áudio no mesmo dia não duplica tarefas aprovadas', async () => {
    const { workflow, host, answers, taskFile, attachment } = fixture()
    answers.push('Aprovar e gravar grupo')
    await workflow.processAttachment(attachment, '')
    const afterFirstApproval = readFileSync(taskFile, 'utf8')
    await workflow.processAttachment(attachment, '')

    expect(readFileSync(taskFile, 'utf8')).toBe(afterFirstApproval)
    expect(host.ask).toHaveBeenCalledOnce()
  })

  it('retoma idempotência após reconstruir o workflow, inclusive no dia seguinte', async () => {
    const { workflow, host, answers, taskFile, attachment, data } = fixture()
    answers.push('Aprovar e gravar grupo')
    await workflow.processAttachment(attachment, '')
    const afterFirstApproval = readFileSync(taskFile, 'utf8')
    const restarted = new AudioCaptureWorkflow(
      {
        transcribe: vi.fn(async () => ({
          language: 'pt',
          text: 'Comprar leite',
          segments: [{ start: 0, end: 1, text: 'Comprar leite', uncertain: false }],
        })),
      },
      new AudioDictionaryStore(data),
      {
        interpret: vi.fn(async () =>
          JSON.stringify({ groups: [{ kind: 'tasks', list: 'Compras', tasks: [{ title: 'Comprar leite', date: '27.10.2026' }] }] }),
        ),
      },
      createTaskWriter(),
      host,
      () => new Date(2026, 9, 27),
    )

    await restarted.processAttachment(attachment, '')

    expect(readFileSync(taskFile, 'utf8')).toBe(afterFirstApproval)
    expect(host.ask).toHaveBeenCalledOnce()
  })

  it('roteia trechos de agenda somente após a aprovação explícita do grupo', async () => {
    const plan: AudioPlan = { groups: [{ kind: 'route', domain: 'agenda', text: 'Dentista amanhã às 10' }] }
    const { workflow, host, answers, taskFile, attachment } = fixture(undefined, plan)
    const before = readFileSync(taskFile)
    answers.push('Encaminhar trecho')
    await workflow.processAttachment(attachment, '')

    expect(host.routeGroup).toHaveBeenCalledWith('agenda', 'Dentista amanhã às 10', expect.any(String))
    expect(readFileSync(taskFile)).toEqual(before)
  })

  it('mantém a captura pendente se o fluxo normal de domínio falhar e permite retomada', async () => {
    const plan: AudioPlan = { groups: [{ kind: 'route', domain: 'agenda', text: 'Dentista amanhã às 10' }] }
    const { workflow, host, answers, attachment } = fixture(undefined, plan)
    host.routeGroup.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    answers.push('Encaminhar trecho', 'Encaminhar trecho')

    await workflow.processAttachment(attachment, '')
    await workflow.processAttachment(attachment, '')

    expect(host.routeGroup).toHaveBeenCalledTimes(2)
    expect(host.routeGroup.mock.calls[0]?.[2]).toBe(host.routeGroup.mock.calls[1]?.[2])
  })

  it('não marca escrita aceita se a confirmação própria for cancelada; pode retomar e aprovar', async () => {
    const plan: AudioPlan = { groups: [{ kind: 'route', domain: 'writing', text: 'Uma ideia de conto.' }] }
    const { workflow, host, answers, attachment } = fixture(undefined, plan)
    host.saveWriting.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    answers.push('Encaminhar trecho', 'Encaminhar trecho')

    await workflow.processAttachment(attachment, '')
    expect(host.saveWriting).toHaveBeenCalledTimes(1)

    await workflow.processAttachment(attachment, '')
    expect(host.saveWriting).toHaveBeenCalledTimes(2)
    expect(host.log).toHaveBeenCalledWith('assistant', 'O trecho foi salvo como Original na biblioteca de Escrita, após sua confirmação.')
  })

  it('sem aprovação de contexto não chama o planner nem grava tarefas', async () => {
    const { workflow, host, taskFile, attachment } = fixture()
    const before = readFileSync(taskFile)
    host.confirmContext.mockResolvedValueOnce(false)
    await workflow.processAttachment(attachment, '')

    expect(readFileSync(taskFile)).toEqual(before)
    expect(host.ask).not.toHaveBeenCalled()
  })

  it('se ASR local falhar, não envia texto ao planner nem grava nada', async () => {
    const { host, taskFile, attachment, data } = fixture()
    const before = readFileSync(taskFile)
    const workflow = new AudioCaptureWorkflow(
      {
        transcribe: vi.fn(async () => {
          throw new Error('Runtime local indisponível; sem fallback.')
        }),
      },
      new AudioDictionaryStore(data),
      { interpret: vi.fn() },
      createTaskWriter(),
      host,
    )
    await workflow.processAttachment(attachment, '')

    expect(readFileSync(taskFile)).toEqual(before)
    expect(host.confirmContext).not.toHaveBeenCalled()
    expect(host.log).toHaveBeenCalledWith('error', 'Runtime local indisponível; sem fallback.')
  })
})
