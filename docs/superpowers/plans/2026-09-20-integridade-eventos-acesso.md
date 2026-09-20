# Integridade dos eventos de acesso + base limpa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o banco garantir a integridade do log de acesso físico, e entregar a base limpa para o primeiro cliente real.

**Architecture:** Três frentes independentes. (1) Ferramenta de dados: scripts de dump e wipe, ambos com trava de confirmação. (2) Schema: DDL manual criando FK em `id_device`, trocando cascata por `RESTRICT` no histórico e adicionando o snapshot `nome_dispositivo`. (3) Código: um helper único de gravação de evento que deriva condomínio e nome do aparelho do próprio dispositivo, substituindo 16 `create` espalhados.

**Tech Stack:** NestJS + Prisma 6 (MySQL), Node 24 (`--env-file`), `mysql2/promise` para os scripts, Jest para os testes.

**Spec:** `docs/superpowers/specs/2026-09-20-integridade-eventos-acesso-design.md`

## Global Constraints

- Schema é SQL escrito à mão: **não existe `prisma/migrations/`** nem script de migração. Toda DDL vai em arquivo versionado sob `click-cond-web/prisma/sql/` e é aplicada manualmente pelo operador.
- `prisma/schema.prisma` deve refletir exatamente o banco após a DDL.
- `DATABASE_URL` do `click-cond-web/.env` aponta para **produção** (AWS RDS). Não existe banco local nem de staging.
- Nenhum script deste plano pode escrever no banco sem flag explícita de confirmação. O modo padrão de qualquer script destrutivo é dry-run.
- Nenhum push nem merge para `master`. O trabalho fica na branch `fix/integridade-dados`.
- Baseline de testes a preservar: **112 suites / 1037 testes** passando (`npx jest --config apps/api/jest.config.cts --forceExit`).
- Todos os caminhos de arquivo abaixo são relativos a `click-cond-web/` salvo indicação contrária.
- **Task 5 não é para subagente.** É operação destrutiva em produção, executada pelo controlador com confirmação do operador humano.

---

### Task 1: Script de dump completo

**Files:**
- Create: `click-cond-web/scripts/migration/dump-database.mjs`

**Interfaces:**
- Consumes: nada (primeira task)
- Produces: arquivo de dump em `backups/dump-YYYYMMDD-HHMMSS.json` e a função de contagem que a Task 2 usa para conferir o antes/depois. Invocação: `node --env-file=.env scripts/migration/dump-database.mjs`

O dump é pré-requisito de segurança da Task 5. Formato JSON (e não SQL) porque não há `mysqldump` garantido no ambiente Windows do operador, e porque o objetivo é restaurar dado, não recriar estrutura — a estrutura vive no `schema.prisma` e na DDL versionada.

- [ ] **Step 1: Escrever o script**

```javascript
/**
 * Dump completo do banco para arquivo JSON — SOMENTE LEITURA.
 *
 * Pré-requisito de segurança do wipe (wipe-test-data.mjs). Não recria
 * estrutura: a estrutura vive em prisma/schema.prisma e em prisma/sql/.
 * Este arquivo existe para poder devolver os DADOS se algo der errado.
 *
 * Uso: node --env-file=.env scripts/migration/dump-database.mjs
 */
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

function buildConfig() {
  const url = new URL(process.env.DATABASE_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
    connectTimeout: 20000,
  };
}

/** Conta linhas de cada tabela. Usado aqui e pelo wipe, para comparar antes/depois. */
export async function contarTodasAsTabelas(conn, database) {
  const [tabelas] = await conn.query(
    'SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ? AND table_type = "BASE TABLE" ORDER BY table_name',
    [database],
  );
  const contagens = {};
  for (const { t } of tabelas) {
    const [[row]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
    contagens[t] = row.n;
  }
  return contagens;
}

async function main() {
  const cfg = buildConfig();
  const conn = await mysql.createConnection(cfg);
  try {
    const contagens = await contarTodasAsTabelas(conn, cfg.database);
    const total = Object.values(contagens).reduce((a, b) => a + b, 0);
    console.log(`Tabelas: ${Object.keys(contagens).length} | linhas totais: ${total}`);

    const dados = {};
    for (const tabela of Object.keys(contagens)) {
      const [rows] = await conn.query(`SELECT * FROM \`${tabela}\``);
      dados[tabela] = rows;
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dir = path.resolve(process.cwd(), '..', 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const destino = path.join(dir, `dump-${stamp}.json`);
    fs.writeFileSync(destino, JSON.stringify({ geradoEm: new Date().toISOString(), contagens, dados }, null, 2));

    const bytes = fs.statSync(destino).size;
    console.log(`Dump salvo: ${destino} (${(bytes / 1024 / 1024).toFixed(2)} MB)`);

    // Trava de sanidade: dump vazio com banco cheio significa falha silenciosa.
    if (total > 0 && bytes < 1024) {
      console.error('Dump suspeito: banco tem linhas mas o arquivo saiu vazio.');
      process.exit(1);
    }
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error('Dump falhou:', e.message);
  process.exit(1);
});
```

- [ ] **Step 2: Verificar que o script roda e produz dump com conteúdo**

Run: `cd click-cond-web && node --env-file=.env scripts/migration/dump-database.mjs`
Expected: imprime contagem de tabelas e linhas, e o caminho do arquivo com tamanho > 0 MB. O arquivo existe em `backups/`.

- [ ] **Step 3: Verificar que `backups/` está fora do git**

Run: `cd .. && git check-ignore backups/ && echo IGNORADO || echo "PRECISA ADICIONAR"`
Expected: `IGNORADO`. Se imprimir `PRECISA ADICIONAR`, acrescente `backups/` ao `.gitignore` antes de commitar — o dump contém todos os dados do banco e nunca pode ser versionado.

- [ ] **Step 4: Commit**

```bash
git add click-cond-web/scripts/migration/dump-database.mjs .gitignore
git commit -m "feat(scripts): dump completo do banco em JSON antes do wipe"
```

---

### Task 2: Script de wipe com dry-run por padrão

**Files:**
- Create: `click-cond-web/scripts/migration/wipe-test-data.mjs`

**Interfaces:**
- Consumes: `contarTodasAsTabelas` de `dump-database.mjs` (Task 1)
- Produces: `node --env-file=.env scripts/migration/wipe-test-data.mjs` (dry-run) e `... --confirmo-apagar-tudo` (executa). A Task 5 chama as duas formas.

Apaga os dados de teste preservando `Users` (senão o operador perde o próprio login) e `Planos`. A ordem de exclusão respeita as FKs: filhos antes de pais.

- [ ] **Step 1: Escrever o script**

```javascript
/**
 * Apaga os dados de teste, preservando estrutura, Users e Planos.
 *
 * Modo padrão é DRY-RUN: lista o que seria apagado e não escreve nada.
 * Só apaga de verdade com --confirmo-apagar-tudo.
 *
 * Preserva Users porque apagar contas removeria o login do próprio operador.
 * Preserva Planos porque é tabela de catálogo, não dado de cliente.
 *
 * Uso:
 *   node --env-file=.env scripts/migration/wipe-test-data.mjs
 *   node --env-file=.env scripts/migration/wipe-test-data.mjs --confirmo-apagar-tudo
 */
import mysql from 'mysql2/promise';
import { contarTodasAsTabelas } from './dump-database.mjs';

const CONFIRMADO = process.argv.includes('--confirmo-apagar-tudo');

/** Tabelas que NÃO são apagadas. */
const PRESERVAR = new Set(['Users', 'Planos', '_prisma_migrations']);

function buildConfig() {
  const url = new URL(process.env.DATABASE_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
    connectTimeout: 20000,
  };
}

async function main() {
  const cfg = buildConfig();
  const conn = await mysql.createConnection(cfg);
  try {
    const antes = await contarTodasAsTabelas(conn, cfg.database);
    const alvo = Object.entries(antes).filter(([t, n]) => !PRESERVAR.has(t) && n > 0);
    const totalAlvo = alvo.reduce((a, [, n]) => a + n, 0);

    console.log(CONFIRMADO ? '=== APAGANDO ===' : '=== DRY-RUN (nada será apagado) ===');
    for (const [t, n] of alvo) console.log(`  ${t.padEnd(30)} ${String(n).padStart(8)} linhas`);
    console.log(`  ${'TOTAL'.padEnd(30)} ${String(totalAlvo).padStart(8)} linhas`);
    console.log('\nPreservadas:');
    for (const t of PRESERVAR) if (antes[t] !== undefined) console.log(`  ${t}: ${antes[t]} linhas`);

    if (!CONFIRMADO) {
      console.log('\nNada foi alterado. Para apagar de verdade, rode com --confirmo-apagar-tudo');
      return;
    }

    // FOREIGN_KEY_CHECKS=0 evita ter que descobrir a ordem topológica correta
    // das ~50 tabelas. Religado no finally, mesmo se algo falhar no meio.
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    try {
      for (const [t] of alvo) {
        await conn.query(`DELETE FROM \`${t}\``);
        await conn.query(`ALTER TABLE \`${t}\` AUTO_INCREMENT = 1`);
        console.log(`  apagada: ${t}`);
      }
    } finally {
      await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    }

    const depois = await contarTodasAsTabelas(conn, cfg.database);
    const restantes = Object.entries(depois).filter(([t, n]) => !PRESERVAR.has(t) && n > 0);
    if (restantes.length) {
      console.error('\nAINDA HÁ LINHAS:', restantes.map(([t, n]) => `${t}=${n}`).join(', '));
      process.exit(1);
    }
    console.log(`\nOK. Users preservados: ${depois['Users'] ?? 0}`);
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error('Wipe falhou:', e.message);
  process.exit(1);
});
```

- [ ] **Step 2: Rodar o dry-run e conferir que nada muda**

Run: `cd click-cond-web && node --env-file=.env scripts/migration/wipe-test-data.mjs`
Expected: lista as tabelas com linhas e o total, mostra `Users` na seção de preservadas, e termina com "Nada foi alterado".

- [ ] **Step 3: Confirmar que o dry-run realmente não escreveu**

Run: `node --env-file=.env scripts/migration/wipe-test-data.mjs | tail -20`
Expected: as mesmas contagens do Step 2. Se qualquer número caiu, o dry-run está escrevendo — defeito grave, corrija antes de seguir.

- [ ] **Step 4: Commit**

```bash
git add click-cond-web/scripts/migration/wipe-test-data.mjs
git commit -m "feat(scripts): wipe dos dados de teste com dry-run por padrao"
```

---

### Task 3: DDL das constraints + schema.prisma

**Files:**
- Create: `click-cond-web/prisma/sql/2026-09-20-integridade-acessos-facial.sql`
- Modify: `click-cond-web/prisma/schema.prisma` (modelos `Acessos_Facial` e `Facial_Devices`)

**Interfaces:**
- Consumes: nada
- Produces: campo `nome_dispositivo` e relação `dispositivo` no modelo `Acessos_Facial` — a Task 4 grava nos dois. O SQL é aplicado pelo operador na Task 5.

A DDL **não pode ser aplicada antes do wipe**: existem 185 eventos apontando para dispositivo inexistente e o MySQL recusaria criar a FK. Esta task só escreve os arquivos.

- [ ] **Step 1: Escrever a DDL**

```sql
-- Integridade do log de acesso físico.
-- Aplicar SOMENTE depois do wipe: a FK de id_device falha enquanto existirem
-- eventos apontando para dispositivo inexistente (eram 185 em 19/09/2026).

-- D1 — snapshot do aparelho na própria linha do evento, para o log continuar
-- legível se o dispositivo for removido depois. Mesmo padrão de nome_pessoa.
ALTER TABLE `Acessos_Facial`
  ADD COLUMN `nome_dispositivo` VARCHAR(100) NULL AFTER `tipo_dispositivo`;

-- D3 — o histórico deixa de ser destruído junto com o condomínio.
-- Remover um condomínio passa a exigir expurgo explícito do log antes.
ALTER TABLE `Acessos_Facial` DROP FOREIGN KEY `fk_acfac_cond`;
ALTER TABLE `Acessos_Facial`
  ADD CONSTRAINT `fk_acfac_cond` FOREIGN KEY (`id_condominio`)
  REFERENCES `Condominios` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- D2 — id_device deixa de ser um inteiro solto.
-- RESTRICT: apagar um terminal não pode apagar o histórico de quem passou por ele.
CREATE INDEX `idx_acfac_device` ON `Acessos_Facial` (`id_device`);
ALTER TABLE `Acessos_Facial`
  ADD CONSTRAINT `fk_acfac_device` FOREIGN KEY (`id_device`)
  REFERENCES `Facial_Devices` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 2: Refletir no `schema.prisma` — modelo `Acessos_Facial`**

No modelo `Acessos_Facial`, adicione o campo depois de `tipo_dispositivo`:

```prisma
  nome_dispositivo String?     @db.VarChar(100)
```

Troque a relação de condomínio (que hoje é `onDelete: Cascade`) e acrescente a de dispositivo:

```prisma
  condominio       Condominios    @relation(fields: [id_condominio], references: [id], onDelete: Restrict, map: "fk_acfac_cond")
  dispositivo      Facial_Devices @relation(fields: [id_device], references: [id], onDelete: Restrict, map: "fk_acfac_device")
```

E o índice novo, junto dos `@@index` existentes:

```prisma
  @@index([id_device], map: "idx_acfac_device")
```

- [ ] **Step 3: Refletir no `schema.prisma` — relação inversa em `Facial_Devices`**

O Prisma exige a relação dos dois lados. No modelo `Facial_Devices`, acrescente junto das outras listas de relação:

```prisma
  acessos          Acessos_Facial[]
```

- [ ] **Step 4: Validar o schema e regenerar o client**

Run: `cd click-cond-web && npx prisma validate --schema prisma/schema.prisma && npx prisma generate --schema prisma/schema.prisma`
Expected: `The schema at prisma/schema.prisma is valid` e geração concluída. Se `validate` reclamar de relação faltando, o Step 3 não foi aplicado.

- [ ] **Step 5: Confirmar que o tipo novo existe no client gerado**

Run: `grep -c "nome_dispositivo" apps/api/src/app/prisma/generated/index.d.ts`
Expected: número maior que 0. Se for 0, o `generate` não escreveu no diretório que a aplicação importa — confira o `output` configurado no `schema.prisma`.

- [ ] **Step 6: Confirmar que a suíte continua verde**

Run: `npx jest --config apps/api/jest.config.cts --forceExit --silent 2>&1 | grep -E "^Tests:|^Test Suites:"`
Expected: 112 suites / 1037 testes passando. O client regenerado não pode quebrar nada — ainda não mudamos comportamento.

- [ ] **Step 7: Commit**

```bash
git add click-cond-web/prisma/sql/2026-09-20-integridade-acessos-facial.sql click-cond-web/prisma/schema.prisma
git commit -m "feat(schema): FK em id_device, snapshot do dispositivo e RESTRICT no historico de acesso"
```

---

### Task 4: Helper único de gravação de evento

**Files:**
- Modify: `click-cond-web/apps/api/src/app/facial/facial.service.ts` (16 chamadas de `acessos_Facial.create`)
- Create: `click-cond-web/apps/api/src/app/facial/facial.registrar-evento.spec.ts`

**Interfaces:**
- Consumes: campo `nome_dispositivo` e relação `dispositivo` do `schema.prisma` (Task 3)
- Produces: método privado `registrarEvento(dispositivo, dados)` em `FacialService`

Hoje há 16 `acessos_Facial.create` espalhados. Todos derivam `id_condominio` de `device.id_condominio` — exceto que, no fluxo de caminho de acesso (`facial.service.ts:4124`), o evento grava `id_device: abertura.id` (o aparelho de **abertura**) junto de `id_condominio: device.id_condominio` (o **leitor**). São dois objetos diferentes; hoje coincidem porque ambos pertencem ao mesmo condomínio, mas a coerência é acidental. O helper elimina a possibilidade: condomínio e nome saem sempre do aparelho que está sendo gravado.

- [ ] **Step 1: Escrever o teste que falha**

```typescript
import { FacialService } from './facial.service';

describe('FacialService.registrarEvento — coerência dispositivo↔condomínio', () => {
  function build() {
    const criados: any[] = [];
    const prisma: any = {
      isConnected: true,
      acessos_Facial: {
        create: jest.fn(async ({ data }: any) => {
          criados.push(data);
          return { id: criados.length, ...data };
        }),
      },
    };
    // O construtor tem 10 parâmetros, nessa ordem: prisma, client,
    // notifications, enrollSessions, auditoria, accessState, agent, tenant,
    // consentimentos, consentimentosTerceiros. registrarEvento só usa o prisma.
    const svc = new FacialService(
      prisma,
      null as any, null as any, null as any, null as any,
      null as any, null as any, null as any, null as any, null as any,
    );
    return { svc, prisma, criados };
  }

  const leitor = { id: 6, id_condominio: 1, tipo: 'facial', nome: 'Portaria Principal' };
  const abertura = { id: 9, id_condominio: 2, tipo: 'rele', nome: 'Portão Social' };

  it('grava o condomínio DO APARELHO registrado, não o de quem chamou', async () => {
    const { svc, criados } = build();

    // Caminho de acesso: o leitor (cond 1) aciona uma abertura (cond 2).
    // O evento é sobre a ABERTURA, então tem de registrar o condomínio dela.
    await (svc as any).registrarEvento(abertura, {
      face_id: 'morador_10',
      tipo_pessoa: 'morador',
      id_pessoa: 10,
      nome_pessoa: 'Fulano',
      evento: 'entrada',
    });

    expect(criados[0].id_device).toBe(9);
    expect(criados[0].id_condominio).toBe(2);
  });

  it('preenche nome_dispositivo com o nome do aparelho', async () => {
    const { svc, criados } = build();

    await (svc as any).registrarEvento(leitor, {
      face_id: 'trigger_manual',
      tipo_pessoa: 'operador',
      nome_pessoa: 'Operador',
      evento: 'acionado_manual',
    });

    expect(criados[0].nome_dispositivo).toBe('Portaria Principal');
    expect(criados[0].tipo_dispositivo).toBe('facial');
  });

  it('usa null para id_pessoa e confianca quando não informados', async () => {
    const { svc, criados } = build();

    await (svc as any).registrarEvento(leitor, {
      face_id: 'desconhecido',
      tipo_pessoa: 'desconhecido',
      nome_pessoa: 'Não identificado',
      evento: 'negado',
    });

    expect(criados[0].id_pessoa).toBeNull();
    expect(criados[0].confianca).toBeNull();
    expect(criados[0].timestamp).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd click-cond-web && npx jest --config apps/api/jest.config.cts --testPathPatterns "facial.registrar-evento" --forceExit`
Expected: FAIL com `svc.registrarEvento is not a function`.

- [ ] **Step 3: Implementar o helper**

Em `facial.service.ts`, acrescente o método privado (junto dos outros privados da classe):

```typescript
  /**
   * Único ponto de gravação de evento de acesso.
   *
   * Deriva id_condominio, tipo e nome DO APARELHO que está sendo registrado,
   * em vez de aceitar do chamador. Antes disto, o fluxo de caminho de acesso
   * gravava id_device da ABERTURA junto de id_condominio do LEITOR — dois
   * objetos distintos, coerentes só porque pertenciam ao mesmo condomínio.
   *
   * nome_dispositivo é snapshot, mesmo papel de nome_pessoa: mantém o log
   * legível depois que o aparelho for removido.
   */
  private async registrarEvento(
    dispositivo: { id: number; id_condominio: number; tipo: string; nome: string },
    dados: {
      face_id: string;
      tipo_pessoa: string;
      id_pessoa?: number | null;
      nome_pessoa: string;
      evento: string;
      confianca?: number | null;
      timestamp?: Date;
    },
  ) {
    return this.prisma.acessos_Facial.create({
      data: {
        id_condominio: dispositivo.id_condominio,
        id_device: dispositivo.id,
        tipo_dispositivo: dispositivo.tipo,
        nome_dispositivo: dispositivo.nome,
        face_id: dados.face_id,
        tipo_pessoa: dados.tipo_pessoa,
        id_pessoa: dados.id_pessoa ?? null,
        nome_pessoa: dados.nome_pessoa,
        evento: dados.evento,
        confianca: dados.confianca ?? null,
        timestamp: dados.timestamp ?? new Date(),
      },
    });
  }
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx jest --config apps/api/jest.config.cts --testPathPatterns "facial.registrar-evento" --forceExit`
Expected: 3 testes passando.

- [ ] **Step 5: Migrar as 16 chamadas para o helper**

Substitua cada `await this.prisma.acessos_Facial.create({ data: {...} })` em `facial.service.ts` por uma chamada a `this.registrarEvento(<aparelho>, {...})`, removendo `id_condominio`, `id_device`, `tipo_dispositivo` e `nome_dispositivo` do objeto (o helper preenche os quatro).

O `<aparelho>` é o dispositivo que o evento descreve — em 15 dos 16 casos é `device`; na chamada da linha ~4124 (laço `for (const abertura of aberturasParaAcionar)`) é **`abertura`**, não `device`. Esse é o ponto que motivou a task.

Exemplo, a chamada de acionamento manual:

```typescript
    // ANTES
    await this.prisma.acessos_Facial.create({
      data: {
        id_condominio: device.id_condominio,
        id_device: device.id,
        tipo_dispositivo: device.tipo,
        face_id: 'trigger_manual',
        tipo_pessoa: 'operador',
        id_pessoa: operador?.sub ?? null,
        nome_pessoa: result.ok ? nomeOperador : `${nomeOperador} (FALHA)`,
        evento: result.ok ? 'acionado_manual' : 'falha_acionamento',
        timestamp: new Date(),
      },
    });

    // DEPOIS
    await this.registrarEvento(device, {
      face_id: 'trigger_manual',
      tipo_pessoa: 'operador',
      id_pessoa: operador?.sub ?? null,
      nome_pessoa: result.ok ? nomeOperador : `${nomeOperador} (FALHA)`,
      evento: result.ok ? 'acionado_manual' : 'falha_acionamento',
    });
```

- [ ] **Step 6: Confirmar que não sobrou nenhuma gravação direta**

Run: `grep -c "prisma.acessos_Facial.create" apps/api/src/app/facial/facial.service.ts`
Expected: `1` — apenas a de dentro do próprio `registrarEvento`.

- [ ] **Step 7: Rodar a suíte inteira**

Run: `npx jest --config apps/api/jest.config.cts --forceExit --silent 2>&1 | grep -E "^Tests:|^Test Suites:|✕"`
Expected: 113 suites / 1040 testes passando (baseline 112/1037 mais a suite nova com 3 testes). Nenhum `✕`.

Se algum teste existente de facial quebrar, é porque ele afirmava sobre o formato do `create` — atualize a afirmação para o novo formato, não o helper.

- [ ] **Step 8: Typecheck**

Run: `npx tsc -p apps/api/tsconfig.app.json --noEmit`
Expected: sem saída (exit 0).

- [ ] **Step 9: Commit**

```bash
git add click-cond-web/apps/api/src/app/facial/facial.service.ts click-cond-web/apps/api/src/app/facial/facial.registrar-evento.spec.ts
git commit -m "refactor(facial): helper unico de evento derivando condominio e nome do aparelho"
```

---

### Task 5: Executar dump, wipe e DDL em produção

> **Esta task NÃO vai para subagente.** É destrutiva e irreversível em banco de produção. Executada pelo controlador, com confirmação explícita do operador humano imediatamente antes do passo destrutivo.

**Files:** nenhum (operação)

**Interfaces:**
- Consumes: `dump-database.mjs` (Task 1), `wipe-test-data.mjs` (Task 2), o `.sql` (Task 3)
- Produces: banco vazio com as constraints aplicadas

- [ ] **Step 1: Dump**

Run: `cd click-cond-web && node --env-file=.env scripts/migration/dump-database.mjs`
Expected: arquivo em `backups/` com tamanho > 0. **Anote o caminho e o total de linhas.**

- [ ] **Step 2: Conferir o dump antes de apagar qualquer coisa**

Run: `node -e "const fs=require('fs'),p=require('path');const d='../backups';const f=fs.readdirSync(d).filter(x=>x.startsWith('dump-')).sort().pop();const j=JSON.parse(fs.readFileSync(p.join(d,f),'utf8'));console.log('arquivo:',f);console.log('tabelas:',Object.keys(j.dados).length,'| Acessos_Facial:',j.dados.Acessos_Facial?.length,'| Visitantes:',j.dados.Visitantes?.length,'| Users:',j.dados.Users?.length)"`
Expected: os números batem com o panorama da auditoria (472 eventos, 94 visitantes) e `Users` > 0. Se não baterem, **pare** — o dump está incompleto e o wipe não pode acontecer.

- [ ] **Step 3: Dry-run do wipe**

Run: `node --env-file=.env scripts/migration/wipe-test-data.mjs`
Expected: lista das tabelas e total. Conferir que `Users` aparece em "Preservadas".

- [ ] **Step 4: PARAR e pedir confirmação ao operador humano**

Apresente: caminho do dump, total de linhas que serão apagadas, e a lista de tabelas preservadas. Só prossiga com um "sim" explícito.

- [ ] **Step 5: Wipe**

Run: `node --env-file=.env scripts/migration/wipe-test-data.mjs --confirmo-apagar-tudo`
Expected: cada tabela apagada, e ao final `OK. Users preservados: <n>` com n > 0.

- [ ] **Step 6: Aplicar a DDL**

Run: `node --env-file=.env -e "const m=require('mysql2/promise'),fs=require('fs');(async()=>{const u=new URL(process.env.DATABASE_URL);const c=await m.createConnection({host:u.hostname,port:+u.port||3306,user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),database:u.pathname.slice(1),multipleStatements:true});const sql=fs.readFileSync('prisma/sql/2026-09-20-integridade-acessos-facial.sql','utf8');await c.query(sql);console.log('DDL aplicada');await c.end();})()"`
Expected: `DDL aplicada`, sem erro.

- [ ] **Step 7: Verificar que as constraints existem de fato**

Run: `node --env-file=.env -e "const m=require('mysql2/promise');(async()=>{const u=new URL(process.env.DATABASE_URL);const c=await m.createConnection({host:u.hostname,port:+u.port||3306,user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),database:u.pathname.slice(1)});const [r]=await c.query(\"SELECT CONSTRAINT_NAME,DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='Acessos_Facial'\");console.table(r);const [[col]]=await c.query(\"SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Acessos_Facial' AND COLUMN_NAME='nome_dispositivo'\");console.log('coluna nome_dispositivo:',col.n);await c.end();})()"`
Expected: `fk_acfac_cond` e `fk_acfac_device` ambas com `DELETE_RULE = RESTRICT`, e `coluna nome_dispositivo: 1`.

---

## Verificação final

Rodar depois da Task 5, contra o banco já migrado:

- [ ] `npx jest --config apps/api/jest.config.cts --forceExit` → 113 suites / 1040 testes
- [ ] `npx tsc -p apps/api/tsconfig.app.json --noEmit` → exit 0
- [ ] `node --env-file=.env scripts/migration/audit-integridade-dados.mjs` → base vazia, nenhuma inconsistência
