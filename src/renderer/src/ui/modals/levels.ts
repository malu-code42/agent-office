import { LEVEL_INFO, LEVEL_TEXT, levelCounts, OWNER_ACCOUNT, type LevelChange, type LevelRow, type LevelsSnapshot } from '@shared/permission-levels'
import type { PermissionLevel } from '@shared/types'
import { h } from '../dom'
import { cleanError, field, modal } from './common'

// AO-109, parte 4: o seletor dos cinco níveis (Novo agente) e a janela "Níveis de permissão" (Ajustes).
// O nível que vale agora (com rebaixamento) vem do processo principal; aqui só se mostra e se escolhe.

type Toast = (t: string, k?: 'info' | 'ok' | 'err') => void

export interface LevelPicker {
  el: HTMLElement
  /** O nível escolhido agora (começa no inicial). */
  value(): PermissionLevel
  /** A usuária mexeu? Só então o nível vai no pedido; senão o agente vale pelo modo. */
  touched(): boolean
  /** Acompanha o modo escolhido enquanto a usuária não mexeu no nível. */
  follow(l: PermissionLevel): void
}

/** Os cinco botões de nível (design aprovado). `disabled` trava um nível (ex.: o 5 sem a conta do dono). */
export function levelButtons(
  current: () => PermissionLevel,
  pick: (l: PermissionLevel) => void,
  isDisabled: (l: PermissionLevel) => boolean = () => false,
): HTMLElement & { repaint(): void } {
  const wrap = h('div', { class: 'nv-levels', role: 'group', 'aria-label': LEVEL_TEXT.fieldLabel })
  const paint = () => {
    for (const b of wrap.querySelectorAll<HTMLButtonElement>('button')) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.level) === current()))
    }
  }
  for (const info of LEVEL_INFO) {
    const b = h(
      'button',
      {
        type: 'button',
        class: 'nv-lvl',
        'aria-pressed': 'false',
        disabled: isDisabled(info.level),
        'data-level': String(info.level),
        onclick: () => {
          pick(info.level)
          paint()
        },
      },
      h('span', { class: 'nv-lvl-n' }, String(info.level)),
      h('span', { class: 'nv-lvl-t' }, h('b', {}, info.name), h('span', {}, info.description)),
    )
    wrap.append(b)
  }
  paint()
  return Object.assign(wrap, { repaint: paint })
}

/** O campo "Nível de permissão" de Novo agente. `initial` é o nível que o modo escolhido já daria. */
export function levelPicker(initial: PermissionLevel, allowOwnerLevel: () => boolean): LevelPicker {
  let chosen = initial
  let touched = false
  const buttons = levelButtons(
    () => chosen,
    (l) => {
      chosen = l
      touched = true
    },
    (l) => l === 5 && !allowOwnerLevel(),
  )
  return {
    el: field(LEVEL_TEXT.fieldLabel, buttons, LEVEL_TEXT.newAgentHint),
    value: () => chosen,
    touched: () => touched,
    follow: (l) => {
      if (touched) return
      chosen = l
      buttons.repaint()
    },
  }
}

/** A janela "Níveis de permissão": agentes à esquerda, os cinco níveis do escolhido à direita. */
export function openPermissionLevels(root: HTMLElement, toast: Toast): void {
  let snap: LevelsSnapshot = { rows: [], githubAccounts: [] }
  let selected = ''
  const pending = new Map<string, PermissionLevel>()
  let saving = false
  const content = h('div', { class: 'sw-frame' })

  const close = () => el.remove()
  const el = modal(LEVEL_TEXT.windowTitle, [content], [], close, true)
  el.querySelector('.modal')?.classList.add('sw-modal')

  const ownerListed = () => snap.githubAccounts.includes(OWNER_ACCOUNT)
  const shown = (r: LevelRow): PermissionLevel => pending.get(r.id) ?? r.stored ?? r.requested

  const render = () => {
    const rows = snap.rows
    if (!rows.some((r) => r.id === selected)) selected = rows[0]?.id ?? ''
    const row = rows.find((r) => r.id === selected)
    const counts = levelCounts(rows)

    const nav = h(
      'nav',
      { class: 'sw-nav', 'aria-label': 'Agentes' },
      h('div', { class: 'sw-sec' }, LEVEL_TEXT.navTitle),
      ...rows.map((r) =>
        h(
          'button',
          {
            type: 'button',
            class: 'sw-side',
            'aria-current': r.id === selected ? 'page' : undefined,
            onclick: () => {
              selected = r.id
              render()
            },
          },
          h('span', { class: `sw-dot ${r.downgraded ? 'sw-dot-paused' : 'sw-dot-working'}`, 'aria-hidden': 'true' }),
          h('span', { class: 'sw-side-name' }, r.name + (pending.has(r.id) ? ' *' : '')),
          h('span', { class: 'nv-level-pill', 'aria-label': `nível ${r.level}` }, String(r.level)),
        ),
      ),
      rows.length ? null : h('div', { class: 'sw-note' }, 'Nenhum agente no escritório agora.'),
      h('div', { class: 'sw-note' }, LEVEL_TEXT.navNote),
    )

    const kpis = h(
      'div',
      { class: 'sw-kpis' },
      ...LEVEL_INFO.map((i) => h('div', { class: 'sw-kpi' }, h('b', {}, String(counts[i.level])), h('span', {}, `no nível ${i.level}`))),
    )

    const accounts = accountsEditor()
    const detail: HTMLElement[] = []
    if (row) {
      detail.push(
        h(
          'div',
          { class: 'sw-head' },
          h('div', {}, h('div', { class: 'sw-sec' }, row.name.toUpperCase()), h('div', { class: 'field-hint' }, LEVEL_TEXT.pickHint)),
          h(
            'span',
            { class: 'sw-state' },
            h('span', { class: `sw-dot ${row.hasWorktree ? 'sw-dot-working' : 'sw-dot-paused'}`, 'aria-hidden': 'true' }),
            row.hasWorktree ? LEVEL_TEXT.withWorktree : LEVEL_TEXT.withoutWorktree,
          ),
        ),
        levelButtons(
          () => shown(row),
          (l) => {
            if (l === (row.stored ?? row.requested)) pending.delete(row.id)
            else pending.set(row.id, l)
            render()
          },
          (l) => row.fixed || (l === 5 && !ownerListed()),
        ),
        ...row.warnings.map((w) => h('div', { class: 'nv-warn', role: 'status' }, w)),
      )
    }
    const save = h('button', { class: 'btn btn-primary', type: 'button', disabled: saving, onclick: () => void persist() }, LEVEL_TEXT.save)
    const main = h(
      'div',
      { class: 'sw-main' },
      kpis,
      ...detail,
      h('div', { class: 'nv-warn' }, LEVEL_TEXT.rules),
      h('div', { class: 'nv-rule' }, h('b', {}, 'Piso: '), LEVEL_TEXT.floor),
      accounts,
      h('div', { class: 'nv-foot' }, h('button', { class: 'btn', type: 'button', onclick: close }, LEVEL_TEXT.cancel), save),
    )
    content.replaceChildren(nav, main)
    nav.querySelector<HTMLElement>('[aria-current="page"]')?.focus()
  }

  // Editor da lista de contas do GitHub (portão do dono). Gravar passa pelo diálogo do processo principal.
  const accountsEditor = (): HTMLElement => {
    const draft = [...snap.githubAccounts]
    const list = h('div', { class: 'field-hint' })
    const input = h('input', { class: 'input', maxlength: 39, placeholder: 'login do GitHub', 'aria-label': 'Login do GitHub' }) as HTMLInputElement
    const paint = () =>
      list.replaceChildren(
        ...(draft.length
          ? draft.map((a) =>
              h(
                'div',
                { class: 'bridge-row' },
                h('span', {}, a),
                h(
                  'button',
                  {
                    class: 'btn',
                    type: 'button',
                    'aria-label': `Tirar ${a}`,
                    onclick: () => {
                      draft.splice(draft.indexOf(a), 1)
                      paint()
                    },
                  },
                  'Tirar',
                ),
              ),
            )
          : ['Lista vazia: nada é publicado nem mesclado pelo escritório.']),
      )
    paint()
    const add = h(
      'button',
      {
        class: 'btn',
        type: 'button',
        onclick: () => {
          const v = input.value.trim().toLowerCase()
          if (!/^[a-z0-9](?:[a-z0-9-]{0,38})$/.test(v)) return toast('Login do GitHub inválido.', 'err')
          if (!draft.includes(v)) draft.push(v)
          input.value = ''
          paint()
        },
      },
      'Adicionar',
    )
    const apply = h(
      'button',
      {
        class: 'btn',
        type: 'button',
        onclick: async () => {
          try {
            await window.office.saveSettings({ githubAccounts: draft })
            toast('Contas autorizadas salvas.', 'ok')
            await load()
          } catch (err) {
            toast(cleanError(err), 'err')
          }
        },
      },
      'Salvar contas',
    )
    return h(
      'div',
      { class: 'bridge-box' },
      h('div', { class: 'bridge-title' }, LEVEL_TEXT.accountsTitle),
      h('div', { class: 'field-hint' }, LEVEL_TEXT.accountsHint),
      list,
      h('div', { class: 'bridge-row' }, input, add, apply),
    )
  }

  const persist = async () => {
    if (saving) return
    if (!pending.size) return toast(LEVEL_TEXT.nothingToSave, 'info')
    saving = true
    try {
      const changes: LevelChange[] = [...pending].map(([id, level]) => ({ id, level }))
      snap = await window.office.setPermissionLevels(changes)
      pending.clear()
      toast(LEVEL_TEXT.saved, 'ok')
      close()
    } catch (err) {
      saving = false
      toast(cleanError(err), 'err')
      render()
    }
  }

  const load = async () => {
    try {
      snap = await window.office.permissionLevels()
      render()
    } catch (err) {
      toast(cleanError(err), 'err')
    }
  }

  render()
  root.append(el)
  void load()
}
