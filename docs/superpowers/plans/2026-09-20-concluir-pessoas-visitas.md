# Concluir a migração Pessoas + Visitas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Terminar a migração de `Visitantes` para `Pessoas` + `Visitas`, deixando uma fonte única de identidade e ligando a flag com segurança.

**Architecture:** A Fase 0 já estabilizou o estado meio-migrado: o caminho novo está atrás de `PESSOAS_MIGRATION_ENABLED` (default off), as rotas novas exigem operador, os DTOs validam. Falta criar as tabelas, migrar as escritas, ensinar o facial a falar `pessoa_`, e só então ligar a flag.

**Tech Stack:** NestJS + Prisma 6 (MySQL), Node 24 (`--env-file`), Jest com `--forceExit`.

**Spec:** `docs/superpowers/specs/2026-09-19-pessoas-visitas-design.md` (do autor) + os achados da revisão de 2026-09-20 registrados em `.superpowers/sdd/2026-09-19-pessoas-visitas/progress.md`

## Contexto que muda o trabalho

**`Visitantes` tem 0 linhas.** A base foi zerada no sub-projeto 1. Consequências:

- **Não há backfill.** O item que seria o maior risco (reconciliar dados antigos aplicando a heurística de identidade) simplesmente não existe.
- As regras de identidade perdidas (fusão por `face_id`, foto, nome) só importam para cadastros **futuros** — e só a de `face_id` vale recuperar.
- Qualquer tabela nova nasce vazia, então constraints podem ser criadas sem conflito de dados.

## Global Constraints

- Schema é SQL escrito à mão em `click-cond-web/prisma/sql/`, aplicado manualmente. Não existe `prisma/migrations/` — não criar.
- `DATABASE_URL` aponta para **produção** (AWS RDS). Não há banco local nem staging.
- `PESSOAS_MIGRATION_ENABLED` permanece **desligada** até a Task 8. Nenhuma task antes dela pode ligá-la.
- `npx tsc -p apps/api/tsconfig.app.json --noEmit` deve sair com **zero** erros ao fim de cada task.
- Baseline: **124 suites / 1105 testes**. Rodar com `--forceExit`.
- Nenhum push, nenhum merge. Branch `fix/integridade-dados`.
- Caminhos relativos a `click-cond-web/` salvo indicação contrária.
- **A ordem Task 7 → Task 8 é obrigatória.** Ligar a flag antes de o facial entender `pessoa_` coloca rostos num terminal que nem o log de acesso nem a varredura de fantasmas sabem interpretar.

---

### Task 1: SQL das tabelas + alinhar o schema

**Files:**
- Create: `prisma/sql/2026-09-20-pessoas-visitas.sql`
- Modify: `prisma/schema.prisma` (models `Pessoas`, `Visitas`, `Vagas`)

**Interfaces:**
- Produces: tabelas `pessoas`, `visitas`, coluna `Vagas.id_visita` — tudo que as tasks seguintes consomem.

A revisão apontou três correções a embutir agora, antes de existir qualquer dado: `@@unique` no par condomínio+documento (sem ele, `obterOuCriar` é uma corrida e a tabela cuja razão de existir é "uma linha por humano" não garante isso), `Visitas → Apartamentos` como `RESTRICT` (hoje `Cascade` apagaria histórico de visita junto com o apartamento, incoerente com as FKs `RESTRICT` que o sub-projeto 1 criou), e a coluna `Vagas.id_visita` que o código já lê e que não existe no banco.

- [ ] **Step 1: Escrever a DDL**

```sql
-- Pessoas + Visitas: identidade separada da autorizacao.
-- Aplicar com a base vazia (Visitantes tem 0 linhas apos o wipe de 2026-09-20).

CREATE TABLE `pessoas` (
  `id`                INT NOT NULL AUTO_INCREMENT,
  `id_condominio`     INT NOT NULL,
  `nome`              VARCHAR(255) NOT NULL,
  `doc_identificacao` VARCHAR(50) NULL,
  `telefone`          VARCHAR(50) NULL,
  `foto_pessoa`       LONGTEXT NULL,
  `foto_documento`    LONGTEXT NULL,
  `tipo_pessoa`       VARCHAR(20) NOT NULL DEFAULT 'visitante',
  `face_id`           VARCHAR(100) NULL,
  `face_enrolled_at`  DATETIME NULL,
  `face_sync_status`  VARCHAR(20) NULL,
  `face_sync_error`   VARCHAR(500) NULL,
  `bloqueado`         TINYINT NOT NULL DEFAULT 0,
  `created_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  -- Garante "uma linha por humano por condominio". Sem isto, dois POST
  -- simultaneos do mesmo CPF criam duas Pessoas e o terminal ganha dois rostos.
  UNIQUE KEY `uq_pes_cond_doc` (`id_condominio`, `doc_identificacao`),
  KEY `idx_pes_cond` (`id_condominio`),
  KEY `idx_pes_cond_nome` (`id_condominio`, `nome`),
  CONSTRAINT `fk_pes_cond` FOREIGN KEY (`id_condominio`) REFERENCES `Condominios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `visitas` (
  `id`                  INT NOT NULL AUTO_INCREMENT,
  `id_pessoa`           INT NOT NULL,
  `id_condominio`       INT NOT NULL,
  `id_apartamento`      INT NOT NULL,
  `user`                INT NULL,
  `is_visitante`        TINYINT NOT NULL DEFAULT 1,
  `is_prestador`        TINYINT NOT NULL DEFAULT 0,
  `data_hora_inicio`    DATETIME NULL,
  `data_hora_termino`   DATETIME NULL,
  `data_entrada`        DATETIME NULL,
  `data_saida`          DATETIME NULL,
  `codigo_acesso`       VARCHAR(50) NULL,
  `liberado`            TINYINT NOT NULL DEFAULT 1,
  `bloqueado`           TINYINT NOT NULL DEFAULT 0,
  `avisar`              TINYINT NOT NULL DEFAULT 1,
  `tag_rfid`            VARCHAR(50) NULL,
  `dias_semana`         VARCHAR(100) NULL,
  `categorias`          VARCHAR(500) NULL,
  `auth_status`         VARCHAR(20) NULL,
  `auth_solicitado_em`  DATETIME NULL,
  `auth_respondido_em`  DATETIME NULL,
  `auth_respondido_por` INT NULL,
  `created_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_visita_pessoa` (`id_pessoa`),
  KEY `idx_visita_cond_entrada` (`id_condominio`, `data_entrada`),
  KEY `idx_visita_apto` (`id_apartamento`),
  KEY `idx_visita_cond_pin` (`id_condominio`, `codigo_acesso`),
  KEY `fk_visita_user` (`user`),
  CONSTRAINT `fk_visita_pessoa` FOREIGN KEY (`id_pessoa`) REFERENCES `pessoas` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_visita_cond` FOREIGN KEY (`id_condominio`) REFERENCES `Condominios` (`id`) ON DELETE CASCADE,
  -- RESTRICT e nao CASCADE: historico de visita e registro de acesso fisico,
  -- nao pode sumir junto com o apartamento. Coerente com as FKs de Acessos_Facial.
  CONSTRAINT `fk_visita_apto` FOREIGN KEY (`id_apartamento`) REFERENCES `Apartamentos` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_visita_user` FOREIGN KEY (`user`) REFERENCES `Users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Vagas passa a poder referenciar uma visita. O codigo ja le esta coluna
-- (visitas.service.ts, visitantes.service.ts); sem ela, qualquer SELECT em
-- Vagas falha com Unknown column assim que o schema Prisma a declara.
ALTER TABLE `Vagas`
  ADD COLUMN `id_visita` INT NULL AFTER `id_visitante`,
  ADD KEY `fk_vaga_visita` (`id_visita`),
  ADD CONSTRAINT `fk_vaga_visita` FOREIGN KEY (`id_visita`) REFERENCES `visitas` (`id`) ON DELETE SET NULL;
```

- [ ] **Step 2: Alinhar `schema.prisma`**

No model `Pessoas`, trocar o índice do par documento por unicidade:

```prisma
  @@unique([id_condominio, doc_identificacao], map: "uq_pes_cond_doc")
```

removendo o `@@index([id_condominio, doc_identificacao], map: "idx_pes_cond_doc")` que existe hoje.

No model `Visitas`, trocar o `onDelete` do apartamento:

```prisma
  apartamento        Apartamentos @relation(fields: [id_apartamento], references: [id], onDelete: Restrict, map: "fk_visita_apto")
```

- [ ] **Step 3: Validar e regenerar**

Run: `npx prisma validate --schema prisma/schema.prisma && npx prisma generate --schema prisma/schema.prisma`
Expected: schema válido, geração concluída.

- [ ] **Step 4: Aplicar a DDL em produção**

Run: `node --env-file=.env -e "const m=require('mysql2/promise'),fs=require('fs');(async()=>{const u=new URL(process.env.DATABASE_URL);const c=await m.createConnection({host:u.hostname,port:+u.port||3306,user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),database:u.pathname.slice(1),multipleStatements:true});await c.query(fs.readFileSync('prisma/sql/2026-09-20-pessoas-visitas.sql','utf8'));console.log('DDL aplicada');await c.end();})().catch(e=>{console.error('FALHOU:',e.message);process.exit(1)})"`
Expected: `DDL aplicada`.

- [ ] **Step 5: Verificar no banco**

Run: `node --env-file=.env -e "const m=require('mysql2/promise');(async()=>{const u=new URL(process.env.DATABASE_URL);const c=await m.createConnection({host:u.hostname,port:+u.port||3306,user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),database:u.pathname.slice(1)});const [t]=await c.query(\"SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('pessoas','visitas')\");console.log('tabelas:',t.map(x=>x.TABLE_NAME).join(', '));const [v]=await c.query(\"SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Vagas' AND COLUMN_NAME='id_visita'\");console.log('Vagas.id_visita:',v[0].n);const [u2]=await c.query(\"SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pessoas' AND CONSTRAINT_TYPE='UNIQUE'\");console.log('unique em pessoas:',u2.map(x=>x.CONSTRAINT_NAME).join(', '));const [fk]=await c.query(\"SELECT CONSTRAINT_NAME,DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='visitas'\");console.table(fk);await c.end();})().catch(e=>{console.error(e.message);process.exit(1)})"`
Expected: as duas tabelas, `Vagas.id_visita: 1`, `uq_pes_cond_doc`, e `fk_visita_apto` com `DELETE_RULE = RESTRICT`.

- [ ] **Step 6: Suíte e typecheck**

Run: `npx jest --config apps/api/jest.config.cts --forceExit --silent 2>&1 | grep -E "^Tests:|^Test Suites:" && npx tsc -p apps/api/tsconfig.app.json --noEmit`
Expected: 124 suites / 1105 testes; typecheck sem saída.

- [ ] **Step 7: Commit**

```bash
git add click-cond-web/prisma/sql/2026-09-20-pessoas-visitas.sql click-cond-web/prisma/schema.prisma
git commit -m "feat(schema): cria pessoas e visitas com unique de documento e RESTRICT no apartamento"
```

---

### Task 2: Corrigir busca e recuperar a fusão por face_id

**Files:**
- Modify: `apps/api/src/app/pessoas/pessoas.service.ts`
- Test: `apps/api/src/app/pessoas/pessoas.identidade.spec.ts` (criar)

**Interfaces:**
- Consumes: `@@unique([id_condominio, doc_identificacao])` da Task 1
- Produces: `obterOuCriar` com fusão por documento **e** por `face_id`

Dois achados da revisão. O primeiro: `buscarPessoas` usa `contains` (vira `LIKE '%x%'`), que o MySQL não serve por índice — o teto de escala saiu do Node e foi para o banco, não sumiu. Para documento a comparação correta é igualdade sobre o valor normalizado.

O segundo é o que mais importa: a heurística antiga fundia pessoas por documento **ou face_id** (entre outras chaves). `obterOuCriar` só usa documento. Visitante sem CPF — que o sistema aceita — vira pessoa nova a cada visita, e o terminal ganha duas faces do mesmo ser humano. É exatamente o problema que a migração existia para resolver.

- [ ] **Step 1: Escrever o teste que falha**

```typescript
import { PessoasService } from './pessoas.service';

describe('PessoasService.obterOuCriar — fusão de identidade', () => {
  function build(existentes: any[] = []) {
    const criados: any[] = [];
    const prisma: any = {
      pessoas: {
        findFirst: jest.fn(async ({ where }: any) => {
          return (
            existentes.find((p) => {
              if (p.id_condominio !== where.id_condominio) return false;
              if (where.doc_identificacao) return p.doc_identificacao === where.doc_identificacao;
              if (where.face_id) return p.face_id === where.face_id;
              return false;
            }) ?? null
          );
        }),
        create: jest.fn(async ({ data }: any) => {
          const novo = { id: 100 + criados.length, ...data };
          criados.push(novo);
          return novo;
        }),
        update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
      },
    };
    return { svc: new PessoasService(prisma), prisma, criados };
  }

  it('reaproveita a pessoa quando o face_id bate, mesmo sem documento', async () => {
    const existente = { id: 7, id_condominio: 1, nome: 'Rodrigo', doc_identificacao: null, face_id: 'face-abc' };
    const { svc, prisma } = build([existente]);

    const r = await svc.obterOuCriar(1, { nome: 'Rodrigo Silva', face_id: 'face-abc' } as any);

    expect(r.id).toBe(7);
    expect(prisma.pessoas.create).not.toHaveBeenCalled();
  });

  it('cria pessoa nova quando não há documento nem face_id que batam', async () => {
    const { svc, prisma } = build([]);

    await svc.obterOuCriar(1, { nome: 'Alguém Novo' } as any);

    expect(prisma.pessoas.create).toHaveBeenCalledTimes(1);
  });

  it('o documento continua tendo precedência sobre o face_id', async () => {
    const porDoc = { id: 3, id_condominio: 1, nome: 'Ana', doc_identificacao: '11122233344', face_id: 'face-ana' };
    const porFace = { id: 9, id_condominio: 1, nome: 'Outro', doc_identificacao: null, face_id: 'face-x' };
    const { svc } = build([porDoc, porFace]);

    const r = await svc.obterOuCriar(1, {
      nome: 'Ana',
      doc_identificacao: '111.222.333-44',
      face_id: 'face-x',
    } as any);

    expect(r.id).toBe(3);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx jest --config apps/api/jest.config.cts --testPathPatterns "pessoas.identidade" --forceExit`
Expected: FAIL no primeiro teste — hoje `obterOuCriar` só procura por documento, então cria em vez de reaproveitar.

- [ ] **Step 3: Implementar a fusão por face_id**

Em `obterOuCriar`, depois da tentativa por documento e antes do `create`, acrescentar a tentativa por `face_id`:

```typescript
    // Regra herdada da heuristica antiga de agrupamento: mesmo rosto = mesma
    // pessoa. Sem isto, visitante sem CPF (o sistema aceita) vira uma Pessoa
    // nova a cada visita e o terminal acumula varias faces do mesmo humano —
    // o problema que esta migracao existe para resolver.
    if (!encontrada && dto.face_id) {
      encontrada = await this.prisma.pessoas.findFirst({
        where: { id_condominio: idCondominio, face_id: dto.face_id },
      });
    }
```

(adaptar o nome da variável ao que já existe no método — leia antes de editar)

- [ ] **Step 4: Trocar `contains` por igualdade no documento**

Em `buscarPessoas`, o filtro de documento passa a comparar o valor normalizado por igualdade (`equals`), e o nome passa a usar `startsWith`. Manter o comportamento de busca vazia.

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npx jest --config apps/api/jest.config.cts --testPathPatterns "pessoas" --forceExit`
Expected: os 3 testes novos passando, e os existentes de `pessoas` continuando verdes.

- [ ] **Step 6: Suíte inteira e typecheck**

Run: `npx jest --config apps/api/jest.config.cts --forceExit --silent 2>&1 | grep -E "^Tests:|^Test Suites:" && npx tsc -p apps/api/tsconfig.app.json --noEmit`
Expected: 124 suites / 1108 testes (baseline + 3); typecheck limpo.

- [ ] **Step 7: Commit**

```bash
git add click-cond-web/apps/api/src/app/pessoas/
git commit -m "feat(pessoas): funde identidade por face_id e corrige busca por documento"
```

---

---

### Task 3: Migrar create() para Pessoas/Visitas (Concluída no commit a6311c9b)

### Task 4: Migrar update, remove, removerPessoa, atualizarPessoa (Concluída nos commits 617f25e1 e 03dd212a)

---

### Task 5: Migrar caminhos de estado e leituras em VisitantesService

**Files:**
- Modify: `apps/api/src/app/visitantes/visitantes.service.ts`
- Test: `apps/api/src/app/visitantes/visitantes.state-surface.pessoas-visitas.spec.ts` (criar)

**Interfaces:**
- Consumes: `assertPodeAcessarVisita`, `mapVisitaParaRespostaLegada`, `prisma.visitas`, `prisma.pessoas`
- Produces: Delegação completa de `checkIn`, `liberarAcesso`, `checkOut`, `solicitarAutorizacao`, `autorizar`, `negar`, `validarCodigo`, `findOne`, `detalhes`, `findAll`, `findAllMobile`, `listarPendentes` quando `pessoasMigrationEnabled() === true`.

**Requisitos específicos:**
1. `checkIn`:
   - Quando flag ativa, usa `assertPodeAcessarVisita(id, payload)`.
   - Atualiza `visitas`: `data_entrada: new Date()`, `data_saida: null`, `liberado: 1`, `user: payload?.sub`. Se `auth_status === 'pendente'`, marca como `autorizado`.
   - Dispara `facial.syncPessoa(v.id_pessoa)` e auditoria `CHECK_IN`.
2. `liberarAcesso`:
   - Usa `assertPodeAcessarVisita(id, payload)`.
   - Atualiza `visitas`: `liberado: 1`, `data_entrada: null`, `data_saida: null`.
   - Desativa outros códigos para a mesma pessoa/visita.
   - Dispara `facial.syncPessoa(v.id_pessoa)` e auditoria.
3. `checkOut`:
   - Usa `assertPodeAcessarVisita(id, payload)`.
   - Atualiza `visitas`: `data_saida: new Date()`, `codigo_acesso: null`, `liberado: ref.is_prestador === 1 ? 1 : 0`, `auth_status: null`.
   - Libera vagas de garagem vinculadas à visita (`prisma.vagas.updateMany({ where: { id_visita: v.id }, data: { ocupada: 0, id_visita: null, placa: null } })`).
   - Dispara `facial.syncPessoa(v.id_pessoa)` e auditoria `CHECK_OUT`.
4. `solicitarAutorizacao`, `autorizar`, `negar`:
   - Usam `assertPodeAcessarVisita`.
   - Atualizam `visitas`: `auth_status`, `auth_solicitado_em` / `auth_respondido_em`, `auth_respondido_por`.
   - Disparam eventos realtime e `facial.syncPessoa(v.id_pessoa)`.
5. `validarCodigo`:
   - Busca em `prisma.visitas` com include `pessoa`, `apartamento`, `criadoPor`.
   - Verifica período de validade, tolerância e dias de semana.
   - Retorna formato compatível (LGPD sanitizado).
6. `findOne`, `detalhes`, `findAll`, `findAllMobile`, `listarPendentes`:
   - Buscam em `visitas` + `pessoa` e formatam via `mapVisitaParaRespostaLegada()`.

---

### Task 6: Hardware Facial: Suporte a pessoa_ e Proteção contra Fantasmas

**Files:**
- Modify: `apps/api/src/app/facial/facial.service.ts`
- Modify: `apps/api/src/app/facial/facial-device-client.service.ts`
- Test: `apps/api/src/app/facial/parse-external-id.spec.ts`
- Test: `apps/api/src/app/facial/tick-fantasmas.spec.ts`

**Requisitos específicos:**
1. `facial-device-client.service.ts`:
   - `NOSSO_EXTERNAL_ID`: atualizar regex para `/^(morador|visitante|prestador_servico|pessoa)_\d+$/`.
2. `facial.service.ts`:
   - `parseExternalId`: aceitar `/^(morador|visitante|prestador_servico|pessoa)_(\d+)$/`.
   - No tratamento de eventos por `externalId`: quando `parsed.tipo === 'pessoa'`, buscar `this.prisma.pessoas.findUnique({ where: { id: parsed.id } })` e mapear `idPessoa`, `tipoPessoa`, `nomePessoa`.
   - No fallback por `face_id`: incluir busca em `this.prisma.pessoas.findFirst({ where: { face_id: externalId, id_condominio: device.id_condominio } })`.
   - `tickFantasmas`: incluir `this.prisma.pessoas.findMany({ where: { id_condominio: device.id_condominio, face_id: { in: idsNoAparelho } }, select: { face_id: true } })` em `idsNoBanco`. Garante que biometria de pessoas migradas nunca seja removida como fantasma.
   - `syncVisitante`: quando `pessoasMigrationEnabled()`, resolver a `pessoa` vinculada à visita e chamar `syncPessoa`.

---

### Task 7: Virar a chave da flag PESSOAS_MIGRATION_ENABLED=true e Validação Global

**Files:**
- Modify: `click-cond-web/.env`
- Modify: `click-cond-web/.env.example`

**Requisitos específicos:**
1. Set `PESSOAS_MIGRATION_ENABLED=true`.
2. Rodar bateria completa de testes Jest da API (`npx jest --config apps/api/jest.config.cts --forceExit`).
3. Rodar checagem de tipos TypeScript (`npx tsc -p apps/api/tsconfig.app.json --noEmit`).
4. Rodar testes do Flutter app mobile (`flutter test` no diretório do app) se houver testes.
5. Garantir zero quebras e zero regressões.

---

### Task 8: Code Review Final, Merge e Deploy

1. Revisão completa do diff contra master (`git diff master..HEAD`).
2. Checkout da branch `master`, merge de `fix/integridade-dados`.
3. `git push origin master` disparando GitHub Actions CI/CD e deploy no Elastic Beanstalk.
4. Monitorar build e status do ambiente.

