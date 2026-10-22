# Integração Hera no Agent Office — descoberta

Estado: histórico de descoberta iniciado em 2026-10-14. Este registro não é uma especificação aprovada nem autorização para implementar.

## Leia primeiro: estado vigente

O [consolidado de produto e prévia visual](hera-integracao-consolidado.md), atualizado em 2026-10-16 por autorização de Malu, reúne os aceites posteriores à Q28 e as correções recebidas do trabalho de design no Claude Code. Consulte-o antes de usar os registros abaixo. Eles permanecem como histórico, não como instruções concorrentes.

Substituições importantes:

- Os arquivos canônicos agora estão em `D:\Documents\vault-agent-office`, conforme Q23; caminhos anteriores são históricos.
- Tickets e lotes pertencem somente aos andares de trabalho/projeto. No andar de estudos, a unidade é um tópico em estudo por vez; as propostas anteriores de tickets para estudo/cartões foram substituídas.
- Notas e cartões continuam registros distintos, mas compartilham uma sala de estudo individual, menor e acolhedora.
- A diretora Lia e a diretoria de estudos permanecem; a sala fica menor e mais mobiliada. Sua função operacional continua aberta, sem tickets ou lotes. As diretorias dos projetos não recebem esse redesign.
- A revisão diária mantém mudanças em proposta até a confirmação final. Fechar sem terminar não aplica mudanças; o aceite anterior de gravação a cada passo foi substituído.
- Um andar de projeto novo começa somente com a diretoria; os squads são propostos a partir da spec e dos tickets aprovados, e configurados após aprovação de sua composição.

## Escopo definido

- Um andar próprio reúne ciclo de estudo, notas e cartões de conhecimento.
- A biblioteca representa `D:\Documents\study sources`, com estantes por tópicos.
- Quadros na parede permitem consultar tarefas, objetivos e revisão diária.
- Uma secretária pessoal fica à escrivaninha na frente do escritório, no térreo; reúne agenda, acompanhamento e assistência compartilhada.
- Agentes individuais ficam no térreo.
- Andares de projeto têm um diretor e squads. A sala do diretor fica no centro do andar, cercada pelas salas dos squads.
- Squads atendem ao fluxo ticket → PR; vários grupos permitem trabalho paralelo.
- Malu escolhe os tickets elegíveis para distribuição pelo diretor.
- Escrita e pensamentos ficam fora do escopo.
- Preservar o padrão estético do Agent Office. Malu aprova o design visual antes da implementação.

## Rodada 1 — decisões confirmadas

### Q1 — documentos compartilhados com Obsidian

Malu aceitou a recomendação: Office e Obsidian trabalham sobre os mesmos documentos canônicos editáveis. Decisões, planos, notas, cartões e entregas vão para o vault. Conversas brutas, logs e estado visual permanecem no armazenamento do Office. Alterações simultâneas precisam ser tratadas sem sobrescrever trabalho.

Fontes indicadas por Malu: `D:\Documents\tarefas.md` e `D:\Documents\trilha zettel.md`, cada uma para seu assunto. Cópias no Hera não passam a ser canônicas. Localização do vault, organização dos documentos e regra de conflitos ainda serão definidos.

### Q2 — autonomia da secretária

Malu aceitou a recomendação: organizar a visão do dia, sinalizar pendências e propor mudanças automaticamente. Alterar prioridades, reagendar, descartar tarefas ou encaminhar trabalho aos agentes requer confirmação. Pedidos diretos de Malu já autorizam a ação correspondente.

### Q3 — início da distribuição e organização espacial

Malu confirmou que a distribuição deve esperar um início explícito após a seleção de tickets. Acrescentou a sala central do diretor e salas dos squads ao redor. Não tratar esse aceite como definição dos cargos, capacidade por squad, política de novos tickets, revisão ou merge.

## Rodada 2 — decisões confirmadas

### Q4 — squads completos e reutilizáveis

Malu aceitou squads reutilizáveis com líder/coordenador, implementador e revisor independente. O diretor distribui entre equipes; o líder coordena dentro da equipe. Inicialmente, cada squad tem um ticket ativo.

### Q5 — entrega e merge

Malu aceitou a entrega de PR revisada internamente, com verificações aprovadas e resumo. O diretor acompanha pendências e apresenta a entrega; Malu autoriza o merge. O ticket distingue aguardando aprovação de concluído. Ainda definir quando o squad pode assumir outro ticket e como atender correções posteriores.

### Q6 — seleção aguardando foco

Malu aceitou lotes explícitos: iniciar libera apenas os tickets selecionados naquele momento; novas seleções precisam de liberação explícita. Acrescentou que quer manter tarefas selecionadas aguardando até poder atribuir à seleção o foco atual. Preparar uma seleção não libera execução. Ainda definir alcance do foco, número de seleções salvas e relação entre atribuir foco e iniciar distribuição.

## Rodada 3 — decisões confirmadas e ampliação de escopo

### Q7 — origem do foco e squads não relacionados a desenvolvimento

Malu definiu que o foco atual se origina em `D:\Documents\tarefas.md`, com ajuda da secretária para construí-lo. Não aceitou a recomendação de foco independente por andar; o alcance e a execução entre andares ainda precisam ser definidos. Também esclareceu que algumas tarefas exigem squads sem serem desenvolvimento e perguntou como introduzir novos tipos de squad. O fluxo ticket → PR e os cargos aprovados em Q4/Q5 passam a ser específicos do squad de desenvolvimento; outros tipos e seus critérios de entrega aguardam definição.

### Q8 — seleções salvas

Malu aceitou várias seleções nomeadas por andar, editáveis enquanto aguardam. Um ticket pode aparecer em mais de uma seleção, mas não pode ser executado em duplicidade; o quadro indica tickets em andamento ou concluídos. Ainda definir como essas seleções se relacionam com o foco pessoal originado em tarefas.md.

### Q9 — foco separado da execução

Malu aceitou separar definir foco, conferir tickets e iniciar distribuição. Trocar foco não cancela trabalhos em andamento. Antes da troca, o Office oferece pausar novas distribuições do lote anterior, deixando os tickets iniciados continuarem.

## Rodada 4 — modelos de squad e organização dos andares

### Q10 — biblioteca de modelos

Malu aceitou uma biblioteca de modelos de squad duplicáveis, com cargos, instruções, etapas e critérios de entrega. A secretária pode ajudar a propor o modelo; Malu aprova antes de usá-lo. Cada sala recebe uma equipe baseada em um modelo.

### Q11 — tarefa pessoal e tickets delegáveis

Resolvida pela correção de Malu na rodada 5: tarefas pessoais não têm relação com os andares. Cada andar tem seu próprio conjunto de tickets. A proposta de vincular tarefas pessoais a tickets de squads foi rejeitada; não criar conversão, associação ou propagação de conclusão por padrão.

### Q12 — andares por projeto ou área

Malu aceitou que cada andar represente um projeto ou área e reúna squads de tipos diferentes. O andar de estudos pode conter equipes de preparação de estudo e curadoria; o diretor distribui tickets somente para equipes compatíveis com o trabalho.

## Complemento confirmado em 2026-10-15

Fonte: resposta direta de Malu após a comparação dos registros históricos do Hera.

- Em qualquer conflito com os registros anteriores, prevalecem as escolhas feitas nesta conversa para o Agent Office. Reaproveitar necessidades e adaptar o funcionamento ao Office, sem importar a arquitetura ou o visual do Hera por consequência.
- As categorias da revisão e dos quadros seguem os nomes das listas do arquivo canônico `D:\Documents\tarefas.md`, não uma taxonomia fixa de áreas do Hera. A existência de listas sobre escrita não reintroduz o módulo de escrita/pensamentos excluído.
- Os tópicos das estantes da biblioteca seguem os títulos das listas de `D:\Documents\trilha zettel.md`; não criar outra classificação independente. Política para renomear/remover listas e vincular fontes ainda será definida.
- Malu concordou com os demais itens do grupo 4 da comparação: revisão diária com continuar/reagendar/revisar/descartar; revisão concluída não conclui tarefa; descartada difere de concluída; tarefa canônica única sem cópias por área; sinais de abandono são sugestões; timer de 25 minutos compartilhado entre as visões de foco e atividade, sem concluir sozinho quando expira com o aplicativo fechado. A adaptação espacial dessas visões ao Office ainda será desenhada.
- Naquele momento, o aceite ao grupo 4 não resolvia a Q11; a correção posterior da rodada 5 rejeitou o vínculo entre tarefas pessoais e tickets dos andares.
- A ordem de origem das questões e o critério numérico de conclusão do ciclo não foram respondidos por este aceite ao grupo 4.
- A política de fontes deve ser discutida em termos dos agentes, andares, biblioteca e permissões do Agent Office; não aplicar automaticamente o fluxo de consentimento do aplicativo Hera.

## Rodada 5 — separação das tarefas e permissões de fontes

### Q11 — tarefas pessoais separadas dos tickets dos andares

Malu corrigiu expressamente: tarefas pessoais não têm relação com os andares; cada andar tem seu próprio conjunto de tickets. O quadro pessoal e o foco derivados de tarefas.md não são um mecanismo de distribuição de tickets. A relação entre foco pessoal e a escolha de iniciar uma fila permanece apenas uma questão de interação a esclarecer, sem presumir vínculo entre registros.

### Q13 — acesso delimitado à biblioteca

Malu aceitou aprovar fontes ou estantes disponíveis à equipe ao preparar o trabalho. Os agentes usam esse recorte durante o trabalho autorizado, sem confirmação a cada leitura; acrescentar fontes fora dele exige confirmação. A prévia informa que conteúdo utilizado pode ser enviado ao provedor de IA, distinguindo acesso local de transmissão. A decisão é de produto; não autoriza leitura ou transmissão de fontes reais nesta entrevista.

### Q14 — mudanças nas listas da trilha Zettel

Malu aceitou refletir renomeações nas estantes e colocar vínculos de uma lista removida em “Sem tópico”, sem excluir livros, notas ou cartões. Mudanças ambíguas exigem confirmação em vez de associação presumida pela IA.

## Rodada 6 — lotes, acesso e disponibilidade dos squads

### Q15 — lotes distintos do foco pessoal

Malu aceitou lotes nomeados por andar, com estados Preparado, Liberado, Pausado e Encerrado. Preparar não executa; Iniciar distribuição libera o lote ao diretor. Foco atual permanece um conceito das tarefas pessoais, separado dos lotes dos andares.

### Q16 — acesso entre andares

Após uma negativa ambígua na rodada 6, Malu confirmou a recomendação na rodada 7: o diretor acessa somente tickets do próprio andar; Malu pode consultar todos. Não conceder acesso cruzado automaticamente aos agentes.

### Q17 — terminar antes de assumir outro ticket

Malu restringiu a recomendação anterior: o squad só pode partir para o próximo quando tudo do ticket estiver finalizado. Não liberar a equipe apenas pela entrega em Aguardando aprovação. Os marcos finais foram confirmados na Q18.

## Rodada 7 — conclusão e bloqueios

### Q18 — marco de conclusão do ticket

Malu aceitou: em desenvolvimento, critérios atendidos, testes e revisão aprovados, aprovação humana e merge realizado. Para outros tipos, entrega conferida, critérios atendidos e aceite explícito de Malu. Enquanto aguarda decisão humana, o squad permanece vinculado ao ticket, sem chamadas de IA desnecessárias.

### Q19 — bloqueio e liberação excepcional

Malu aceitou manter o squad reservado ao ticket bloqueado. Excepcionalmente, Malu pode usar Suspender e liberar equipe: o ticket permanece pendente com contexto salvo e não é marcado concluído. Não executar essa liberação automaticamente.

## Rodada 8 — vault, tickets e alterações concorrentes

### Q20 — localização do vault

Malu definiu o vault em `D:\Documents\vault-agent-office`. Os caminhos canônicos externos anteriormente indicados permanecem válidos; a resposta de localização não autoriza mover, copiar ou vincular esses arquivos, nem configurar o Obsidian ou ampliar acesso a Documents. A apresentação dos arquivos externos dentro do Obsidian ainda precisa ser definida.

### Q21 — tickets canônicos no vault

Malu aceitou um arquivo por ticket, organizado por andar, com critérios, histórico e referências às entregas. O Office apresenta e atualiza esses registros; o armazenamento interno mantém o necessário para executar e recuperar agentes. O formato e a migração dos tickets existentes ainda serão especificados.

### Q22 — alterações concorrentes

Malu aceitou preservar sua edição no Obsidian e apresentar a alteração preparada pelo agente para reconciliação, sem sobrescrever ou mesclar silenciosamente. Alterações em tickets em execução são sinalizadas ao diretor para verificar se mudam o trabalho autorizado.

## Rodada 9 — arquivos no vault e biblioteca

### Q23 — arquivos movidos por Malu

Malu informou que já moveu os arquivos para o vault, substituindo a proposta de links externos. Inspeção somente dos nomes das entradas confirmou `D:\Documents\vault-agent-office\tarefas.md`, `D:\Documents\vault-agent-office\trilha zettel.md` e `D:\Documents\vault-agent-office\study sources`. Esses são os caminhos canônicos atuais e substituem os caminhos anteriores neste registro. Nenhum conteúdo das fontes foi lido, nenhum arquivo foi movido pelo agente e não foi verificada a configuração do Obsidian. A mudança de caminho não amplia acesso dos agentes às fontes.

### Q24 — catálogo e associações às estantes

Malu aceitou um catálogo de referências: uma fonte pode aparecer em várias estantes sem duplicar o arquivo. A IA sugere associações e Malu confirma. Fontes ainda não classificadas aparecem em Sem tópico; os títulos das listas da trilha Zettel continuam definindo as estantes.

### Q25 — interação com livros

Malu aceitou uma ficha com título, tópicos, localização e notas/cartões relacionados, além de Abrir original e Disponibilizar para uma equipe. Abrir o arquivo não inicia IA nem concede acesso aos agentes automaticamente.

## Rodada 10 — ciclo de estudo e squad dedicado

### Q26 — ciclo e equipe do andar de estudos

Malu aceitou diagnóstico → erros/dúvidas → prática e fontes → notas → reteste, com pausa e retomada. Os agentes preparam e acompanham; respostas de Malu produzem a evidência de aprendizagem. Cartões são opcionais e não bloqueiam avanço. Acrescentou que quer um squad próprio do andar de estudos e lembrou que as notas têm área própria. Organização espacial e cargos dessa equipe ainda serão definidos.

Verificação documental: `D:\Documents\hera\docs\design\zettel-study-notes-claude-design.md`, seções 3–6, descreve coleção própria de Notas de estudo, distinta de Cartões, com seleção de notas para iniciar um cartão. `study-note-session-claude-design.md`, seções de entrada/registro/retomada, descreve registro de notas independente de diagnóstico ou ciclo. São insumos históricos para adaptar ao Office; não importar visual, restrições de destino ou comportamentos adicionais sem confirmação atual.

### Q27 — origem das questões

Malu manteve a preferência ENEM → livros → concursos → IA entre questões adequadas ao tópico e com gabarito conferido. Questões criadas pela IA permanecem identificadas como tal mesmo se baseadas em livros. Ausência de questões elegíveis deve ser informada, sem origem inventada.

### Q28 — critério de conclusão

Malu aceitou como padrão 80% em pelo menos dez questões novas de reteste, respondidas sem ajuda e com gabaritos validados, ajustável antes de iniciar cada ciclo. Atingir o mínimo permite concluir com confirmação de Malu, sem projeto final obrigatório ou promessa de domínio completo.

## Continuidade após Q28

Os aceites Q29–Q71, os testes de conexão dos motores e as correções posteriores de produto/design estão registrados no [consolidado vigente](hera-integracao-consolidado.md). A lista de pendências anterior à consolidação foi substituída pela seção de questões abertas desse documento, evitando reabrir escolhas já respondidas.

## Próximo passo

Seguir o consolidado vigente e o trabalho visual já conduzido por Malu com Claude Code. Perguntar somente sobre questões consequenciais ainda abertas; não promover sugestões não respondidas ou comportamento simulado a aprovação/implementação de produção.
