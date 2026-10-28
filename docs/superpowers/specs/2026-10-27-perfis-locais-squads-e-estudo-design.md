# Perfis locais de agentes para squads e estudo

## Objetivo e decisões confirmadas

O Agent Office deve adaptar a lógica de especialização dos agentes observada no export da equipe do Paperclip para construir seus próprios agentes. O resultado não depende do Paperclip em execução nem lê arquivos do Paperclip ao criar equipes. Primeiro se aplica aos squads de desenvolvimento; a mesma lógica atende depois a equipe de estudo, integrada às etapas coordenadas por Bonnie. A usuária aprova a composição antes de criar uma equipe. Squads e dados existentes não são reescritos automaticamente.

Fontes de inspiração, não dependências: `D:/Documents/pexhub/paperclip/docs/fork/company-templates/agent-team/.paperclip.yaml` e `agents/*/AGENTS.md` (export de 20/10/2026). Não copiar modelos, contas, permissões, caminhos de ambiente, instruções de heartbeat, hierarquia corporativa literal nem prompts duplicados desse export. O Agent Office só executa Claude; registros históricos de OpenCode continuam somente para leitura.

## Abordagem escolhida

Um catálogo local de **perfis de competência**, e não squads fixos ou sincronização com Paperclip. Cada perfil define identidade funcional, escopo, responsabilidades, limites, critérios de entrega e instruções-base. A composição usa o brief e o contexto aprovado para selecionar perfis compatíveis; o resultado gerado é uma cópia independente e editável, sem vínculo vivo com o catálogo. Os perfis não concedem ferramentas, acesso a arquivos, permissões, modelo nem conta.

Alternativas rejeitadas: ler o export do Paperclip em tempo de criação (dependência externa e configuração permissiva inadequada) e manter equipes fechadas por função (não permite squads sob medida nem reaproveitamento no estudo).

## Desenvolvimento: proposta e materialização

- Adaptar as responsabilidades de TechLead, BackendEngineer, FrontendEngineer, QAEngineer, SecurityEngineer, SRE, ProductManager e UXDesigner em perfis locais pertinentes ao brief. Nem todos precisam compor cada squad. Um papel de coordenação, quando necessário, planeja e acompanha sem implementar nem revisar o próprio trabalho; o orquestrador existente continua responsável por distribuir passos.
- Manter o contrato executável atual: de dois a seis membros além do coordenador fixo da sala; exatamente um `implementer` e um `reviewer` independentes, com a revisão após a implementação. Um perfil de especialidade (por exemplo, backend ou frontend) refina o escopo de trabalho de um membro; não substitui o papel executável nem elimina o revisor.
- A proposta precisa expor nome, papel executável, especialidade/foco, modelo e conta escolhidos para revisão humana. O brief e os tickets são contexto, não autorização para inventar tarefas ou alterar objetivos. Modelo e conta devem continuar validados contra as opções realmente disponíveis.
- Somente depois da aprovação, gerar `squads/<code>/squad.yaml`, `agents/<id>.agent.md` e `pipeline/pipeline.yaml` pelo escritor atômico existente. As instruções do agente devem explicitar tarefa, limites, formato da entrega e critérios de qualidade; revisão aponta problemas sem corrigir o objeto revisado. Preservar definições de squads preexistentes e a recuperação de criação interrompida.
- A composição automática atual está pausada em `src/main/squad-creation.ts`. Reativá-la exige um gerador Claude-only integrado ao fluxo de proposta/ajuste, com resposta não confiável validada antes de exibição e sem gravação antecipada. Não reintroduzir o julgador OpenCode.

## Estudos: aplicação da mesma lógica, fluxo próprio

- Usar perfis locais de tutor, curador de fontes e verificador. Bonnie permanece diretora/coordenadora do ciclo; não se cria para ela um segundo agente com autoridade concorrente. A equipe de estudo é configurada/revisada pela usuária antes de ficar disponível.
- Integrar os perfis às chamadas explícitas de cada etapa do ciclo já existente: Tutor no diagnóstico, Curador na avaliação explícita da prática e Verificador na conferência explícita do reteste. Busca/consulta de fontes permanece local e sob seleção da usuária; nenhum perfil provoca leitura ampla ou chamada automática. Aguardando ou pausado não implica chamada de modelo. A seleção de fonte precisa permanecer dentro do recorte autorizado.
- Não usar `squad.yaml`/pipeline de código como motor do estudo, nem criar tickets, lotes, worktrees ou PRs de estudo. Um tópico por vez e o estado de pausa/reinício continuam sob responsabilidade do serviço do ciclo.
- As respostas da estudante, os gabaritos conferidos e a confirmação exigida pelo ciclo são a evidência de aprendizagem. Pareceres dos agentes não avançam nem concluem o ciclo por si sós. Em divergência ou evidência insuficiente, manter o item em verificação.
- Autorização reconciliada em 2026-10-28 com a decisão registrada em #75 e confirmação explícita da usuária: chamadas Claude do ciclo podem receber somente o mínimo de material de estudo selecionado para a etapa (tópico, pergunta e trecho/fonte pertinente). Isso não autoriza contexto integral do vault/biblioteca, busca ou leitura ampla não selecionada, envio silencioso, nem inclusão de dados fora do recorte autorizado. O perfil não amplia acesso e chamadas permanecem ligadas às ações explícitas do ciclo. Cora permanece bibliotecária separada da equipe do ciclo. A equipe de cartões é outro fluxo, fora deste escopo.

## Fronteiras e falhas

Separar três responsabilidades: (1) catálogo local de perfis e composição, (2) materialização de membros dos squads de desenvolvimento, (3) vinculação dos perfis de estudo às operações explícitas do ciclo Bonnie. Não alterar o contrato de execução para aceitar permissões vindas de prompts. Dados de brief, tickets, arquivos de agente e respostas do modelo são não confiáveis; validar identidade, tamanho, papéis, ordem, modelo/conta e caminhos antes de publicar. Falha de geração, perfil incompatível, conflito de arquivos ou autorização ausente deve parar a operação com explicação em pt-BR, preservando proposta, dados e ciclo conforme o estágio. Não sobrescrever um squad já criado nem substituir conteúdo do vault silenciosamente.

## Critérios de aceite e verificação

1. O Agent Office funciona sem instalação, servidor, credenciais ou diretório do Paperclip.
2. A proposta de desenvolvimento usa perfis locais pertinentes ao brief e continua exigindo aprovação explícita; a criação gera instruções específicas e mantém implementador/revisor distintos.
3. Squads anteriores permanecem legíveis e executáveis sem migração ou regravação automática; falhas de criação não deixam definições parciais publicadas.
4. Os perfis de estudo são usados apenas na etapa correspondente sob coordenação de Bonnie, sem tickets e sem chamadas quando o ciclo está apenas aguardando.
5. O envio a Claude respeita a autorização limitada reconciliada: somente tópico, pergunta e trecho/fonte pertinente selecionados para a etapa; nunca biblioteca/vault integral ou conteúdo não selecionado. Agentes não alteram os gates objetivos de aprendizagem.
6. Testes unitários e de integração cobrem seleção/geração/validação, materialização, compatibilidade, roteamento por etapa, falhas e recusa de acesso. Executar `npm run typecheck`, `npm run lint`, `npm test` e `npm run build` antes de considerar a implementação concluída.

## Fora do escopo

Importação/sincronização com Paperclip; agentes de CEO/CTO como cargos globais do app; mudança de motor para OpenCode; elevação automática de modelo ou permissão; criação de novos fluxos de estudo, de cartões ou de distribuição de tickets; migração automática de equipes existentes; merge, deploy ou execução de squads sem aprovação explícita.
