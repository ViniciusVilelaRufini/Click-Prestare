# Evidência — Release, pipeline e recuperação

- Build web `portaria-web`: concluído com sucesso via `npm run build`.
- Build Android release: concluído com sucesso.
- Workflow CI executa lint, testes, build, typecheck e e2e no pull request/push
  para `main`.
- Workflow de migration exige arquivo selecionado por allowlist, usa secret
  `DATABASE_URL`, TLS e checksum.
- Backup/restauração RDS: **BLOQUEADO**; não foi feita operação AWS destrutiva
  nem restauração sem autorização/ambiente separado.
- Rollback de aplicação é possível por artefato/commit, mas rollback de schema
  precisa de procedimento aprovado por migration individual.

Pendência crítica: comprovar restauração de backup e executar o status das
migrations com o Prisma Schema Engine em ambiente operacional válido.
