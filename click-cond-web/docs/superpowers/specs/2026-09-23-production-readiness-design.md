# Especificação — Prontidão para produção

## Objetivo

Preparar o Click Prestare para operação real com clientes, validando banco de
dados, API, sistema web, aplicativo, segurança, backup, deploy e rollback.

## Escopo

- Banco RDS MySQL e migrations Prisma.
- API NestJS e rotas de visitantes, moradores, unidades e acessos.
- Aplicativo Flutter e fluxos principais no emulador.
- Sistema web e controles de autorização multi-condomínio.
- GitHub Actions, variáveis de ambiente e versionamento de release.

## Critérios de sucesso

1. Migrations aplicam sem perda de dados em ambiente de homologação.
2. Consultas e mutações respeitam o condomínio e apartamento autorizados.
3. CPF, documentos, fotos, biometria, PINs e tokens não aparecem em respostas
   ou logs não autorizados.
4. Listagens são somente leitura e não criam credenciais ou alteram dados.
5. Fluxos críticos do app e web têm testes automatizados e smoke tests.
6. Backup e restauração são comprovados ou marcados explicitamente como
   bloqueio operacional quando não houver permissão AWS.
7. Existe procedimento reproduzível de deploy e rollback.

## Fases

### 1. Baseline e integridade

Registrar schema, migrations, contagens e inconsistências nas tabelas de
usuários, condomínios, apartamentos, pessoas, visitas e acessos.

### 2. Segurança e isolamento

Testar autorização por papel e por condomínio, sanitização de respostas,
logs, secrets, exposição de arquivos e limites de rede do RDS.

### 3. Fluxos de negócio

Executar testes de cadastro, edição, exclusão, aprovação, entrada, saída,
expiração e retenção de visitantes, moradores e unidades.

### 4. App e web

Executar suíte automatizada, build de release, smoke tests no emulador e
validação dos endpoints usados pelo sistema web.

### 5. Recuperação e entrega

Validar backup/restauração, migrations no pipeline, observabilidade, rollback,
artefatos versionados e checklist final de produção.

## Limitações e decisões

- Testes usarão dados sintéticos e não alterarão registros reais sem
  identificação e limpeza determinística.
- Sem permissão explícita para uma operação AWS destrutiva, restauração será
  apenas verificada por configuração e ficará marcada como pendência.
- A aprovação de produção exige que pendências críticas estejam resolvidas;
  resultados inconclusivos não serão tratados como aprovação.
