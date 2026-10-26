# Agent Office — casa, estudos e projetos

Vocabulário da integração em definição entre o Agent Office e as necessidades do Hera. Descreve o produto pretendido; não afirma que os recursos já estejam implementados.

Decisões vigentes: [spec aprovada do centro de controle](docs/specs/centro-de-controle-da-vida-design.md) e [plano](docs/specs/centro-de-controle-da-vida-plano.md). O [estado consolidado Hera](docs/prd/hera-integracao-consolidado.md) é histórico onde divergir. Projetos usam tickets; estudos usam ciclos pedagógicos.

## Organização do escritório

**Diretor do andar**:
Agente que conduz a definição de um projeto com Malu e coordena seus tickets e squads após as aprovações correspondentes.
_Avoid_: Secretária pessoal, executor único do projeto

**Squad**:
Equipe reutilizável de agentes com responsabilidades complementares. Nos projetos atende tickets; nos estudos atende ao contexto de aprendizagem ou elaboração de cartões, sem tickets.
_Avoid_: Agente individual, andar inteiro, fila de tickets obrigatória em estudos

**Squad de desenvolvimento**:
Squad com líder/coordenador, implementador e revisor independente, responsável pelo fluxo de um ticket até uma PR revisada. O merge depende da autorização de Malu.
_Avoid_: Modelo obrigatório para todo squad

**Modelo de squad**:
Definição reutilizável dos cargos, instruções, etapas e critérios de entrega de uma equipe, aprovada por Malu antes do uso. Várias equipes podem se basear no mesmo modelo.
_Avoid_: Equipe em execução, ticket

**Andar de projeto ou área**:
Espaço de trabalho coordenado por um diretor, com seu próprio conjunto de tickets e equipes aprovadas conforme a necessidade do projeto ou área. É distinto do andar de estudos.
_Avoid_: Equipe única, andar exclusivamente de desenvolvimento, andar de estudos

**Foco atual**:
Seleção de trabalho originada das tarefas pessoais de Malu e construída com auxílio da secretária. Atribuir foco não autoriza, por si só, a execução pelos agentes.
_Avoid_: Fila automaticamente iniciada, tarefa duplicada

**Tarefa pessoal**:
Compromisso pessoal registrado no arquivo canônico de tarefas e acompanhado pela secretária e pelos quadros pessoais. Não possui vínculo com os tickets dos andares.
_Avoid_: Ticket do andar, unidade de distribuição para squads

**Ticket do andar**:
Unidade de trabalho do conjunto próprio de um andar de projeto ou área de trabalho, coordenada por seu diretor e independente das tarefas pessoais. Não se aplica ao andar de estudos.
_Avoid_: Tarefa pessoal, item automaticamente derivado do foco pessoal, tópico em estudo

**Luna**:
Coordenadora fixa da casa que organiza a vida pessoal, agenda e rotinas e encaminha trabalho a perfis reutilizáveis Claude, sem concluir tarefa ou objetivo por conta própria.
_Avoid_: Diretora de projeto, Bonnie, execução automática

**Perfil de trabalho**:
Configuração reutilizável de Claude para uma tarefa (Ajuda técnica, Estudo avulso ou Agatha); cada tarefa abre conversa nova e pode manter memória resumida local editável pela usuária.
_Avoid_: Conversa reutilizada entre tarefas, memória bruta da conversa

**Casa**:
Térreo reorganizado como casa em pixel art, com áreas pessoais, espaço de Luna, calendário e objetos próprios para objetivos, mídias e atividades.
_Avoid_: Dashboard genérico, editor livre de andares

**Fila de distribuição**:
Conjunto de tickets liberados por Malu para atribuição pelo diretor às equipes compatíveis do próprio andar de projeto.
_Avoid_: Backlog inteiro, autorização automática por seleção, percurso de estudo

**Lote**:
Seleção nomeada de tickets de um andar de projeto que pode permanecer preparada até Malu liberar sua distribuição.
_Avoid_: Foco pessoal, tópico atual, lote de estudo

**Passo de hoje**:
Recorte opcional de avanço pretendido para uma tarefa pessoal em foco. Não é uma cópia da tarefa nem uma obrigação de concluí-la no mesmo dia.
_Avoid_: Tarefa inteira, prazo obrigatório, ticket

**Revisão diária**:
Atendimento da secretária para avaliar agenda, tarefas, foco e acompanhamento, cujas alterações propostas dependem de confirmação final de Malu. Sua conclusão não conclui tarefas ou tickets.
_Avoid_: Conclusão automática, distribuição de trabalho

## Estudo

**Andar de estudos**:
Espaço dedicado a um tópico em estudo por vez, sua biblioteca, notas, cartões e equipes de apoio. Não organiza trabalho por tickets, lotes ou filas de distribuição.
_Avoid_: Andar de tickets, squad de desenvolvimento, área de escrita livre

**Tópico atual**:
Assunto da trilha escolhido como contexto do estudo em andamento. É distinto do foco pessoal e pode ser trocado preservando o trabalho anterior.
_Avoid_: Ticket, lote, tarefa pessoal

**Ciclo de estudo**:
Percurso de diagnóstico, revisão de erros/dúvidas, prática e fontes direcionadas e reteste de um tópico, até o critério escolhido e a confirmação de Malu.
_Avoid_: Atividade dos agentes como aprendizado, projeto final obrigatório

**Nota de estudo**:
Registro identificável produzido ou editado durante o estudo, inclusive fora de um ciclo, que pode ser escolhido como origem de cartões. Não comprova aprendizado por sua simples existência.
_Avoid_: Cartão pronto, transcrição inteira como nota única

**Cartão de conhecimento**:
Registro elaborado a partir de notas selecionadas, com Informação, Exemplo/Prática, Conexões e Fontes, preservando sua origem. Aceitação, autoria e validação factual são propriedades distintas.
_Avoid_: Nota consumida, aprendizado automaticamente comprovado

**Sala de estudo individual**:
Ambiente acolhedor que reúne o trabalho pessoal com notas e cartões, preservando a distinção entre suas coleções.
_Avoid_: Coleção única indiferenciada, sala dos professores

**Sala dos professores**:
Ambiente onde integrantes das equipes de estudo e cartões aguardam participação na atividade pertinente.
_Avoid_: Fila de tickets, sala de aula ocupada permanentemente por squads

**Sala de aula**:
Ambiente da estudante e dos integrantes chamados para a etapa pertinente do tópico em estudo.
_Avoid_: Escritório permanente dos squads, quadro kanban

**Diretora de estudos**:
Bonnie, diretora do andar de estudos, com a função de continuidade pedagógica aprovada: apresentar o tópico atual e sugerir próximos passos, sem distribuir tickets, lotes ou filas.
_Avoid_: Diretora de projeto, personagem a definir, responsável por filas de estudo

**Diretora de projetos**:
Emi, diretora de um andar de projeto. Conduz o grill-with-docs, a spec e os tickets com o kit de skills do Matt Pocock, e propõe squads após aprovação.
_Avoid_: Secretária pessoal, executor único do projeto

**Estante**:
Agrupamento de referências a fontes pelo tópico definido por uma lista da trilha. Uma fonte pode aparecer em várias estantes sem ser duplicada.
_Avoid_: Cópia de livro, autorização de acesso implícita
