import type { AgentSummary, OfficePermissionMode, ProjectFloor } from '@shared/types'
import type { State } from '../../state'
import { h } from '../dom'
import { cleanError, field, modal } from './common'
import { MODES } from './brain'

// "Contratar squad": start a squad cycle on a project floor.

const RUN_MODES = MODES.filter((m) => m.value !== 'bypassPermissions')
const LAST_RUN_MODE = 'agent-office:squad-mode'

/**
 * "Contratar squad": pick a squad of the project and an orchestrator goes up to the
 * squad room with the whole team to run its pipeline. Hiring it again for the same
 * squad just starts another cycle. Squad cycles never run with "Sem pedir nada".
 * `code` opens the window with that squad already chosen (the room the player clicked).
 */
export function openRunSquad(
  root: HTMLElement,
  state: State,
  project: ProjectFloor,
  toast: (t: string, k?: 'info' | 'ok' | 'err') => void,
  onStarted: (a: AgentSummary) => void,
  code?: string,
): void {
  const catalogue = state.squads.filter((q) => q.cwd === project.cwd)
  const squads = catalogue.filter((q) => q.availability !== 'unavailable')
  const unavailable = catalogue.filter((q) => q.availability === 'unavailable')
  const recoveryCard = (q: (typeof unavailable)[number]) => {
    const card = h(
      'div',
      { class: 'squad-card', role: 'status' },
      h('span', { class: 'squad-icon' }, '⚠️'),
      h(
        'span',
        { class: 'squad-main' },
        h('span', { class: 'squad-name' }, `${q.code} · indisponível`),
        h('span', { class: 'squad-meta' }, q.unavailableReason ?? 'Definição ausente ou inválida.'),
        h(
          'span',
          { class: 'squad-meta' },
          `Recupere manualmente: ${q.recoveryPath ?? `${project.cwd}/squads/${q.code}/squad.yaml`}. Depois, feche e reabra o Agent Office.`,
        ),
      ),
    )
    const open = h('button', { class: 'btn', type: 'button' }, 'Abrir pasta para recuperar')
    open.addEventListener('click', () => void window.office.revealPath(`${q.cwd}/squads/${q.code}`))
    card.append(open)
    return card
  }
  if (!squads.length) {
    if (!unavailable.length)
      return toast(`${project.name} não tem squads definidos. Crie ou restaure manualmente uma definição em ${project.cwd}/squads/<código>/squad.yaml.`, 'err')
    const closeButton = h('button', { class: 'btn', type: 'button', onclick: () => recoveryDialog.remove() }, 'Fechar')
    const recoveryDialog = modal(
      `Squads indisponíveis · ${project.name}`,
      [
        h('div', { class: 'field-hint' }, 'Nenhuma definição pode ser executada. Restaure manualmente os arquivos indicados; o Agent Office não os recria nem sobrescreve.'),
        h('div', { class: 'squad-list' }, ...unavailable.map(recoveryCard)),
      ],
      [closeButton],
      () => recoveryDialog.remove(),
    )
    root.append(recoveryDialog)
    closeButton.focus()
    return
  }
  const here = new Map(
    [...state.agents.values()].filter((a) => a.role === 'orchestrator' && a.cwd === project.cwd).map((a) => [a.squad, a]),
  )
  const statusLabel = (a: AgentSummary | undefined) => {
    if (!a) return 'disponível'
    if (a.status === 'starting' || a.status === 'working') return 'trabalhando'
    if (a.status === 'waiting') return 'aguardando decisão'
    if (a.status === 'error' || a.status === 'stopped') return 'bloqueado'
    if (a.status === 'done') return 'concluído'
    return 'disponível'
  }
  let chosen = (code ? squads.find((q) => q.code === code) : undefined) ?? squads[0]
  const cards = squads.map((q) => {
    const boss = here.get(q.code)
    const inline = q.members.filter((m) => m.execution === 'inline').length
    const card = h(
      'button',
      { class: 'squad-card', type: 'button' },
      h('span', { class: 'squad-icon' }, q.icon),
      h(
        'span',
        { class: 'squad-main' },
        h(
          'span',
          { class: 'squad-name' },
          q.name,
          h('span', { class: `chip ${boss?.status === 'waiting' ? 'chip-wait' : ''}` }, statusLabel(boss)),
        ),
        h(
          'span',
          { class: 'squad-meta' },
          `${q.members.length} membros${inline ? ` (${inline} inline)` : ''} · ${q.steps.length} passos · ${q.steps.filter((x) => x.type === 'checkpoint').length} checkpoints`,
        ),
        h(
          'span',
          { class: 'squad-meta' },
          `Coordenador: Agent Office · ${q.members.map((m) => `${m.role === 'implementer' ? 'Implementador' : m.role === 'reviewer' ? 'Revisor' : 'Membro'}: ${m.name}`).join(' · ')}`,
        ),
        q.description ? h('span', { class: 'squad-desc' }, q.description) : null,
      ),
    )
    card.addEventListener('click', () => {
      chosen = q
      paint()
      void paintQueue()
    })
    return card
  })
  const invalidCards = unavailable.map(recoveryCard)

  const mode = h('select', { class: 'input' }, ...RUN_MODES.map((m) => h('option', { value: m.value }, m.label)))
  const saved = localStorage.getItem(LAST_RUN_MODE)
  const inheritedMode = project.permissionMode ?? state.settings.defaultPermissionMode
  mode.value = RUN_MODES.some((m) => m.value === saved)
    ? saved!
    : RUN_MODES.some((m) => m.value === inheritedMode)
      ? inheritedMode
      : 'default'
  const modeHint = h('span', {})
  const syncHint = () => (modeHint.textContent = RUN_MODES.find((x) => x.value === mode.value)!.hint)
  mode.addEventListener('change', syncHint)
  syncHint()
  const note = h('textarea', { class: 'input', rows: 2, placeholder: 'Recado para o orquestrador (opcional)' })

  const close = () => el.remove()
  const go = h('button', { class: 'btn btn-primary' })
  const paint = () => {
    cards.forEach((c, i) => c.classList.toggle('on', squads[i] === chosen))
    go.textContent = here.has(chosen.code) ? '▶ Rodar ciclo' : '▶ Iniciar squad'
  }
  // The queue of the squad: the ticket it works on and the ones waiting for it.
  const queueBox = h('div', { class: 'panelbox' })
  const ticketLine = (id: string | null): HTMLElement | null => {
    if (!id) return null
    const t = state.tickets.get(id)
    return h('div', { class: 'squad-queue-line' }, h('b', {}, t ? `${t.key} · ` : ''), t ? t.title : 'ticket fora do quadro')
  }
  const paintQueue = async () => {
    const queue = await window.office.squadQueue(chosen.code).catch(() => undefined)
    if (!queue || (!queue.active && !queue.queue.length)) {
      queueBox.replaceChildren(h('div', { class: 'sec-title' }, 'Fila do squad'), h('div', { class: 'hint' }, 'Sem ticket na fila.'))
      return
    }
    queueBox.replaceChildren(
      h('div', { class: 'sec-title' }, 'Fila do squad'),
      h('div', { class: 'hint' }, 'Um ticket ativo por squad.'),
      ...(queue.active ? [h('div', { class: 'squad-queue-line' }, h('span', { class: 'sbadge sb-working' }, 'ativo'), ticketLine(queue.active) as HTMLElement)] : []),
      ...queue.queue.map((id) => h('div', { class: 'squad-queue-line' }, h('span', { class: 'sbadge sb-mute' }, 'espera'), ticketLine(id) as HTMLElement)),
    )
  }
  paint()
  void paintQueue()
  go.addEventListener('click', async () => {
    go.setAttribute('disabled', '')
    try {
      const modeOrder: OfficePermissionMode[] = ['plan', 'default', 'acceptEdits', 'auto', 'bypassPermissions']
      const confirmOverride = modeOrder.indexOf(mode.value as OfficePermissionMode) > modeOrder.indexOf(inheritedMode)
      localStorage.setItem(LAST_RUN_MODE, mode.value)
      const a = await window.office.runSquad(chosen.cwd, chosen.code, mode.value as OfficePermissionMode, note.value, confirmOverride)
      close()
      toast(`${a.name} subiu para a sala do squad e começou o ciclo.`, 'ok')
      onStarted(a)
    } catch (err) {
      go.removeAttribute('disabled')
      toast(cleanError(err), 'err')
    }
  })
  const el = modal(
    `Contratar squad · ${project.name}`,
    [
      h('div', { class: 'squad-list' }, ...cards, ...invalidCards),
      queueBox,
      field('Permissões', mode, modeHint),
      field('Recado', note, 'Os checkpoints do ciclo vêm até você como perguntas. Sem resposta, o ciclo espera.'),
    ],
    [h('button', { class: 'btn', onclick: close }, 'Cancelar'), go],
    close,
  )
  root.append(el)
  go.focus()
}
