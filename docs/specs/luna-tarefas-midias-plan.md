# Plano de implementação: Luna, tarefas e mídias

**Spec aprovada:** `docs/specs/luna-tarefas-midias-design.md`  
**Base:** `1f4dd84` (PR #98 integrada)  
**Execução escolhida:** três tickets sequenciais, sem checkpoints entre eles: Luna → tarefas → Casa/mídias.

## Regras de execução

- Trabalhar somente nesta worktree `agent/luna-focus-media-followups`; não importar/alterar as mudanças não relacionadas do checkout principal.
- Usar o Claude Design da rodada 7 disponível no checkout principal apenas como referência visual. Não portar dados simulados ou código do protótipo.
- Manter cada ticket pequeno, testado e formatado antes de começar o seguinte; no final executar a suíte completa exigida por `AGENTS.md`.
- Sem commits, push, PR, atualização de versão ou alterações ao vault real nesta execução.

## Ticket 1 — Luna: preferências, popups e chat

1. Registrar o estado atual dos testes e seguir os fluxos desde `showAgent`/painel até `LunaChat`, IPC, `AgentManager`/SDK e eventos de retorno; localizar a causa concreta de mensagens sem resposta antes de alterar o fluxo.
2. Adicionar preferências próprias da Luna para aparência, modelo e esforço no armazenamento existente do `office.json`, com defaults e migração compatíveis. Garantir que `agent-office:luna` continue fixa e que preferências não alterem defaults globais nem outros agentes.
3. Reutilizar o cabeçalho/editor de aparência e dropdowns existentes para exibir os dados da Luna; assegurar que modelo/esforço alterados sejam usados no próximo envio e aparência atualizada no painel e na cena da Casa.
4. Substituir a revisão em cartões embutidos no chat por popup dedicada usando o fluxo/dados de revisão atuais. Ligar ações diretas no painel e botões da oferta contextual; preservar adiamento/rascunho e aplicar alterações somente na confirmação final.
5. Implementar popup guiada de planejamento de amanhã: leitura de foco, `agenda.md` e rotinas; escolha e proposta; revisão exata das operações; revalidar arquivos/estado antes de persistir; cancelar sem escrever e reportar falha/conflicto sem sucesso parcial falso.
6. Remover apenas a aprovação intermediária de contexto do chat normal, preservando permission mode e confirmações independentes. Corrigir estados de envio/resposta/erro/retry e garantir que a resposta associada apareça no feed.
7. Ajustar CSS de Markdown do feed conforme referência (largura de leitura e espaçamento), preservando DOMPurify, HTML escapado e segurança de links/imagens.
8. Testar migração/persistência das preferências, validação IPC, confirmação/cancelamento/revalidação de revisão e planejamento, além do fluxo de chat que reproduziu a falha. Formatar só arquivos tocados.

## Ticket 2 — Tarefas

1. Adicionar botão superior persistente “Tarefas” que abre o quadro diretamente, preservando acesso por teclado, foco, contador e compatibilidade com o layout atual.
2. Corrigir renderização de `focus-popup.ts`: estado vazio visível apenas se não houver tarefa válida; itens ausentes continuam sinalizados e não suprimem nem contradizem tarefas válidas.
3. Verificar a ligação do quadro e da categoria geral de mídias já existente no quadro.
4. Adicionar testes puros/renderer viáveis e conferir a referência de estados da rodada 7. Formatar arquivos tocados.

## Ticket 3 — Casa e mídias

1. Rastrear as etiquetas `homeTags`, a seleção de andar e o ciclo de vida do `OverlayManager`. Limitar Objetivos, Rotinas pessoais, Agenda e Livros à Casa: ocultar/indesabilitar etiquetas de overlay nos andares de projeto e restaurá-las ao retornar, sem remover objetos ou ações da Casa.
2. Preservar controles/etiquetas que são legítimos nos andares de projeto (ex.: sala de reunião, descanso, etiquetas de agente); não aplicar filtro amplo a todos os overlays.
3. Adicionar modo de categoria isolada para aberturas de Filmes/Jogos/Livros vindas da Casa. Manter abas e título geral na abertura da biblioteca pelo quadro de tarefas.
4. Validar navegação de ida/volta de andar, destinos de clique, seleção de categoria, leitura vazia/erro e acessibilidade. Se alteração de cena exigir recursos descartáveis, seguir regras de `disposeTree`/overlays.

## Verificação final

- Formatar somente arquivos tocados.
- Executar `npm run typecheck`, `npm run lint`, `npm test` e `npm run build`.
- Executar `npm run contrast -- --check` se mudar texto/cor da UI.
- Validar manualmente estados de modal/foco e, para alteração de cena, rodar `__leakTest()` em dev quando possível.
- Confirmar `git status` da worktree e reportar resultados e eventuais verificações manuais indisponíveis; não afirmar sucesso de testes que não rodaram.
