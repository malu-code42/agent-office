# Plano — perfis locais de competência

Fonte de requisitos: `docs/superpowers/specs/2026-10-27-perfis-locais-squads-e-estudo-design.md`.

## Escopo executável agora

1. Registrar a fonte no repositório da worktree, reconciliar a spec-mestra e o plano de fases sem alterar vault/configuração externa.
2. Criar catálogo local versionado de perfis de competência com identidade, escopo, responsabilidades, limites e critérios de entrega/qualidade; sem atribuição de ferramentas, permissões, modelo ou conta.
3. Oferecer escolha da especialidade nos membros implementador e revisor da proposta manual. Exibir papel, especialidade, modelo e conta antes da aprovação.
4. Persistir um snapshot validado da especialidade no integrante e materializá-lo no `.agent.md`; manter papéis executáveis, revisão independente, escritor atômico, compatibilidade de squads existentes e ausência de chamadas externas.
5. Adicionar testes sintéticos de catálogo, validação, proposta, materialização e compatibilidade; executar typecheck, lint, testes e build.
6. Atualizar tickets: #58 como integração com Emi, #89 para catálogo/squads e #90 para perfis de estudo. Registrar em #75 a reconciliação autorizada sem remover seu histórico.

## Reconciliação de autorização (resolvida em 2026-10-28)

Com confirmação explícita da usuária, #75 autoriza somente o mínimo selecionado para a etapa (tópico, pergunta e trecho/fonte pertinente). Não autoriza contexto integral do vault/biblioteca, busca/leitura ampla não selecionada, envio silencioso ou dados além do recorte. As specs e #90 foram atualizados; integração pode prosseguir com esses limites.

## Critérios de conclusão

- Perfis da proposta vêm exclusivamente do catálogo local e os dados externos/retornos não podem inventar perfil, papel, modelo ou conta.
- Implementador e revisor são distintos, em ordem de pipeline, e o revisor recebe instruções somente-leitura.
- Nada é materializado antes da aprovação explícita; nenhum squad existente é sobrescrito.
- Squads antigos sem snapshot continuam legíveis/executáveis.
- Nenhum dado real de vault/Paperclip ou chamada Claude é usado nos testes.
- `npm run typecheck`, `npm run lint`, `npm test` e `npm run build` executados; limitações preexistentes reportadas.
- Sem commit, push, merge, deploy ou release.
