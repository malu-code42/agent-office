import type { IrisPreview } from '@shared/iris'
import { projectFor } from '@shared/projects'
import { profileById } from '@shared/profiles'
import { h } from './dom'
import { cleanError, field, LAST_CWD, modal } from './modals/common'

type Toast = (text: string, kind?: 'info' | 'ok' | 'err') => void

/**
 * Pedir à Luna (AO-13): a request in words. "Revisar envio" builds the exact text that would leave the computer and
 * shows it; nothing is sent until "Enviar à Luna". Esc or "Cancelar" in the preview goes back to the request, unsent.
 * The answer is a proposal in the caixa de entrada, or a question shown here: the text stays in the box, so the
 * answer is written in it and sent again.
 */
export function openIris(root: HTMLElement, toast: Toast): void {
  let done = false
  let preview: IrisPreview | undefined

  const area = h('textarea', { class: 'iris-text', rows: '4', maxlength: '2000', 'aria-describedby': 'iris-hint' })
  const question = h('div', { class: 'iris-question hidden', role: 'status' })
  const status = h('div', { class: 'field-hint', role: 'status', 'aria-live': 'polite' })
  const context = h('pre', { class: 'iris-context', tabindex: '0', 'aria-label': 'Texto que será enviado à Luna' })
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
  const sendBtn = h('button', { class: 'btn btn-primary hidden', type: 'button', onclick: () => void send() }, 'Enviar à Luna')
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
      toast('Escreva o pedido para a Luna.', 'err')
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
    status.textContent = 'A Luna está pensando…'
    try {
      const result = await window.office.sendIris(token)
      if (result.kind === 'task') {
        const agentName = await startProfileTask(result.profile, area.value.trim())
        if (agentName) {
          const profile = profileById(result.profile)
          toast(`${agentName} começou com ${profile?.name ?? 'o perfil escolhido'}: ${profile?.scope ?? 'escopo aplicado à tarefa'}.`, 'ok')
          close()
          return
        }
        question.textContent = 'A tarefa não começou porque nenhuma pasta foi escolhida.'
        question.classList.remove('hidden')
        return
      }
      if (result.kind === 'proposal') {
        if (!result.profile) {
          toast('A Luna preparou uma proposta. Revise na caixa de entrada.', 'ok')
          close()
          return
        }
        // The proposal is in the caixa de entrada; the profile suggestion stays visible for the
        // user to read before closing. It is only a suggestion: nothing carries it by itself.
        const profile = profileById(result.profile)
        question.textContent = `A Luna preparou uma proposta (revise na caixa de entrada) e sugere o perfil “${profile?.name ?? result.profile}” (serve para: ${profile?.scope ?? '—'}).`
        question.classList.remove('hidden')
        return
      }
      question.textContent = `A Luna pergunta: ${result.text}`
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
    'Pedir à Luna',
    [
      h(
        'p',
        { class: 'hint', id: 'iris-hint' },
        'Escreva em português o que quer, por exemplo: “reserve amanhã às 15h por uma hora”. Você confere o texto antes de enviar, e a Luna só propõe: nada muda até você confirmar a proposta.',
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

/** A clear task request goes straight to a fresh Claude conversation; folder choice is asked only when unknown. */
async function startProfileTask(profileId: string, task: string): Promise<string | null> {
  const profile = profileById(profileId)
  if (!profile) throw new Error('Esse perfil não existe mais. Tente o pedido de novo.')
  let cwd = localStorage.getItem(LAST_CWD) ?? ''
  if (!cwd) cwd = (await window.office.pickFolder()) ?? ''
  if (!cwd) return null
  const state = await window.office.getState()
  try {
    const agent = await window.office.hire({
      name: '',
      cwd,
      task,
      profile: profile.id,
      engine: 'claude',
      permissionMode: projectFor(state.settings.projects, cwd)?.permissionMode ?? state.settings.defaultPermissionMode,
      model: state.settings.defaultModel || undefined,
      effort: state.settings.defaultEffort || undefined,
    })
    localStorage.setItem(LAST_CWD, cwd)
    return agent.name
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes('Escolha uma pasta de projeto que exista.')) throw err
    const selected = await window.office.pickFolder(cwd)
    if (!selected || selected === cwd) throw err
    const agent = await window.office.hire({
      name: '',
      cwd: selected,
      task,
      profile: profile.id,
      engine: 'claude',
      permissionMode: projectFor(state.settings.projects, selected)?.permissionMode ?? state.settings.defaultPermissionMode,
      model: state.settings.defaultModel || undefined,
      effort: state.settings.defaultEffort || undefined,
    })
    localStorage.setItem(LAST_CWD, selected)
    return agent.name
  }
}
