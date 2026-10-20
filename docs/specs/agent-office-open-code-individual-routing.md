# OpenCode para agentes individuais e squads Claude

**Status:** aprovada pela usuária para planejamento (2026-10-18). Implementação depende da aprovação deste plano.
**Data:** 2026-10-18
**Relaciona-se a:** `.scratch/correcoes-agent-office/issues/02-refazer-logica-dos-squads.md`, `.scratch/correcoes-agent-office/issues/03-rever-modos-de-permissao.md`, `.scratch/entrega-1-planejamento/issues/14-integrar-codex-e-opencode.md`.

## 1. Objetivo

Permitir que agentes individuais do Agent Office deleguem subtarefas pelo OpenCode a subagentes que usam modelos diferentes, enquanto o Agent Office continua sendo a autoridade de coordenação, estado, worktrees e permissões. Squads continuam como equipes reutilizáveis no motor Claude para tarefas importantes que a usuária inicia explicitamente.

## 2. Decisões de produto aprovadas

- **Um controle de fluxo:** o Agent Office mantém projetos, agentes principais, aprovações, worktrees, sessões, logs e status. OpenCode executa o agente individual e coordena seus subagentes; não substitui o gerenciamento de squads do Office.
- **Agentes individuais:** OpenCode é o motor; o Agent Office não utilizará modelos gratuitos. O julgador usa GPT-6 Luna `high` via conta/provider já configurado no OpenCode, com quota e uso visíveis. Se o provider não fornecer custo confiável, mostrá-lo como desconhecido (nunca assumir custo zero). Depois que as contas Claude forem conectadas e aprovadas, também pode escolher Claude para subtarefas individuais pesadas.
- **Critério do roteador:** priorizar adequação/capacidade à subtarefa. Para programação, favorecer modelos com controles de raciocínio e usar o maior nível/variant suportado pelo modelo OpenCode; disponibilidade/quota e custo são critérios seguintes. Não presumir que OpenCode use literalmente o parâmetro `effort`.
- **Limites do roteador:** modelos/provedores novos não entram automaticamente; precisam de aprovação. GPT-6 Luna `high` é o único modelo atualmente aprovado para o runtime do Agent Office; Claude aprovado poderá entrar após conectar as contas. Se nenhum modelo aprovado estiver disponível/adequado ou a quota acabar, pausar e pedir decisão. Nunca trocar de modelo/conta silenciosamente depois do início.
- **Dados:** a usuária permite enviar código do Agent Office aos modelos selecionados. Não enviar o vault real, credenciais, dados de clientes ou segredos.
- **Squads:** permanecem no motor Claude atual, para trabalho muito importante. A usuária escolhe quando iniciar um squad; o roteador não escala automaticamente uma tarefa a Claude como squad. Serão conectadas duas contas Claude, com uma conta fixa por squad durante cada execução. Depois da conexão, o julgador OpenCode também pode usar essas contas para subtarefas individuais pesadas; a pool é compartilhada livremente e a quota pode colidir. Ao atingir limites, pausar e perguntar, sem troca silenciosa de conta/modelo.
- **Revisão:** GPT-6 Luna `high` permanece como revisor enquanto a assinatura OpenAI estiver ativa. Após aviso manual da usuária de que a assinatura terminou, o revisor passa para Claude Haiku 5.5. Nesse momento, atualizar a skill global de fluxo de tickets.
- **Permissões:** Agent Office é a autoridade de permissões para Claude e OpenCode. OpenCode pode restringir mais, nunca relaxar a política do Office.
- **Modo Automático:** leitura, edição na worktree do ticket e testes/build locais não pedem confirmação. Apagar arquivos, instalar dependências, acessar rede externa, fazer commit/push, abrir PR ou publicar sempre pedem confirmação.
- **“Sempre permitir”:** regra por projeto/andar, aplicável à mesma categoria de ação em ambos os motores; precisa ser visível e revogável individualmente ou em conjunto. Não remove confirmações das ações de risco (apagar, instalar, rede, commit/push/PR/publicação); somente o modo “Sem pedir nada” conscientemente ativado faz bypass.
- **“Sem pedir nada”:** manter o bypass atual como modo perigoso, com aviso e confirmação consciente ao ativar. Uma worktree Git não é uma sandbox.
- **Andares de projeto:** em cada andar, preservar as cabines dos squads de um lado e criar uma sala de agentes individuais do outro.
- **Presença visual:** agentes principais individuais permanecem visíveis quando ociosos. Subagentes ativos ocupam assentos temporários próximos, mostrando modelo e subtarefa; ao concluir, liberam o assento imediatamente e deixam o resultado no painel/log do agente principal.
- **Proposta de squad:** cada andar mostra somente um botão para propor squad. A usuária informa brief de trabalho e pode selecionar tickets aprovados; o julgador OpenCode retorna composição/atribuições. A usuária aprova antes de o Office salvar em `<projeto>/squads/<código>/`.
- **Definição perdida:** a pasta do projeto continua sendo fonte oficial. Se YAML faltar/corromper no reload, marcar indisponível e orientar recuperação; nunca recriar ou sobrescrever silenciosamente.
- **Revisão de permissões antigas:** regras “Sempre permitir” já salvas pelo Claude CLI são mostradas para revisão; importar somente as aprovadas, sem limpar/regravar silenciosamente.

## 3. Arquitetura proposta

### Agent Office — plano de controle

O Office cria e acompanha o agente individual principal, atribui a worktree, aplica permissões, apresenta aprovações e controla cancelamento/retomada. Também recebe os eventos do OpenCode e os converte em estado visível para o painel do Office, distinguindo agente principal e subagentes, modelo selecionado, subtarefa e resultado.

Squads continuam no fluxo atual baseado em Claude até que o ticket 02 estabilize sua criação, papéis, persistência e recuperação. Seu orquestrador, membros, estados e salas não são substituídos pelo OpenCode.

### OpenCode — execução e subdelegação individual

Para cada agente individual, o Office abre/associa uma sessão OpenCode vinculada ao diretório da worktree e envia o objetivo. O agente julgador do OpenCode recebe o objetivo e o inventário de modelos aprovados, decompõe o trabalho, seleciona o perfil de subagente adequado e passa cada subtarefa. Também pode receber brief/tickets aprovados e propor composição de squad; a persistência só ocorre após aprovação explícita. Os eventos das sessões-filhas alimentam os assentos dinâmicos e os logs do agente principal.

**Recomendação técnica provisória:** avaliar primeiro o serviço local do OpenCode com `@opencode/client` e `@opencode/client/service` no processo principal do Electron. O SDK embedded é uma alternativa distinta documentada como `@opencode/sdk`; fica como alternativa se a descoberta/gestão do serviço não atender ao ciclo de vida do Office. A escolha depende de spike que valide streaming SSE, eventos e IDs das sessões-filhas, permissões, interrupção, retomada e recuperação após reconexão. Eventos documentados são live-only, sem replay/reconexão automática.

### Agente julgador/model router

O julgador seleciona apenas dentro do catálogo aprovado e aplica as regras de adequação, reasoning/variant, disponibilidade/quota e custo. Para programação, escolhe o maior nível de raciocínio/variant que o modelo OpenCode suportar; `effort` não deve ser presumido como nome de parâmetro OpenCode. A resposta deve registrar modelo/perfil, subtarefa, nível selecionado e justificativa. Não pode contornar permissões, cadastrar modelos ou mudar o modelo de uma execução ativa.

Se a política não produzir uma opção adequada, houver incerteza relevante, ou nenhum modelo aprovado estiver disponível, a execução pausa e solicita orientação. Não há fallback para modelos gratuitos nem troca de modelo durante uma execução. A possibilidade de o julgador ser LLM dedicado, o modelo usado pelo próprio julgador, o contrato exato da resposta e o critério de confiança serão definidos na spec detalhada após o inventário de capacidades GPT-6/Claude.

## 4. Experiência dos andares

Cada andar mantém o espaço central do diretor e as cabines de squads conforme a organização aprovada, além de uma sala de agentes individuais no lado oposto. Todos os andares oferecem o botão **Propor squad com IA**, mas nenhum squad nasce automaticamente. Ao usá-lo, a usuária informa um brief e pode selecionar tickets aprovados; o julgador propõe composição e atribuições, e a definição só é gravada depois de aprovação. Os arquivos canônicos são escritos atomicamente em `<projeto>/squads/<código>/`, sem sobrescrever outro squad.

Os agentes principais representam sessões individuais persistentes e continuam em seus assentos quando ociosos. Cada subagente OpenCode ativo recebe assento temporário na sala do respectivo projeto, dimensionada pelo limite de concorrência configurado no Office, com indicação de tarefa e modelo. A conclusão libera o assento; não apaga o resultado ou histórico do agente principal.

Antes de qualquer código de UI, criar quatro protótipos HTML usando os tokens e componentes reais do Agent Office para revisar largura, fluxo entre as duas áreas, quantidade/expansão de assentos, estados ocioso/ativo/aguardando/aprovado/concluído e responsividade. A usuária aprova o layout antes da implementação.

## 5. Fluxo de permissões

O Office mantém a matriz de ações e mapeia suas categorias para Claude e OpenCode. Os prompts desnecessários já citados para o modo Automático são leitura de arquivo comum na worktree e execução de teste local. A política aprovada é:

| Ação | Modo Automático |
|---|---|
| Ler arquivo comum dentro da worktree | Permitir sem perguntar |
| `Grep`/busca de conteúdo | Permitir apenas com escopo explícito e seguro; busca ampla, sem path ou ambígua pede confirmação |
| Editar dentro da worktree | Permitir sem perguntar |
| Teste/build local | Permitir sem perguntar |
| Sair da worktree ou acessar caminho externo | Pedir confirmação |
| Apagar arquivo, instalar dependência, rede externa, commit, push, PR ou publicação | Pedir confirmação sempre |

Squads e agentes individuais herdam o modo do projeto. Um agente/ticket individual pode escolher um modo mais restrito; relaxar o modo herdado exige aviso de risco e confirmação. Rotinas herdam o modo do projeto e pausam/avisam quando precisam de confirmação. Regras de “Sempre permitir” são por projeto, valem para ambos os motores e aparecem em uma área de revisão/revogação.

O mapeamento para OpenCode não pode confiar nos defaults permissivos do runtime (`*/* allow`): a sessão principal e cada perfil de subagente recebem explicitamente as regras do Office, inclusive para `external_directory`. As regras são ordenadas (a última correspondência vence), `deny` é hard-deny e `ask` pode ser relaxado por uma regra de agente posterior; cada perfil filho precisa receber a política e o spike deve provar que ela não pode ser contornada. OpenCode entrega pedidos de aprovação de forma assíncrona; o adapter cria estado de espera no Office e responde a cada pedido. Se a usuária não responder ou o serviço desconectar, a tarefa pausa sem aprovar. Aprovações pontuais usam `once`; “Sempre permitir” persiste no store do Office, sem criar um segundo conjunto oculto no OpenCode.

## 6. Fases e gates

1. **Rever permissões (ticket 03):** grill-with-docs para mapear cada modo aos mecanismos de Claude/OpenCode, revisar as aprovações antigas Claude, validar os dois exemplos excessivos e desenhar consentimento/revogação. Aprovar spec antes do código.
2. **Estabilizar squads Claude (ticket 02):** reproduzir e corrigir persistência/criação, papéis e estados usando `<projeto>/squads/` como fonte oficial. Erro de definição ausente deve orientar recuperação e nunca reconstruir silenciosamente.
3. **Validar e integrar OpenCode individual (ticket 14):** validar GPT-6 Luna `high` pelo serviço OpenCode, documentar capabilities, variants/reasoning, disponibilidade, quotas, custo, termos e retenção. Claude só entra após conectar e aprovar as contas. Fazer spike de serviço/SDK, eventos de subagentes, permissões, cancelamento, retomada e sessões paralelas; então implementar adapter e julgador.
4. **Propor squads por IA e desenhar andares (ticket 04, depende de 02 e 14):** cada andar expõe o botão de proposta; OpenCode recebe brief/tickets e retorna uma proposta; usuária aprova antes de salvar. Criar quatro protótipos HTML usando tokens reais e aprovar o layout com cabines de squads e sala individual em lados opostos antes do código.

Cada fase preserva branch/worktree própria, revisão independente, PR sem merge automático e proteção do vault real. Nenhum ticket deste documento autoriza leitura, cópia ou envio do vault.

## 7. Critérios de aceitação da integração OpenCode

- Agente individual do Office pode executar em OpenCode e criar subagentes para subtarefas independentes.
- O roteador escolhe só modelos aprovados (inicialmente gratuitos; Claude também fica elegível após configuração/aprovação), segue as regras de adequação e reasoning/variant máximo suportado para programação, registra a justificativa e pausa quando não houver opção apropriada.
- Office mostra o estado do agente principal e dos subagentes; suporta cancelar/retomar e guarda resultado e histórico após um subagente liberar seu assento.
- A política do Office é aplicada a ferramentas OpenCode; fora do modo “Sem pedir nada”, OpenCode não consegue relaxar uma regra nem acessar fora da worktree autorizada sem consentimento. O bypass continua sem confinamento e exige aviso e confirmação consciente para ativação.
- Squads continuam visíveis/reutilizáveis, usam Claude e conta fixa por squad; só iniciam por escolha explícita da usuária.
- Testes cobrem criação/retomada, falta de provider/model, quota, erro de stream, interrupção, subagente que falha, permissão negada e revogação de regra “Sempre permitir”.
- Dados reais do vault, credenciais, segredos e dados de clientes não são enviados a GPT-6 ou Claude.

## 7a. Contrato do julgador — decisão de delegação (implementado 2026-10-19)

Execução em duas etapas dentro da mesma sessão OpenCode: `decidir → validar no Office → executar`. Só a etapa 2 pode gerar subagentes, e nenhum subagente nasce antes de a decisão passar na validação local.

1. **Etapa 1 (decidir).** O Office envia o objetivo + perfis filhos aprovados + o par aprovado (`openai/gpt-6-luna`, variant `high`) e proíbe ferramentas. O julgador responde **somente** um envelope JSON estruturado:

   ```json
   {"objective": "...", "decisions": [{"task": "...", "profile": "...", "providerID": "...", "modelID": "...", "variant": "...", "rationale": "...", "confidence": 0.0}]}
   ```

   `decisions: []` é válido e significa que o julgador conduz a tarefa sozinho, sem subagentes.

2. **Validação local (Office) — fail-closed.** O Office extrai o JSON com parser tolerante e valida cada decisão antes de autorizar a etapa 2: perfil ∈ perfis aprovados; `providerID/modelID/variant` = exatamente o par aprovado; justificativa não vazia; `confidence` número entre 0 e 1. Com confiança abaixo de `0.5` (constante `MIN_DELEGATION_CONFIDENCE`), o Office pausa em vez de delegar. Plano ilegível ou inválido **pausa a execução sem delegar**, com lista de motivos registrada no log — jamais delege sem prova de permissão.

3. **Etapa 2 (executar).** O Office reenvia o envelope validado verbatim e o julgador executa exatamente essas delegações. O Office rastreia o plano validado como orçamento de nascimento por perfil (`session.created` além do plano, inclusive segunda delegação do mesmo perfil já esgotado, interrompe subagente, sessão pai e a execução). A governança de eventos verifica o que é observável (`session.created`/`permission.asked`): **perfil, modelo, variant e contagem**. O texto da subtarefa (`task`) é obrigação por instrução do envelope reenviado verbatim, e não gate de string-matching: `session.created` não expõe o texto da tarefa para casar de forma confiável, e heurística sobre o `title` produziria falsos bloqueios (fail-closed) sem ganho de segurança — o risco de escalada já está contido por perfil/modelo/contagem. A aderência de tarefa fica visível para verificação humana: cada delegação validada e o título de cada filho aparecem nos logs de auditoria na sala individual, para a usuária conferir.

4. **Central de segurança na decisão.** Durante a etapa 1 (`deciding`): nenhum delta vai à interface (vai só ao buffer de decisão), qualquer `permission.asked` para subagente na sessão pai e qualquer `session.created` de subagente interrompem tudo imediatamente (fail-closed).

5. **Auditoria.** Assim que o plano passa na validação local — antes da etapa 2, inclusive se a etapa 2 falhar — a Office registra por decisão: perfil, modelo, variant, justificativa e confiança no log do agente (visível na sala individual), além de "Julgador selecionou …". O plano invalidado nunca chega ao OpenCode nem ao log de delegações.

## 8. Pontos que a spec detalhada deve fechar

- Catálogo GPT-6 Luna `high` e, após conexão, modelos Claude aprovados; documentar termos/retention, capacidades, custos e quotas.
- Modelo do agente julgador, formato de entrada/saída estruturada, critério de confiança e limites de complexidade. *(Contrato implementado em 2026-10-19 — ver seção 7a; restam os limites de complexidade por execução.)*
- Contrato do adapter OpenCode, granularidade de eventos, retentativa, timeout, recuperação de serviço e concorrência de sessões.
- Validar tecnicamente o uso das duas contas Claude compartilhadas entre squads e subagentes OpenCode: autenticação em cada runtime, paralelismo, limites/quota compartilhados e pausa quando a conta chega ao limite, sem alternar credencial no meio de uma execução nem expor tokens ao renderer.
- Escopo de regras `Sempre permitir`, armazenamento seguro e remoção/revogação.
- Protótipos e aprovação do layout final do andar de projeto.
