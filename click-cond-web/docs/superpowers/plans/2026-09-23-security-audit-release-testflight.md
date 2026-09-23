# Plano de auditoria de segurança e release TestFlight

Objetivo: corrigir os achados reproduzidos na API de visitantes, validar as superfícies de app/web e publicar a versão iOS pelo workflow existente do GitHub Actions.

## Gates

- Fixtures somente sintéticas e removidas ao final.
- Nenhum segredo, PII, token, PIN ou URL com credencial em commits/logs.
- Testes de regressão RED antes da correção e GREEN depois.
- API validada com `PESSOAS_MIGRATION_ENABLED=true` e `false`.
- Flutter test/build e typecheck executados antes do push.
- TestFlight somente pelo workflow macOS existente, com secrets do GitHub.

## Tarefas executadas

1. Auditar listagens e check-in de visitantes; impedir PIN em respostas de leitura e rejeitar autorizações expiradas.
2. Proteger a expurgação LGPD contra corrida entre seleção e substituição de fotos.
3. Adicionar testes de regressão e executar as suítes API nos dois modos de migração.
4. Validar Flutter, build Android release e metadados de versão.
5. Publicar `master` e disparar `ios-release.yml` para TestFlight.

## Critério de conclusão

Código, testes e documentação commitados em `master`; workflow de TestFlight concluído com sucesso ou reportado explicitamente como pendente/falho, sem afirmar disponibilidade na loja antes da confirmação da Action.
