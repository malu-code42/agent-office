// Preview of the three study popups with sample data (no Electron). Not part of the app.
import { emptyStudyCycleState } from '@shared/study-cycle'
import { parseStudyTrail } from '@shared/study-trail'
import { openStudyLibrary } from '../src/renderer/src/ui/study-library'
import { openStudyQuestions } from '../src/renderer/src/ui/study-questions'
import { openStudyTrailBoard } from '../src/renderer/src/ui/study-trail-board'

const TRAIL = [
  '## 1º período',
  '### [P1-LMD] Lógica e Matemática Discreta — 90 h',
  '- [x] [P1-LMD-01] Proposições e conectivos',
  '- [ ] [P1-LMD-02] Tabelas-verdade',
  '- [ ] [P1-LMD-03] Conjuntos e relações',
  '### [P1-ALG] Algoritmos e Lógica de Programação — 90 h',
  '- [x] [P1-ALG-01] Variáveis e tipos',
  '- [ ] [P1-ALG-02] Estruturas de decisão',
  '- [ ] [P1-ALG-03] Laços de repetição',
  '## 2º período',
  '### [P2-ED] Estrutura de Dados e Técnicas de Programação — 45 h',
  '- [x] [P2-ED-01] Listas encadeadas',
  '- [ ] [P2-ED-02] Pilhas',
  '- [ ] [P2-ED-03] Recursão',
  '- [ ] [P2-ED-04] Árvores binárias',
  '- [ ] [P2-ED-05] Filas',
  '### [P2-BD] Banco de Dados — 60 h',
  '- [ ] [P2-BD-01] Modelo entidade-relacionamento',
  '- [ ] [P2-BD-02] Normalização',
  '## 3º período',
  '### [P3-ES] Engenharia de Software — 60 h',
  '- [ ] [P3-ES-01] Requisitos',
  '- [ ] [P3-ES-02] Testes de software',
].join('\n')

let n = 0
const q = (topic: string, originKind: string, answerStatus: string) => ({
  id: `q-preview-${String(++n).padStart(8, '0')}`,
  topic,
  tags: [],
  question: `Questão de exemplo sobre ${topic}: qual alternativa descreve corretamente o conceito?`,
  answer: 'Alternativa C',
  answerStatus,
  originKind,
  sourceTitle: originKind === 'enem' ? 'ENEM 2019' : originKind === 'livro' ? 'Cormen, Algoritmos' : 'Prova FCC 2022',
  sourceVisibility: 'public',
  sourceUrl: 'https://example.org/questao',
  attribution: 'Banca',
  license: 'desconhecida',
})
const BANK = [
  ...Array.from({ length: 9 }, (_, i) => q('[P2-ED-05] Filas', ['enem', 'concurso', 'livro'][i % 3]!, ['verified', 'unverified'][i % 2]!)),
  ...Array.from({ length: 6 }, (_, i) => q('Pilhas', ['livro', 'ia'][i % 2]!, ['verified', 'missing', 'unverified'][i % 3]!)),
  ...Array.from({ length: 4 }, () => q('árvores binárias', 'web', 'unverified')),
  ...Array.from({ length: 5 }, (_, i) => q('Tabelas-verdade', 'concurso', i < 3 ? 'verified' : 'unverified')),
  ...Array.from({ length: 2 }, () => q('P1-LMD-01', 'enem', 'verified')),
  ...Array.from({ length: 3 }, () => q('Normalização', 'ia', 'unverified')),
  ...Array.from({ length: 3 }, () => q('Termodinâmica', 'enem', 'missing')),
  q('Óptica geométrica', 'livro', 'verified'),
]

const rec = (title: string, kind: string, level: number, label: string, start: number, end: number) => ({
  path: `study sources/${title}.${kind}`,
  title,
  kind,
  start,
  end,
  range: kind === 'pdf' ? `p. ${start}–${end}` : kind === 'pptx' ? `slides ${start}–${end}` : `seções ${start}–${end}`,
  score: level * 19,
  level,
  label,
  snippet: 'Uma fila é uma estrutura FIFO: o primeiro elemento a entrar é o primeiro a sair. As operações básicas são enfileirar e desenfileirar…',
})

const wait = <T>(value: T, ms = 400) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms))

;(window as unknown as { office: unknown }).office = {
  readStudyTrail: () => wait(parseStudyTrail(TRAIL), 100),
  readStudyCycle: () => wait(emptyStudyCycleState(), 50),
  readStudyQuestions: () => wait({ questions: BANK, unknownLines: [] }),
  openStudySource: () => Promise.resolve(),
  studySourceInventory: (verify: boolean) =>
    wait({
      complete: true,
      ocrQueued: verify ? 2 : 0,
      sources: [
        { path: 'study sources/ED/Filas e pilhas.pdf', name: 'Filas e pilhas.pdf', ext: '.pdf', size: 2_400_000, status: 'lida', pages: 48 },
        { path: 'study sources/ED/Aula 05 - Filas.pptx', name: 'Aula 05 - Filas.pptx', ext: '.pptx', size: 900_000, status: 'lida' },
        { path: 'study sources/BD/Prova antiga escaneada.pdf', name: 'Prova antiga escaneada.pdf', ext: '.pdf', size: 8_100_000, status: 'ocr', pages: 12, blankPages: 12 },
        { path: 'study sources/LMD/Resumo.md', name: 'Resumo.md', ext: '.md', size: 12_000, status: 'lida' },
        { path: 'study sources/Livros/Cormen.epub', name: 'Cormen.epub', ext: '.epub', size: 15_000_000, status: 'so-nome' },
        { path: 'study sources/ES/apostila.pdf', name: 'apostila.pdf', ext: '.pdf', size: 60_000_000, status: 'grande' },
        { path: 'study sources/velho.doc', name: 'velho.doc', ext: '.doc', size: 40_000, status: 'ilegivel' },
      ],
    }),
  recommendStudySources: ([query]: string[]) =>
    wait([
      {
        query,
        recommendations: [
          rec('Filas e pilhas', 'pdf', 5, 'Muito relevante', 12, 18),
          rec('Aula 05 - Filas', 'pptx', 4, 'Relevante', 3, 9),
          rec('Resumo', 'md', 3, 'Pode ajudar', 2, 4),
          rec('Cormen', 'pdf', 2, 'Pouco relevante', 230, 241),
          rec('Apostila ED', 'pdf', 1, 'Só menciona', 40, 41),
        ],
      },
    ]),
  searchStudyLibrary: (query: string) =>
    wait({
      token: 't',
      query,
      complete: true,
      hits: [1, 2, 3, 4].map((i) => ({
        id: `h${i}`,
        sourceRef: `study sources/ED/Filas e pilhas.pdf#p${10 + i}`,
        title: `Filas e pilhas — página ${10 + i}`,
        excerpt: 'Em uma fila circular, os índices de início e fim voltam ao zero quando chegam ao fim do vetor, reaproveitando as posições livres.',
        line: 0,
        score: 80 - i,
      })),
    }),
  searchStudyQuestions: (query: string) =>
    wait({
      token: 'tok',
      status: 'found',
      localScanComplete: true,
      canGenerate: true,
      local: BANK.slice(0, 2),
      sourceCandidates: [q(query, 'livro', 'unverified')],
      web: [q(query, 'web', 'unverified')],
    }),
  generateStudyQuestions: () => wait({ status: 'found', canGenerate: false, generated: [q('Filas', 'ia', 'unverified')] }),
  saveStudyQuestions: () => wait(undefined),
}

const ui = document.getElementById('ui')!
const toast = (text: string) => {
  const el = document.getElementById('toast')!
  el.textContent = text
  el.hidden = false
  setTimeout(() => (el.hidden = true), 2500)
}
const close = () => ui.replaceChildren()
const open: Record<string, () => void> = {
  questions: () => openStudyQuestions(ui, toast),
  library: () => openStudyLibrary(ui, toast, '[P2-ED-05] Filas'),
  libraryEmpty: () => openStudyLibrary(ui, toast),
  trail: () => void openStudyTrailBoard(ui, toast, (topic) => toast(`Começar: ${topic}`)),
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-open]'))
  button.onclick = () => {
    close()
    open[button.dataset.open!]!()
  }
open[location.hash.slice(1) || 'questions']?.()
