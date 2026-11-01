// Bonnie's own tools (`mcp__estudos__`): the study floor as she talks about it. Every tool hands
// Claude the minimal study material the user authorized in #75/#90: topics, stages, counts,
// the class grid, and Cora's ranked source names with page ranges. Never a file's content,
// never the user's answers, never a whole-library read.

import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { ClassScheduleView } from '@shared/class-schedule'
import {
  activeStudyCycle,
  evaluateStudyGate,
  practiceScore,
  retestScore,
  studyGaps,
  type StudyCycle,
  type StudyCycleState,
} from '@shared/study-cycle'
import type { StudyQuestion } from '@shared/study-questions'
import { questionsForTopic, type StudySourceRecommendations } from '@shared/study-sources'
import { STUDY_TRAIL_STATE_LABEL, studyTopicStart, studyTrailBoard, topicName, trailTopicOf, type StudyTrail } from '@shared/study-trail'

export const BONNIE_SERVER = 'estudos'

/**
 * Tools Bonnie's session never gets (#75/#90): reading, searching, writing files, the shell and
 * the web. She works through the tools below, which choose what of the study material she sees.
 */
export const BONNIE_BLOCKED_TOOLS = [
  'Read',
  'Grep',
  'Glob',
  'LS',
  'Bash',
  'BashOutput',
  'KillShell',
  'Edit',
  'MultiEdit',
  'Write',
  'NotebookEdit',
  'NotebookRead',
  'WebFetch',
  'WebSearch',
  'Task',
  'Agent',
] as const

export interface BonnieToolDeps {
  trail(): StudyTrail
  cycles(): StudyCycleState
  bank(): StudyQuestion[]
  start(topic: string, questionIds: string[]): StudyCycleState
  resume(cycleId: string): StudyCycleState
  setAside(): StudyCycleState
  schedule(): ClassScheduleView
  /** Cora's local ranking for a theme. */
  recommend(theme: string): Promise<StudySourceRecommendations>
  /** Opens a source of the study sources folder in the system's app. */
  openSource(path: string, page?: number): Promise<void>
}

const STAGE: Record<StudyCycle['stage'], string> = {
  diagnosis: 'diagnóstico',
  'review-required': 'erros e dúvidas',
  practice: 'prática e fontes',
  'retest-ready': 'reteste liberado',
  retest: 'reteste',
  completed: 'concluído',
}

/** The trail as lists (disciplines) of topics with their state, optionally one discipline only. */
export function trailText(trail: StudyTrail, state: StudyCycleState, discipline?: string): string {
  if (!trail.found) return 'O vault não tem trilha zettel.md.'
  const wanted = discipline?.trim().toLocaleLowerCase('pt-BR')
  const lists = studyTrailBoard(trail, state).filter((list) => !wanted || list.discipline.toLocaleLowerCase('pt-BR').includes(wanted))
  if (!lists.length) return wanted ? `Nenhuma disciplina da trilha corresponde a "${discipline}".` : 'A trilha não tem tópicos.'
  return lists
    .map((list) =>
      [
        `## ${list.discipline} (${list.period}) — ${list.open} em aberto de ${list.cards.length}`,
        ...list.cards.map(
          (card) => `- [${STUDY_TRAIL_STATE_LABEL[card.state]}] ${card.topic.title}${card.cycleId ? ` · ciclo ${card.cycleId}` : ''}`,
        ),
      ].join('\n'),
    )
    .join('\n\n')
}

/** Where the study cycle stands: counts and gates only, never the questions or the answers. */
export function cycleStatusText(state: StudyCycleState, trail: StudyTrail): string {
  const kept = state.cycles.filter((cycle) => cycle.id !== state.activeId && cycle.stage !== 'completed')
  const keptLines = kept.map((cycle) => `- ${cycle.id} · ${topicName(cycle.topic)} · ${STAGE[cycle.stage]}`)
  const cycle = activeStudyCycle(state)
  if (!cycle)
    return [
      'Nenhum ciclo ativo.',
      ...(keptLines.length ? ['Ciclos guardados (podem ser retomados):', ...keptLines] : ['Nenhum ciclo guardado.']),
    ].join('\n')
  const answered = cycle.questions.filter((q) => q.response).length
  const gate = evaluateStudyGate(cycle)
  const place = trailTopicOf(trail, cycle.topic)
  const lines = [
    `Ciclo ativo: ${cycle.id}`,
    `Tópico: ${topicName(cycle.topic)}${place ? ` (tópico ${place.index} de ${place.total} · ${place.discipline})` : ''}`,
    `Etapa: ${STAGE[cycle.stage]}`,
    `Diagnóstico: ${answered} de ${cycle.questions.length} respondidas; ${studyGaps(cycle).length} erro(s) ou dúvida(s).`,
  ]
  if (cycle.stage === 'diagnosis')
    lines.push(
      gate.ready
        ? `Gate do diagnóstico cumprido: a próxima etapa é ${gate.nextStage === 'retest-ready' ? 'o reteste' : 'a revisão de erros e dúvidas'}; a usuária confirma no quadro.`
        : gate.reason === 'incomplete'
          ? 'Gate bloqueado: faltam respostas ou a marcação de incerteza.'
          : 'Gate bloqueado: há respostas aguardando a verificação do Tutor.',
    )
  const round = cycle.practiceRounds.at(-1)
  if (round) lines.push(`Prática: ${practiceScore(round)}% na rodada atual; ${cycle.notes.length} nota(s) de estudo.`)
  const retest = cycle.retests.at(-1)
  const score = retest ? retestScore(retest) : null
  if (score !== null) lines.push(`Reteste: ${score}%.`)
  if (keptLines.length) lines.push('Ciclos guardados:', ...keptLines)
  return lines.join('\n')
}

/** The week of aulas.md, one line per class. */
export function scheduleText(view: ClassScheduleView): string {
  if (!view.found) return 'O vault não tem aulas.md.'
  const lines = view.days.flatMap((day) =>
    day.classes.map((slot) => {
      const change =
        slot.change?.kind === 'cancelled'
          ? ' (cancelada)'
          : slot.change?.kind === 'moved'
            ? ` (movida de ${slot.change.from})`
            : slot.change?.kind === 'retitled'
              ? ' (título alterado)'
              : ''
      return `- ${day.label} ${day.date.slice(8)}/${day.date.slice(5, 7)}${day.today ? ' (hoje)' : ''} ${slot.time} · ${slot.topic}${slot.detail ? ` · ${slot.detail}` : ''}${change}`
    }),
  )
  return [lines.length ? lines.join('\n') : 'Nenhuma aula nesta semana.', ...view.warnings.map((w) => `Aviso: ${w}`)].join('\n')
}

/** Cora's list as Bonnie reads it: source names, page/slide/section ranges and the scale, never the text. */
export function recommendationsText(result: StudySourceRecommendations): string {
  if (!result.recommendations.length)
    return `Cora não encontrou fontes locais para "${result.query}".${result.warning ? ` ${result.warning}` : ''}`
  return [
    `Fontes da Cora para "${result.query}", da melhor para a pior:`,
    ...result.recommendations.map(
      (r, i) =>
        `${i + 1}. ${r.title} — ${r.range}${r.startHeading ? ` (${r.startHeading}${r.endHeading && r.endHeading !== r.startHeading ? ` → ${r.endHeading}` : ''})` : ''} · ${r.label} (${r.score}/100) · ${r.path}`,
    ),
    ...(result.warning ? [`Aviso: ${result.warning}`] : []),
  ].join('\n')
}

export function bonnieTools(deps: BonnieToolDeps): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: BONNIE_SERVER,
    version: '1.0.0',
    instructions:
      'O andar de estudos: trilha, ciclo de estudo, horário de aula e as fontes da Cora. As leituras trazem só tópicos, etapas, ' +
      'contagens e nomes de fontes com páginas; nunca o conteúdo dos arquivos nem as respostas da usuária.',
    tools: bonnieToolDefs(deps),
  })
}

/** The tool definitions, apart from the server so tests can call each handler. */
export function bonnieToolDefs(deps: BonnieToolDeps) {
  const run = (fn: () => string | Promise<string>) => async () => {
    try {
      return { content: [{ type: 'text' as const, text: await fn() }] }
    } catch (err) {
      return { content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }], isError: true }
    }
  }
  const read = { annotations: { readOnlyHint: true } }
  return [
    tool(
      'trail_list',
      'Lista a trilha zettel por disciplina, com o estado de cada tópico (ciclo atual, guardado, concluído, marcado, não iniciado).',
      { discipline: z.string().max(200).optional().describe('Parte do nome de uma disciplina, para filtrar') },
      (args) => run(() => trailText(deps.trail(), deps.cycles(), args.discipline))(),
      read,
    ),
    tool(
      'cycle_status',
      'Mostra o ciclo de estudo ativo (tópico, etapa, contagens, gates) e os ciclos guardados. Não traz questões nem respostas.',
      {},
      () => run(() => cycleStatusText(deps.cycles(), deps.trail()))(),
      read,
    ),
    tool(
      'cycle_start',
      'Começa a estudar um tópico (use o rótulo da trilha, ex.: "[P2-ED-05] Filas"). Retoma o ciclo guardado do tópico se houver; ' +
        'senão guarda o ciclo atual (nada se perde) e abre um diagnóstico com questões do banco local sobre o tópico.',
      { topic: z.string().trim().min(1).max(200) },
      (args) =>
        run(() => {
          const state = deps.cycles()
          const trail = deps.trail()
          const label = trailTopicOf(trail, args.topic)?.label ?? args.topic.trim()
          const plan = studyTopicStart(state, label)
          if (plan.kind === 'open') return `“${label}” já é o ciclo atual.\n\n${cycleStatusText(state, trail)}`
          if (plan.kind === 'resume') return `Ciclo retomado de onde parou.\n\n${cycleStatusText(deps.resume(plan.cycleId), trail)}`
          const questions = questionsForTopic(deps.bank(), label)
          if (!questions.length)
            throw new Error(
              `O banco local não tem questões sobre “${label}”. Peça à usuária para buscar questões no banco (estante de questões) ou escolher as questões no quadro “Tópico atual”.`,
            )
          const next = deps.start(
            label,
            questions.map((q) => q.id),
          )
          return `Diagnóstico de “${label}” começou com ${questions.length} questão(ões) do banco local.${plan.setAside ? ' O ciclo anterior ficou guardado.' : ''}\n\n${cycleStatusText(next, trail)}`
        })(),
    ),
    tool(
      'cycle_switch',
      'Troca de ciclo sem apagar nada: com cycle_id retoma um ciclo guardado; sem ele, guarda o ciclo atual e deixa o andar sem ciclo ativo.',
      { cycle_id: z.string().max(80).optional() },
      (args) =>
        run(() => {
          const next = args.cycle_id ? deps.resume(args.cycle_id) : deps.setAside()
          return `${args.cycle_id ? 'Ciclo retomado.' : 'Ciclo atual guardado.'}\n\n${cycleStatusText(next, deps.trail())}`
        })(),
    ),
    tool(
      'schedule_read',
      'Lê a semana de aulas.md (horário de aula), uma linha por aula.',
      {},
      () => run(() => scheduleText(deps.schedule()))(),
      read,
    ),
    tool(
      'ask_cora',
      'Pede à Cora (busca local, sem IA) as fontes da pasta "study sources" para um tema, da melhor para a pior, com página/slide/seção ' +
        'de início e de fim e uma escala de relevância. Traz só nomes e intervalos, nunca o conteúdo.',
      { theme: z.string().trim().min(2).max(200).describe('O tema e o pedido, ex.: "fila, estrutura de dados, introdução"') },
      (args) => run(async () => recommendationsText(await deps.recommend(args.theme)))(),
      read,
    ),
    tool(
      'open_source',
      'Abre no computador da usuária uma fonte que a Cora recomendou (caminho relativo ao vault, como ask_cora mostra). Em PDF, passe a página de início para abrir nela.',
      { path: z.string().trim().min(1).max(1000), page: z.number().int().min(1).max(100000).optional() },
      (args) =>
        run(async () => {
          await deps.openSource(args.path, args.page)
          return args.page ? `Abri ${args.path} na página ${args.page}.` : `Abri ${args.path}.`
        })(),
    ),
  ]
}
