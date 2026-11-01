import type { State } from '../state'
import { h, icon } from './dom'
import { cleanError } from './modals'

// "Saindo quando os agentes terminarem": the banner while the app waits to quit.

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Shown while state.quitWait is set; "Interromper e sair agora" interrupts, "Ficar" cancels. */
export function mountQuitBanner(root: HTMLElement, state: State, toast: (text: string, kind?: 'info' | 'ok' | 'err') => void): void {
  const text = h('span', { class: 'quit-text' })
  const act = (fn: () => Promise<void>) => () => void fn().catch((err) => toast(cleanError(err), 'err'))
  const el = h(
    'div',
    { class: 'quit-banner card hidden', role: 'status' },
    icon('power', 15),
    text,
    h('button', { class: 'btn btn-small', type: 'button', onclick: act(() => window.office.cancelQuit()) }, 'Ficar'),
    h(
      'button',
      { class: 'btn btn-small btn-danger-soft', type: 'button', onclick: act(() => window.office.quitNow()) },
      'Interromper e sair agora',
    ),
  )
  root.append(el)
  let last = ''
  const render = () => {
    const w = state.quitWait
    el.classList.toggle('hidden', !w)
    if (!w) return void (last = '')
    const parts = [
      w.working ? plural(w.working, 'agente trabalhando', 'agentes trabalhando') : '',
      w.pending ? plural(w.pending, 'pedido esperando você', 'pedidos esperando você') : '',
      w.background ? plural(w.background, 'tarefa em segundo plano', 'tarefas em segundo plano') : '',
    ].filter(Boolean)
    const next = `Saindo quando terminarem: ${parts.join(', ')}.`
    if (next !== last) text.textContent = last = next
  }
  state.onChange(render)
  render()
}
