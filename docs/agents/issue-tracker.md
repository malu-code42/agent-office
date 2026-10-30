# Issue tracker

Specs e tickets deste repositório vivem no GitHub Issues: [`malu-code42/agent-office`](https://github.com/malu-code42/agent-office). Use o `gh` CLI para operações.

## Convenções

- Criar: `gh issue create --repo malu-code42/agent-office --title "..." --body-file <file>`.
- Ler: `gh issue view <número> --repo malu-code42/agent-office --json number,title,body,labels,comments`.
- Listar/pesquisar: `gh issue list` com filtros de estado, rótulo ou busca.
- Bloqueios: usar dependências nativas de issue quando disponíveis; caso contrário, registrar `Blocked by: #...` no corpo.
- Tickets-filhos: usar GitHub sub-issues quando houver issue-pai existente.
- Aplicar os rótulos de triagem definidos em `docs/agents/triage-labels.md`.

**PRs como superfície de solicitação/triagem: não.**
