import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMediaWriter, type MediaChange, type MediaDraft } from '../src/main/media-write'
import { parseMedia } from '../src/shared/media'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0x00, 0x00, 0x00]), Buffer.from('WEBPVP8 ')])
const MIB = 1024 * 1024
const STAMP = new Date(2026, 9, 24, 10, 15, 30)

const LIVROS = [
  '# Livros',
  '',
  '## Livro de teste',
  '- ID: mabc12345',
  '- Estado: em andamento',
  '- Páginas lidas: 40',
  '- Total de páginas: 200',
  '- Anotação livre: manter esta linha',
  '- Agenda: 2026-10-30 19:30 Sessão de leitura',
  '',
].join('\n')

const FILMES = ['## Filme de teste', '- ID: mfilm0001', '- Estado: planejado', '- Anotação: sem vínculo', ''].join('\n')

const JOGOS = ['## Jogo de teste', '- ID: mjogo0001', '- Estado: em andamento', '- Favorito: não', '- Platina: não', ''].join('\n')

const AGENDA = '# Agenda\n- 2026-10-30 19:30 Sessão de leitura\n'
const TAREFAS = '## Estudo\n- [ ] Ler capítulo 3 ^t1a2b3c\n'

let vault: string

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), 'ao-media-write-'))
})
afterEach(() => rmSync(vault, { recursive: true, force: true }))

const ids = (...list: string[]) => {
  let i = 0
  return () => list[i++]!
}

const writer = (opts: Parameters<typeof createMediaWriter>[0] = {}) =>
  createMediaWriter({ now: () => STAMP, newId: ids('mnovo0001', 'mnovo0002', 'mnovo0003', 'mnovo0004'), ...opts })

const put = (name: string, text: string) => writeFileSync(join(vault, name), text, 'utf8')
const read = (name: string) => readFileSync(join(vault, name), 'utf8')
const backupsDir = () => join(vault, 'backups', 'midias')
const withMovie = (w = writer()) => {
  put('filmes.md', FILMES)
  w.read(vault, 'filme')
  return w
}

function canLink(kind: 'dir' | 'file'): boolean {
  const base = mkdtempSync(join(tmpdir(), 'ao-media-link-'))
  try {
    if (kind === 'dir') mkdirSync(join(base, 'alvo'))
    else writeFileSync(join(base, 'alvo.png'), '')
    symlinkSync(join(base, kind === 'dir' ? 'alvo' : 'alvo.png'), join(base, 'link'), kind === 'dir' ? 'junction' : 'file')
    return true
  } catch {
    // Without the privilege to create links (Windows without developer mode) the link tests are skipped.
    return false
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
}
const canDirLink = canLink('dir')
const canFileLink = canLink('file')

describe('read', () => {
  it('vault sem Markdown: lista vazia e nada é criado', () => {
    expect(writer().read(vault, 'livro')).toEqual([])
    expect(existsSync(join(vault, 'livros.md'))).toBe(false)
  })

  it('devolve os itens do arquivo existente', () => {
    put('livros.md', LIVROS)
    expect(writer().read(vault, 'livro')).toEqual([
      {
        kind: 'livro',
        id: 'mabc12345',
        title: 'Livro de teste',
        status: 'em andamento',
        pagesRead: 40,
        totalPages: 200,
        agenda: { day: '2026-10-30', time: '19:30', title: 'Sessão de leitura' },
      },
    ])
  })
})

describe('create', () => {
  it('cria com ID novo, estado planejado e páginas em zero, e relê o mesmo item', () => {
    const w = writer()
    w.read(vault, 'livro')
    expect(w.create(vault, 'livro', { title: 'Dom Casmurro' })).toBe('mnovo0001')
    expect(w.read(vault, 'livro')).toEqual([{ kind: 'livro', id: 'mnovo0001', title: 'Dom Casmurro', status: 'planejado', pagesRead: 0 }])
    expect(read('livros.md')).toBe('## Dom Casmurro\n- ID: mnovo0001\n- Estado: planejado\n- Páginas lidas: 0\n')
  })

  it('filme nasce sem pôster e jogo nasce sem favorito nem platina', () => {
    const w = writer()
    w.read(vault, 'filme')
    w.read(vault, 'jogo')
    w.create(vault, 'filme', { title: 'Ran' })
    w.create(vault, 'jogo', { title: 'Hades' })
    expect(w.read(vault, 'filme')).toEqual([{ kind: 'filme', id: 'mnovo0001', title: 'Ran', status: 'planejado' }])
    expect(w.read(vault, 'jogo')).toEqual([
      { kind: 'jogo', id: 'mnovo0002', title: 'Hades', status: 'planejado', favorite: false, platinum: false },
    ])
  })

  it('aceita campos do tipo no rascunho e platina já nasce concluída', () => {
    const w = writer()
    w.read(vault, 'livro')
    w.read(vault, 'jogo')
    w.create(vault, 'livro', { title: 'Dom Casmurro', totalPages: 256 })
    w.create(vault, 'jogo', { title: 'Celeste', platinum: true, favorite: true })
    expect(w.read(vault, 'livro')[0]).toMatchObject({ totalPages: 256, pagesRead: 0 })
    expect(w.read(vault, 'jogo')[0]).toMatchObject({ status: 'concluído', platinum: true, favorite: true })
  })

  it('recusa criar sem antes ler o arquivo', () => {
    expect(() => writer().create(vault, 'livro', { title: 'X' })).toThrow('Abra a biblioteca de novo antes de alterar o livros.md.')
    expect(existsSync(join(vault, 'livros.md'))).toBe(false)
  })

  it('stale-check: recusa quando o Markdown mudou desde a leitura, sem escrever nem fazer backup', () => {
    put('livros.md', LIVROS)
    const w = writer()
    w.read(vault, 'livro')
    put('livros.md', LIVROS + '\n## Outro\n- ID: mnada0001\n- Estado: planejado\n')
    const edited = read('livros.md')

    expect(() => w.create(vault, 'livro', { title: 'Novo' })).toThrow('O livros.md mudou desde que você abriu a biblioteca')
    expect(read('livros.md')).toBe(edited)
    expect(existsSync(join(vault, 'backups'))).toBe(false)
  })

  it('backup datado criado e nunca sobrescrito por outra gravação', () => {
    put('livros.md', LIVROS)
    const first = writer()
    first.read(vault, 'livro')
    first.create(vault, 'livro', { title: 'A' })

    const second = writer({ newId: ids('mnovo0002') })
    second.read(vault, 'livro')
    second.create(vault, 'livro', { title: 'B' })

    const backups = readdirSync(backupsDir())
    expect(backups).toHaveLength(2)
    expect(backups).toContain('livros-2026-10-24-101530.md')
    expect(readFileSync(join(backupsDir(), 'livros-2026-10-24-101530.md'), 'utf8')).toBe(LIVROS)
  })

  it('escolhe outro ID quando o gerador repete um já usado', () => {
    put('livros.md', LIVROS)
    const w = writer({ newId: ids('mabc12345', 'mnovo0003') })
    w.read(vault, 'livro')
    expect(w.create(vault, 'livro', { title: 'Outro' })).toBe('mnovo0003')
  })

  it('recusa título vazio ou campo que não existe para o tipo, sem gravar', () => {
    const w = writer()
    w.read(vault, 'livro')
    expect(() => w.create(vault, 'livro', { title: '   ' })).toThrow('O título precisa ter de 1 a 200 caracteres')
    expect(() => w.create(vault, 'livro', { title: 'X', favorite: true } as unknown as MediaDraft<'livro'>)).toThrow(
      'Este campo não existe para livros.',
    )
    expect(existsSync(join(vault, 'livros.md'))).toBe(false)
  })
})

describe('update', () => {
  it('platina conclui o jogo e desmarcar a platina não reabre', () => {
    put('jogos.md', JOGOS)
    const w = writer()
    w.read(vault, 'jogo')
    w.update(vault, 'jogo', 'mjogo0001', { platinum: true })
    expect(w.read(vault, 'jogo')[0]).toMatchObject({ status: 'concluído', platinum: true })

    w.update(vault, 'jogo', 'mjogo0001', { platinum: false })
    expect(w.read(vault, 'jogo')[0]).toMatchObject({ status: 'concluído', platinum: false })
  })

  it('jogo platinado não volta para planejado enquanto a platina estiver marcada', () => {
    put('jogos.md', JOGOS)
    const w = writer()
    w.read(vault, 'jogo')
    w.update(vault, 'jogo', 'mjogo0001', { platinum: true })
    expect(() => w.update(vault, 'jogo', 'mjogo0001', { status: 'planejado' })).toThrow('é platinado')
    expect(w.read(vault, 'jogo')[0]).toMatchObject({ status: 'concluído', platinum: true })
  })

  it('páginas: atualiza, não muda o estado ao chegar no total e recusa valores fora do limite', () => {
    put('livros.md', LIVROS)
    const w = writer()
    w.read(vault, 'livro')
    w.update(vault, 'livro', 'mabc12345', { pagesRead: 200 })
    expect(w.read(vault, 'livro')[0]).toMatchObject({ pagesRead: 200, status: 'em andamento' })

    expect(() => w.update(vault, 'livro', 'mabc12345', { pagesRead: 201 })).toThrow('não pode ser maior que o total de páginas')
    expect(() => w.update(vault, 'livro', 'mabc12345', { pagesRead: -1 })).toThrow('inteiro maior ou igual a zero')
    expect(w.read(vault, 'livro')[0]).toMatchObject({ pagesRead: 200 })
  })

  it('total de páginas pode ser removido com null', () => {
    put('livros.md', LIVROS)
    const w = writer()
    w.read(vault, 'livro')
    w.update(vault, 'livro', 'mabc12345', { totalPages: null })
    const [book] = w.read(vault, 'livro')
    expect(book!.totalPages).toBeUndefined()
    expect(read('livros.md')).not.toContain('Total de páginas')
  })

  it('atualiza item com Estado sem espaço após o hífen sem trocar o estado silenciosamente', () => {
    const text = '## Livro\n- ID: mabc12345\n-Estado: concluído\n- Páginas lidas: 4\n'
    put('livros.md', text)
    const w = writer()
    w.read(vault, 'livro')
    w.update(vault, 'livro', 'mabc12345', { pagesRead: 5 })
    expect(w.read(vault, 'livro')[0]).toMatchObject({ status: 'concluído', pagesRead: 5 })
    expect(read('livros.md')).toContain('- Estado: concluído')
  })

  it('permite desmarcar platina e reabrir jogo na mesma atualização', () => {
    put('jogos.md', JOGOS.replace('- Estado: em andamento', '- Estado: concluído').replace('- Platina: não', '- Platina: sim'))
    const w = writer()
    w.read(vault, 'jogo')
    w.update(vault, 'jogo', 'mjogo0001', { platinum: false, status: 'planejado' })
    expect(w.read(vault, 'jogo')[0]).toMatchObject({ platinum: false, status: 'planejado' })
  })

  it('mudar o estado do filme mantém o pôster', () => {
    put('filmes.md', FILMES.replace('- Anotação', '- Pôster: midias/posters/mfilm0001.png\n- Anotação'))
    const w = writer()
    w.read(vault, 'filme')
    w.update(vault, 'filme', 'mfilm0001', { status: 'concluído' })
    expect(w.read(vault, 'filme')[0]).toMatchObject({ status: 'concluído', posterPath: 'midias/posters/mfilm0001.png' })
  })

  it('preserva as linhas desconhecidas e troca só o campo alterado', () => {
    put('livros.md', LIVROS)
    const w = writer()
    w.read(vault, 'livro')
    w.update(vault, 'livro', 'mabc12345', { pagesRead: 120 })
    expect(read('livros.md')).toBe(LIVROS.replace('- Páginas lidas: 40', '- Páginas lidas: 120'))
  })

  it('mantém a marca de ordem de bytes (BOM) do arquivo', () => {
    put('livros.md', '\uFEFF' + LIVROS)
    const w = writer()
    w.read(vault, 'livro')
    w.update(vault, 'livro', 'mabc12345', { pagesRead: 120 })
    expect(read('livros.md')).toBe('\uFEFF' + LIVROS.replace('- Páginas lidas: 40', '- Páginas lidas: 120'))
  })

  it('sem mudança real não grava nem faz backup', () => {
    put('livros.md', LIVROS)
    const w = writer()
    w.read(vault, 'livro')
    w.update(vault, 'livro', 'mabc12345', { status: 'em andamento' })
    expect(existsSync(join(vault, 'backups'))).toBe(false)
    expect(read('livros.md')).toBe(LIVROS)
  })

  it('stale-check também vale para atualização', () => {
    put('livros.md', LIVROS)
    const w = writer()
    w.read(vault, 'livro')
    put('livros.md', LIVROS.replace('Livro de teste', 'Livro editado no Obsidian'))
    expect(() => w.update(vault, 'livro', 'mabc12345', { pagesRead: 1 })).toThrow('mudou desde que você abriu')
    expect(read('livros.md')).toContain('Livro editado no Obsidian')
    expect(existsSync(join(vault, 'backups'))).toBe(false)
  })

  it('recusa item inexistente e campo de outro tipo', () => {
    put('livros.md', LIVROS)
    put('filmes.md', FILMES)
    const w = writer()
    w.read(vault, 'livro')
    w.read(vault, 'filme')
    expect(() => w.update(vault, 'livro', 'mnada0001', { pagesRead: 1 })).toThrow('Não encontrei este item em livros.md.')
    expect(() => w.update(vault, 'filme', 'mfilm0001', { pagesRead: 3 } as unknown as MediaChange<'filme'>)).toThrow(
      'Este campo não existe para filmes.',
    )
  })
})

describe('vínculo com a agenda', () => {
  it('linkAgenda grava só a referência e não cria tarefa nem altera agenda.md', () => {
    put('agenda.md', AGENDA)
    put('tarefas.md', TAREFAS)
    put('planning.json', '{}')
    const w = withMovie()
    w.linkAgenda(vault, 'filme', 'mfilm0001', { day: '2026-11-02', time: '20:00', title: 'Cinema com a família' })

    expect(w.read(vault, 'filme')[0]).toMatchObject({ agenda: { day: '2026-11-02', time: '20:00', title: 'Cinema com a família' } })
    expect(read('agenda.md')).toBe(AGENDA)
    expect(read('tarefas.md')).toBe(TAREFAS)
    expect(read('planning.json')).toBe('{}')
  })

  it('vincular num vault sem tarefas não cria tarefas.md, agenda.md nem planning.json', () => {
    const w = withMovie()
    w.linkAgenda(vault, 'filme', 'mfilm0001', { day: '2026-11-02', time: '20:00', title: 'Cinema' })
    expect(readdirSync(vault).sort()).toEqual(['backups', 'filmes.md'])
  })

  it('desvincular volta ao texto de antes do vínculo', () => {
    const w = withMovie()
    w.linkAgenda(vault, 'filme', 'mfilm0001', { day: '2026-11-02', time: '20:00', title: 'Cinema' })
    w.unlinkAgenda(vault, 'filme', 'mfilm0001')
    expect(read('filmes.md')).toBe(FILMES)
  })

  it('recusa data, hora ou título inválidos', () => {
    const w = withMovie()
    const link = (agenda: { day: string; time: string; title: string }) => () => w.linkAgenda(vault, 'filme', 'mfilm0001', agenda)
    expect(link({ day: '30-10-2026', time: '19:30', title: 'Cinema' })).toThrow('formato AAAA-MM-DD HH:MM')
    expect(link({ day: '2026-10-30', time: '25:00', title: 'Cinema' })).toThrow('formato AAAA-MM-DD HH:MM')
    expect(link({ day: '2026-10-30', time: '19:30', title: '' })).toThrow('formato AAAA-MM-DD HH:MM')
    expect(read('filmes.md')).toBe(FILMES)
  })
})

describe('pôster', () => {
  it.each([
    ['png', PNG],
    ['PNG', PNG],
    ['jpg', JPEG],
    ['jpeg', JPEG],
    ['webp', WEBP],
  ])('aceita a extensão %s e grava os bytes sem alterar', (extension, bytes) => {
    const w = withMovie()
    const rel = `midias/posters/mfilm0001.${extension.toLowerCase()}`
    expect(w.attachPoster(vault, 'mfilm0001', { bytes, extension })).toBe(rel)
    expect(readFileSync(join(vault, ...rel.split('/')))).toEqual(bytes)
    expect(parseMedia('filme', read('filmes.md')).items[0]).toMatchObject({ posterPath: rel })
  })

  it('assinatura que não bate com a extensão é recusada e nada é gravado', () => {
    const w = withMovie()
    expect(() => w.attachPoster(vault, 'mfilm0001', { bytes: JPEG, extension: 'png' })).toThrow('não é um PNG válido')
    expect(() => w.attachPoster(vault, 'mfilm0001', { bytes: PNG, extension: 'webp' })).toThrow('não é um WebP válido')
    expect(() => w.attachPoster(vault, 'mfilm0001', { bytes: Buffer.from('RIFF0000WAVE'), extension: 'webp' })).toThrow(
      'não é um WebP válido',
    )
    expect(() => w.attachPoster(vault, 'mfilm0001', { bytes: Buffer.from('texto qualquer'), extension: 'jpg' })).toThrow(
      'não é um JPEG válido',
    )
    expect(existsSync(join(vault, 'midias'))).toBe(false)
    expect(read('filmes.md')).toBe(FILMES)
  })

  it.each(['gif', 'svg', '.png', 'png/../x', ''])('extensão %j fora da lista é recusada', (extension) => {
    const w = withMovie()
    expect(() => w.attachPoster(vault, 'mfilm0001', { bytes: PNG, extension })).toThrow('Escolha um pôster PNG, JPEG ou WebP.')
    expect(existsSync(join(vault, 'midias'))).toBe(false)
  })

  it('recusa arquivo vazio e acima de 10 MiB, e aceita exatamente 10 MiB', () => {
    const w = withMovie()
    expect(() => w.attachPoster(vault, 'mfilm0001', { bytes: Buffer.alloc(0), extension: 'png' })).toThrow('está vazio')
    const over = Buffer.concat([PNG, Buffer.alloc(10 * MIB - PNG.length + 1)])
    expect(() => w.attachPoster(vault, 'mfilm0001', { bytes: over, extension: 'png' })).toThrow('passa de 10 MiB')
    const exact = Buffer.concat([PNG, Buffer.alloc(10 * MIB - PNG.length)])
    expect(w.attachPoster(vault, 'mfilm0001', { bytes: exact, extension: 'png' })).toBe('midias/posters/mfilm0001.png')
  })

  it('id com ".." é recusado e nada é criado fora da pasta do vault', () => {
    const w = withMovie()
    expect(() => w.attachPoster(vault, '../mfilm0001', { bytes: PNG, extension: 'png' })).toThrow('é inválido')
    expect(() => w.attachPoster(vault, '..\\..\\fora', { bytes: PNG, extension: 'png' })).toThrow('é inválido')
    expect(readdirSync(vault)).toEqual(['filmes.md'])
  })

  it('filme inexistente é recusado antes de copiar o pôster', () => {
    const w = withMovie()
    expect(() => w.attachPoster(vault, 'mnada0001', { bytes: PNG, extension: 'png' })).toThrow('Não encontrei este item em filmes.md.')
    expect(existsSync(join(vault, 'midias'))).toBe(false)
  })

  it('stale-check: recusa se o filmes.md mudou e não copia o pôster', () => {
    const w = withMovie()
    put('filmes.md', FILMES + '\n## Outro\n- ID: mnada0001\n- Estado: planejado\n')
    expect(() => w.attachPoster(vault, 'mfilm0001', { bytes: PNG, extension: 'png' })).toThrow('mudou desde que você abriu')
    expect(existsSync(join(vault, 'midias'))).toBe(false)
  })

  it('falha simulada na gravação do Markdown remove o pôster novo', () => {
    put('filmes.md', FILMES)
    const w = writer({
      writeText: (file) => {
        if (file.endsWith('filmes.md')) throw new Error('disco cheio')
      },
    })
    w.read(vault, 'filme')
    expect(() => w.attachPoster(vault, 'mfilm0001', { bytes: PNG, extension: 'png' })).toThrow('Não foi possível gravar filmes.md')
    expect(existsSync(join(vault, 'midias', 'posters', 'mfilm0001.png'))).toBe(false)
    expect(read('filmes.md')).toBe(FILMES)
  })

  it('falha na gravação devolve o pôster anterior que estava no mesmo caminho', () => {
    put('filmes.md', FILMES)
    mkdirSync(join(vault, 'midias', 'posters'), { recursive: true })
    const previous = Buffer.concat([PNG, Buffer.from('anterior')])
    writeFileSync(join(vault, 'midias', 'posters', 'mfilm0001.png'), previous)
    const w = writer({
      writeText: (file) => {
        if (file.endsWith('filmes.md')) throw new Error('disco cheio')
      },
    })
    w.read(vault, 'filme')
    expect(() => w.attachPoster(vault, 'mfilm0001', { bytes: Buffer.concat([PNG, Buffer.from('novo')]), extension: 'png' })).toThrow(
      'Não foi possível gravar filmes.md',
    )
    expect(readFileSync(join(vault, 'midias', 'posters', 'mfilm0001.png'))).toEqual(previous)
    expect(read('filmes.md')).toBe(FILMES)
  })

  it('falha no registro restaura o pôster anterior e remove o novo quando a extensão mudou', () => {
    put('filmes.md', FILMES.replace('- Anotação', '- Pôster: midias/posters/mfilm0001.jpg\n- Anotação'))
    mkdirSync(join(vault, 'midias', 'posters'), { recursive: true })
    const previous = Buffer.concat([JPEG, Buffer.from('anterior')])
    writeFileSync(join(vault, 'midias', 'posters', 'mfilm0001.jpg'), previous)
    const w = writer({
      writeText: (file) => {
        if (file.endsWith('filmes.md')) throw new Error('disco cheio')
      },
    })
    w.read(vault, 'filme')
    expect(() => w.attachPoster(vault, 'mfilm0001', { bytes: PNG, extension: 'png' })).toThrow('Não foi possível gravar filmes.md')
    expect(readFileSync(join(vault, 'midias', 'posters', 'mfilm0001.jpg'))).toEqual(previous)
    expect(existsSync(join(vault, 'midias', 'posters', 'mfilm0001.png'))).toBe(false)
  })

  it('ao trocar a extensão com sucesso, remove o pôster anterior regular', () => {
    put('filmes.md', FILMES.replace('- Anotação', '- Pôster: midias/posters/mfilm0001.jpg\n- Anotação'))
    mkdirSync(join(vault, 'midias', 'posters'), { recursive: true })
    writeFileSync(join(vault, 'midias', 'posters', 'mfilm0001.jpg'), JPEG)
    const w = writer()
    w.read(vault, 'filme')
    w.attachPoster(vault, 'mfilm0001', { bytes: PNG, extension: 'png' })
    expect(existsSync(join(vault, 'midias', 'posters', 'mfilm0001.jpg'))).toBe(false)
    expect(readFileSync(join(vault, 'midias', 'posters', 'mfilm0001.png'))).toEqual(PNG)
  })

  it('trocar o pôster no mesmo caminho grava os bytes novos e mantém o registro', () => {
    put('filmes.md', FILMES.replace('- Anotação', '- Pôster: midias/posters/mfilm0001.png\n- Anotação'))
    mkdirSync(join(vault, 'midias', 'posters'), { recursive: true })
    writeFileSync(join(vault, 'midias', 'posters', 'mfilm0001.png'), PNG)
    const novo = Buffer.concat([PNG, Buffer.from('novo')])
    const w = writer()
    w.read(vault, 'filme')
    w.attachPoster(vault, 'mfilm0001', { bytes: novo, extension: 'png' })
    expect(read('filmes.md')).toContain('- Pôster: midias/posters/mfilm0001.png')
    expect(readFileSync(join(vault, 'midias', 'posters', 'mfilm0001.png'))).toEqual(novo)
    expect(w.read(vault, 'filme')[0]).toMatchObject({ posterPath: 'midias/posters/mfilm0001.png' })
  })

  it.runIf(canDirLink)('pasta midias/posters que é um link para fora do vault é recusada', () => {
    const outside = mkdtempSync(join(tmpdir(), 'ao-media-outside-'))
    try {
      mkdirSync(join(vault, 'midias'))
      symlinkSync(outside, join(vault, 'midias', 'posters'), 'junction')
      const w = withMovie()
      expect(() => w.attachPoster(vault, 'mfilm0001', { bytes: PNG, extension: 'png' })).toThrow('Caminho de pôster inválido')
      expect(readdirSync(outside)).toEqual([])
      expect(read('filmes.md')).toBe(FILMES)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it.runIf(canFileLink)('arquivo de pôster que é um link é recusado e o alvo fica intacto', () => {
    const outside = mkdtempSync(join(tmpdir(), 'ao-media-outside-'))
    try {
      const target = join(outside, 'alvo.png')
      writeFileSync(target, PNG)
      mkdirSync(join(vault, 'midias', 'posters'), { recursive: true })
      symlinkSync(target, join(vault, 'midias', 'posters', 'mfilm0001.png'), 'file')
      const w = withMovie()
      expect(() => w.attachPoster(vault, 'mfilm0001', { bytes: Buffer.concat([PNG, Buffer.from('x')]), extension: 'png' })).toThrow(
        'Caminho de pôster inválido',
      )
      expect(readFileSync(target)).toEqual(PNG)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it.runIf(canFileLink)('temporário de pôster que é link é recusado sem alterar alvo nem criar pôster', () => {
    const outside = mkdtempSync(join(tmpdir(), 'ao-media-outside-'))
    try {
      const target = join(outside, 'alvo.png')
      writeFileSync(target, Buffer.from('intacto'))
      mkdirSync(join(vault, 'midias', 'posters'), { recursive: true })
      symlinkSync(target, join(vault, 'midias', 'posters', 'mfilm0001.png.tmp'), 'file')
      const w = withMovie()
      expect(() => w.attachPoster(vault, 'mfilm0001', { bytes: PNG, extension: 'png' })).toThrow('Caminho de pôster inválido')
      expect(readFileSync(target, 'utf8')).toBe('intacto')
      expect(existsSync(join(vault, 'midias', 'posters', 'mfilm0001.png'))).toBe(false)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it.runIf(canDirLink)('diretório backups/midias que aponta para fora é recusado sem escrita externa', () => {
    const outside = mkdtempSync(join(tmpdir(), 'ao-media-outside-'))
    try {
      mkdirSync(join(vault, 'backups'))
      symlinkSync(outside, backupsDir(), 'junction')
      const w = withMovie()
      expect(() => w.update(vault, 'filme', 'mfilm0001', { status: 'concluído' })).toThrow('Caminho de backup inválido')
      expect(readdirSync(outside)).toEqual([])
      expect(read('filmes.md')).toBe(FILMES)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('erro de gravação do Markdown é apresentado em pt-BR e mantém a causa', () => {
    put('livros.md', LIVROS)
    const cause = Object.assign(new Error('disk full'), { code: 'ENOSPC' })
    const w = writer({
      writeText: () => {
        throw cause
      },
    })
    w.read(vault, 'livro')
    try {
      w.update(vault, 'livro', 'mabc12345', { pagesRead: 41 })
      throw new Error('esperava falha')
    } catch (err) {
      expect((err as Error).message).toContain('Não foi possível gravar livros.md')
      expect((err as Error & { cause?: unknown }).cause).toBe(cause)
    }
  })
})

describe('escopo das gravações', () => {
  it('nenhuma operação de mídia cria ou altera tarefas.md, agenda.md ou planning.json', () => {
    put('agenda.md', AGENDA)
    put('tarefas.md', TAREFAS)
    put('planning.json', '{}')
    put('livros.md', LIVROS)
    put('filmes.md', FILMES)
    put('jogos.md', JOGOS)
    const w = writer()
    w.read(vault, 'livro')
    w.read(vault, 'filme')
    w.read(vault, 'jogo')
    w.create(vault, 'livro', { title: 'Novo livro' })
    w.update(vault, 'jogo', 'mjogo0001', { platinum: true })
    w.linkAgenda(vault, 'filme', 'mfilm0001', { day: '2026-11-02', time: '20:00', title: 'Cinema' })
    w.attachPoster(vault, 'mfilm0001', { bytes: PNG, extension: 'png' })

    expect(read('agenda.md')).toBe(AGENDA)
    expect(read('tarefas.md')).toBe(TAREFAS)
    expect(read('planning.json')).toBe('{}')
    expect(existsSync(join(vault, 'tarefas.md.tmp'))).toBe(false)
    expect(readdirSync(vault).sort()).toEqual([
      'agenda.md',
      'backups',
      'filmes.md',
      'jogos.md',
      'livros.md',
      'midias',
      'planning.json',
      'tarefas.md',
    ])
    expect(lstatSync(join(vault, 'midias', 'posters', 'mfilm0001.png')).isFile()).toBe(true)
  })
})
