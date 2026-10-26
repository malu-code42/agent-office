import { describe, expect, it } from 'vitest'
import { audioPlanContext, parseAudioPlan, relativeDateReference } from '../src/main/audio-plan'

describe('plano de grupos de captura de áudio', () => {
  it('monta contexto com dia local e apenas nomes das listas canônicas', () => {
    const context = audioPlanContext('Comprar leite', '2026-10-26', ['Compras', 'Casa'])
    expect(context).toContain('Data local de referência: 2026-10-26')
    expect(context).toContain('- amanhã: 27.10.2026')
    expect(context).toContain('- depois de amanhã: 28.10.2026')
    expect(context).toContain('- Compras\n- Casa')
    expect(context).toContain('Transcrição corrigida')
  })

  it('resolve relativas pelo calendário local e rejeita uma data-base inválida', () => {
    expect(relativeDateReference('2026-12-31')).toEqual({ today: '31.12.2026', tomorrow: '01.01.2027', dayAfterTomorrow: '02.01.2027' })
    expect(() => relativeDateReference('2026-02-30')).toThrow(/não existe no calendário/)
  })

  it('separa grupos de tarefa por lista e roteia trechos não-tarefa', () => {
    expect(
      parseAudioPlan(
        JSON.stringify({
          groups: [
            { kind: 'tasks', list: 'Compras', tasks: [{ title: 'Comprar leite', date: '27.10.2026' }] },
            { kind: 'route', domain: 'writing', text: 'Anote esta ideia de texto.' },
          ],
        }),
        ['Compras', 'Casa'],
      ),
    ).toEqual({
      groups: [
        { kind: 'tasks', list: 'Compras', tasks: [{ title: 'Comprar leite', date: '27.10.2026' }] },
        { kind: 'route', domain: 'writing', text: 'Anote esta ideia de texto.' },
      ],
    })
  })

  it('pergunta sobre listas inexistentes em vez de criar uma categoria', () => {
    expect(
      parseAudioPlan(JSON.stringify({ groups: [{ kind: 'tasks', list: 'Nova categoria', tasks: [{ title: 'Comprar leite' }] }] }), [
        'Compras',
      ]),
    ).toMatchObject({
      groups: [],
      question: expect.stringContaining('Escolha uma lista existente'),
    })
  })

  it('pergunta em vez de gravar ações quando a data ou o destino estiver ambíguo', () => {
    expect(parseAudioPlan(JSON.stringify({ groups: [], question: 'Qual quinta-feira?' }), ['Compras'])).toEqual({
      groups: [],
      question: 'Qual quinta-feira?',
    })
  })

  it('descarta resposta malformada, título vazio e hora/data inválidas', () => {
    expect(() => parseAudioPlan('isso não é JSON', ['Compras'])).toThrow(/com segurança/)
    expect(() =>
      parseAudioPlan(JSON.stringify({ groups: [{ kind: 'tasks', list: 'Compras', tasks: [{ title: ' ' }] }] }), ['Compras']),
    ).toThrow(/com segurança/)
    expect(() =>
      parseAudioPlan(JSON.stringify({ groups: [{ kind: 'tasks', list: 'Compras', tasks: [{ title: 'Leite', date: '31.02.2026' }] }] }), [
        'Compras',
      ]),
    ).toThrow(/com segurança/)
  })
})
