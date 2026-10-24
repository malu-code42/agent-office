import { describe, expect, it } from 'vitest'
import {
  appendMediaItem,
  bookProgress,
  newMediaItem,
  parseMedia,
  replaceMediaItem,
  serializeMedia,
  setMovieStatus,
  setPagesRead,
  setPlatinum,
  setStatus,
} from '../src/shared/media'
import type { MediaStatus } from '../src/shared/media'

const BOOKS = [
  '# Livros de teste',
  '',
  'texto que não pertence a nenhum item',
  '',
  '## Livro de teste',
  '- ID: mabc12345',
  '- Estado: em andamento',
  '- Páginas lidas: 40',
  '- Total de páginas: 200',
  '- Anotação livre: manter esta linha',
  '- Agenda: 2026-10-30 19:30 Sessão de leitura',
  '',
  '## Livro sem total',
  '- ID: mdef67890',
  '- Estado: planejado',
  '- Páginas lidas: 0',
  '',
  'fim do arquivo',
].join('\n')

const MOVIES = [
  '## Filme de teste',
  '- ID: mfilm0001',
  '- Estado: planejado',
  '- Pôster: midias/posters/mfilm0001.png',
  '- Páginas lidas: 10',
  '',
  '## Filme sem pôster',
  '- ID: mfilm0002',
  '- Estado: concluído',
].join('\n')

const GAMES = [
  '## Jogo de teste',
  '- ID: mgame0001',
  '- Estado: em andamento',
  '- Favorito: sim',
  '- Platina: não',
  '',
  '## Jogo platinado',
  '- ID: mgame0002',
  '- Estado: planejado',
  '- Favorito: não',
  '- Platina: sim',
].join('\n')

describe('codec de mídias', () => {
  it('faz round-trip exato em LF, com texto fora dos itens e linhas desconhecidas', () => {
    expect(serializeMedia(parseMedia('livro', BOOKS))).toBe(BOOKS)
    expect(serializeMedia(parseMedia('livro', `${BOOKS}\n`))).toBe(`${BOOKS}\n`)
  })

  it('faz round-trip exato em CRLF', () => {
    const crlf = `${BOOKS.replace(/\n/g, '\r\n')}\r\n`
    expect(serializeMedia(parseMedia('livro', crlf))).toBe(crlf)
  })

  it('lê os campos de livro e guarda as linhas que não reconhece', () => {
    const document = parseMedia('livro', BOOKS)
    expect(document.items).toEqual([
      {
        kind: 'livro',
        id: 'mabc12345',
        title: 'Livro de teste',
        status: 'em andamento',
        pagesRead: 40,
        totalPages: 200,
        agenda: { day: '2026-10-30', time: '19:30', title: 'Sessão de leitura' },
      },
      { kind: 'livro', id: 'mdef67890', title: 'Livro sem total', status: 'planejado', pagesRead: 0 },
    ])
    expect(document.lines).toContain('- Anotação livre: manter esta linha')
  })

  it('usa padrões quando o item não informa estado nem páginas', () => {
    const [item] = parseMedia('livro', '## Sem estado\n- ID: mabc12345\n').items
    expect(item).toMatchObject({ status: 'planejado', pagesRead: 0 })
    expect(item?.totalPages).toBeUndefined()
  })

  it('cria itens novos com padrões seguros por tipo', () => {
    expect(newMediaItem('livro', 'mabc12345', 'Livro novo')).toEqual({
      kind: 'livro',
      id: 'mabc12345',
      title: 'Livro novo',
      status: 'planejado',
      pagesRead: 0,
    })
    expect(newMediaItem('filme', 'mfilm0001', 'Filme novo')).toEqual({
      kind: 'filme',
      id: 'mfilm0001',
      title: 'Filme novo',
      status: 'planejado',
    })
    expect(newMediaItem('jogo', 'mgame0001', 'Jogo novo')).toEqual({
      kind: 'jogo',
      id: 'mgame0001',
      title: 'Jogo novo',
      status: 'planejado',
      favorite: false,
      platinum: false,
    })
  })

  it('trata seção sem ID como texto livre, sem validar seus campos', () => {
    const text = '## Notas\n- Estado: rascunho\n\n## Livro\n- ID: mabc12345\n'
    const document = parseMedia('livro', text)
    expect(document.items.map((item) => item.id)).toEqual(['mabc12345'])
    expect(serializeMedia(document)).toBe(text)
  })

  it('rejeita ID duplicado com mensagem em pt-BR', () => {
    const text = '## Um\n- ID: mabc12345\n\n## Dois\n- ID: mabc12345\n'
    expect(() => parseMedia('livro', text)).toThrow('O identificador mabc12345 aparece mais de uma vez em livros.md.')
  })

  it('rejeita campo repetido dentro do mesmo item', () => {
    expect(() => parseMedia('livro', '## Livro\n- ID: mabc12345\n- Estado: planejado\n- Estado: concluído\n')).toThrow(
      /"Estado" aparece mais de uma vez/,
    )
  })

  it('rejeita campo inválido com mensagem em pt-BR', () => {
    expect(() => parseMedia('livro', '## Livro\n- ID: mabc12345\n- Estado: pronto\n')).toThrow(
      /Estado inválido.*planejado, em andamento ou concluído/,
    )
    expect(() => parseMedia('livro', '## Livro\n- ID: abc\n')).toThrow(/identificador.*inválido/)
    expect(() => parseMedia('jogo', '## Jogo\n- ID: mgame0001\n- Favorito: talvez\n')).toThrow(/Favorito.*"sim" ou "não"/)
    expect(() => parseMedia('jogo', '## Jogo\n- ID: mgame0001\n- Platina: 1\n')).toThrow(/Platina.*"sim" ou "não"/)
    expect(() => parseMedia('filme', '## Filme\n- ID: mfilm0001\n- Agenda: 2026-02-31 19:30 Sessão\n')).toThrow(
      /vínculo de agenda.*AAAA-MM-DD HH:MM/,
    )
    expect(() => parseMedia('filme', '## Filme\n- ID: mfilm0001\n- Agenda: 2026-10-30 24:00 Sessão\n')).toThrow(
      /vínculo de agenda.*AAAA-MM-DD HH:MM/,
    )
  })

  it('rejeita páginas lidas negativas', () => {
    expect(() => parseMedia('livro', '## Livro\n- ID: mabc12345\n- Páginas lidas: -3\n')).toThrow(
      /Páginas lidas.*número inteiro maior ou igual a zero/,
    )
  })

  it('rejeita páginas lidas maiores que o total', () => {
    expect(() => parseMedia('livro', '## Livro\n- ID: mabc12345\n- Páginas lidas: 300\n- Total de páginas: 200\n')).toThrow(
      /não pode ser maior que o total de páginas/,
    )
  })

  it('filme não tem progresso numérico: a linha de páginas fica como desconhecida', () => {
    const document = parseMedia('filme', MOVIES)
    expect(document.items[0]).not.toHaveProperty('pagesRead')
    expect(document.lines).toContain('- Páginas lidas: 10')
    expect(serializeMedia(document)).toBe(MOVIES)
  })

  it('aceita pôster relativo dentro de midias/posters e marca os outros caminhos como erro de pôster', () => {
    expect(parseMedia('filme', MOVIES).items[0]?.posterPath).toBe('midias/posters/mfilm0001.png')
    for (const path of [
      '../mfilm0001.png',
      'midias/posters/../x.png',
      '/abs/mfilm0001.png',
      'C:/x/mfilm0001.png',
      'midias\\posters\\x.png',
      'midias/posters/x.gif',
    ]) {
      const [movie] = parseMedia('filme', `## Filme\n- ID: mfilm0001\n- Pôster: ${path}\n`).items
      expect(movie).not.toHaveProperty('posterPath')
      expect(movie?.posterError).toMatch(/pôster.*midias\/posters/i)
    }
  })

  it('pôster inválido não impede os outros filmes de carregarem', () => {
    const text = [
      '## Filme ruim',
      '- ID: mfilm0001',
      '- Estado: planejado',
      '- Pôster: ../foto.png',
      '',
      '## Filme bom',
      '- ID: mfilm0002',
      '- Estado: concluído',
      '- Pôster: midias/posters/mfilm0002.png',
    ].join('\n')
    const document = parseMedia('filme', text)
    expect(document.items).toEqual([
      {
        kind: 'filme',
        id: 'mfilm0001',
        title: 'Filme ruim',
        status: 'planejado',
        posterError: 'O pôster de "Filme ruim" precisa estar em midias/posters e ser PNG, JPEG ou WebP.',
      },
      { kind: 'filme', id: 'mfilm0002', title: 'Filme bom', status: 'concluído', posterPath: 'midias/posters/mfilm0002.png' },
    ])
    expect(serializeMedia(document)).toBe(text)
  })

  it('recusa pôster inválido ao gravar, em criar, substituir e mudar estado', () => {
    const movie = parseMedia('filme', MOVIES).items[0]!
    const invalid = { ...movie, posterPath: '../foto.png' }
    expect(() => setMovieStatus(invalid, 'concluído')).toThrow(/pôster.*midias\/posters/i)
    expect(() => replaceMediaItem(MOVIES, 'filme', invalid)).toThrow(/pôster.*midias\/posters/i)
    expect(() => appendMediaItem(MOVIES, 'filme', { ...newMediaItem('filme', 'mfilm0003', 'Novo'), posterPath: '../foto.png' })).toThrow(
      /pôster.*midias\/posters/i,
    )
  })

  it('ao editar filme com pôster inválido, mantém a linha do pôster para correção manual', () => {
    const text = '## Filme ruim\n- ID: mfilm0001\n- Estado: planejado\n- Pôster: ../foto.png\n'
    const movie = parseMedia('filme', text).items[0]!
    expect(replaceMediaItem(text, 'filme', setMovieStatus(movie, 'concluído'))).toBe(text.replace('planejado', 'concluído'))
  })

  it('recusa caracteres de controle no nome do pôster, como tabulação', () => {
    for (const name of ['ca\tlo.png', 'ca\x01lo.png']) {
      const [movie] = parseMedia('filme', `## Filme\n- ID: mfilm0001\n- Pôster: midias/posters/${name}\n`).items
      expect(movie).not.toHaveProperty('posterPath')
      expect(movie?.posterError).toMatch(/pôster/)
    }
  })

  it('reconhece campos com espaço antes do dois-pontos', () => {
    const [item] = parseMedia('livro', '## Livro\n- ID : mabc12345\n- Estado : em andamento\n- Páginas lidas : 5\n').items
    expect(item).toMatchObject({ id: 'mabc12345', status: 'em andamento', pagesRead: 5 })
  })

  it('lança erro pt-BR quando a linha de ID está malformada, em vez de tratar a seção como texto livre', () => {
    expect(() => parseMedia('livro', '## Livro\n- ID mabc12345\n')).toThrow(/linha de ID de "Livro"/)
    expect(() => parseMedia('livro', '## Livro\n- ID\n')).toThrow(/linha de ID de "Livro"/)
  })

  it('lê jogo platinado como concluído, mesmo com outro estado no arquivo', () => {
    expect(parseMedia('jogo', GAMES).items[1]).toMatchObject({ platinum: true, status: 'concluído' })
  })

  it('faz round-trip exato de jogos em LF e CRLF', () => {
    expect(serializeMedia(parseMedia('jogo', GAMES))).toBe(GAMES)
    const crlf = `${GAMES.replace(/\n/g, '\r\n')}\r\n`
    expect(serializeMedia(parseMedia('jogo', crlf))).toBe(crlf)
  })

  it('faz round-trip exato de filmes em CRLF', () => {
    const crlf = `${MOVIES.replace(/\n/g, '\r\n')}\r\n`
    expect(serializeMedia(parseMedia('filme', crlf))).toBe(crlf)
  })

  it('rejeita arquivo com finais de linha mistos, com mensagem em pt-BR', () => {
    expect(() => parseMedia('livro', BOOKS.replace('\n', '\r\n'))).toThrow(/mistura finais de linha LF e CRLF/)
  })

  it('rejeita edição de arquivo com finais de linha mistos', () => {
    const book = parseMedia('livro', BOOKS).items[0]!
    expect(() => replaceMediaItem(BOOKS.replace('\n', '\r\n'), 'livro', book)).toThrow(/mistura finais de linha/)
  })

  it('remove o BOM do início do arquivo ao ler', () => {
    const document = parseMedia('livro', `\uFEFF${BOOKS}`)
    expect(document.items.map((item) => item.id)).toEqual(['mabc12345', 'mdef67890'])
    expect(document.lines[0]).toBe('# Livros de teste')
  })

  it('aceita "- ID:" com ou sem espaços depois dos dois-pontos', () => {
    const text = '## Livro\n- ID:mabc12345\n\n## Outro\n- ID:   mdef67890\n'
    expect(parseMedia('livro', text).items.map((item) => item.id)).toEqual(['mabc12345', 'mdef67890'])
  })

  it('trata pôster vazio como ausente e carrega os demais filmes', () => {
    const text = [
      '## Filme sem pôster',
      '- ID: mfilm0001',
      '- Estado: planejado',
      '- Pôster:',
      '',
      '## Filme com pôster',
      '- ID: mfilm0002',
      '- Estado: concluído',
      '- Pôster: midias/posters/mfilm0002.png',
    ].join('\n')
    const items = parseMedia('filme', text).items
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({ kind: 'filme', id: 'mfilm0001', title: 'Filme sem pôster', status: 'planejado' })
    expect(items[1]?.posterPath).toBe('midias/posters/mfilm0002.png')
  })

  it('trata total de páginas e agenda vazios como ausentes', () => {
    const [item] = parseMedia('livro', '## Livro\n- ID: mabc12345\n- Páginas lidas: 5\n- Total de páginas:\n- Agenda:\n').items
    expect(item).toEqual({ kind: 'livro', id: 'mabc12345', title: 'Livro', status: 'planejado', pagesRead: 5 })
    expect(item).not.toHaveProperty('totalPages')
    expect(item).not.toHaveProperty('agenda')
  })

  it('compara o prefixo do pôster sem ignorar maiúsculas e minúsculas', () => {
    for (const path of ['MIDIAS/Posters/x.png', 'midias/Posters/x.png']) {
      const [movie] = parseMedia('filme', `## Filme\n- ID: mfilm0001\n- Pôster: ${path}\n`).items
      expect(movie).not.toHaveProperty('posterPath')
      expect(movie?.posterError).toMatch(/pôster.*midias\/posters/i)
    }
    expect(parseMedia('filme', '## Filme\n- ID: mfilm0001\n- Pôster: midias/posters/x.PNG\n').items[0]?.posterPath).toBe(
      'midias/posters/x.PNG',
    )
  })

  it('recusa nomes reservados do Windows no pôster, com ou sem extensão', () => {
    for (const name of [
      'CON.png',
      'con.jpg',
      'PRN.webp',
      'AUX.png',
      'NUL.png',
      'COM1.png',
      'com9.jpeg',
      'LPT1.png',
      'lpt9.webp',
      'CON .png',
    ]) {
      const [movie] = parseMedia('filme', `## Filme\n- ID: mfilm0001\n- Pôster: midias/posters/${name}\n`).items
      expect(movie).not.toHaveProperty('posterPath')
      expect(movie?.posterError).toMatch(/pôster/)
    }
    expect(parseMedia('filme', '## Filme\n- ID: mfilm0001\n- Pôster: midias/posters/CONTEUDO.png\n').items[0]?.posterPath).toBe(
      'midias/posters/CONTEUDO.png',
    )
  })
})

describe('regras de mídia', () => {
  it('platina conclui o jogo', () => {
    const game = parseMedia('jogo', GAMES).items[0]!
    expect(setPlatinum(game, true)).toMatchObject({ platinum: true, status: 'concluído' })
  })

  it('desmarcar a platina não reabre o jogo', () => {
    const platinum = setPlatinum(parseMedia('jogo', GAMES).items[0]!, true)
    expect(setPlatinum(platinum, false)).toMatchObject({ platinum: false, status: 'concluído' })
  })

  it('não muda o estado de um jogo platinado enquanto a platina estiver marcada', () => {
    const platinum = setPlatinum(parseMedia('jogo', GAMES).items[0]!, true)
    expect(() => setStatus(platinum, 'em andamento')).toThrow(/platinado.*concluído/)
    expect(setStatus(setPlatinum(platinum, false), 'em andamento').status).toBe('em andamento')
  })

  it('progresso de livro é zero quando o total de páginas é desconhecido', () => {
    const book = { ...parseMedia('livro', BOOKS).items[1]!, pagesRead: 50 }
    expect(bookProgress(book)).toEqual({ pagesRead: 50, totalPages: undefined, percent: 0 })
  })

  it('livro que chega ao total não muda de estado automaticamente', () => {
    const book = parseMedia('livro', BOOKS).items[0]!
    const finished = setPagesRead(book, 200)
    expect(finished).toMatchObject({ pagesRead: 200, status: 'em andamento' })
    expect(bookProgress(finished).percent).toBe(100)
  })

  it('recusa páginas lidas negativas ou acima do total ao atualizar', () => {
    const book = parseMedia('livro', BOOKS).items[0]!
    expect(() => setPagesRead(book, -1)).toThrow(/número inteiro maior ou igual a zero/)
    expect(() => setPagesRead(book, 201)).toThrow(/não pode ser maior que o total/)
  })

  it('percentual de livro não arredonda para baixo: 29 de 100 dá 29%', () => {
    const book = { ...parseMedia('livro', BOOKS).items[0]!, pagesRead: 29, totalPages: 100 }
    expect(bookProgress(book).percent).toBe(29)
  })

  it('percentual de livro não arredonda para baixo: 57 de 100 dá 57%', () => {
    const book = { ...parseMedia('livro', BOOKS).items[0]!, pagesRead: 57, totalPages: 100 }
    expect(bookProgress(book).percent).toBe(57)
  })

  it('rejeita gravar jogo platinado que não esteja concluído', () => {
    const game = { ...parseMedia('jogo', GAMES).items[0]!, platinum: true, status: 'em andamento' as const }
    expect(() => replaceMediaItem(GAMES, 'jogo', game)).toThrow(/platinado.*concluído/)
  })

  it('grava jogo platinado concluído com a platina marcada', () => {
    const game = setPlatinum(parseMedia('jogo', GAMES).items[0]!, true)
    expect(parseMedia('jogo', replaceMediaItem(GAMES, 'jogo', game)).items[0]).toMatchObject({
      platinum: true,
      status: 'concluído',
    })
  })

  it('valida o estado em tempo de execução ao gravar', () => {
    const game = { ...parseMedia('jogo', GAMES).items[0]!, status: 'pronto' as unknown as MediaStatus }
    expect(() => replaceMediaItem(GAMES, 'jogo', game)).toThrow('Estado inválido. Use planejado, em andamento ou concluído.')
  })

  it('muda o estado de filme sem alterar o pôster e recusa estado inválido', () => {
    const movie = parseMedia('filme', MOVIES).items[0]!
    expect(setMovieStatus(movie, 'concluído')).toEqual({ ...movie, status: 'concluído' })
    expect(() => setMovieStatus(movie, 'pronto' as unknown as MediaStatus)).toThrow(/Estado inválido/)
  })
})

describe('edição preserva o restante do arquivo', () => {
  it('acrescenta um item sem alterar o texto existente', () => {
    const text = appendMediaItem(BOOKS, 'livro', newMediaItem('livro', 'mnew00001', 'Livro novo'))
    expect(text.startsWith(BOOKS)).toBe(true)
    expect(parseMedia('livro', text).items.map((item) => item.id)).toEqual(['mabc12345', 'mdef67890', 'mnew00001'])
  })

  it('recusa acrescentar um ID que já existe', () => {
    expect(() => appendMediaItem(BOOKS, 'livro', newMediaItem('livro', 'mabc12345', 'Repetido'))).toThrow(
      'O identificador mabc12345 aparece mais de uma vez em livros.md.',
    )
  })

  it('altera só o item indicado, mantém o vínculo e as linhas desconhecidas, em CRLF', () => {
    const crlf = BOOKS.replace(/\n/g, '\r\n')
    const book = { ...parseMedia('livro', crlf).items[0]!, pagesRead: 120 }
    const updated = replaceMediaItem(crlf, 'livro', book)
    expect(updated).not.toMatch(/[^\r]\n/)
    expect(updated).toContain('- Páginas lidas: 120')
    expect(updated).toContain('- Anotação livre: manter esta linha')
    expect(updated).toContain('- Agenda: 2026-10-30 19:30 Sessão de leitura')
    expect(updated).toContain('texto que não pertence a nenhum item')
    expect(updated).toContain('## Livro sem total\r\n- ID: mdef67890\r\n- Estado: planejado\r\n- Páginas lidas: 0')
  })

  it('mantém a posição das linhas desconhecidas ao trocar páginas lidas', () => {
    const book = { ...parseMedia('livro', BOOKS).items[0]!, pagesRead: 120 }
    expect(replaceMediaItem(BOOKS, 'livro', book).split('\n')).toEqual(
      BOOKS.split('\n').map((line) => (line === '- Páginas lidas: 40' ? '- Páginas lidas: 120' : line)),
    )
  })

  it('adiciona e remove o vínculo de agenda sem criar tarefa nem outro item', () => {
    const book = parseMedia('livro', BOOKS).items[1]!
    const linked = replaceMediaItem(BOOKS, 'livro', { ...book, agenda: { day: '2026-11-01', time: '08:00', title: 'Ler capítulo 1' } })
    const expected = BOOKS.split('\n')
    expected.splice(16, 0, '- Agenda: 2026-11-01 08:00 Ler capítulo 1')
    expect(linked.split('\n')).toEqual(expected)
    expect(parseMedia('livro', linked).items).toHaveLength(2)

    const unlinked = { ...book }
    delete unlinked.agenda
    expect(replaceMediaItem(linked, 'livro', unlinked)).toBe(BOOKS)
  })
})
