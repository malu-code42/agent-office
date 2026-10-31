import type { StudyQuestion } from '@shared/study-questions'
import { h } from './dom'
import { cleanError, modal } from './modals/common'

type Toast = (text: string, kind?: 'info' | 'ok' | 'err') => void

/** Search/review/save surface. Results remain in memory until the explicit save button is activated. */
export function openStudyQuestions(root: HTMLElement, toast: Toast): void {
  const topic = h('input', {
    class: 'input',
    type: 'search',
    maxlength: '200',
    placeholder: 'Ex.: Probabilidade condicional',
    'aria-label': 'Tópico para buscar questões',
  })
  const results = h('div', { class: 'study-question-results', 'aria-live': 'polite' })
  const search = h('button', { class: 'btn btn-primary', type: 'button' }, 'Buscar questões')
  const generate = h('button', { class: 'btn', type: 'button', disabled: true }, 'Gerar questões com IA')
  const save = h('button', { class: 'btn', type: 'button', disabled: true }, 'Salvar seleção no banco')
  const reviewConsent = h('input', {
    type: 'checkbox',
    'aria-label': 'Confirmo que revisei procedência e licença e selecionei apenas conteúdo que posso guardar',
  })
  const body = h(
    'div',
    {},
    h(
      'p',
      { class: 'field-hint' },
      'O banco local vem primeiro. WebSearch e IA não verificam procedência, licença ou direitos. Questões ficam como candidatas até revisão e salvamento explícitos.',
    ),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Tópico'), topic),
    results,
    // The consent goes with what it is about (the candidates), inside the body: in the footer it
    // was squeezed out of the modal, over the scene.
    h(
      'label',
      { class: 'study-questions-consent' },
      reviewConsent,
      h(
        'span',
        {},
        'Revisei procedência/licença e selecionei apenas conteúdo que posso guardar. Para licença incerta, escolha somente metadados/URL, sem enunciado.',
      ),
    ),
  )
  let token = ''
  let candidates: StudyQuestion[] = []
  let done = false
  const close = () => {
    if (!done) {
      done = true
      el.remove()
    }
  }
  const el = modal(
    'Buscar questões',
    [body],
    [h('button', { class: 'btn', type: 'button', onclick: close }, 'Fechar'), h('div', { class: 'grow' }), search, generate, save],
    close,
  )
  const renderCandidates = (groups: { label: string; rows: StudyQuestion[]; selectable: boolean }[]) => {
    const checkboxes: HTMLInputElement[] = []
    const sections = groups
      .filter((group) => group.rows.length)
      .map(({ label, rows, selectable }) =>
        h(
          'section',
          {},
          h('h3', {}, label),
          ...rows.map((question) => {
            const check = selectable ? h('input', { type: 'checkbox', 'aria-label': `Selecionar questão ${question.id}` }) : null
            if (check) {
              checkboxes.push(check)
              check.onchange = () => {
                save.disabled = !reviewConsent.checked || !checkboxes.some((item) => item.checked)
              }
            }
            return h(
              'article',
              { class: 'study-question-candidate' },
              h(
                'label',
                {},
                ...(check ? [check] : []),
                h('strong', {}, `${question.topic} · ${question.originKind.toUpperCase()} · ${question.answerStatus}`),
              ),
              h('p', {}, question.sourceOnly ? 'Somente metadados e URL; não há trecho de questão salvo.' : question.question),
              h(
                'p',
                { class: 'field-hint' },
                `Fonte: ${question.sourceTitle} · acesso ${question.sourceVisibility} · ${question.sourceUrl ?? question.sourceReference ?? 'sem link'} · ${question.attribution} · Licença informada (não verificada): ${question.license} · ${question.verifiedByUser ? `revisada por você em ${question.verifiedAt}` : 'procedência/licença não revisadas'}`,
              ),
              ...(!question.sourceOnly && question.answer
                ? [
                    h(
                      'details',
                      {},
                      h('summary', {}, 'Ver gabarito'),
                      h('p', {}, question.answer),
                      ...(question.rationale ? [h('p', {}, question.rationale)] : []),
                    ),
                  ]
                : []),
            )
          }),
        ),
      )
    results.replaceChildren(...(sections.length ? sections : [h('p', {}, 'Nenhuma questão encontrada para esse tópico.')]))
    save.disabled = checkboxes.length === 0 || !reviewConsent.checked
    reviewConsent.onchange = () => {
      save.disabled = !reviewConsent.checked || !checkboxes.some((item) => item.checked)
    }
    save.onclick = async () => {
      const selected = checkboxes.flatMap((check, index) => (check.checked ? [candidates[index]!] : []))
      if (!selected.length || !token) return
      save.disabled = true
      try {
        await window.office.saveStudyQuestions(token, selected, reviewConsent.checked)
        done = true
        el.remove()
        toast(`${selected.length} questão(ões) salvas no banco.`, 'ok')
      } catch (error) {
        toast(cleanError(error), 'err')
        save.disabled = false
      }
    }
  }
  search.onclick = async () => {
    const query = topic.value.trim()
    if (!query) {
      topic.focus()
      return
    }
    search.disabled = true
    generate.disabled = true
    save.disabled = true
    reviewConsent.checked = false
    token = ''
    candidates = []
    results.replaceChildren(h('p', { role: 'status' }, 'Buscando questões…'))
    try {
      const response = await window.office.searchStudyQuestions(query)
      token = response.token
      candidates = [...response.sourceCandidates, ...response.web]
      generate.disabled = !response.localScanComplete || !response.canGenerate
      search.textContent = response.status === 'error' ? 'Tentar novamente' : 'Buscar questões'
      const statusMessage = h(
        'p',
        { class: 'field-hint', role: response.status === 'error' ? 'alert' : 'status' },
        {
          found: 'Busca concluída; confira as fontes antes de salvar.',
          insufficient: 'A busca terminou, mas ainda há poucos resultados.',
          noResults: 'A busca terminou sem resultados.',
          error: 'A busca falhou. Tente novamente; não foram geradas questões.',
          incomplete: 'Busca local incompleta. Refine o tópico ou escolha uma fonte antes de continuar.',
        }[response.status],
      )
      renderCandidates([
        { label: 'Banco local — priorizado por origem (já salvo)', rows: response.local, selectable: false },
        {
          label: 'Trechos locais encontrados — revisar fonte/licença',
          rows: response.sourceCandidates,
          selectable: response.localScanComplete,
        },
        {
          label: 'Candidatas da web — URL/licença não verificadas; confirme na fonte',
          rows: response.web,
          selectable: response.localScanComplete,
        },
      ])
      results.prepend(statusMessage)
      if (response.warning) results.insertBefore(h('p', { class: 'field-hint' }, response.warning), statusMessage.nextSibling)
    } catch (error) {
      search.textContent = 'Tentar novamente'
      results.replaceChildren(h('p', { role: 'alert' }, cleanError(error)))
    } finally {
      search.disabled = false
    }
  }
  generate.onclick = async () => {
    if (!token || generate.disabled) return
    generate.disabled = true
    save.disabled = true
    reviewConsent.checked = false
    results.replaceChildren(h('p', { role: 'status' }, 'Gerando candidatas marcadas como IA…'))
    try {
      const response = await window.office.generateStudyQuestions(token)
      candidates = [...candidates, ...response.generated]
      generate.disabled = !response.canGenerate
      generate.textContent = response.status === 'error' ? 'Tentar geração novamente' : 'Gerar questões com IA'
      const generationStatus = h(
        'p',
        { role: response.status === 'error' ? 'alert' : 'status' },
        response.warning ?? 'Questões de IA geradas; gabaritos não verificados.',
      )
      renderCandidates([
        {
          label: 'Trechos locais encontrados — revisar fonte/licença',
          rows: candidates.filter((row) => row.originKind === 'enem' || row.originKind === 'concurso' || row.originKind === 'livro'),
          selectable: true,
        },
        {
          label: 'Candidatas da web — URL/licença não verificadas; confirme na fonte',
          rows: candidates.filter((row) => row.originKind === 'web'),
          selectable: true,
        },
        { label: 'Candidatas geradas por IA — gabaritos não verificados', rows: response.generated, selectable: true },
      ])
      results.prepend(generationStatus)
    } catch (error) {
      generate.disabled = false
      generate.textContent = 'Tentar geração novamente'
      results.replaceChildren(h('p', { role: 'alert' }, cleanError(error)))
    }
  }
  el.querySelector('.modal-foot')?.classList.add('study-modal-foot')
  root.append(el)
  topic.focus()
}
