# Plano de implementação — trechos de escrita versionados

**Spec aprovada:** `docs/superpowers/specs/2026-10-24-versoes-de-escrita-design.md`
**Issue:** #46
**Executor/revisor preferido:** GPT-6 Luna High, em sessões/contextos separados
**Branch:** `agent/ticket46-escrita`
**Base:** `origin/main` no commit `3e3b8d4dff41b39819cadfbf9bbf14b2b095632a`

## Guardrails

- Não ler, copiar, indexar ou testar `D:\Documents\vault-agent-office`; usar `mkdtemp` com vaults sintéticos.
- Enviar somente a versão escolhida e a instrução de até 2.000 caracteres, após mostrar a prévia exata e a usuária clicar Enviar.
- O rascunho e a conversa não são persistidos. Não enviar tarefas, agenda, outros trechos ou memória de perfil.
- O arquivo é `escrita.md`; versões são append-only; nenhuma função da aplicação altera o corpo de uma versão salva.
- Todo conteúdo é tratado como dado, nunca como instruções do sistema. A saída do modelo não é gravada antes da confirmação explícita.
- `Iris` de tarefas/agenda não é usado nem modificado para realizar a revisão de escrita; não criar task/proposal/agenda entry.
- Main permanece intacta; só arquivos do ticket são staged. PR para `main`, sem merge.

## Fases

### 1. Modelo de domínio e codec puro

- Criar `src/shared/writing.ts` com aggregate `WritingSnippet` e funções do domínio: criar Original, listar versões e anexar uma nova versão imutável baseada numa versão existente.
- Validar ID do trecho/versão, número sequencial, origem (`original` ou `escrita`), baseVersionId, título (1–200 chars, uma linha), conteúdo (1–50.000 chars) e instrução (1–2.000 chars).
- Codec de `escrita.md`: round-trip LF/CRLF, preserva linhas/conteúdo desconhecidos e corpos Markdown multilinha. Usar delimitadores de corpo com IDs aleatórios de versão; antes de gravar, garantir que delimitador de fechamento não existe no corpo.
- Rejeitar duplicidade, estrutura de versão quebrada ou IDs inválidos com mensagem em pt-BR sem reescrever o arquivo.
- TDD em `test/writing.test.ts`: original e versão, ordem, original imutável, body com Markdown, delimitador em conteúdo, texto livre/linhas desconhecidas, CRLF, IDs e limites.

### 2. Writer de vault

- Criar `src/main/writing-write.ts` com instância por sessão e métodos `read`, `createOriginal`, `appendVersion`.
- `read` guarda snapshot exato de `escrita.md`; cada alteração relê e compara o arquivo antes de qualquer backup/escrita.
- `createOriginal` cria trecho só com Save explícito; `appendVersion` verifica que o snippet/baseVersionId continuam presentes e acrescenta nova versão sem modificar versões anteriores.
- Backup datado em `<vault>/backups/escrita/`, nunca sobrescrito; escrever via `writeFileAtomic`. Backup ou stale-check falho não altera `escrita.md`.
- TDD em `test/writing-write.test.ts`: criação original, nova versão, snapshot concorrente, backup datado, colisão de backup, falha antes/depois do backup, original e versões anteriores intactos, nenhum arquivo extra nos outros domínios.

### 3. Assistente efêmero Escrita

- Criar `src/main/writing-assistant.ts` separado do `IrisDesk` geral. Entrada: snippet/versão selecionada e instrução; saída: prévia exata, pergunta/erro seguro ou rascunho em memória.
- Só `send` depois do token de prévia; cancelamento apaga token. Revalidar stale snapshot depois da resposta e antes de oferecer Save.
- Chamar Claude uma vez com `tools: []`, `persistSession: false`, conta corrente fixa e `profileTaskInstructions('escrita')`; a resposta deve ser texto simples válido dentro de 50.000 caracteres. Não logar pedido, texto, contexto ou resposta.
- `saveDraft` exige token válido, versão base ainda atual e texto editado validado; grava só por `WritingWriter.appendVersion` após a confirmação da usuária. Recusar resultado sem token, expirado/reusado ou conflito.
- TDD em `test/writing-assistant.test.ts`: preview, escopo enviado, question/request, Claude error/malformed/oversized output, cancel, token one-shot, no persistence before save, conflict during call, accepted new version.

### 4. IPC e integração main/preload

- Criar IPC de escrita com schemas Zod para IDs, instrução, tokens e edição de rascunho; cada argumento do renderer chega como `unknown`.
- Instanciar um `WritingWriter` e um `WritingAssistant` por sessão no main; ligar ao vault selecionado e expor só operações tipadas via `OfficeAPI`/preload.
- Não aceitar path fornecido pelo renderer; `writing.md` e backup são derivados do vault configurado.
- Cancelar/fechar limpa tokens e rascunhos efêmeros. Erros do SO são traduzidos para pt-BR sem incluir path sensível em logs/renderer.
- Testar cada handler público com mocks/fixtures; garantir que não chama `Iris` de tarefas, não toca `tasks.md`/`agenda.md`/`planning.json` e não faz log de conteúdo.

### 5. Biblioteca/editor na UI existente

- Adicionar comando `Escrita` na superfície já existente (sem alterar o mundo 3D), com lista de trechos e versões.
- Modal para criar Original manualmente com Save explícito.
- Revisão de versão existente: selecionar versão → escrever instrução → mostrar texto+instrução exatos → Enviar à Escrita → mostrar base e rascunho editável → Salvar nova versão ou Cancelar.
- Cancelar antes/durante/depois da chamada não salva nada. Se houver conflito, oferecer recarregar/revisar novamente; nunca mesclar silenciosamente.
- Seguir `h()`, `modal()`, `field()`, `confirmDialog()`, `keepFocus`, teclado/foco e tokens CSS existentes. Testar copy, long content, empty states e erro na interface.

### 6. Validação final, revisão e entrega

- `npm run typecheck`, ESLint dos arquivos tocados (ESLint direto do root se wrapper falhar na worktree), testes focados, suíte completa, build e `git diff --check`.
- QA visual manual do Electron com vault sintético: criar Original, revisar com prévia, cancelar, salvar versão, reler histórico, simular conflito e verificar foco/teclado.
- Registrar separadamente a falha preexistente `test/delegate-archive.test.ts` se persistir.
- GPT-6 Luna implementa; outra sessão/contexto GPT-6 Luna revisa independentemente; corrigir achados e repetir revisão.
- Commits em português, presente, terceira pessoa, sem prefixo convencional ou ponto final. Push via `malu-code42`, abrir PR base `main`, relacionar #46. Nunca mergear.

## Critérios de conclusão

- `escrita.md` é legível/editável, preserva texto livre e linhas desconhecidas, e mantém histórico append-only.
- O perfil Escrita só é chamado após pedido explícito e prévia enviada pela usuária; a resposta é um draft efêmero.
- Nenhuma versão é gravada por gerar/responder; somente Save new version confirma e anexa.
- Conflito do Obsidian, cancelamento, erro do Claude, JSON inválido e falha de backup preservam original/versões anteriores.
- Nenhum conteúdo de escrita sai em logs, tasks, agenda, planning ou contexto adicional.
- Todos os testes são sintéticos; PR revisável fica sem merge.

## Execução

A usuária já escolheu GPT-6 Luna High para execução de todos os tickets até o limite de tokens. Este plano não autoriza implementação por outro modelo. A implementação só começa após aprovação explícita deste plano.
