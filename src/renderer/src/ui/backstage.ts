import type { WorktreeEntry, WorktreeFloor } from '@shared/types'
import { hasWork, isBusy, isForgotten, sizeText, worktreeStatus } from '@shared/worktrees'
import type { State } from '../state'
import { keepFocus } from './a11y'
import { h, icon, timeAgo } from './dom'
import { cleanError, modal } from './modals'

// Bastidores (B): what the office keeps behind the scenes. Today, the agent copies
// (worktrees) floor by floor, with their size and what removing each one would lose.

type Toast = (text: string, kind?: 'info' | 'ok' | 'err') => void
type Filter = 'all' | 'forgotten' | 'work' | 'busy'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const TONE_CHIP = { ok: 'chip chip-done', warn: 'chip chip-wait', fail: 'chip chip-err', idle: 'chip' } as const

/** Opens Bastidores → Worktrees. A second call while it is open closes it. */
export function openBackstage(root: HTMLElement, state: State, opts: { toast: Toast; openAgent(id: string): void }): void {
  const open = root.querySelector('.backdrop-backstage')
  if (open) return void open.remove()
  let floors: WorktreeFloor[] | null = null
  let error = ''
  let loading = false
  let filter: Filter = 'all'
  const busy = new Set<string>()
  const body = h('div', { class: 'bs-body' })
  const foot = h('div', { class: 'bs-foot' })
  const close = () => el.remove()
  const el = modal('Bastidores · Worktrees', [body], [foot], close)
  el.classList.add('backdrop-backstage')

  const all = () => (floors ?? []).flatMap((f) => f.items)
  const load = () => {
    if (loading) return
    loading = true
    error = ''
    window.office
      .listWorktrees()
      .then((f) => void (floors = f))
      .catch((err) => void (error = cleanError(err)))
      .finally(() => {
        loading = false
        render()
      })
    render()
  }

  const run = async (key: string, fn: () => Promise<string | null>) => {
    busy.add(key)
    render()
    try {
      const msg = await fn()
      if (msg) {
        opts.toast(msg, 'ok')
        load()
      }
    } catch (err) {
      opts.toast(cleanError(err), 'err')
    } finally {
      busy.delete(key)
      render()
    }
  }

  const setFloorDefault = async (floorId: string, on: boolean) => {
    const projects = state.settings.projects.map((p) => {
      if (p.id !== floorId) return p
      const { worktrees: _w, ...rest } = p
      return on ? rest : { ...rest, worktrees: false as const }
    })
    try {
      await window.office.saveSettings({ projects })
      for (const f of floors ?? []) if (f.floorId === floorId) f.worktrees = on
      opts.toast(
        on
          ? 'Agentes novos deste andar ganham uma cópia isolada (worktree).'
          : 'Agentes novos deste andar mexem direto na pasta do projeto.',
        'ok',
      )
    } catch (err) {
      opts.toast(cleanError(err), 'err')
    }
    render()
  }

  const row = (w: WorktreeEntry): HTMLElement => {
    const st = worktreeStatus(w)
    const name = w.branch ? w.branch.replace(/^agent\//, '') : (w.root.split(/[\\/]/).pop() ?? w.root)
    const removing = busy.has(w.root)
    const agentId = w.agentId && state.agents.has(w.agentId) ? w.agentId : undefined
    return h(
      'div',
      { class: 'resume-row bs-row' },
      h(
        'div',
        { class: 'resume-main' },
        h('div', { class: 'resume-title' }, h('span', { class: 'resume-title-text', title: `${w.branch}\n${w.root}` }, name)),
        h(
          'div',
          { class: 'resume-meta' },
          h('span', { class: TONE_CHIP[st.tone] }, st.text),
          h('span', {}, sizeText(w.size)),
          w.createdAt ? h('span', { title: `Criada em ${new Date(w.createdAt).toLocaleString('pt-BR')}` }, timeAgo(w.createdAt)) : null,
        ),
      ),
      h(
        'div',
        { class: 'resume-actions' },
        w.exists
          ? h(
              'button',
              {
                class: 'icon-btn',
                type: 'button',
                title: 'Mostrar a pasta',
                'aria-label': 'Mostrar a pasta',
                onclick: () => void window.office.revealPath(w.root),
              },
              icon('folder', 15),
            )
          : null,
        agentId
          ? h(
              'button',
              { class: 'btn btn-small', type: 'button', onclick: () => (close(), opts.openAgent(agentId)) },
              icon('eye', 13),
              'Ver agente',
            )
          : w.agentId || w.foreign
            ? null
            : h(
                'button',
                {
                  class: 'btn btn-small btn-danger-soft',
                  type: 'button',
                  disabled: removing,
                  onclick: () => void run(w.root, () => window.office.removeWorktreeAt(w.root)),
                },
                icon('trash', 13),
                removing ? 'Removendo…' : 'Remover',
              ),
      ),
    )
  }

  const floorSection = (f: WorktreeFloor): HTMLElement[] => {
    const is: Record<Filter, (w: WorktreeEntry) => boolean> = {
      all: () => true,
      forgotten: (w) => isForgotten(w),
      work: hasWork,
      busy: isBusy,
    }
    const items = f.items.filter(is[filter])
    if (!items.length && filter !== 'all') return []
    const total = f.items.reduce((n, w) => n + (w.size ?? 0), 0)
    const toggle = h('input', { type: 'checkbox' }) as HTMLInputElement
    toggle.checked = f.worktrees
    toggle.addEventListener('change', () => void setFloorDefault(f.floorId!, toggle.checked))
    return [
      h(
        'div',
        { class: 'resume-group bs-group' },
        h(
          'span',
          { title: f.repo },
          `${f.name} · ${f.items.length ? `${plural(f.items.length, 'cópia', 'cópias')} · ${sizeText(total)}` : 'nenhuma cópia'}`,
        ),
        f.floorId
          ? h(
              'label',
              { class: 'check bs-default', title: 'Vale para agentes novos deste andar. Ao contratar dá para mudar caso a caso.' },
              toggle,
              'Agentes novos em worktree',
            )
          : h('span', { class: 'bs-default' }, 'fora dos andares'),
      ),
      ...(items.length
        ? items.map(row)
        : [
            h(
              'div',
              { class: 'resume-empty bs-none' },
              f.worktrees ? 'Nenhuma cópia agora.' : 'Nenhuma cópia: os agentes daqui mexem direto na pasta do projeto.',
            ),
          ]),
    ]
  }

  const filters = () => {
    const list = all()
    const tab = (k: Filter, label: string, n: number) =>
      h(
        'button',
        {
          class: `seg-btn${filter === k ? ' on' : ''}`,
          type: 'button',
          'aria-pressed': String(filter === k),
          onclick: () => ((filter = k), render()),
        },
        `${label} (${n})`,
      )
    return h(
      'div',
      { class: 'seg bs-filters' },
      tab('all', 'Todas', list.length),
      tab('forgotten', 'Esquecidas', list.filter((w) => isForgotten(w)).length),
      tab('work', 'Com trabalho', list.filter(hasWork).length),
      tab('busy', 'Em uso', list.filter(isBusy).length),
    )
  }

  const empty = (...children: (HTMLElement | string)[]) => [h('div', { class: 'resume-empty' }, ...children)]
  const bodyParts = (): HTMLElement[] => {
    if (error) return empty(h('b', {}, 'Não consegui ler as cópias. '), error)
    if (!floors) return empty('Medindo as cópias dos agentes…')
    if (!floors.length) return empty('Nenhum andar com repositório git. As cópias isoladas (worktrees) só existem em projetos com git.')
    const list = all()
    const total = list.reduce((n, w) => n + (w.size ?? 0), 0)
    const sections = floors.flatMap(floorSection)
    return [
      h(
        'p',
        { class: 'field-hint bs-intro' },
        `Cada agente em worktree trabalha numa cópia do repositório, num branch próprio: ${plural(list.length, 'cópia', 'cópias')}, ${sizeText(total)} no disco. Remover nunca apaga commit que só exista na cópia.`,
      ),
      filters(),
      h('div', { class: 'resume-list' }, ...(sections.length ? sections : empty('Nenhuma cópia deste tipo.'))),
    ]
  }

  const render = () =>
    keepFocus(el, () => {
      body.replaceChildren(...bodyParts())
      const forgotten = all().filter((w) => isForgotten(w))
      const size = forgotten.reduce((n, w) => n + (w.size ?? 0), 0)
      foot.replaceChildren(
        h(
          'button',
          { class: 'btn', type: 'button', disabled: loading, onclick: load },
          icon('reset', 14),
          loading ? 'Atualizando…' : 'Atualizar',
        ),
        ...(forgotten.length
          ? [
              h(
                'button',
                {
                  class: 'btn btn-danger-soft',
                  type: 'button',
                  disabled: busy.has('clean'),
                  onclick: () => void run('clean', () => window.office.cleanWorktrees()),
                },
                icon('trash', 14),
                `Limpar esquecidas (${forgotten.length} · ${sizeText(size)})`,
              ),
            ]
          : []),
      )
    })

  root.append(el)
  load()
  ;(el.querySelector('.modal-foot button') as HTMLElement | null)?.focus()
}

/** Once per start, after the office settles: a toast when forgotten copies take disk space. */
export function remindForgottenCopies(toast: Toast): void {
  setTimeout(() => {
    void window.office
      .listWorktrees()
      .then((floors) => {
        const forgotten = floors.flatMap((f) => f.items).filter((w) => isForgotten(w))
        if (!forgotten.length) return
        const size = sizeText(forgotten.reduce((n, w) => n + (w.size ?? 0), 0))
        toast(
          `${forgotten.length === 1 ? '1 cópia esquecida ocupa' : `${forgotten.length} cópias esquecidas ocupam`} ${size}. Limpe em Bastidores (B).`,
          'info',
        )
      })
      .catch(() => undefined)
  }, 30_000)
}
