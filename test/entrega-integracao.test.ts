// Ticket 21 (#59): combined flows over one fixture vault. Every canonical file is open in the app
// while "Obsidian" edits all of them; no writer may overwrite those edits, and after a fresh read the
// same flows write only their own file. Also guards that no test points at the real vault or app data.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AGENDA_FILE, createAgendaWriter, planAddCommitment } from '../src/main/agenda-write'
import { createGoalsWriter } from '../src/main/goals-write'
import { createMediaWriter } from '../src/main/media-write'
import { TASKS_FILE, createTaskWriter } from '../src/main/tasks-write'

const GOAL = 'gabc12345'
const FILES: Record<string, string> = {
  [TASKS_FILE]: '## Estudo\n- [ ] Ler capítulo 3 ^t1a2b3c\n',
  [AGENDA_FILE]: '# Agenda\n\n## 2026-10-30\n- 19:30 Sessão de leitura\n',
  'objetivos.md': ['# Objetivos', '', '## Estudar TypeScript', `- ID: ${GOAL}`, '- Alvo: concluir o curso', '- Prazo: 2026-12-31', '- Estado: ativo', '- Marco: [ ] Módulos 1–3', ''].join('\n'),
  'livros.md': ['## Livro de teste', '- ID: mabc12345', '- Estado: em andamento', '- Páginas lidas: 40', ''].join('\n'),
}
const STAMP = new Date(2026, 9, 31, 9, 0, 0)

let vault: string
beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), 'ao-entrega-'))
  for (const [name, text] of Object.entries(FILES)) writeFileSync(join(vault, name), text)
})
afterEach(() => rmSync(vault, { recursive: true, force: true }))

const snapshot = (): Record<string, string> =>
  Object.fromEntries(readdirSync(vault).filter((n) => n.endsWith('.md')).map((n) => [n, readFileSync(join(vault, n), 'utf8')]))

function openAll() {
  const tasks = createTaskWriter({ now: () => STAMP, newId: () => 'tnew001' })
  const agenda = createAgendaWriter({ now: () => STAMP })
  const goals = createGoalsWriter({ now: () => STAMP })
  const media = createMediaWriter({ now: () => STAMP, newId: () => 'mnovo0001' })
  tasks.remember(vault, readFileSync(join(vault, TASKS_FILE), 'utf8'))
  agenda.read(vault)
  goals.read(vault)
  media.read(vault, 'livro')
  return { tasks, agenda, goals, media }
}

describe('vault fixture: edição concorrente em todos os arquivos', () => {
  it('nenhum fluxo escreve por cima da edição do Obsidian nem cria backup', () => {
    const w = openAll()
    for (const name of Object.keys(FILES)) writeFileSync(join(vault, name), `${FILES[name]}\nedição concorrente em ${name}\n`)
    const edited = snapshot()

    expect(() => w.tasks.create(vault, { title: 'Nova', list: 'Estudo' })).toThrow(/mudou/)
    expect(() => w.agenda.current(vault)).toThrow(/mudou/)
    expect(() => w.agenda.write(vault, FILES[AGENDA_FILE], 'perdido')).toThrow(/mudou/)
    expect(() => w.goals.setMilestone(vault, GOAL, 0, true)).toThrow(/mudou/)
    expect(() => w.media.create(vault, 'livro', { title: 'Dom Casmurro' })).toThrow(/mudou/)

    expect(snapshot()).toEqual(edited)
    expect(existsSync(join(vault, 'backups'))).toBe(false)
  })

  it('depois de reler, cada fluxo grava só o próprio arquivo e preserva a edição', () => {
    for (const name of Object.keys(FILES)) writeFileSync(join(vault, name), `${FILES[name]}\nedição concorrente em ${name}\n`)
    const w = openAll()
    const before = snapshot()

    w.tasks.create(vault, { title: 'Nova', list: 'Estudo' })
    const agendaText = w.agenda.current(vault)
    w.agenda.write(vault, agendaText, planAddCommitment(agendaText, { day: '2026-10-30', time: '08:00', title: 'Aula' }))
    w.goals.setMilestone(vault, GOAL, 0, true)
    w.media.create(vault, 'livro', { title: 'Dom Casmurro' })

    const after = snapshot()
    for (const name of Object.keys(FILES)) {
      expect(after[name]).not.toBe(before[name])
      expect(after[name]).toContain(`edição concorrente em ${name}`)
    }
    expect(after[TASKS_FILE]).toContain('Nova')
    expect(after[AGENDA_FILE]).toContain('Aula')
    expect(after['objetivos.md']).toContain('[x] Módulos 1–3')
    expect(after['livros.md']).toContain('Dom Casmurro')
  })
})

describe('testes nunca apontam para o vault real nem para os dados do app', () => {
  const root = resolve(__dirname)
  const real = [/vault-agent-office/i, /AppData[\\/]+Roaming[\\/]+agent-office/i, /study-pdf-cache|ocr-lang/]
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(join(dir, e.name)) : /\.(ts|mjs|js)$/.test(e.name) ? [join(dir, e.name)] : [],
    )

  it.each(files(root).map((f) => [f.slice(root.length + 1), f]))('%s', (_name, file) => {
    const text = readFileSync(file, 'utf8').replace(/const real = \[.*\]/, '')
    for (const pattern of real) expect(text).not.toMatch(pattern)
  })
})
