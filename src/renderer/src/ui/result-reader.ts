import type { AgentResult, AgentSummary } from '@shared/types'
import type { State } from '../state'
import { announce, asDialog, FocusReturn, labelDialog } from './a11y'
import { h, icon } from './dom'
import { renderMarkdown } from './markdown'
import { cleanError } from './modals/common'
import { standingSprite } from './portrait'
import {
  footerActions,
  readableResults,
  readerView,
  startsReply,
  stepResult,
  type ReaderHandlers,
  type ReaderSource,
} from './result-reader-model'

/** O que a tela pede à carta de resultado (dialog.ts): as mesmas ações, nada novo. */
export interface ReaderHost extends ReaderHandlers {
  toast(text: string, kind?: 'info' | 'ok' | 'err'): void
  /** Depois de responder: o painel do agente, para ver ele trabalhar. */
  reply(agentId: string): void
}

/**
 * Tela de leitura de um resultado de ticket, por cima do escritório: o agente à esquerda,
 * o texto no centro (com os arquivos alterados ao lado, quando vieram) e, embaixo, a
 * resposta e as mesmas ações da carta. DOM e CSS puros: nenhum laço de desenho novo.
 */
export class ResultReader {
  private el: HTMLDivElement
  private resultId: string | null = null
  private focusBack = new FocusReturn()
  /** Uma ação da carta rodando: o rodapé espera. */
  private busy = false
  private drafts = new Map<string, string>()

  constructor(
    root: HTMLElement,
    private state: State,
    private host: ReaderHost,
  ) {
    this.el = h('div', { class: 'rr hidden' })
    asDialog(this.el, { label: 'Tela de leitura do resultado' })
    // As teclas ficam aqui: os atalhos do escritório (T, N, setas que andam…) não disparam por trás.
    this.el.addEventListener('keydown', (e) => {
      e.stopPropagation()
      this.onKey(e)
    })
    root.append(this.el)
  }

  get isOpen(): boolean {
    return this.resultId !== null
  }

  private get source(): ReaderSource {
    const s = this.state
    return { agents: s.agents, results: s.results, tickets: s.tickets, squads: s.squads, projects: s.settings.projects }
  }

  /** Abre um resultado pendente. False quando ele não existe mais. */
  open(resultId: string): boolean {
    const r = this.state.results.get(resultId)
    const agent = r && this.state.agents.get(r.agentId)
    if (!r || !agent) return false
    if (!this.resultId) this.focusBack.save(this.el)
    this.resultId = r.id
    this.busy = false
    this.render(agent, r)
    return true
  }

  close(): void {
    if (!this.resultId) return
    this.resultId = null
    this.el.classList.add('hidden')
    this.el.replaceChildren()
    this.focusBack.restore(this.el)
  }

  /** O resultado aberto saiu (recebido em outro lugar, respondido): vai para o próximo, ou fecha. */
  sync(): void {
    if (!this.resultId || this.state.results.has(this.resultId)) return
    const next = readableResults(this.source)[0]
    if (!next || !this.open(next.id)) this.close()
  }

  /** Os arquivos do resultado aberto chegaram ou mudaram (commit, descarte). */
  syncChanges(resultId: string): void {
    if (this.resultId === resultId) this.open(resultId)
  }

  private go(dir: -1 | 1): void {
    if (!this.resultId) return
    const next = stepResult(readableResults(this.source), this.resultId, dir)
    if (next) this.open(next)
  }

  private onKey(e: KeyboardEvent): void {
    if (e.isComposing) return
    const input = this.el.querySelector<HTMLTextAreaElement>('.rr-input')
    const inInput = !!input && document.activeElement === input
    if (e.key === 'Escape') {
      e.preventDefault()
      // Com texto na resposta, o Esc só sai do campo: o rascunho fica.
      if (inInput && input.value.trim()) return void this.el.querySelector<HTMLElement>('.rr-text')?.focus({ preventScroll: true })
      return this.close()
    }
    if (inInput) return
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault()
      return this.go(e.key === 'ArrowUp' ? -1 : 1)
    }
    const a = document.activeElement
    if (input && !input.disabled && startsReply(e) && !(a instanceof HTMLInputElement)) input.focus()
  }

  private render(agent: AgentSummary, r: AgentResult): void {
    const hadFocus = this.el.contains(document.activeElement)
    const typing = document.activeElement instanceof HTMLTextAreaElement && this.el.contains(document.activeElement)
    const view = readerView(this.source, agent, r)
    const list = readableResults(this.source)
    const pos = list.findIndex((x) => x.id === r.id)

    const title = h('h2', { class: 'rr-name' }, view.name)
    const kind = h(
      'span',
      { class: `chip ${view.isError ? 'chip-err' : 'chip-done'}` },
      view.isError ? 'teve um problema' : 'resultado entregue',
    )
    const side = h(
      'aside',
      { class: 'rr-side card', 'aria-label': `Sobre ${view.name}` },
      h('div', { class: 'rr-figure', role: 'img', 'aria-label': `${view.name}, de pé` }, standingSprite(agent.look, 5)),
      title,
      view.where ? h('div', { class: 'rr-where' }, view.where) : null,
      view.ticket
        ? h(
            'div',
            { class: 'rr-ticket' },
            h('span', { class: 'chip chip-ticket' }, view.ticket.key),
            h('span', { class: 'rr-ticket-title' }, view.ticket.title),
          )
        : null,
      view.facts.length
        ? h(
            'dl',
            { class: 'rr-facts' },
            ...view.facts.map((f) => h('div', { class: 'rr-fact' }, h('dt', {}, f.label), h('dd', {}, f.value))),
          )
        : null,
    )

    const text = h(
      'div',
      { class: 'rr-text', tabindex: 0, role: 'region', 'aria-label': 'Texto do resultado' },
      renderMarkdown(view.text || '(sem texto)'),
    )
    const files = view.files
      ? h(
          'aside',
          { class: 'rr-files', 'aria-label': 'Arquivos alterados' },
          h(
            'div',
            { class: 'rr-files-head' },
            `${view.filesTotal} arquivo${view.filesTotal === 1 ? '' : 's'} alterado${view.filesTotal === 1 ? '' : 's'}`,
          ),
          view.branch ? h('span', { class: 'chip chip-branch' }, icon('branch', 11), view.branch) : null,
          h(
            'ul',
            { class: 'rr-files-list' },
            ...view.files.map((f) =>
              h(
                'li',
                { class: 'rr-file', title: f.path },
                h('span', { class: `chg-letter chg-${f.status}` }, ({ added: 'A', modified: 'M', deleted: 'D' } as const)[f.status]),
                h('span', { class: 'rr-file-path' }, f.path),
                f.added !== undefined || f.removed !== undefined
                  ? h(
                      'span',
                      { class: 'chg-nums' },
                      h('span', { class: 'chg-plus' }, `+${f.added ?? 0}`),
                      h('span', { class: 'chg-minus' }, `−${f.removed ?? 0}`),
                    )
                  : null,
              ),
            ),
          ),
          view.files.length < view.filesTotal
            ? h('div', { class: 'rr-files-more' }, `…e mais ${view.filesTotal - view.files.length}`)
            : null,
        )
      : null

    const read = h(
      'section',
      { class: 'rr-read card', 'aria-label': 'Resultado' },
      h('div', { class: 'rr-read-head' }, h('span', { class: 'rr-read-title' }, view.isError ? 'Problema' : 'Resultado'), kind),
      h('div', { class: `rr-read-body${files ? ' with-files' : ''}` }, text, files),
    )

    const actions = footerActions(agent, r, this.host)
    const buttons = actions.map((a) =>
      h(
        'button',
        {
          type: 'button',
          class: a.id === 'ack' ? 'btn btn-primary' : a.id === 'discard' ? 'btn btn-danger-soft' : 'btn',
          disabled: !a.enabled || this.busy,
          title:
            a.id === 'discard'
              ? 'Volta os arquivos para como estavam antes da tarefa (pede confirmação)'
              : a.id === 'pr'
                ? 'git push do branch e gh pr create (pede confirmação)'
                : 'Recebido: tira o resultado da fila',
        },
        icon(a.id === 'ack' ? 'check' : a.id === 'pr' ? 'pr' : 'undo', 15),
        a.label,
      ),
    )
    buttons.forEach((b, i) => {
      const a = actions[i]
      b.addEventListener('click', () => void this.run(a.id, a.run, buttons))
    })

    const foot = h(
      'footer',
      { class: 'rr-foot card' },
      view.canReply ? this.composer(agent, r) : h('div', { class: 'rr-reply-off' }, 'Sessão do terminal: responda por lá.'),
      h('div', { class: 'rr-actions' }, ...buttons),
    )

    const top = h(
      'div',
      { class: 'rr-top' },
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => this.close() }, '← Voltar ao escritório'),
      h('div', { class: 'grow' }),
      list.length > 1 ? h('span', { class: 'rr-count', 'aria-live': 'polite' }, `${pos + 1} de ${list.length} resultados`) : null,
      list.length > 1
        ? h(
            'button',
            {
              type: 'button',
              class: 'icon-btn',
              title: 'Resultado anterior (▲)',
              'aria-label': 'Resultado anterior',
              onclick: () => this.go(-1),
            },
            '▲',
          )
        : null,
      list.length > 1
        ? h(
            'button',
            {
              type: 'button',
              class: 'icon-btn',
              title: 'Próximo resultado (▼)',
              'aria-label': 'Próximo resultado',
              onclick: () => this.go(1),
            },
            '▼',
          )
        : null,
    )

    this.el.className = `rr tone-${view.isError ? 'err' : 'done'}`
    this.el.replaceChildren(top, h('div', { class: 'rr-main' }, side, read), foot)
    labelDialog(this.el, { title: [title] })
    if (!hadFocus) announce(`Lendo o resultado de ${view.name}`)
    const input = this.el.querySelector<HTMLTextAreaElement>('.rr-input')
    if (typing && input) input.focus({ preventScroll: true })
    else text.focus({ preventScroll: true })
  }

  private composer(agent: AgentSummary, r: AgentResult): HTMLElement {
    const input = h('textarea', {
      class: 'input rr-input',
      rows: 2,
      placeholder: `Responder para ${agent.name}… (é só começar a digitar)`,
      'aria-label': `Responder para ${agent.name} (Enter envia, Shift+Enter quebra a linha)`,
    }) as HTMLTextAreaElement
    input.value = this.drafts.get(r.id) ?? ''
    input.addEventListener('input', () => this.drafts.set(r.id, input.value))
    const send = h('button', { type: 'button', class: 'btn', title: 'Enviar (Enter)' }, icon('send', 15), 'Enviar')
    let sending = false
    const go = async () => {
      const t = input.value.trim()
      if (!t || sending) return
      sending = true
      send.disabled = true
      try {
        // O mesmo envio do painel (composer.ts).
        await window.office.send(agent.id, t)
        this.drafts.delete(r.id)
        this.close()
        this.host.reply(agent.id)
      } catch (err) {
        this.host.toast(cleanError(err), 'err')
      } finally {
        sending = false
        send.disabled = false
      }
    }
    send.addEventListener('click', () => void go())
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault()
        void go()
      }
    })
    return h('div', { class: 'rr-reply' }, input, send)
  }

  /** Uma ação da carta: o rodapé espera enquanto roda; erros viram toast, como na carta. */
  private async run(id: 'discard' | 'pr' | 'ack', fn: () => Promise<void> | void, buttons: HTMLButtonElement[]): Promise<void> {
    if (this.busy || !this.resultId) return
    const current = this.resultId
    const next = id === 'ack' ? stepResult(readableResults(this.source), current, 1) : null
    this.busy = true
    buttons.forEach((b) => (b.disabled = true))
    try {
      await fn()
    } catch (err) {
      this.host.toast(cleanError(err), 'err')
    } finally {
      this.busy = false
    }
    if (this.resultId !== current) return
    if (id === 'ack') {
      if (!next || next === current || !this.open(next)) this.close()
    } else this.open(current)
  }
}
