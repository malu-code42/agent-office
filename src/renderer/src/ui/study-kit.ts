// The look of the study floor's windows (approved prototype "Ciclo de estudo da Bonnie"): a badge with
// who runs the window, a pixel title over a subtitle, chips that say who is in the room, bordered
// panels with mono labels, the four stages of the cycle as a strip and gate checklists in the foot.
// Only DOM building: the windows keep their own behavior.

import { h } from './dom'
import { modal } from './modals/common'

export type StudyTone = 'ok' | 'warn' | 'err' | 'pink' | 'now' | 'info' | 'mute'

/** Who runs a window: the letter on the badge and its color. */
export interface StudyWho {
  letter: string
  tone: 'bonnie' | 'cora' | 'tutor' | 'curator' | 'verifier' | 'bank' | 'cards' | 'schedule'
  /** Read by screen readers instead of the letter. */
  name: string
}

export const STUDY_WHO = {
  bonnie: { letter: 'B', tone: 'bonnie', name: 'Bonnie' },
  cora: { letter: 'C', tone: 'cora', name: 'Cora' },
  tutor: { letter: 'T', tone: 'tutor', name: 'Tutor' },
  curator: { letter: 'C', tone: 'curator', name: 'Curador' },
  verifier: { letter: 'V', tone: 'verifier', name: 'Verificador' },
  bank: { letter: 'Q', tone: 'bank', name: 'Banco de questões' },
  cards: { letter: 'Z', tone: 'cards', name: 'Cartões' },
  schedule: { letter: 'H', tone: 'schedule', name: 'Horário' },
} satisfies Record<string, StudyWho>

export const studyBadge = (who: StudyWho, small = false): HTMLElement =>
  h('span', { class: `sk-badge sk-badge-${who.tone}${small ? ' sk-badge-s' : ''}`, 'aria-hidden': 'true' }, who.letter)

export const studyChip = (text: string, tone?: StudyTone, title?: string): HTMLElement =>
  h('span', { class: `sk-chip${tone ? ` sk-chip-${tone}` : ''}`, ...(title ? { title } : {}) }, text)

/** "Tutor na sala": the chip in the head that says which teacher is in the classroom. */
export const studyInRoom = (who: StudyWho, text = `${who.name} na sala`): HTMLElement =>
  h('span', { class: 'sk-room' }, studyBadge(who, true), text)

/** A bordered block with an optional mono label on top. */
export function studyPanel(label: string | null, ...children: (HTMLElement | string | null | false)[]): HTMLElement {
  return h(
    'section',
    { class: 'sk-panel', ...(label ? { 'aria-label': label } : {}) },
    label ? h('div', { class: 'sk-label' }, label) : null,
    ...children.filter((child): child is HTMLElement | string => !!child),
  )
}

export const studyLabel = (text: string): HTMLElement => h('div', { class: 'sk-label' }, text)

/** A pixel section title with an optional dim note on the same line. */
export const studyHeading = (text: string, note?: string): HTMLElement =>
  h('h3', { class: 'sk-heading' }, text, note ? h('span', { class: 'sk-heading-note' }, note) : null)

/** A bar from 0 to max with an optional goal mark (e.g. 80%). */
export function studyMeterBar(value: number, max: number, goal?: number, label = 'Progresso'): HTMLElement {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return h(
    'div',
    {
      class: 'sk-meter',
      role: 'progressbar',
      'aria-label': label,
      'aria-valuenow': String(value),
      'aria-valuemin': '0',
      'aria-valuemax': String(max),
    },
    h('span', { class: `sk-meter-fill${goal !== undefined && value >= goal ? ' sk-meter-ok' : ''}`, style: `width:${pct}%` }),
    goal !== undefined && max > 0 ? h('span', { class: 'sk-meter-goal', style: `left:${(goal / max) * 100}%` }) : null,
  )
}

export type StudyStepState = 'done' | 'now' | 'locked' | 'skipped'

export interface StudyStep {
  label: string
  state: StudyStepState
  /** Chip text; by default OK / Em curso / Bloqueado / Pulado. */
  chip?: string
  /** The criterion, under the name (overview only). */
  note?: string
}

const STEP_CHIP: Record<StudyStepState, [string, StudyTone]> = {
  done: ['OK', 'ok'],
  now: ['Em curso', 'now'],
  locked: ['Bloqueado', 'mute'],
  skipped: ['Pulado', 'mute'],
}

/** The four stages of the cycle as a strip; `dashed` when no topic is chosen yet. */
export function studySteps(steps: StudyStep[], options: { dashed?: boolean; detailed?: boolean } = {}): HTMLElement {
  return h(
    'ol',
    {
      class: `sk-steps${options.dashed ? ' sk-steps-dashed' : ''}${options.detailed ? ' sk-steps-detailed' : ''}`,
      'aria-label': 'Etapas do ciclo',
    },
    ...steps.map((step, i) => {
      const [chip, tone] = STEP_CHIP[step.state]
      return h(
        'li',
        { class: `sk-step sk-step-${step.state}`, ...(step.state === 'now' ? { 'aria-current': 'step' } : {}) },
        h(
          'span',
          { class: 'sk-step-top' },
          h('span', { class: 'sk-step-n' }, String(i + 1)),
          h('span', { class: 'sk-step-name' }, step.label),
        ),
        options.dashed ? null : studyChip(step.chip ?? chip, step.state === 'now' ? 'now' : tone),
        options.detailed && step.note ? h('span', { class: 'sk-step-note' }, step.note) : null,
      )
    }),
  )
}

export interface StudyGateItem {
  state: 'ok' | 'todo' | 'pending'
  text: string
  note?: string
}

/** A checklist of a gate: ✓ done, … missing, ! pending check. */
export function studyGate(items: StudyGateItem[], inline = false): HTMLElement {
  return h(
    'ul',
    { class: `sk-gate${inline ? ' sk-gate-inline' : ''}` },
    ...items.map((item) =>
      h(
        'li',
        { class: `sk-gate-${item.state}` },
        h('span', { class: 'sk-tick', 'aria-hidden': 'true' }, item.state === 'ok' ? '✓' : item.state === 'pending' ? '!' : '…'),
        h(
          'span',
          {},
          h('span', { class: 'sk-sr' }, item.state === 'ok' ? 'Cumprido: ' : item.state === 'pending' ? 'Em verificação: ' : 'Falta: '),
          item.text,
          item.note ? h('span', { class: 'sk-gate-note' }, ` · ${item.note}`) : null,
        ),
      ),
    ),
  )
}

/** A strip across the window: a pause, a "no help" rule, an error. */
export const studyBanner = (tone: 'warn' | 'err' | 'info', title: string, text: string): HTMLElement =>
  h('div', { class: `sk-banner sk-banner-${tone}`, role: tone === 'err' ? 'alert' : 'status' }, h('b', {}, title), h('span', {}, text))

/** A big number over a caption (stat tiles, scores). */
export const studyStat = (label: string, value: string, caption?: string): HTMLElement =>
  h(
    'div',
    { class: 'sk-stat' },
    studyLabel(label),
    h('span', { class: 'sk-stat-value' }, value),
    caption ? h('span', { class: 'sk-stat-caption' }, caption) : null,
  )

export interface StudyWindowHead {
  who: StudyWho
  subtitle?: string
  /** Chips and buttons on the right of the head, before the close button. */
  tags?: HTMLElement[]
}

/**
 * Gives a modal of the study floor its head: the badge, the title over a subtitle and the tags on
 * the right. Returns setters, so a window that changes stage can retitle itself.
 */
export function dressStudyWindow(
  el: HTMLElement,
  head: StudyWindowHead,
  size: 'm' | 'l' | 'xl' = 'l',
): { setTitle(text: string): void; setSubtitle(text: string): void; setTags(tags: HTMLElement[]): void; setWho(who: StudyWho): void } {
  const box = (el.matches('.modal, .board') ? el : el.querySelector('.modal, .board')) as HTMLElement
  box.classList.add('study-popup', 'sk-window', `sk-${size}`)
  const bar = box.querySelector('.modal-head, .board-head') as HTMLElement
  const title = bar.querySelector('.modal-title, .board-title, h2') as HTMLElement
  const badge = studyBadge(head.who)
  const subtitle = h('span', { class: 'sk-subtitle' }, head.subtitle ?? '')
  subtitle.hidden = !head.subtitle
  const titles = h('div', { class: 'sk-titles' })
  title.replaceWith(titles)
  titles.append(title, subtitle)
  title.classList.add('sk-title')
  titles.before(badge)
  const tags = h('div', { class: 'sk-tags' }, ...(head.tags ?? []))
  const close = bar.querySelector('.icon-btn:last-child')
  if (close) close.before(tags)
  else bar.append(tags)
  return {
    setTitle: (text) => (title.textContent = text),
    setSubtitle: (text) => {
      subtitle.textContent = text
      subtitle.hidden = !text
    },
    setTags: (list) => tags.replaceChildren(...list),
    setWho: (who) => {
      badge.className = `sk-badge sk-badge-${who.tone}`
      badge.textContent = who.letter
    },
  }
}

/** A modal of the study floor, already dressed. */
export function studyWindow(
  opts: StudyWindowHead & { title: string; body: HTMLElement[]; foot: HTMLElement[]; onClose: () => void; size?: 'm' | 'l' | 'xl' },
): { el: HTMLDivElement; head: ReturnType<typeof dressStudyWindow> } {
  const el = modal(opts.title, opts.body, opts.foot, opts.onClose)
  const head = dressStudyWindow(el.querySelector('.modal') as HTMLElement, opts, opts.size)
  return { el, head }
}
