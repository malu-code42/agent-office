import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendGoal, goalProgress, linkGoalTask, parseGoals, serializeGoals, setGoalMilestone } from '../src/shared/goals'
import { createGoalsWriter } from '../src/main/goals-write'
import { parseTasksFile } from '../src/shared/tasks'

const ID = 'gabc12345'
const START = [
  '# Objetivos pessoais',
  '',
  'texto que o codec não conhece e deve ficar intacto',
  '',
  '## Estudar TypeScript',
  `- ID: ${ID}`,
  '- Alvo: concluir o curso',
  '- Prazo: 2026-12-31',
  '- Estado: ativo',
  '- Marco: [ ] Módulos 1–3',
  '- Observação livre: manter esta linha',
  '- Marco: [x] Inscrição feita',
  '- Tarefa: ^tabc123',
  '',
  'linha extra no final',
].join('\n')

let vault: string
beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), 'agent-office-goals-'))
})
afterEach(() => rmSync(vault, { recursive: true, force: true }))

describe('codec de objetivos.md', () => {
  it('faz round-trip sem perder linhas desconhecidas nem a quebra de linha final', () => {
    const document = parseGoals(`${START}\n`)
    expect(serializeGoals(document)).toBe(`${START}\n`)
    expect(document.goals).toHaveLength(1)
    expect(document.goals[0]?.milestones).toEqual([
      { done: false, text: 'Módulos 1–3' },
      { done: true, text: 'Inscrição feita' },
    ])
  })

  it('preserva CRLF ao editar um marco', () => {
    const crlf = START.replace(/\n/g, '\r\n')
    const updated = setGoalMilestone(crlf, ID, 0, true)
    expect(updated).toContain('\r\n- Observação livre: manter esta linha\r\n')
    expect(updated.replace(/\r\n/g, '')).not.toContain('\n')
    expect(parseGoals(updated).goals[0]?.milestones[0]?.done).toBe(true)
  })

  it('adiciona, atualiza marco e vínculo sem alterar as linhas não reconhecidas', () => {
    const newText = appendGoal(START, {
      id: 'gdef67890',
      title: 'Ler',
      target: 'Ler 12 livros',
      deadline: '2026-12-31',
      milestones: [{ done: false, text: 'Ler 4 livros' }],
      taskIds: ['tdef456'],
    })
    const updated = setGoalMilestone(newText, 'gdef67890', 0, true)
    const linked = linkGoalTask(updated, 'gdef67890', 'tdef456')
    expect(linked).toBe(updated)
    expect(linked).toContain('texto que o codec não conhece e deve ficar intacto')
    expect(linked).toContain('- Observação livre: manter esta linha')
    expect(linked.match(/- Tarefa: \^tdef456/g)).toHaveLength(1)
    expect(parseGoals(linked).goals[1]?.milestones[0]?.done).toBe(true)
  })
})

describe('progresso dos objetivos', () => {
  it('mantém progresso em zero com denominador vazio', () => {
    const goal = { ...parseGoals(START).goals[0]!, milestones: [], taskIds: [] }
    expect(goalProgress(goal, new Set())).toEqual({ complete: 0, total: 0, percent: 0 })
  })

  it('pesa marcos e tarefas vinculadas igualmente, sem contar vínculos duplicados', () => {
    const goal = { ...parseGoals(START).goals[0]!, taskIds: ['tabc123', 'tabc123', 'tdef456'] }
    const progress = goalProgress(goal, new Set(['tabc123']))
    expect(progress).toEqual({ complete: 2, total: 4, percent: 50 })
  })

  it('vincular não duplica nem conclui tarefas canônicas', () => {
    const tasksText = '## A fazer\n- [ ] Tarefa importante ^tabc123\n'
    const originalTasks = tasksText
    const linked = linkGoalTask(START, ID, 'tabc123')
    expect(parseGoals(linked).goals[0]?.taskIds).toEqual(['tabc123'])
    expect(parseTasksFile(tasksText).lists[0]?.tasks[0]?.status).toBe('open')
    expect(tasksText).toBe(originalTasks)
  })
})

describe('writer de objetivos', () => {
  const at = () => new Date(2026, 9, 23, 11, 12, 13)
  const draft = {
    title: 'Meta',
    target: 'Alcançar 10',
    deadline: '2026-12-31',
    milestones: [{ text: 'Chegar a 5', done: false }],
    taskIds: [],
  }

  it('recusa conflito obsoleto e não cria backup nem escreve por cima da edição do Obsidian', () => {
    writeFileSync(join(vault, 'objetivos.md'), START)
    const writer = createGoalsWriter({ now: at, newId: () => ID })
    writer.read(vault)
    writeFileSync(join(vault, 'objetivos.md'), `${START}\nedição concorrente`)
    expect(() => writer.setMilestone(vault, ID, 0, true)).toThrow(/mudou desde que você abriu/)
    expect(readFileSync(join(vault, 'objetivos.md'), 'utf8')).toBe(`${START}\nedição concorrente`)
    expect(readdirSync(vault)).toEqual(['objetivos.md'])
  })

  it('faz backup anterior e grava atomically em fixtures temporárias', () => {
    writeFileSync(join(vault, 'objetivos.md'), START)
    const writer = createGoalsWriter({ now: at, newId: () => 'gdef67890' })
    writer.read(vault)
    writer.create(vault, draft)
    const backup = join(vault, 'backups', 'objetivos', 'objetivos-2026-10-23-111213.md')
    expect(readFileSync(backup, 'utf8')).toBe(START)
    expect(readFileSync(join(vault, 'objetivos.md'), 'utf8')).toContain('## Meta')
    expect(readdirSync(vault)).toContain('objetivos.md')
    expect(readdirSync(join(vault, 'backups', 'objetivos'))).toEqual(['objetivos-2026-10-23-111213.md'])
    expect(readdirSync(vault, { recursive: true }).some((entry) => String(entry).endsWith('.tmp'))).toBe(false)
  })

  it('só marca alcançado após progresso integral e confirmação explícita', async () => {
    const ready = START.replace('- Marco: [ ] Módulos 1–3', '- Marco: [x] Módulos 1–3')
    writeFileSync(join(vault, 'objetivos.md'), ready)
    const tasks = [{ id: 'tabc123', status: 'completed' as const, text: 'Tarefa', line: 1 }]
    let asks = 0
    const writer = createGoalsWriter({ now: at, confirmAchieved: async () => (asks++, false) })
    writer.read(vault)
    await expect(writer.achieve(vault, ID, tasks)).resolves.toBe(false)
    expect(asks).toBe(1)
    expect(readFileSync(join(vault, 'objetivos.md'), 'utf8')).toBe(ready)

    writeFileSync(join(vault, 'tarefas.md'), '## A fazer\n- [x] Tarefa ^tabc123\n')
    const confirmed = createGoalsWriter({ now: at, confirmAchieved: async () => true })
    confirmed.read(vault)
    await expect(confirmed.achieve(vault, ID, tasks)).resolves.toBe(true)
    expect(readFileSync(join(vault, 'objetivos.md'), 'utf8')).toContain('- Estado: alcançado')
  })

  it('revalida tarefas.md após confirmação e preserva a tarefa reaberta sem alcançar a meta', async () => {
    const ready = START.replace('- Marco: [ ] Módulos 1–3', '- Marco: [x] Módulos 1–3')
    const completedTasks = '## A fazer\n- [x] Tarefa importante ^tabc123\n'
    const reopenedTasks = '## A fazer\n- [ ] Tarefa importante ^tabc123\n'
    writeFileSync(join(vault, 'objetivos.md'), ready)
    writeFileSync(join(vault, 'tarefas.md'), completedTasks)
    const writer = createGoalsWriter({
      now: at,
      confirmAchieved: async () => {
        writeFileSync(join(vault, 'tarefas.md'), reopenedTasks)
        return true
      },
    })
    writer.read(vault)

    await expect(writer.achieve(vault, ID, [{ id: 'tabc123', status: 'completed', text: 'Tarefa importante', line: 1 }])).rejects.toThrow(
      /progresso do objetivo mudou durante a confirmação.*100%/,
    )
    expect(readFileSync(join(vault, 'objetivos.md'), 'utf8')).toBe(ready)
    expect(readFileSync(join(vault, 'tarefas.md'), 'utf8')).toBe(reopenedTasks)
    expect(readdirSync(vault).sort()).toEqual(['objetivos.md', 'tarefas.md'])
  })
})

describe('objetivos.txt (checklist simples)', () => {
  const LIST = ['- [ ] Concluir o curso A', '- [x] Terminar o livro B', '- [ ] Publicar o projeto C'].join('\n')
  const confirm = { confirmAchieved: async () => true }

  it('lê itens como objetivos sem alvo, prazo nem marcos', () => {
    const { goals } = parseGoals(`${LIST}\n`)
    expect(goals.map((g) => [g.title, g.achieved, g.simple, g.deadline])).toEqual([
      ['Concluir o curso A', false, true, ''],
      ['Terminar o livro B', true, true, ''],
      ['Publicar o projeto C', false, true, ''],
    ])
    expect(new Set(goals.map((g) => g.id)).size).toBe(3)
    expect(parseGoals(`${LIST}\n`).goals[0]?.id).toBe(goals[0]?.id)
  })

  it('o writer usa o objetivos.txt, cria e conclui sem mudar o formato', async () => {
    writeFileSync(join(vault, 'objetivos.txt'), `${LIST}\n`)
    writeFileSync(join(vault, 'tarefas.md'), '## A fazer\n')
    const writer = createGoalsWriter({ ...confirm, newId: () => 'gnew00001' })
    const { goals } = writer.read(vault)
    expect(goals).toHaveLength(3)
    writer.create(vault, { title: 'Novo item', target: 'x', deadline: '2026-12-31', milestones: [], taskIds: [] })
    expect(await writer.achieve(vault, goals[0]!.id, [])).toBe(true)
    expect(readFileSync(join(vault, 'objetivos.txt'), 'utf8')).toBe(
      ['- [x] Concluir o curso A', '- [x] Terminar o livro B', '- [ ] Publicar o projeto C', '- [ ] Novo item', ''].join('\n'),
    )
    expect(readdirSync(vault)).not.toContain('objetivos.md')
    expect(() => writer.setMilestone(vault, goals[1]!.id, 0, true)).toThrow(/simples/)
  })

  it('prefere objetivos.md quando os dois existem', () => {
    writeFileSync(join(vault, 'objetivos.md'), `${START}\n`)
    writeFileSync(join(vault, 'objetivos.txt'), `${LIST}\n`)
    expect(
      createGoalsWriter()
        .read(vault)
        .goals.map((g) => g.id),
    ).toEqual([ID])
  })
})
