# Plano de implementação — Agent Office como centro de controle da vida

**Status:** aprovado pela usuária em 2026-10-21. Base: `centro-de-controle-da-vida-design.md`. Execução autorizada somente para a Fase 0 isolada; as fases posteriores exigem seus gates próprios.
**Andamento:** implementação da Fase 0 está na worktree `agent/centro-vida-preflight-5702c15`, sem commit/merge. Typecheck, testes, build e lint consolidado passaram depois de remover worktrees antigas já integradas/encerradas; as branches foram preservadas. Restam `main`, esta worktree e as worktrees dos PRs abertos #36/#37.

## Ordem acordada

1. Preflight documental e técnico, incluindo a aposentadoria de OpenCode.
2. Casa e Luna: redesenho, dados pessoais, memória/perfis e migração local das rotinas.
3. Estudos e Bonnie.
4. Telegram, captura de áudio e resumo diário.
5. Andares de projeto, squads sob medida e salas de reunião.
6. Editor de aparência inspirado em The Sims fica futuro/fora das entregas iniciais.

## Fase 0 — Preflight, docs e OpenCode

### Descoberta consolidada: fontes e APIs existentes

- `src/main/store.ts:53–85,88–118,157–167`: `migrateSettings`, `Store`, migração e persistência local. `office.json` usa `loadJson`/`writeJsonAtomic`.
- `src/shared/types/agents.ts:14–30,41–90,192–226`: `AgentEngine`, `AgentBrain`, `AgentSummary`, `HireRequest`, `AgentTemplate`.
- `src/main/agents/base.ts:33–52,153–170`: restauração, estado/logs de agentes e persistência.
- Ativos OpenCode antes da remoção: `src/main/agents/sdk.ts`, `src/main/opencode/runtime.ts`, `src/main/opencode/judge.ts`, `src/main/opencode/ask.ts`, `src/main/squad-creation.ts`.
- UI/consentimento OpenCode: `src/renderer/src/ui/modals/new-agent.ts:115,155–217,256–280`; `src/main/ipc/agents.ts:35,54,120–135`; setting `openCodeDataConsentAt` em `src/shared/types/settings.ts:14–22` e migração em `src/main/store.ts:57–61`.
- Ledger OpenCode: `src/main/ledger.ts:201–212`; schemas OpenCode em `src/shared/types/agents.ts:60–65,149–160`.
- Escrita segura: `src/main/fs-safe.ts:30–67,143–175`; `DATA_FILES` em `src/main/backups.ts:17–25`; tarefas em `src/main/tasks-write.ts:409–449`; agenda em `src/main/agenda-write.ts:201–249`.
- IPC validado: `src/shared/types/ipc.ts:175–239`, `src/main/validate.ts`, handlers em `src/main/ipc/` e API preload em `src/preload/index.ts`.
- Mundo 3D: `src/renderer/src/world/office.ts:43`, `layout.ts:19–38,56–97,181–299`, `upper-floor.ts:15–57,132–166`, `furniture.ts`, `game/floors.ts:61–96,136–174`.
- Rotinas atuais: `src/shared/types/routines.ts:5–79`, `src/main/routines/store.ts:16–93`, `src/main/routines/scheduler.ts:65–151,248–275`, `src/main/ipc/routines.ts`.
- Agenda/tarefas puras: `src/shared/agenda.ts:48–107`, `src/shared/tasks.ts:78–83,116–142,206`.
- Padrão visual descartável: `claude design/HANDOFF.md:21–32,128–153`, `claude design/proto/ground-office.ts`, `scenes.ts`; protótipo não é código de produção.
- Telegram Bot API: `https://core.telegram.org/bots/api` — updates expiram em até 24h; `deleteMessage` pode remover mensagem recebida em conversa privada em até 48h.

### Tarefas

1. Revalidar branch, status e worktrees imediatamente antes de executar. O checkout observado estava sujo, com alterações tracked e arquivos locais/untracked. Usar worktree isolada; não apagar, resetar, stashar ou stagear em lote trabalho existente. Copiar para a worktree somente artefatos que a usuária autorizou reconciliar.
2. Alinhar, sem apagar histórico, os documentos locais que hoje divergem: `docs/prd/hera-integracao-consolidado.md`, `docs/prd/hera-integracao-descoberta.md`, `docs/specs/entrega-1-planejamento.md`, `docs/specs/agent-office-open-code-individual-routing.md`, `AGENTS.md`, `GLOSSARY.md`, `README.md`, `COMO-RODAR.md`, `.scratch/ORDEM-DE-DESENVOLVIMENTO.md`, `.scratch/PLANO-OPEN-CODE-AGENTES.md`, `.scratch/LOTE-2-STATUS.md` e tickets locais 02/03/04/14/20 relevantes. Preservar partes Claude-only úteis; marcar só requisitos/runtime OpenCode como superados. Não alterar issues/PRs externos nesta fase.
3. Remover OpenCode como motor ativo: contratação/seletor, consentimento, runtime/judge, permissões, roteamento de squad, ledger de novas execuções e testes ativos. `defaultEngine` migra para Claude; registros OpenCode antigos permanecem legíveis em modo histórico, sem retomar. Trabalho inacabado só recomeça como Claude após pedido explícito. Proposta automática de composição de squads fica pausada até existir o fluxo Claude-only da Fase 4; composição/alteração existente por operação manual não deve ser apagada.
4. Tornar a verificação ESLint única capaz de analisar checkout e worktrees, cada qual com seu `tsconfig` correto. Não simplesmente excluir as worktrees.
5. No `test/permission-notice.test.ts`, mover criação de symlinks para setup executado somente quando a suíte não está pulada. Preservar assertions de segurança em plataformas que suportam symlink.
6. Reexecutar typecheck, lint, testes e build. Baseline observado: typecheck/build passam; suíte tinha 742 aprovados, 9 ignorados e a falha de symlink; lint mostrava erros de parser/`tsconfigRootDir`, não 7.641 defeitos independentes.

### Critério de saída e guardrails

- Preferência nova/legada aponta para Claude; não existe caminho para iniciar OpenCode. Sessões, resultados, logs e métricas antigas continuam consultáveis; nenhuma conversão ou envio automático de tarefa em curso.
- O gerador/julgador OpenCode não é chamado; enquanto a composição Claude-only da Fase 4 não existir, a UI informa que composição automática está temporariamente pausada.
- Não remover dados históricos nem rotinas/tickets. Testar migração de configurações/agents antigas.
- Não enfraquecer validação de symlink para “passar” teste. Não acessar o vault real; usar fixtures.
- O estado do checkout deve ser documentado e as alterações locais preservadas.

## Fase 1 — Casa e Luna

### O que implementar

1. Criar prévia descartável da casa usando o prompt do `centro-de-controle-da-vida-design.md` e os componentes/ativos reais. Aprovação visual é gate obrigatório antes de alterar `src/`.
2. Depois da aprovação, atualizar `src/renderer/src/world/layout.ts`, `office.ts`, `furniture.ts` e `game` para sala, cozinha, quarto, escritório pessoal, mesa da Luna, cantinho criativo e acessos físicos de agenda, objetivos e mídias. Manter circulação/elevador; usar `disposeTree` para recursos Three.js.
3. Criar codecs puros, arquivos canônicos separados no vault, writers atômicos e backups para objetivos, mídias, escrita e rotinas. Relê/compara o conteúdo antes de gravar para não sobrescrever edição do Obsidian.
4. Objetivos: alvo, prazo, marcos e vínculo opcional de tarefa; percentual com pesos iguais; Luna pede confirmação para marcar alcançado. Mídias: planejado/em andamento/concluído, progresso por tipo, vínculo opcional à agenda com atualização somente confirmada. Atividades pessoais são adicionadas manualmente como compromissos, nunca como tarefas automáticas.
5. Escrita: arquivo separado, salvar só após confirmação, preservar original; perfil Escrita cria proposta de nova versão, nunca sobrescreve sem aceite.
6. Luna coordenadora local: pedidos claros de organização executam diretamente; ambiguidade pergunta; excluir/descartar pede confirmação; concluir tarefa só por pedido claro da usuária. Perfis iniciais da casa: Ajuda técnica, Estudo avulso e Escrita.
7. Persistir perfis reutilizáveis e memória resumida privada local. Conversa limpa por tarefa; memória própria atualiza automaticamente, Luna pode ler e a usuária pode consultar/editar/apagar. Skills aprovadas adaptáveis por tarefa; mudanças permanentes de skills/perfis precisam aprovação.
8. Modelo padrão Haiku 5.5 `medium`; aumento de capacidade pede aceite com modelo, motivo e impacto. Escolher conta com disponibilidade no início e mantê-la fixa; se quota acabar, pausar e perguntar.
9. Migrar rotinas locais ao fluxo de Luna: definições no vault, execuções/histórico local; importar pausadas, revisar/ativar uma a uma, preservar histórico; rotinas ligadas a projeto continuam no contexto/permissões do projeto.

### Verificação e referências

- Reusar `createTaskWriter`, `createAgendaWriter`, `writeFileAtomic`, backups e contratos IPC em `src/main/tasks-write.ts`, `agenda-write.ts`, `fs-safe.ts`, `backups.ts`, `shared/types/ipc.ts`, `main/validate.ts`, `preload/index.ts`.
- Testes puros de codecs, round-trip, linhas desconhecidas, conflito Obsidian, backups, esquema e migração; sem escrever no vault real.
- Testar goal progress e vínculos sem duplicar tarefa; media progress só avança com confirmação; escrita mantém original; rotinas importadas pausadas.
- Visual QA com dados `SIMULADO`, pathfinding, circulação, contraste e `__leakTest()`.

### Anti-patterns

- Não misturar novos registros pessoais em `tarefas.md`/`agenda.md`; cada domínio usa o arquivo próprio decidido.
- Não usar `saveMarkdown` como writer de domínio nem sobrescrever arquivo Obsidian sem stale-check/backup.
- Não auto concluir tarefa/objetivo por término de timer, agente ou rotina.
- Não ativar rotinas importadas automaticamente.

## Fase 2 — Estudos e Bonnie

### O que implementar

1. Preservar a aparência aprovada do andar de estudos. Criar codec de grade semanal no vault; a agenda deriva as próximas aulas e aceita exceção de uma data sem alterar a recorrência.
2. Criar estado persistente do ciclo, etapa e evidências para retomar após reinício. Bonnie é dona dos gates:
   - Diagnóstico fecha quando todas as questões selecionadas têm resposta e incertezas marcadas; sem nota mínima.
   - Erros/dúvidas fecha quando cada resposta errada/incerta tem causa e próximo passo; se nada foi errado/incerto, pular.
   - Prática/fontes: fonte ligada aos erros, pelo menos uma nota, ≥80% sobre o conjunto planejado (sem mínimo fixo). Se ficar abaixo, revisar erros e oferecer questões novas; a etapa permanece bloqueada. Conjunto vazio com erros não pode passar.
   - Reteste: ≥10 questões novas, gabaritos conferidos, sem ajuda, ≥80%; só depois da confirmação da estudante concluir ciclo.
   - Se diagnóstico não detectar erros/incertezas, pular Erros/dúvidas e Prática/fontes (incluindo nota obrigatória) e liberar o Reteste.
3. Tutor apoia diagnóstico/erros, curador fontes/prática, verificador reteste. Bonnie coordena e calcula gates. Perfil Estudo só responde dúvidas avulsas fora do ciclo ativo.
4. Notas são criadas durante a consulta de fontes e seguem como documentos distintos dos cartões.
5. Cartões Zettelkasten continuam fora do ciclo: equipe coordenador/assistente/verificador lê notas selecionadas e cria cartão digital no Obsidian. Cada cartão digital gera cópia física na sala de estudo e recebe marca manual “escrito”; não bloqueia o reteste.
6. Cora permanece bibliotecária com acesso local à biblioteca inteira. Não enviar conteúdo do andar de estudos a Claude até autorização específica por ambiente.

### Verificação e referências

- Novos arquivos `src/shared/<study-domain>.ts` para lógica pura; `src/main` para writer/state; `src/main/ipc`, `src/preload/index.ts`, `src/shared/types/ipc.ts` e `src/main/validate.ts` para IPC validado. Confirmar nomes/APIs durante implementação, sem supor formato do vault.
- Reusar leitura/agenda `src/shared/agenda.ts:29–82,85–107`; writer `src/main/agenda-write.ts:201–249`; rotina de horário local `src/shared/schedule.ts:198–262` somente como referência, não copiar formato de job para grade de aula.
- Reusar plano de andar/mobília `src/renderer/src/world/upper-floor.ts:15–57,132–166` e chamadas de sala em `src/renderer/src/game/floors.ts:61–96`.
- Testes de gates de Bonnie, diagnóstico sem erros (pula prática/notas), exceção de aula, retomada, nota ligada à fonte, questão/gabarito inválido, conjunto vazio e cartão físico sem interferência no ciclo.

### Anti-patterns

- Não usar tickets/lotes/filas no ciclo de estudo.
- Não tratar nota/cartão/atividade de agente como prova de aprendizagem.
- Não avançar com 80% de denominador zero, gabarito não validado ou questão não respondida.
- Não ler o vault real na suíte ou na prévia visual.

## Fase 3 — Telegram, áudio e agenda remota

### O que implementar

1. Adaptador Telegram Bot API local, long polling enquanto o Office estiver aberto; autenticar somente o Telegram user ID vinculado. Mensagens aguardam até 24h; expiradas geram aviso e pedido de reenvio. Sem infraestrutura hospedada.
2. Armazenar token do bot com mecanismo local seguro, nunca em renderer/vault/log. Verificar a API Electron instalada antes de escolher storage para segredo. Limitar o histórico local a estado pendente e registros aprovados.
3. Receber arquivos importados e áudios Telegram. Fazer spike de speech-to-text local usando primeiro ferramentas/modelos já disponíveis; não instalar dependência ou enviar áudio à nuvem sem decisão. Se nenhum ASR local funcionar, parar e pedir decisão.
4. Pipeline: transcrever localmente, corrigir forma sem alterar sentido, mostrar texto corrigido, perguntar trechos incertos, confirmar correções; adicionar ao dicionário resumido com contexto e perguntar conflitos. Apagar cópia local após processamento. Após confirmação/salvamento, tentar apagar áudio da conversa Telegram e reportar falha.
5. Classificar trechos: tarefas → lista existente em `tarefas.md`; compromissos → agenda; mídias/objetivos → arquivos próprios; escrita → preview/confirmação e nova versão. Trecho sem destino pergunta. Pedidos de áudio sobre conclusão de tarefa integram o grupo de revisão.
6. Tarefas por áudio agrupadas pela lista de origem, datadas destacadas, datas relativas convertidas no horário local; uma lista por vez para revisar. Aprovar aplica atomicamente o grupo; editar gera nova prévia; rejeitar não escreve. A tarefa por texto direto pode ser criada sem esse gate.
7. Permissão remota de agente: resposta só para user ID autorizado; mostrar agente, ação exata, recurso, risco e opções aprovar/recusar. Validade curta, idempotência e mesma matriz de risco local; nunca converter mensagem Telegram em bypass.
8. Resumo de agenda às 08:00 local com compromissos/aulas, tarefas datadas e atividades agendadas. Se app fechado, enviar ao abrir usando o dia atual e rótulo de atraso.

### Referências e verificação

- Telegram Bot API oficial: `https://core.telegram.org/bots/api` (`getUpdates`/webhook, 24h; `deleteMessage`, recebida em chat privado, até 48h).
- Padrões locais de permissão: `src/main/bridge.ts:12–26,63–105,299–316` não é autenticação Telegram; usar apenas como princípios de loopback/token. IPC sempre passa pelo schema Zod e preload tipado.
- Reusar arquivo seguro `src/main/fs-safe.ts:30–67`, backup/stale-check de `tasks-write.ts:435–449` e `agenda-write.ts:227–245`, proposal lifecycle em `src/main/proposals.ts:108–202`.
- Testes mockam Bot API, user ID, atualização duplicada/expirada, import MIME/tamanho, ASR local, dict conflict, grupos editados/reapresentados, escrita sem aprovação, Telegram delete error, permission reply de usuário não autorizado e 08:00/app fechado. Nunca usar bot token real na suíte.

### Anti-patterns

- Não hospedar relay ou acessar o desktop quando app está fechado; não prometer receber update após 24h.
- Não enviar áudio a modelo/cloud como fallback silencioso; transcrição aprovada é local.
- Não persistir tokens Telegram em JSON comum ou log; não armazenar conversa/áudio bruto após os estados acordados.
- Não gravar tarefa capturada por áudio antes de aprovação do grupo.

## Fase 4 — Projetos, equipes e sala de reuniões

### O que implementar

1. Fazer prévia da sala de reuniões no Claude Design quando esta fase começar; aprovar antes de mudar a UI 3D. A sala é distinta da sala de agentes individuais e aparece em cada andar, diante da diretoria.
2. Após implementação, testes e revisão, agente vai à sala de reuniões; o Office avisa, a usuária clica para abrir apresentação; agente aguarda resposta/nova tarefa. Resultado não é aceito/mergeado automaticamente.
3. Emi usa o fluxo de skills Matt Pocock `grill-with-docs → to-spec → to-tickets`, construindo artefatos com a usuária e respeitando gates já aprovados. Squads sob medida são aprovados antes de iniciar; Emi pode redistribuir subtarefas sem mudar escopo/critério aprovado.
4. Coordenador do squad entra só quando necessário; planeja/acompanhamento, não implementa nem aprova. Implementador executa o escopo e corrige achados; reviewer independente é obrigatório para código, avalia e aponta, sem corrigir.
5. Rotinas de projeto ficam na pasta/contexto do andar e usam perfil fixo; mantêm permissões, quota e apresentação de resultado do projeto.

### Referências e verificação

- Planta/salas: `src/shared/types/settings.ts:77–99`; `src/renderer/src/world/layout.ts:181–189,253–299,420–433`; `upper-floor.ts:32–57,102–166`; `src/renderer/src/game/floors.ts:61–96,136–174`.
- Mesa de reunião existe em `src/renderer/src/world/furniture.ts:194–200`; não confundir objeto com sala/fluxo completo.
- Resultados/inbox atuais: `src/renderer/src/ui/dialog.ts:28–46,98–118,434–453`; squad ack checks em `test/squad-result-ack-ipc.test.ts:44–85`.
- Schemas squad `src/shared/types/squads.ts`, `squad-proposals.ts:51–65,101–122`, composition `src/main/squad-creation.ts`; preservar approval/validation e adaptar papéis flexíveis.
- Testes de cada andar, overflow/circulação, estados resultado/revisão/aceite, squad sem coordenador, reviewer obrigatório para código, sem merge/escopo alterado automaticamente.

### Anti-patterns

- Não reaproveitar OpenCode judge para compor equipes; não reintroduzir modelos/providers OpenCode.
- Não confundir sala de reunião com sala individual ou lounge.
- Não contornar aprovação humana de spec/ticket/squad/merge por rotinas ou conversa.

## Fase 5 — Verificação integrada e entrega

1. Rodar `npm run typecheck`, `npm run lint` (checkout + todas as worktrees), `npm test` e `npm run build`; confirmar o teste de symlink no sistema suportado e registrar o comportamento no Windows.
2. Rodar `npm run contrast -- --check` após mudança visual e `__leakTest()` para cenas 3D.
3. Testar migrações (engine/OpenCode histórico, rotinas pausadas, stores/profile memories) com fixtures temporárias. Verificar que mudanças concorrentes no Obsidian não são sobrescritas.
4. Fazer QA visual no Electron usando dados sintéticos: casa, calendário, quadro de metas, mídia, cantinho criativo, estudos/Bonnie e salas de reunião. Não abrir o vault real.
5. Verificar que credentials/secrets não entram em logs, Telegram, profile memory, vault ou prompts; testar aprovações locais e Telegram com bot mock.
6. Atualizar a documentação de usuário/`AGENTS.md` quando a implementação modificar essas regras. Registrar evidências e limitações por fase.
7. Não fazer push, merge, release ou alteração de versão sem autorização separada.

## Gaps de viabilidade para validar no início da execução

- Confirmar método local de speech-to-text que rode no computador atual, idiomas/formats e limites de arquivo; não instalar/puxar modelo sem autorização separada.
- Confirmar storage de token Telegram e API Electron para criptografia local; não usar bridge local atual como se fosse autenticação remota.
- Confirmar a configuração de privacy improvement na(s) conta(s) Claude antes de enviar conteúdo de cada ambiente; a retenção consumer normal continua limitada à política do provedor (desativar treino não é zero-retention).
- Definir esquema/nomes finais dos arquivos `objetivos`, `mídias`, `escrita`, `aulas` e `rotinas` durante o primeiro codec, preservando o caráter editável do Obsidian.
- Revisar com o usuário os arquivos/tickets locais superados por este plano; documentos OpenCode permanecem como história e não são apagados.
