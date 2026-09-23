# Evidência — Baseline do banco

## Resultado

Executado em modo somente leitura contra o RDS configurado, sem registrar a
URL ou qualquer dado pessoal.

```text
pessoas: 0
visitas: 0
legacyVisitantes: 0
acessosFacial: 0
visitasOrfas: 0
pessoaCondoMismatch: 0
aptoCondoMismatch: 0
pessoasOrfas: 0
activePinDuplicateGroups: 0
openExpired: 0
```

## Migration status

`prisma migrate status` conseguiu carregar o schema e identificar o banco, mas
terminou com `Schema engine error` sem diagnóstico adicional. Portanto, o
estado das migrations fica **BLOQUEADO** até ser executado em um ambiente com
o engine Prisma funcionando e permissões confirmadas.

O workflow de SQL existente restringe arquivos por allowlist, usa TLS e grava
checksum em `_schema_migrations`, mas não comprova backup/restauração antes da
execução.
