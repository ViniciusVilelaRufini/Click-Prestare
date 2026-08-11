# Roadmap de Escalabilidade — Click Condomínios

## Estado atual (Julho 2026)

- **Frontend**: Vercel (Angular) — escala automaticamente, sem custo adicional
- **API**: Railway **plano Hobby** (NestJS) — instância única, sem réplicas
- **Banco**: MySQL no Railway — pool de 25 conexões
- **Rate limit**: 20 req/s (burst) + 600 req/min **por IP**

### Limites do plano Hobby vs. uso real

| Recurso | Limite do plano | Uso atual |
|---|---|---|
| RAM | 8 GB por réplica | ~300–600 MB (NestJS single-instance) |
| vCPU | 8 por réplica | baixo |
| Réplicas | até 5 | 1 |
| Storage | 5 GB | **3,7 MB** |
| Crédito mensal | $5 incluso | excedente cobrado por GB-min / vCPU-min |

**Medição do banco de produção (2026-07-27):** 3,7 MB no total — 14 condomínios,
420 moradores, 690 visitantes. As colunas `foto_pessoa` / `foto_documento` são
`LongText` e aceitam base64, mas em produção guardam **URL** (média 0,1 KB): as
imagens vivem em storage externo, não no MySQL.

### Capacidade estimada

- **Sem alterações no código: ~2.000–5.000 moradores cadastrados.** O teto não é
  hardware — é o rate limit por IP (ver Fase 1).
- **Corrigindo o rate limit: ~15.000–30.000 moradores** (≈150–300 condomínios de
  100 unidades) com a mesma instância única.

Hardware não é o gargalo em nenhum desses cenários. A ordem real em que os
limites aparecem é: **(1) rate limit por IP → (2) push do Firebase síncrono →
(3) pool de 25 conexões → (4) storage de eventos**.

---

## Fase 1 — Rate limit por IP (fazer primeiro)

**Por que é o gargalo nº 1:** o throttler usa o IP como chave
([`app.module.ts`](click-cond-web/apps/api/src/app/app.module.ts)), e operadoras
móveis usam CGNAT — dezenas de moradores saem pelo **mesmo IP público**. Os
20 req/s e 600 req/min são consumidos coletivamente sem querer, e usuários
legítimos tomam `429` muito antes de qualquer métrica de recurso encostar no
limite.

- Trocar a chave do throttler de IP para o **id do usuário autenticado** nas
  rotas do app (`ThrottlerGuard` com `getTracker` sobrescrito)
- Manter a chave por IP apenas nas rotas **não autenticadas** (login, recuperação
  de senha), onde ela é a proteção correta contra força bruta

---

## Fase 2 — Push do Firebase assíncrono

**Quando fazer:** tempo de resposta médio passar de 800ms.

- Hoje o Firebase é chamado de forma **síncrona**, bloqueando a resposta HTTP
- Mover para fila assíncrona (**Bull + Redis**) ou, como passo intermediário sem
  dependência nova, disparar em background e responder imediatamente
- Adicionar **Redis como serviço no Railway** (~$5/mês adicional)

---

## Fase 3 — Banco e concorrência

**Quando fazer:** erros de `pool_timeout` no log, ou p95 acima de 800ms com CPU baixa.

- Aumentar `connection_limit` de 25 para 40–50 na `DATABASE_URL`:
  ```
  ?connection_limit=40&pool_timeout=20
  ```
- Ativar cache Redis nas listagens mais acessadas:
  - Lista de moradores e apartamentos (TTL 5 min)
  - Áreas sociais e configurações do condomínio (TTL 15 min)
- Índices compostos para queries de data:
  ```sql
  ALTER TABLE Visitantes ADD INDEX idx_cond_data (id_condominio, created_at);
  ALTER TABLE Encomendas ADD INDEX idx_cond_data (id_condominio, created_at);
  ALTER TABLE Comunicados ADD INDEX idx_cond_data (id_condominio, created_at);
  ```

**Antes de subir para múltiplas réplicas:** o `ThrottlerModule` usa storage
**em memória**. Com N réplicas, o limite efetivo vira N× o configurado e deixa de
ser confiável. Réplica só depois do Redis (throttler storage compartilhado).

---

## Fase 4 — Retenção de eventos (o limite de storage)

**Este é o único caminho pelo qual os 5 GB do Hobby acabam.** Storage não cresce
com usuários cadastrados; cresce com **eventos**.

### As duas tabelas que crescem sozinhas

| Tabela | O que grava | Volume |
|---|---|---|
| `Acessos_Facial` | 1 linha por passagem no terminal facial | **dominante** |
| `audit_logs` (`AuditLog`) | 1 linha por operação de escrita (POST/PUT/PATCH/DELETE) | moderado |

`Auditoria` é a tabela legada equivalente e segue a mesma regra.

`audit_logs` só registra escrita — não loga `GET`, então acompanha a *atividade
administrativa*, não o tráfego. Cresce devagar. Quem manda no storage é
`Acessos_Facial`: cada morador gera ~4 passagens/dia (entrada e saída, ida e
volta), e cada linha custa ~350 bytes com índices.

### Projeção

| Escala | Eventos/dia | Crescimento | Tempo até 5 GB |
|---|---|---|---|
| 14 condomínios (hoje) | ~200 | ~25 MB/ano | não é problema |
| 50 condomínios | ~20.000 | ~2,5 GB/ano | ~2 anos |
| 150 condomínios | ~60.000 | ~7,7 GB/ano | **~8 meses** |

Ou seja: na escala que a Fase 1 destrava (150–300 condomínios), o storage estoura
**antes** de qualquer limite de CPU ou RAM. E hoje **não existe nenhuma rotina de
expurgo** — as duas tabelas só crescem.

### Como resolver

**1. Tick de retenção (resolve ~95% do problema).** Segue o padrão de
`setTimeout` + `setInterval` já usado no construtor do
[`facial.service.ts`](click-cond-web/apps/api/src/app/facial/facial.service.ts) —
não precisa de `@nestjs/schedule`. Roda 1×/dia e apaga em lotes:

```ts
// Lotes evitam lock longo na tabela — MySQL trava linhas num DELETE grande.
private async tickRetencaoEventos() {
  const corte = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  let apagados: number;
  do {
    const { count } = await this.prisma.acessos_Facial.deleteMany({
      where: { timestamp: { lt: corte } },
      take: 5000, // ver nota abaixo
    });
    apagados = count;
  } while (apagados > 0);
}
```

> `deleteMany` do Prisma não aceita `take`. Na prática, buscar os ids com
> `findMany({ select: { id: true }, take: 5000 })` e apagar por
> `where: { id: { in: ids } }`, ou usar `$executeRaw` com
> `DELETE ... ORDER BY id LIMIT 5000`.

O índice `idx_acfac_cond_ts` já cobre a coluna `timestamp`, então o filtro é
barato. Para `audit_logs`, o índice `idx_audit_created` faz o mesmo papel.

**2. Rollup antes de apagar.** Se o histórico longo importa para relatórios,
agregue antes: uma tabela `Acessos_Facial_Diario` com
`(id_condominio, id_pessoa, dia, total_entradas, total_saidas)` guarda a
informação útil em **1 linha por pessoa/dia** em vez de 4. Reduz o volume em
~4× e permite manter anos de histórico dentro de poucos MB.

**3. Não quebra o que já existe.** A ocupação de áreas de lazer e os dashboards
usam o **último evento do dia** — nenhuma feature depende de evento com mais de
alguns meses. Um corte de 6 a 12 meses é seguro.

**4. Janela de retenção sugerida:** 12 meses de linha crua + rollup diário
permanente. Do ponto de vista de LGPD, descartar log de acesso antigo é
favorável: minimização de dados. Confirme antes se algum contrato de condomínio
exige histórico maior.

**5. Se um dia não bastar:** particionar `Acessos_Facial` por mês
(`PARTITION BY RANGE`), o que troca o `DELETE` por um `DROP PARTITION`
instantâneo; ou exportar o arquivo frio para storage externo (CSV/Parquet) antes
de apagar.

---

## Fase 5 — Escala alta (múltiplos condomínios grandes)

- Migrar banco MySQL para plano dedicado no Railway ou **PlanetScale**
- Múltiplas instâncias da API (horizontal scaling — exige Redis, ver Fase 3)
- Separar banco em leitura/escrita (read replicas para dashboards e relatórios)
- Avaliar migração para **PostgreSQL** (melhor suporte a conexões concorrentes)

---

## Monitoramento

Verificar periodicamente em **Railway → Metrics** do serviço `click-prestare-production`:

| Métrica | Normal | Atenção | Crítico |
|---|---|---|---|
| RAM | < 4 GB | 4–6 GB | > 6 GB (de 8 GB) |
| CPU | < 40% | 40–70% | > 70% |
| Tempo de resposta | < 300ms | 300–800ms | > 800ms |
| Storage do banco | < 2 GB | 2–4 GB | > 4 GB (de 5 GB) |
| Erros 429 no log | ~0 | qualquer volume recorrente | → executar Fase 1 |

**Railway → Usage** merece atenção igual às métricas técnicas: o Hobby inclui
$5 de crédito e cobra o excedente. Com API + MySQL rodando 24/7, o custo tende a
encostar nesse teto antes de qualquer degradação de performance.

---

## Variáveis de ambiente para atualizar ao escalar

```
# Fase 3
DATABASE_URL="...?connection_limit=40&pool_timeout=20"
REDIS_URL="redis://..."   # após adicionar Redis no Railway
```
