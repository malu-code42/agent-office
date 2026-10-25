# Privacidade do Tutor no ciclo de estudos (AO-49)

O diagnóstico e suas respostas ficam no `study-cycle.json` em `userData`. O arquivo entra nos backups locais e na exportação/importação do Agent Office. Ele não é gravado em `planning.json`, no vault, em tickets ou em logs de agentes.

O Tutor não recebe dados ao abrir ou iniciar um ciclo. Somente o clique explícito em **Verificar com Tutor** pode enviar uma questão por vez: enunciado selecionado, resposta da estudante e evidência da questão. Para questão com gabarito marcado como conferido, a evidência é esse gabarito; para qualquer outro estado, somente o trecho que a estudante colou no campo de apoio. Sem evidência, a questão continua **Em verificação** e nenhuma chamada é feita.

Antes de usar conteúdo real, a pessoa deve conferir que a conta Claude selecionada e seu ambiente de execução podem receber esse conteúdo. O app fixa, para cada chamada, a primeira conta em Ajustes → Contas padrão (ou a conta Principal quando a lista estiver vazia), o modelo configurado (ou `claude-haiku-5-5`) e o esforço configurado (ou `medium`). Não alterna conta/modelo em caso de indisponibilidade ou cota. A chamada é de um turno, sem ferramentas e sem sessão persistida. Falhas preservam a resposta local para uma tentativa posterior.

Esta integração não comprova que a política de retenção ou o contrato da conta selecionada sejam adequados para dados sensíveis. Não envie conteúdo confidencial sem verificar as condições da conta e obter as autorizações necessárias.
