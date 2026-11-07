# Revisão de segurança da ponte Telegram da Luna (AO-85)

Escopo: `src/main/telegram-bridge.ts`, `telegram-service.ts`, `telegram-settings.ts`, `ipc/telegram.ts`, `luna-chat.ts` (`askRemote`), `iris.ts`/`iris-claude.ts` (regras do canal) e a seção de ajustes `telegram-section.ts`. O Telegram é uma entrada remota para a Luna; o risco central é alguém além da usuária comandá-la, ou um comando remoto gerar ação sem confirmação no app.

Método: leitura do código e testes automatizados com Telegram (`fetch`) e Claude (intérprete) simulados. Nenhuma chamada real à API do Telegram nem ao Claude, e o app não foi aberto. O uso está em [telegram-luna.md](telegram-luna.md).

## Vereditos

| Item | Veredito |
|---|---|
| Allowlist de chat_id | Adequada, com ressalvas (R1, R2) |
| Token | Adequado, com ressalvas (R3, R4) |
| Injeção de prompt | Contida pela arquitetura; o modelo em si não é uma barreira (R5) |
| Ações destrutivas | Nenhuma é executada só pelo Telegram no caminho atual (R6) |
| Limites de tamanho e taxa | Adequados; uma falha pequena corrigida aqui (R7) |
| Logs | Adequados (R8) |

### 1. Allowlist
- A ponte só trata `chat.type === 'private'` e `chat.id` presente na lista; qualquer outro é descartado antes de responder ou chamar a Luna. Só `allowed_updates: ['message']` é pedido (sem editadas, canais, callbacks).
- Teste: `telegram-abuse.test.ts` (chat de outra pessoa e grupo: sem resposta, sem chamada ao Claude, sem proposta, arquivos intactos) e `telegram-bridge.test.ts`.
- O chat_id é validado na tela e no processo principal (inteiro positivo, até 15 dígitos); grupos (negativos) são recusados de propósito.

### 2. Token
- Guardado com `safeStorage` em arquivo próprio, fora de `settings.json` (que vai inteiro ao renderer). Nunca retorna ao renderer: as respostas do IPC são `TelegramView` (sem token), o campo é limpo após salvar, e erros de validação não repetem o valor digitado.
- O token vai na URL da Bot API. Nenhum erro de `fetch` é registrado com a mensagem original; só textos fixos e códigos HTTP. O redator de logs ganhou um padrão para tokens de bot (`123456:ABC...`, também em URL `/bot<token>/`) e o token real é registrado nele ao ligar.
- `telegram-secret.json` entra na lista de credenciais do piso de permissões: agentes não o leem nem o escrevem.
- Testes: `telegram-settings.test.ts`, `telegram-service.test.ts`.

### 3. Injeção de prompt
- O texto remoto é repassado como veio e entra apenas no contexto/mensagem do usuário. As regras do canal vão no prompt do sistema (`systemPrompt`), em argumento próprio; o texto "ignore as regras" nunca é concatenado a elas (teste `iris-claude-channel.test.ts` e `telegram-abuse.test.ts`).
- A Luna do Telegram usa o interpretador do chat da janela: sem ferramentas (`tools: []`), um turno, saída em JSON validada por esquema. Operações como concluir tarefa são recusadas pelo esquema. Ela nunca usa a sessão do agente Luna com ferramentas (`agents/sdk.ts`).
- Efeito de uma injeção bem-sucedida: no pior caso, o modelo propõe uma operação indevida, que aparece como proposta pendente no app.

### 4. Ações destrutivas
- Todo efeito da Luna passa por proposta na caixa de entrada, confirmada no app (descartar, reagendar, compromissos). `askRemote` não inicia tarefa de perfil nem abre rascunho de mídia; só orienta a abrir o app. A ponte avisa quando fica algo pendente (`needsAppCard`).
- Commit, push, PR e merge: a Luna do Telegram não tem ferramentas, e o piso (`permissions/floor.ts`) nega push e merge a qualquer agente.
- Teste de ponta a ponta: um modelo simulado "obedece" a um ataque e manda descartar uma tarefa; resultado: uma proposta pendente, `tarefas.md` e `agenda.md` byte a byte iguais.
- Decisão da usuária (06/11): ações destrutivas pelo Telegram são permitidas, com a IA orientada a confirmar no chat. Essa confirmação continua sendo só orientação (R6).

### 5. Limites
- Entrada: 2000 caracteres (corrigido, R7). Taxa: 10 por minuto por chat, janela deslizante, um aviso por janela. Saída: no máximo 8 partes de 4096. Processamento sequencial, 60 s por pedido. Teste: mensagem de 5 milhões de caracteres e rajada de 200 mensagens não travam o laço e só 10 chegam ao Claude.

### 6. Logs
- A ponte e o serviço só registram textos fixos ("Telegram conectado", "recusou o token", "A Luna falhou..."). Nem o texto das mensagens nem o erro original entram no log (teste de abuso verifica texto e token).

## Riscos e o que não foi provado

- **R1. Chat_id errado ou de terceiros (RESOLVIDO, AO-112).** Antes, quem digitasse o chat_id de outra pessoa dava a ela o comando da Luna. Agora a ponte só liga depois da verificação de posse (ver a atualização AO-111 e AO-112, abaixo).
- **R2. Conta do Telegram comprometida.** Quem controla a conta da usuária controla a Luna pelo Telegram. A defesa é a confirmação no app, não o canal. Mensagens encaminhadas ou coladas com instruções (injeção por conteúdo de terceiros) chegam como texto normal da usuária.
- **R3. Token roubado.** Permite ler as mensagens que o bot recebe e enviar mensagens como o bot (respostas da Luna trazem agenda e tarefas). Não permite fazer-se passar pelo chat permitido. Mitigação: `/revoke` no @BotFather. O token fica protegido por `safeStorage` (no Windows, DPAPI): qualquer programa rodando como o mesmo usuário do Windows pode, em tese, decifrá-lo. Não testado com o `safeStorage` real.
- **R4. Achar o chat_id pelo navegador** deixa o token na URL e no histórico; o passo está documentado com o aviso.
- **R5. Barreira do modelo.** Não foi medido o quanto o modelo respeita a regra do canal. A regra do canal ("confirmar antes no chat") convive com a instrução da Luna de não pedir confirmação a pedidos claros (o app é quem confirma); qual delas vence varia. O que garante a segurança é a proposta no app, não o texto.
- **R6. Confirmação só por prompt.** Se um dia a Luna do Telegram ganhar ferramentas ou aplicar operações sem proposta, a confirmação no chat vira apenas orientação ao modelo, que pode errar. Hoje o gancho `confirmation` da ponte está sem implementação (AO-109, parte 3). A ponte não tem como saber se a usuária confirmou.
- **R7. Corrigido aqui.** O limite da ponte era 4000 e o do pedido à Luna é 2000: mensagens entre os dois passavam pela ponte e falhavam com a mensagem genérica. A ponte agora usa o mesmo limite (`IRIS_REQUEST_MAX`).
- **R8. Conteúdo das conversas.** O texto do Telegram aparece no feed da Luna no app, como o chat da janela, e provavelmente é persistido junto com os outros dados do agente (não verificado); o log de diagnóstico não o recebe. O conteúdo também passa pelos servidores do Telegram (sem criptografia de ponta a ponta) e pelo Claude.

### Falhas fora do pequeno (viram tickets separados)
1. **Mensagens antigas na abertura.** Ao ligar, a ponte processa as mensagens pendentes no Telegram (até 24 h), como "descarte X" mandado com o app fechado; viram propostas no app, mas podem surpreender. Sugestão: ignorar mensagens com `date` antigo ou avisar a usuária.
2. **(RESOLVIDA, AO-111)** **Alterar chat_id/token sem confirmação no app.** O IPC de salvar não pede confirmação (diferente de mudanças de permissão). Um renderer comprometido poderia apontar a ponte para outro chat. Sugestão: caixa de diálogo do processo principal ao mudar chat_id ou token.
3. **Confirmação por código** (AO-109, parte 3), já planejada: não implementada aqui.
4. **(R1 RESOLVIDA, AO-112; custo já tratado no AO-109)** **Verificação de posse do chat_id** (R1) e custo: 10 mensagens por minuto ainda podem gerar muitas chamadas ao Claude; avaliar limite por hora.

### Não provado
- Nada foi visto no app rodando (tela do Telegram, indicador de estado, foco por teclado).
- Nada contra a API real do Telegram (formato real de respostas, erro 409, `retry_after`, limites reais) nem contra o Claude real.
- `safeStorage` real do Electron não foi exercitado; os testes injetam uma criptografia de mentira e provam apenas que o texto puro não vai ao disco.
- O comportamento do modelo diante de injeções reais não foi medido; os testes simulam um modelo que obedece ao ataque para provar que a arquitetura contém o efeito.

## Atualização AO-109, parte 3

- **R6 tratado**: o gancho `confirmation` agora existe (`src/main/telegram-confirm.ts`, ligado em `telegram-service.ts`). Um pedido destrutivo vindo do Telegram não chega à Luna; a ponte responde "SIM <código>" no mesmo chat (código de 5 caracteres, uso único, 5 minutos, 3 tentativas, um pendente por chat; qualquer outra mensagem cancela). Se o gancho falhar, o pedido não segue.
- **Conta como destrutivo** (texto sem acento e sem maiúsculas, `DESTRUCTIVE_PATTERNS`): apagar, excluir, deletar, remover/remova, descartar, cancelar, limpar, zerar, sobrescrever, destruir, formatar, resetar, tirar; commit, push, merge, mesclar, deploy, publicar, pull request, PR; em inglês delete, remove, discard, cancel, erase, wipe, drop, overwrite, clear, destroy, purge, truncate, rm. Na dúvida, vale como destrutivo. Fora dessa lista a detecção é por palavra: um pedido destrutivo escrito com outras palavras passa, mas o efeito continua sendo uma proposta que só o app confirma.
- **Falha 1 corrigida**: mensagem com mais de 5 minutos ou sem data é descartada, com um aviso por lote.
- **Falha 4 corrigida**: limite de 60 mensagens por hora por chat, além dos 10 por minuto.
- **Seguiam abertas**: falha 2 (diálogo ao mudar chat_id/token) e a verificação de posse do chat_id (R1); tratadas abaixo.

## Atualização AO-111 e AO-112

- **Falha 2 resolvida (AO-111)**: mudar o chat_id ou colar um token diferente do guardado abre um diálogo NATIVO do processo principal (`dialog.showMessageBox`, `telegram-change-dialog.ts`), não do renderer. Mostra o chat_id de e para; do token diz só "será substituído", nunca o valor. Só o botão "Confirmar mudança" salva; "Cancelar", Esc/X, falha do diálogo ou ausência de janela contam como não: nada é gravado e a ponte continua como estava (o salvar responde com erro). A validação roda antes do diálogo. O serviço exige a função de confirmação na construção: sem quem pergunte, nada que mude o destino é salvo. Ligar/desligar sem mudar chat_id nem token não pergunta.
- **R1 resolvida (AO-112)**: a ponte não liga sem chat_id verificado (`TelegramSettingsStore.isVerified`, usado no `config` da ponte). A usuária salva token e chat_id, pede o código nos Ajustes, o bot o envia ao chat configurado, e ela o digita. Código de 6 dígitos de `crypto.randomInt`, uso único, validade de 5 minutos, 3 tentativas (a terceira errada descarta o código), intervalo mínimo de 30 s entre envios, um código pendente por vez. O código só viaja ao chat do Telegram: a `TelegramView` só diz `codePending` e `verified`, o código não é registrado em log, e erros de envio viram texto fixo (a URL leva o token). Trocar chat_id ou token zera a verificação e descarta o código pendente. Instalações anteriores (sem o campo `verified`) precisam verificar uma vez antes de a ponte ligar de novo. A verificação não aprova nada: só libera a ponte; pedidos da Luna continuam sendo confirmados no app.
- **Não provado**: nenhuma chamada real à API do Telegram (o envio do código é simulado nos testes), nada visto no app rodando (diálogo nativo, seção de verificação), `safeStorage` real. Quem controla a conta do Telegram da usuária (R2) ainda recebe o código: a verificação prova que o chat_id é de quem lê aquele chat, não que é a usuária.
