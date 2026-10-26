# Telegram local

## Vincular

Em Ajustes → Telegram local, importe pelo seletor do sistema um arquivo JSON criado fora do vault e fora da pasta de dados do Agent Office:

```json
{ "botToken": "123456:token-do-bot", "userId": 123456789 }
```

O `userId` é o ID numérico da conta privada autorizada. O processo principal valida o bot com `getMe`, criptografa token e ID com `safeStorage` e grava somente o ciphertext em `telegram-credentials.bin` com permissões restritas. `basic_text`/backend inseguro é recusado. O arquivo JSON de importação permanece no local escolhido; apague-o manualmente após a vinculação.

O token nunca é retornado pela API do preload, colocado em `office.json`, gravado no vault ou escrito em logs. A vinculação mostra apenas nome do bot e ID autorizado.

## Recebimento

- `getUpdates` por long polling começa depois que a janela principal é criada e permanece ativo enquanto o processo do Agent Office está aberto. `before-quit` aborta a chamada em andamento e para o loop.
- Só mensagens `private` cujo `from.id` e `chat.id` correspondam ao ID vinculado são publicadas ao renderer. Outros updates são consumidos sem exibir ou armazenar o texto.
- O cursor guarda somente `botId` e `updateId` em `telegram-offset.json`; ele torna reentregas idempotentes. Conversas não são arquivadas. O texto autorizado é exibido em uma notificação efêmera para os fluxos seguintes (por exemplo, permissões e resumo do #55).
- Mensagens recebidas com mais de 24 horas geram aviso para reenvio; Updates expirados/removidos pelo próprio Telegram não podem ser recuperados quando o app esteve fechado.
- Token revogado interrompe o polling e mostra instrução para revincular; não há troca de token, webhook ou relay hospedado.

Os testes usam fetch, bot, IDs e mensagens sintéticos. Nenhum token real é necessário.
