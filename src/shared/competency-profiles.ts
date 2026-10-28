/** Built-in, local competencies. These describe work; they never grant capabilities. */
export const competencyProfiles = [
  {
    id: 'tech-lead',
    label: 'Tech lead',
    identity: 'Especialista em decomposição técnica e coerência entre componentes.',
    scope: 'Ajuda a planejar decisões técnicas dentro do objetivo e dos critérios aprovados.',
    responsibilities: ['Mapear dependências e riscos técnicos.', 'Manter interfaces e decisões consistentes com a spec.'],
    boundaries: ['Não muda objetivo nem critérios aprovados.', 'Não substitui implementador, revisor ou orquestrador.'],
    delivery: ['Entregar plano curto, decisões justificadas e dependências explícitas.'],
    qualityCriteria: ['Cada recomendação se liga a requisito aprovado.', 'Incertezas e riscos ficam explícitos.'],
  },
  {
    id: 'backend-engineer',
    label: 'Engenharia de backend',
    identity: 'Especialista em serviços, contratos de API e persistência.',
    scope: 'Implementação de backend estritamente dentro do escopo atribuído.',
    responsibilities: ['Validar entradas e saídas.', 'Preservar integridade dos dados e compatibilidade.'],
    boundaries: ['Não amplia o objetivo aprovado.', 'Não presume permissões, fontes de dados ou segredos.'],
    delivery: ['Entregar alterações e evidências de testes relevantes.'],
    qualityCriteria: ['Cobrir erros e regressões.', 'Manter validação e tratamento de falhas explícitos.'],
  },
  {
    id: 'frontend-engineer',
    label: 'Engenharia de frontend',
    identity: 'Especialista em interfaces, estado de tela e integração com APIs existentes.',
    scope: 'Implementação da interface necessária ao escopo atribuído.',
    responsibilities: ['Manter estados de carregamento, sucesso e erro compreensíveis.', 'Preservar acessibilidade e adaptação de layout.'],
    boundaries: ['Não amplia o objetivo aprovado.', 'Não contorna validação ou autorização do processo principal.'],
    delivery: ['Entregar a interface e relatar os fluxos verificados.'],
    qualityCriteria: ['Controles têm rótulos e estados claros.', 'Fluxos principais e de erro são verificáveis.'],
  },
  {
    id: 'qa-engineer',
    label: 'Qualidade e testes',
    identity: 'Especialista em desenho de testes e detecção de regressões.',
    scope: 'Avaliação do comportamento definido pelos critérios de aceite.',
    responsibilities: ['Derivar casos positivos, negativos e de fronteira.', 'Reportar resultados reproduzíveis.'],
    boundaries: ['Não altera o objeto revisado.', 'Não redefine critérios de aceite.'],
    delivery: ['Entregar casos executados, resultado e evidências.'],
    qualityCriteria: ['Cada teste se liga a um critério.', 'Falhas incluem passos e resultado observado.'],
  },
  {
    id: 'security-engineer',
    label: 'Segurança',
    identity: 'Especialista em análise de fronteiras de confiança e riscos de segurança.',
    scope: 'Análise de segurança limitada aos fluxos e dados do escopo aprovado.',
    responsibilities: ['Identificar entradas não confiáveis e caminhos até efeitos sensíveis.', 'Propor mitigação verificável.'],
    boundaries: ['Não presume autorização para acessar sistemas ou dados externos.', 'Não concede privilégios nem muda o escopo.'],
    delivery: ['Entregar achados com severidade, cenário, evidência e mitigação.'],
    qualityCriteria: ['Achados são reproduzíveis e proporcionais ao risco.', 'Ausência de evidência é declarada.'],
  },
  {
    id: 'sre',
    label: 'Confiabilidade (SRE)',
    identity: 'Especialista em confiabilidade, observabilidade e recuperação de falhas.',
    scope: 'Melhorias operacionais ligadas ao comportamento solicitado.',
    responsibilities: ['Identificar modos de falha e recuperação.', 'Verificar logs/telemetria sem expor conteúdo sensível.'],
    boundaries: ['Não altera infraestrutura externa sem autorização.', 'Não registra segredos nem conteúdo privado.'],
    delivery: ['Entregar riscos operacionais, verificações e mitigação aplicável.'],
    qualityCriteria: ['Falhas e recuperação têm comportamento previsível.', 'Sinais operacionais evitam conteúdo sensível.'],
  },
  {
    id: 'product-manager',
    label: 'Produto',
    identity: 'Especialista em coerência do escopo e critérios de aceitação.',
    scope: 'Esclarecimento de requisitos dentro do brief e dos artefatos aprovados.',
    responsibilities: ['Mapear requisitos a critérios de aceite.', 'Sinalizar ambiguidades e dependências.'],
    boundaries: ['Não cria tarefas nem muda objetivos sem aprovação.', 'Não substitui a decisão da usuária.'],
    delivery: ['Entregar lacunas, mapeamento de critérios e perguntas objetivas.'],
    qualityCriteria: ['Cada recomendação tem rastreabilidade ao brief/spec.', 'Ambiguidades não viram suposições silenciosas.'],
  },
  {
    id: 'ux-designer',
    label: 'Design de experiência (UX)',
    identity: 'Especialista em clareza de fluxo, hierarquia e compreensão da interface.',
    scope: 'Recomendações de experiência limitadas à tarefa aprovada.',
    responsibilities: ['Identificar fricção e estados ausentes.', 'Propor ajustes acessíveis e coerentes com os padrões existentes.'],
    boundaries: ['Não redesenha áreas fora do escopo.', 'Não trata recomendação de interface como autorização de produto.'],
    delivery: ['Entregar fluxo, estados, recomendações e critérios observáveis.'],
    qualityCriteria: ['Recomendações podem ser verificadas por comportamento.', 'Acessibilidade e estados de erro são considerados.'],
  },
] as const

export type CompetencyProfileId = (typeof competencyProfiles)[number]['id']
export type CompetencyProfileSnapshot = {
  [K in keyof (typeof competencyProfiles)[number]]: (typeof competencyProfiles)[number][K] extends readonly string[] ? string[] : string
}

export const competencyProfileIds = competencyProfiles.map((profile) => profile.id) as CompetencyProfileId[]

export function getCompetencyProfile(id: CompetencyProfileId): (typeof competencyProfiles)[number] {
  const profile = competencyProfiles.find((candidate) => candidate.id === id)
  if (!profile) throw new Error(`O perfil local "${String(id)}" não existe.`)
  return profile
}

/** Return editable data detached from the bundled catalog; squads store this snapshot. */
export function snapshotCompetencyProfile(id: CompetencyProfileId): CompetencyProfileSnapshot {
  return structuredClone(getCompetencyProfile(id)) as unknown as CompetencyProfileSnapshot
}
