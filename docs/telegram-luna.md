# Telegram da Luna: como usar e o que a ponte não faz

A ponte Telegram deixa você conversar com a Luna pelo celular. Ela roda dentro do Agent Office (processo principal), só enquanto o app está aberto, e usa o bot que você mesma cria. Não existe servidor intermediário nosso.

Para a revisão de segurança, os riscos e o que não foi provado, veja [telegram-luna-revisao-seguranca.md](telegram-luna-revisao-seguranca.md).

## Configurar

1. **Criar o bot.** No Telegram, abra o @BotFather, mande `/newbot`, escolha nome e usuário. Ele responde com o **token**, no formato `123456789:ABC...`. Quem tem o token controla o bot: não compartilhe, não cole em chats nem em tickets.
2. **Achar o seu chat_id.** Abra uma conversa com o seu bot e mande qualquer mensagem. Depois abra no navegador `https://api.telegram.org/bot<TOKEN>/getUpdates` (troque `<TOKEN>` pelo seu) e procure `"chat":{"id":NÚMERO`. O número é o chat_id (inteiro positivo, conversa privada). Atenção: essa URL leva o token e fica no histórico do navegador; apague a entrada depois. Esse passo precisa ser feito antes de ligar a ponte no app (o app e o navegador não podem ler as mensagens ao mesmo tempo).
3. **Informar no app.** Ajustes → Luna → Preferências da Luna → seção **Telegram**: cole o token, o chat_id, marque **Ligar o Telegram** e use **Salvar e aplicar Telegram**. O estado aparece abaixo: Desligado, Conectando, Conectado ou Erro com o motivo.

O token é guardado criptografado (`safeStorage` do Electron) em `telegram-secret.json` na pasta de dados do app e **nunca volta para a tela**: depois de salvo, ela só mostra "Token configurado: sim". Para trocar, cole outro; deixar em branco mantém o atual. Se o computador não oferecer armazenamento criptografado, o app recusa guardar o token.

Ligar e desligar vale na hora, sem reiniciar o app. A configuração persiste: ao abrir o app, a ponte liga sozinha se estava ligada. Fechar o app encerra a ponte.

## Como funciona

- Só o chat_id informado é atendido. Mensagens de qualquer outro chat, de grupos ou sem texto são ignoradas, sem resposta e sem chamar a Luna.
- O texto vai para a Luna pelo mesmo caminho do chat da janela, com uma regra extra no prompt do sistema: antes de qualquer ação destrutiva ela descreve o que faria e pede a sua confirmação no mesmo chat; cartões de permissão só se aprovam no app.
- Quando a Luna prepara alterações (descartar tarefa, remover compromisso, reagendar etc.), elas viram uma **proposta na caixa de entrada do Agent Office**. Nada é aplicado até você confirmar no app. A ponte avisa "Confirme no Agent Office".

## Limites e proteções

| Item | Valor |
|---|---|
| Tamanho máximo da mensagem recebida | 2000 caracteres (o mesmo do pedido à Luna no app); acima disso a ponte responde que é grande demais |
| Ritmo | até 10 mensagens por minuto; o excedente é descartado, com um único aviso por janela |
| Tamanho da resposta | até 8 mensagens de 4096 caracteres; o resto é cortado com um aviso |
| Tempo da Luna por pedido | 60 segundos |
| Mensagens processadas | uma de cada vez, em ordem |

## O que a ponte NÃO faz

- Não aprova cartões de permissão (commit, push, PR e afins) nem confirma propostas. Isso é só no app.
- Não faz merge, push ou qualquer comando de terminal: o piso de permissões do app continua valendo e a Luna do Telegram não tem ferramentas.
- Não inicia tarefas de perfil nem abre rascunhos de mídia: só avisa para abrir o Agent Office.
- Não atende grupos, canais, outros usuários, áudios, fotos ou arquivos.
- Não confirma ações por código (por exemplo "responda SIM"). A confirmação no chat é só uma orientação ao modelo e pode falhar. Essa confirmação por código está planejada à parte (AO-109, parte 3).
- Não funciona com o app fechado: não há serviço em segundo plano.
- Não é criptografia de ponta a ponta: conversas com bots passam pelos servidores do Telegram.

## Se algo der errado

- **Erro: Token recusado pelo Telegram.** O token está errado ou foi revogado (no @BotFather, `/revoke`). A ponte para até você salvar um token novo.
- **Erro: Sem conexão com o Telegram.** Falha de rede; a ponte tenta de novo sozinha, com espera crescente.
- **Erro 409.** Outro programa está lendo as mensagens do mesmo bot (por exemplo outra instância do app ou uma URL `getUpdates`); feche o outro.
- **Suspeita de vazamento do token.** No @BotFather use `/revoke`, gere outro e atualize aqui.
