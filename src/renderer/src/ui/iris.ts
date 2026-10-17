import type { IrisPreview } from '@shared/iris'
import { h } from './dom'
import { cleanError, field, modal } from './modals/common'

type Toast = (text: string, kind?: 'info' | 'ok' | 'err') => void

/**
 * Pedir à Íris (AO-13): a request in words. "Revisar envio" builds the exact text that would leave the computer and
 * shows it; nothing is sent until "Enviar à Íris". Esc or "Cancelar" in the preview goes back to the request, unsent.
 * The answer is a proposal in the caixa de entrada, or a question shown here: the text stays in the box, so the
 * answer is written in it and sent again.
 */
export function openIris(root: HTMLElement, toast: Toast): void {
  let done = false
  let preview: IrisPreview | undefined

  const area = h('textarea', { class: 'iris-text', rows: '4', maxlength: '2000', 'aria-describedby': 'iris-hint' })
  const question = h('div', { class: 'iris-question hidden', role: 'status' })
  const status = h('div', { class: 'field-hint', role: 'status', 'aria-live': 'polite' })
  const context = h('pre', { class: 'iris-context', tabindex: '0', 'aria-label': 'Texto que será enviado à Íris' })
  const previewBox = h(
    'div',
    { class: 'iris-preview hidden' },
    h(
      'p',
      { class: 'hint' },
      'Este é o texto exato que sairia do seu computador. Nada foi enviado ainda. As instruções fixas do app acompanham o texto, sem dados seus.',
    ),
    context,
  )

  const reviewBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => void review() }, 'Revisar envio')
  const sendBtn = h('button', { class: 'btn btn-primary hidden', type: 'button', onclick: () => void send() }, 'Enviar à Íris')
  const cancelBtn = h('button', { class: 'btn', type: 'button', onclick: () => onCancel() }, 'Cancelar')

  const close = () => {
    if (done) return
    done = true
    if (preview) void window.office.cancelIris(preview.token).catch(() => undefined)
    el.remove()
  }
  // Esc and the close button step back from the preview first; from the request they close the box.
  const onClose = () => (preview ? onCancel() : close())

  const setPreview = (on: boolean) => {
    previewBox.classList.toggle('hidden', !on)
    area.readOnly = on
    reviewBtn.classList.toggle('hidden', on)
    sendBtn.classList.toggle('hidden', !on)
  }

  const onCancel = () => {
    if (!preview) return close()
    const token = preview.token
    preview = undefined
    setPreview(false)
    void window.office.cancelIris(token).catch(() => undefined)
    area.focus()
  }

  const review = async () => {
    const request = area.value.trim()
    if (!request) {
      toast('Escreva o pedido para a Íris.', 'err')
      area.focus()
      return
    }
    question.classList.add('hidden')
    reviewBtn.setAttribute('disabled', '')
    try {
      preview = await window.office.prepareIris(request)
      context.textContent = preview.context
      setPreview(true)
      sendBtn.focus()
    } catch (err) {
      toast(cleanError(err), 'err')
    } finally {
      reviewBtn.removeAttribute('disabled')
    }
  }

  const send = async () => {
    if (!preview) return
    const token = preview.token
    preview = undefined
    sendBtn.setAttribute('disabled', '')
    cancelBtn.setAttribute('disabled', '')
    status.textContent = 'A Íris está pensando…'
    try {
      const result = await window.office.sendIris(token)
      if (result.kind === 'proposal') {
        toast('A Íris preparou uma proposta. Revise na caixa de entrada.', 'ok')
        close()
        return
      }
      question.textContent = `A Íris pergunta: ${result.text}`
      question.classList.remove('hidden')
    } catch (err) {
      toast(cleanError(err), 'err')
    } finally {
      status.textContent = ''
      sendBtn.removeAttribute('disabled')
      cancelBtn.removeAttribute('disabled')
      if (!done) {
        setPreview(false)
        area.focus()
      }
    }
  }

  const el = modal(
    'Pedir à Íris',
    [
      h(
        'p',
        { class: 'hint', id: 'iris-hint' },
        'Escreva em português o que quer, por exemplo: “reserve amanhã às 15h por uma hora”. Você confere o texto antes de enviar, e a Íris só propõe: nada muda até você confirmar a proposta.',
      ),
      question,
      field('Pedido', area),
      previewBox,
      status,
    ],
    [cancelBtn, h('div', { class: 'grow' }), reviewBtn, sendBtn],
    onClose,
  )
  root.append(el)
  area.focus()
}
