import { adviseAgent } from '@shared/economy'
import type { State } from '../../state'
import { h, icon } from '../dom'
import { adviceCopy, economyTips, SPEND_PARTS, warnTokens } from '../economy-text'
import { cleanError, confirmDialog } from '../modals'
import { portrait } from '../portrait'
import { usd, type Group, type Report } from './data'

// Relatórios → Economia de tokens (upstream 70ae59f): where the money went, what to change and
// who needs it now. Built from the report's own rows (rep-rank, rep-share), no new visuals.

/** `group`: the project filter (null = all), so the agent list follows it. */
export function economy(
  root: HTMLElement,
  state: State,
  r: Report,
  group: string | null,
  groupOf: (cwd: string) => Group,
  toast: (t: string, k?: 'info' | 'ok' | 'err') => void,
): HTMLElement {
  const s = r.split
  const total = s.read + s.write + s.output + s.input
  const share = (v: number) => (total > 0 ? v / total : 0)

  const split = h(
    'div',
    { class: 'rep-section' },
    h('div', { class: 'rep-section-head' }, 'Para onde foi o dinheiro'),
    h(
      'div',
      { class: 'rep-rank' },
      ...(total > 0
        ? SPEND_PARTS.filter((p) => s[p.key] > 0.005).map((p) =>
            h(
              'div',
              { class: 'rep-rank-row rep-model', title: p.title },
              h(
                'div',
                { class: 'rep-rank-main' },
                h(
                  'div',
                  { class: 'rep-rank-name' },
                  h('span', { class: 'name' }, p.label),
                  h('span', { class: 'rep-pct' }, `${Math.round(share(s[p.key]) * 100)}%`),
                ),
                h('div', { class: 'rep-share' }, h('i', { style: `width:${share(s[p.key]) * 100}%` })),
              ),
              h('div', { class: 'rep-rank-side' }, h('b', {}, usd(s[p.key]))),
            ),
          )
        : [h('div', { class: 'rep-empty small' }, 'Sem gasto com preço conhecido no período.')]),
    ),
  )

  const tips = economyTips(s, r.total.turns, state.settings)
  const tipList = h(
    'div',
    { class: 'rep-section' },
    h('div', { class: 'rep-section-head' }, 'Dicas'),
    h(
      'div',
      { class: 'rep-rank' },
      ...(tips.length
        ? tips
        : ['Nada a ajustar agora: as chaves de economia estão ligadas e a memória dos agentes está sob controle.']
      ).map((t) => h('div', { class: 'rep-rank-row eco-tip' }, icon(tips.length ? 'alert' : 'check', 13), h('span', {}, t))),
    ),
  )

  const warn = warnTokens(state.settings)
  const now = [...state.agents.values()]
    .filter((a) => !group || groupOf(a.cwd).key === group)
    .map((a) => ({ a, advice: adviseAgent(a, warn) }))
    .filter((x): x is { a: typeof x.a; advice: NonNullable<typeof x.advice> } => x.advice !== null)
    .sort((x, y) => y.advice.usd - x.advice.usd)

  const clear = async (id: string, name: string) => {
    const ok = await confirmDialog(root, {
      title: `Limpar a memória de ${name}?`,
      text: 'Continua no escritório, mas esquece esta conversa. O histórico fica salvo na Central de resume.',
      confirm: 'Limpar',
      cancel: 'Cancelar',
    })
    if (ok) await window.office.clearContext(id).catch((err: unknown) => toast(cleanError(err), 'err'))
  }

  return h(
    'div',
    { class: 'rep-section' },
    h('div', { class: 'rep-section-head' }, 'Economia de tokens'),
    h('div', { class: 'rep-ranks' }, split, tipList),
    now.length
      ? h(
          'div',
          { class: 'rep-section' },
          h('div', { class: 'rep-section-head' }, 'Agentes que pedem ação agora'),
          h(
            'div',
            { class: 'rep-rank' },
            ...now.map(({ a, advice }) =>
              h(
                'div',
                { class: 'rep-rank-row' },
                portrait(a.look, 26),
                h(
                  'div',
                  { class: 'rep-rank-main' },
                  h('div', { class: 'rep-rank-name' }, h('span', { class: 'name' }, a.name)),
                  h('div', { class: 'eco-tip' }, adviceCopy(advice).title),
                ),
                advice.kind === 'big'
                  ? h(
                      'button',
                      { class: 'btn btn-small', title: 'Resume a conversa (/compact)', onclick: () => window.office.compact(a.id) },
                      icon('compact', 13),
                      'Compactar',
                    )
                  : null,
                h('button', { class: 'btn btn-small', onclick: () => void clear(a.id, a.name) }, icon('reset', 13), 'Limpar'),
              ),
            ),
          ),
        )
      : null,
  )
}
