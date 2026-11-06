# 0011 — CI de PRs e da main somente no Windows

- **Status:** aceito por decisão explícita da usuária
- **Data:** 2026-11-05

## Contexto

O uso deste fork é no Windows. No PR #240, o Windows passou, mas duas tentativas macOS foram interrompidas por falta de runners hospedados arm64, sem executar os testes. A usuária solicitou remover o CI macOS também dos próximos PRs.

## Decisão

O workflow `ci.yml` executa somente em `windows-latest`, com Node 22. Permanecem obrigatórios typecheck, lint, testes e build. O nome do check Windows permanece inalterado. A remoção se aplica aos PRs e aos pushes na main.

## Consequências

- macOS e Linux deixam de ter verificação de execução neste workflow; não declarar essas plataformas validadas pelo CI Windows.
- O código multiplataforma, os testes POSIX executáveis no Windows e o workflow de release são preservados.
- Se houver proteção de branch exigindo `check (macos-latest)`, será necessário ajustar essa regra para exigir somente o check Windows.
- Restaurar a validação macOS exige uma nova decisão; esta alteração não remove o suporte existente do aplicativo.
