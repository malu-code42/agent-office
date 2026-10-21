import { describe, expect, it } from 'vitest'
import { compositionPrompt, extractJson, memberId, parseComposition } from '../src/main/squad-composition'

// The answer of the model is untrusted: it only becomes a composition when it passes
// the local checks. Everything else is refused, and nothing is written.

const ctx = { models: ['', 'fable', 'opus', 'sonnet', 'haiku'], accounts: ['pessoal', 'trabalho'] }

const answer = (members: unknown) => JSON.stringify({ members })

describe('parseComposition', () => {
  it('aceita uma equipe com implementador e revisor, na ordem das mesas', () => {
    const members = parseComposition(
      answer([
        { name: 'Maya', role: 'implementer', model: 'opus', account: 'pessoal', focus: 'Escreve o código' },
        { name: 'Caio', role: 'reviewer', model: '', account: '', focus: 'Revisa com olho crítico' },
      ]),
      ctx,
    )
    expect(members).toHaveLength(2)
    expect(members[0]).toMatchObject({ id: 'maya', name: 'Maya', role: 'implementer', model: 'opus', account: 'pessoal', engine: 'claude' })
    expect(members[1]).toMatchObject({ id: 'caio', role: 'reviewer', model: '', account: '' })
  })

  it('recusa uma resposta que não é JSON', () => {
    expect(() => parseComposition('desculpe, não posso', ctx)).toThrow(/JSON/)
  })

  it('recusa uma equipe fora do tamanho da sala', () => {
    const one = [{ name: 'Maya', role: 'implementer' }]
    expect(() => parseComposition(answer(one), ctx)).toThrow(/sala/)
    const many = Array.from({ length: 7 }, (_, i) => ({ name: `M${i}`, role: i === 0 ? 'implementer' : 'tester' }))
    expect(() => parseComposition(answer(many), ctx)).toThrow(/sala/)
  })

  it('recusa uma equipe sem implementador ou sem revisor', () => {
    const noReviewer = [
      { name: 'Maya', role: 'implementer' },
      { name: 'Caio', role: 'tester' },
    ]
    expect(() => parseComposition(answer(noReviewer), ctx)).toThrow(/revisor/)
  })

  it('recusa o revisor antes do implementador', () => {
    const wrong = [
      { name: 'Caio', role: 'reviewer' },
      { name: 'Maya', role: 'implementer' },
    ]
    expect(() => parseComposition(answer(wrong), ctx)).toThrow(/revisor/)
  })

  it('recusa um papel que o office não conhece', () => {
    const alien = [
      { name: 'Maya', role: 'implementer' },
      { name: 'Caio', role: 'chefe' },
    ]
    expect(() => parseComposition(answer(alien), ctx)).toThrow(/sala/)
  })

  it('recusa um modelo que o office não oferece, em vez de usar o padrão', () => {
    expect(() =>
      parseComposition(
        answer([
          { name: 'Maya', role: 'implementer', model: 'gpt-4' },
          { name: 'Caio', role: 'reviewer' },
        ]),
        ctx,
      ),
    ).toThrow(/modelo/i)
  })

  it('recusa uma conta que o office não tem, em vez de usar o pool do projeto', () => {
    expect(() =>
      parseComposition(
        answer([
          { name: 'Maya', role: 'implementer', account: 'conta que não existe' },
          { name: 'Caio', role: 'reviewer' },
        ]),
        ctx,
      ),
    ).toThrow(/conta/i)
  })

  it('aceita o modelo e a conta vazios: são o padrão do Claude Code e o pool do projeto', () => {
    const members = parseComposition(
      answer([
        { name: 'Maya', role: 'implementer', model: '', account: '' },
        { name: 'Caio', role: 'reviewer', model: '', account: '' },
      ]),
      ctx,
    )
    expect(members[0]).toMatchObject({ model: '', account: '' })
    expect(members[1]).toMatchObject({ model: '', account: '' })
  })

  it('aceita um membro sem modelo e sem conta: o padrão vale', () => {
    const members = parseComposition(
      answer([
        { name: 'Maya', role: 'implementer' },
        { name: 'Caio', role: 'reviewer' },
      ]),
      ctx,
    )
    expect(members[0]).toMatchObject({ model: '', account: '' })
  })

  it('sem conta configurada, só o pool do projeto vale', () => {
    const semContas = { models: ctx.models, accounts: [] as string[] }
    // A conta vazia é o pool do projeto: entra.
    const members = parseComposition(
      answer([
        { name: 'Maya', role: 'implementer', account: '' },
        { name: 'Caio', role: 'reviewer', account: '' },
      ]),
      semContas,
    )
    expect(members[0]).toMatchObject({ account: '' })
    // Uma conta nomeada não existe: a composição é recusada.
    expect(() =>
      parseComposition(
        answer([
          { name: 'Maya', role: 'implementer', account: 'pessoal' },
          { name: 'Caio', role: 'reviewer' },
        ]),
        semContas,
      ),
    ).toThrow(/conta/i)
  })

  it('sem modelo configurado, só o padrão do Claude Code vale', () => {
    const semModelos = { models: [] as string[], accounts: ctx.accounts }
    // O modelo vazio é o padrão: entra.
    const members = parseComposition(
      answer([
        { name: 'Maya', role: 'implementer', model: '' },
        { name: 'Caio', role: 'reviewer', model: '' },
      ]),
      semModelos,
    )
    expect(members[0]).toMatchObject({ model: '' })
    // Um modelo nomeado não existe: a composição é recusada, nunca virada no padrão.
    expect(() =>
      parseComposition(
        answer([
          { name: 'Maya', role: 'implementer', model: 'opus' },
          { name: 'Caio', role: 'reviewer' },
        ]),
        semModelos,
      ),
    ).toThrow(/modelo/i)
  })

  it('modelo e conta nulos são o padrão', () => {
    const members = parseComposition(
      answer([
        { name: 'Maya', role: 'implementer', model: null, account: null, focus: null },
        { name: 'Caio', role: 'reviewer', model: null, account: null },
      ]),
      ctx,
    )
    expect(members[0]).toMatchObject({ model: '', account: '', focus: '' })
    expect(members[1]).toMatchObject({ model: '', account: '' })
  })

  it('um modelo que não é texto recusa a composição', () => {
    expect(() =>
      parseComposition(
        answer([
          { name: 'Maya', role: 'implementer', model: 7 },
          { name: 'Caio', role: 'reviewer' },
        ]),
        ctx,
      ),
    ).toThrow(/sala/)
  })

  it('dá ids diferentes a membros com o mesmo nome', () => {
    const members = parseComposition(
      answer([
        { name: 'Maya', role: 'implementer' },
        { name: 'Maya', role: 'reviewer' },
      ]),
      ctx,
    )
    expect(members[0]!.id).not.toBe(members[1]!.id)
  })

  it('aceita a resposta dentro de um bloco de código', () => {
    const text =
      'Aqui está:\n```json\n' +
      answer([
        { name: 'Maya', role: 'implementer' },
        { name: 'Caio', role: 'reviewer' },
      ]) +
      '\n```'
    expect(parseComposition(text, ctx)).toHaveLength(2)
  })
})

describe('extractJson', () => {
  it('prefere o bloco json e cai no objeto mais externo', () => {
    expect(extractJson('```json\n{"a":1}\n```')?.trim()).toBe('{"a":1}')
    expect(extractJson('antes {"a":1} depois')).toBe('{"a":1}')
    expect(extractJson('nada aqui')).toBeUndefined()
  })
})

describe('memberId', () => {
  it('vira um id de arquivo, sem acentos e sem caminho', () => {
    expect(memberId('Maya da Silva', 0)).toBe('maya-da-silva')
    expect(memberId('José Áureo', 0)).toBe('jose-aureo')
    expect(memberId('///', 2)).toBe('membro-3')
  })
})

describe('compositionPrompt', () => {
  it('pede um JSON com a equipe, e nada mais', () => {
    const prompt = compositionPrompt({
      cwd: '/tmp/projeto',
      brief: 'Refazer a busca da loja',
      tickets: [{ key: 'AO-12', title: 'Busca da loja' }],
      adjustments: ['Inclua um testador'],
      ctx,
    })
    expect(prompt).toContain('"members"')
    expect(prompt).toContain('AO-12: Busca da loja')
    expect(prompt).toContain('Inclua um testador')
    expect(prompt).toContain('Refazer a busca da loja')
    // The rules the answer has to follow.
    expect(prompt).toContain('implementer')
    expect(prompt).toContain('reviewer')
    expect(prompt).toContain('"opus"')
    expect(prompt).toContain('"pessoal"')
  })

  it('sem modelo nem conta, o prompt diz que só o padrão vale', () => {
    const prompt = compositionPrompt({
      cwd: '/tmp/projeto',
      brief: 'Refazer a busca da loja',
      tickets: [],
      adjustments: [],
      ctx: { models: [], accounts: [] },
    })
    expect(prompt).toContain('"" only (the default of Claude Code)')
    expect(prompt).toContain('"" only (the pool of the project)')
  })
})
