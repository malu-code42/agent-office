import type { WritingSnippetView } from '@shared/types/ipc'
import type { WritingVersion } from '@shared/writing'
import { arrowList, keepFocus } from './a11y'
import { h } from './dom'
import { cleanError, confirmDialog, field, modal } from './modals/common'

type Toast = (text: string, kind?: 'info' | 'ok' | 'err') => void
type Screen = 'loading' | 'error' | 'list' | 'original' | 'instruction' | 'preview' | 'sending' | 'draft'

/** Local library and explicit, preview-first writing review flow. */
export function openWritingLibrary(root: HTMLElement, toast: Toast): void {
  let done = false
  let screen: Screen = 'loading'
  let snippets: WritingSnippetView[] = []
  let selectedSnippet: WritingSnippetView | undefined
  let selectedVersion: WritingVersion | undefined
  let previewToken: string | undefined
  let draftToken: string | undefined
  let originalText = ''
  let draftText = ''
  let instructionText = ''
  let sendRequest = 0
  let staleConflict = false
  let draftCopied = false

  const content = h('div', { class: 'writing-content', 'aria-live': 'polite' })
  const footer = h('div', { class: 'writing-footer' })
  const closeButton = h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Fechar')
  const el = modal('Biblioteca de Escrita', [content], [footer], () => close())

  function close(): void {
    if (done) return
    done = true
    const preview = previewToken
    const draft = draftToken
    previewToken = undefined
    draftToken = undefined
    el.remove()
    if (preview) void window.office.cancelWritingPreview(preview).catch(() => undefined)
    if (draft) void window.office.discardWritingDraft(draft).catch(() => undefined)
  }

  function render(): void {
    keepFocus(content, () => {
      content.replaceChildren()
      footer.replaceChildren()
      footer.append(closeButton)

      if (screen === 'loading') {
        content.append(h('p', { class: 'hint', role: 'status' }, 'Carregando trechos…'))
        return
      }
      if (screen === 'list') {
        const list = h('div', { class: 'writing-list', role: 'list', 'aria-label': 'Trechos salvos' })
        if (!snippets.length) content.append(h('p', { class: 'writing-empty' }, 'Ainda não há trechos. Crie um Original para começar.'))
        for (const snippet of snippets) {
          const latest = snippet.versions.at(-1)
          list.append(
            h(
              'div',
              { role: 'listitem' },
              h(
                'button',
                {
                  class: `btn writing-snippet${selectedSnippet?.id === snippet.id ? ' writing-snippet-selected' : ''}`,
                  type: 'button',
                  'data-focus-key': `snippet-${snippet.id}`,
                  onclick: () => {
                    selectedSnippet = snippet
                    selectedVersion = latest
                    screen = 'list'
                    render()
                  },
                },
                h('strong', {}, snippet.title),
                h(
                  'span',
                  { class: 'field-hint' },
                  `${snippet.versions.length} ${snippet.versions.length === 1 ? 'versão' : 'versões'} · v${latest?.number ?? '—'}`,
                ),
              ),
            ),
          )
        }
        arrowList(list, '.writing-snippet')
        if (snippets.length) content.append(list)
        if (selectedSnippet && selectedSnippet.versions.length) {
          const versions = h('div', { class: 'writing-versions', role: 'group', 'aria-label': 'Versões do trecho' })
          for (const version of selectedSnippet.versions) {
            versions.append(
              h(
                'button',
                {
                  class: `btn btn-small${selectedVersion?.versionId === version.versionId ? ' btn-primary' : ''}`,
                  type: 'button',
                  'aria-pressed': String(selectedVersion?.versionId === version.versionId),
                  'data-focus-key': `version-${version.versionId}`,
                  onclick: () => {
                    selectedVersion = version
                    render()
                  },
                },
                `v${version.number}`,
              ),
            )
          }
          const version = selectedVersion ?? selectedSnippet.versions.at(-1)!
          content.append(
            h('h3', { class: 'writing-section-title' }, selectedSnippet.title),
            versions,
            h(
              'div',
              { class: 'writing-meta' },
              `${version.source === 'original' ? 'Original' : 'Escrita'} · ${formatDate(version.createdAt)}`,
            ),
            h('pre', { class: 'writing-body', tabindex: '0', 'aria-label': `Corpo da versão ${version.number}` }, version.body),
          )
          selectedVersion = version
          footer.replaceChildren(
            h('button', { class: 'btn', type: 'button', onclick: () => showOriginal() }, 'Criar Original'),
            h('div', { class: 'grow' }),
            h('button', { class: 'btn btn-primary', type: 'button', onclick: () => showInstruction() }, 'Revisar com Agatha'),
            closeButton,
          )
        } else {
          footer.replaceChildren(
            h('button', { class: 'btn', type: 'button', onclick: () => showOriginal() }, 'Criar Original'),
            h('div', { class: 'grow' }),
            closeButton,
          )
        }
        return
      }
      if (screen === 'original') {
        const title = h('input', { type: 'text', maxlength: '200', autocomplete: 'off', 'aria-describedby': 'writing-title-hint' })
        const body = h('textarea', { rows: '12', maxlength: '50000', 'aria-describedby': 'writing-body-hint' })
        const status = h('p', { class: 'field-hint', role: 'status', 'aria-live': 'polite' })
        content.append(
          h('p', { class: 'hint' }, 'O Original só será salvo quando você confirmar. Ele não será enviado à Agatha.'),
          field('Título', title, h('span', { id: 'writing-title-hint' }, '1 a 200 caracteres, em uma linha.')),
          field('Texto original', body, h('span', { id: 'writing-body-hint' }, 'Até 50.000 caracteres.')),
          status,
        )
        footer.replaceChildren(
          h('button', { class: 'btn', type: 'button', onclick: () => backToList() }, 'Voltar'),
          h('div', { class: 'grow' }),
          h(
            'button',
            { class: 'btn btn-primary', type: 'button', onclick: () => void createOriginal(title, body, status) },
            'Salvar Original',
          ),
          closeButton,
        )
        title.focus()
        return
      }
      if (screen === 'instruction') {
        const instruction = h('textarea', { rows: '4', maxlength: '2000', 'aria-describedby': 'writing-instruction-hint' })
        instruction.value = instructionText
        instruction.addEventListener('input', () => (instructionText = instruction.value))
        const version = selectedVersion!
        content.append(
          h(
            'p',
            { class: 'hint' },
            `Versão selecionada: ${selectedSnippet!.title} · v${version.number}. A revisão envia somente esta versão e sua instrução.`,
          ),
          field('Instrução para Agatha', instruction, h('span', { id: 'writing-instruction-hint' }, 'De 1 a 2.000 caracteres.')),
        )
        footer.replaceChildren(
          h('button', { class: 'btn', type: 'button', onclick: () => backToList() }, 'Voltar'),
          h('div', { class: 'grow' }),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => void prepare(instruction.value) }, 'Ver prévia'),
          closeButton,
        )
        instruction.focus()
        return
      }
      if (screen === 'preview') {
        content.append(
          h('p', { class: 'hint' }, 'Confira abaixo o texto exato que será enviado. Nada foi enviado ainda.'),
          h('pre', { class: 'writing-preview', tabindex: '0', 'aria-label': 'Prévia exata enviada à Agatha' }, previewText),
        )
        footer.replaceChildren(
          h('button', { class: 'btn', type: 'button', onclick: () => void cancelPreview() }, 'Cancelar'),
          h('div', { class: 'grow' }),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => void send() }, 'Enviar à Agatha'),
        )
        return
      }
      if (screen === 'sending') {
        content.append(h('p', { class: 'hint', role: 'status' }, 'Agatha está preparando um rascunho…'))
        footer.replaceChildren(h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancelar'))
        return
      }
      if (screen === 'draft') {
        const draft = h('textarea', {
          class: 'writing-editor',
          rows: '12',
          maxlength: '50000',
          'aria-label': 'Rascunho editável da Agatha',
        })
        draft.value = draftText
        draft.addEventListener('input', () => {
          draftText = draft.value
          draftCopied = false
        })
        const status = h('p', { class: 'field-hint writing-status', role: 'status', 'aria-live': 'polite' })
        const saveButton = h(
          'button',
          {
            class: 'btn btn-primary',
            type: 'button',
            disabled: !draftToken || undefined,
            onclick: () => void saveDraft(draft, status, saveButton),
          },
          'Salvar nova versão',
        )
        content.append(
          h('h3', { class: 'writing-section-title' }, selectedSnippet?.title ?? 'Rascunho'),
          h(
            'label',
            { class: 'field' },
            h('span', { class: 'field-label' }, 'Texto original'),
            h('pre', { class: 'writing-body', tabindex: '0' }, originalText),
          ),
          field('Rascunho editável', draft, 'Edite à vontade. Nada será salvo até você escolher “Salvar nova versão”.'),
          status,
        )
        footer.replaceChildren(
          h('button', { class: 'btn', type: 'button', onclick: () => void copyDraft(draft, status) }, 'Copiar rascunho'),
          h('button', { class: 'btn', type: 'button', onclick: () => void reloadWithDraft(draft) }, 'Recarregar biblioteca'),
          h('div', { class: 'grow' }),
          h('button', { class: 'btn', type: 'button', onclick: () => void discardDraft() }, 'Cancelar'),
          saveButton,
        )
        draft.focus()
        return
      }
      const error = h('p', { class: 'writing-error', role: 'alert' }, loadError)
      content.append(error)
      footer.replaceChildren(h('button', { class: 'btn', type: 'button', onclick: () => void load() }, 'Tentar novamente'), closeButton)
    })
  }

  let previewText = ''
  let loadError = ''

  async function load(): Promise<void> {
    screen = 'loading'
    render()
    try {
      const result = await window.office.readWriting()
      if (done) return
      snippets = result.snippets
      selectedSnippet = snippets.find((snippet) => snippet.id === selectedSnippet?.id)
      selectedVersion =
        selectedSnippet?.versions.find((version) => version.versionId === selectedVersion?.versionId) ?? selectedSnippet?.versions.at(-1)
      screen = 'list'
    } catch (err) {
      if (done) return
      loadError = cleanError(err)
      screen = 'error'
    }
    render()
  }

  async function createOriginal(title: HTMLInputElement, body: HTMLTextAreaElement, status: HTMLElement): Promise<void> {
    try {
      const id = await window.office.createWritingOriginal({ title: title.value, body: body.value })
      toast('Original salvo na biblioteca de Escrita.', 'ok')
      await load()
      selectedSnippet = snippets.find((snippet) => snippet.id === id)
      selectedVersion = selectedSnippet?.versions[0]
      render()
    } catch (err) {
      status.textContent = cleanError(err)
      title.focus()
    }
  }

  async function prepare(instruction: string): Promise<void> {
    instructionText = instruction
    try {
      const result = await window.office.prepareWritingReview(selectedSnippet!.id, selectedVersion!.versionId, instruction)
      if (done) {
        void window.office.cancelWritingPreview(result.token).catch(() => undefined)
        return
      }
      previewToken = result.token
      previewText = result.preview
      screen = 'preview'
    } catch (err) {
      toast(cleanError(err), 'err')
      screen = 'instruction'
    }
    render()
  }

  async function cancelPreview(): Promise<void> {
    const token = previewToken
    previewToken = undefined
    if (token) await window.office.cancelWritingPreview(token).catch(() => undefined)
    if (done) return
    screen = 'instruction'
    render()
  }

  async function send(): Promise<void> {
    const token = previewToken
    if (!token || done) return
    screen = 'sending'
    const request = ++sendRequest
    render()
    try {
      const draft = await window.office.sendWritingPreview(token)
      previewToken = undefined
      if (done || request !== sendRequest) {
        void window.office.discardWritingDraft(draft.draftToken).catch(() => undefined)
        return
      }
      draftToken = draft.draftToken
      staleConflict = false
      draftCopied = false
      originalText = draft.originalText
      draftText = draft.suggestedText
      screen = 'draft'
    } catch (err) {
      previewToken = undefined
      if (done || request !== sendRequest) return
      toast(cleanError(err), 'err')
      screen = 'instruction'
    }
    render()
  }

  async function saveDraft(draft: HTMLTextAreaElement, status: HTMLElement, saveButton: HTMLButtonElement): Promise<void> {
    draftText = draft.value
    const token = draftToken
    if (!token) return
    try {
      await window.office.saveWritingDraft(token, draftText)
      const snippetId = selectedSnippet?.id
      draftToken = undefined
      toast('Nova versão salva.', 'ok')
      screen = 'list'
      await load()
      selectedSnippet = snippets.find((snippet) => snippet.id === snippetId) ?? selectedSnippet
      selectedVersion = selectedSnippet?.versions.at(-1)
      render()
    } catch (err) {
      const message = cleanError(err)
      const stale = /mudou desde que você abriu/.test(message)
      draftToken = undefined
      staleConflict = stale
      draftCopied = false
      void window.office.discardWritingDraft(token).catch(() => undefined)
      saveButton.disabled = true
      status.textContent = stale
        ? 'O escrita.md mudou desde que esta revisão começou. Seu rascunho continua no editor e pode ser copiado, mas não pode ser gravado contra a base antiga. Recarregue a biblioteca, confira a versão atual e inicie uma nova revisão após reconciliar o texto.'
        : `${message} Não é possível confirmar se o token de gravação continua válido. Seu texto editado continua no editor e pode ser copiado, mas não tente salvá-lo contra a base antiga; recarregue a biblioteca, confira a versão atual e inicie uma nova revisão após reconciliar o texto.`
      status.classList.add('writing-error')
      draft.focus()
    }
  }

  async function discardDraft(): Promise<void> {
    const token = draftToken
    draftToken = undefined
    if (token) await window.office.discardWritingDraft(token).catch((err) => toast(cleanError(err), 'err'))
    if (done) return
    screen = 'list'
    await load()
  }

  async function copyDraft(draft: HTMLTextAreaElement, status: HTMLElement): Promise<void> {
    const textToCopy = draft.value
    draftText = textToCopy
    try {
      await navigator.clipboard.writeText(textToCopy)
      draftCopied = draft.value === textToCopy
      status.textContent = 'Rascunho copiado. O texto também continua neste editor.'
    } catch {
      draft.focus()
      draft.select()
      status.textContent = 'Não consegui acessar a área de transferência. O texto ficou selecionado para copiar manualmente.'
    }
  }

  async function reloadWithDraft(draft: HTMLTextAreaElement): Promise<void> {
    draftText = draft.value
    const copied = draftCopied
    if (staleConflict && !copied) {
      const confirmed = await confirmDialog(root, {
        title: 'Recarregar biblioteca?',
        text: 'Recarregar fecha o editor. O rascunho não salvo sairá do editor e não poderá ser recuperado daqui.',
        confirm: 'Recarregar mesmo assim',
        cancel: 'Voltar ao rascunho',
        danger: true,
      })
      if (!confirmed) {
        draft.focus()
        return
      }
    }
    const token = draftToken
    draftToken = undefined
    if (token) void window.office.discardWritingDraft(token).catch(() => undefined)
    await load()
    if (!done) {
      toast(
        copied
          ? 'Biblioteca recarregada. O rascunho está na área de transferência; ele não foi salvo. Confira a versão atual antes de iniciar uma nova revisão.'
          : 'Biblioteca recarregada. O rascunho saiu do editor e não foi salvo. Confira a versão atual antes de iniciar uma nova revisão.',
        'info',
      )
    }
  }

  function showOriginal(): void {
    screen = 'original'
    render()
  }
  function showInstruction(): void {
    screen = 'instruction'
    render()
  }
  function backToList(): void {
    screen = 'list'
    render()
  }

  root.append(el)
  void load()
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}
