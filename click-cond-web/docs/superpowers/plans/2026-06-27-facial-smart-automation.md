# Facial Smart Automation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o sistema de controle de acesso facial completamente autônomo — sem precisar de intervenção manual para expirar, pré-enrolar ou limpar rostos fantasmas nos terminais Intelbras.

**Architecture:** Três crons independentes no `FacialService` (NestJS): (1) expiração automática a cada 15 min, (2) pré-enrolamento 30 min antes da chegada a cada 15 min, (3) varredura diária de rostos órfãos no aparelho via protocolo Dahua `UserInfo/getCount` + `UserInfo/getMulti`. Cada cron chama funções já existentes (`syncVisitante`, `unsyncVisitante`) — sem duplicar lógica.

**Tech Stack:** NestJS + Prisma (MySQL) + protocolo Dahua RPC2 (Intelbras SS 3530) + AgentBridgeService (ponte nuvem→LAN).

---

## Contexto do sistema (leia antes de qualquer task)

### Arquivos principais
| Arquivo | Responsabilidade |
|---|---|
| `apps/api/src/app/facial/facial.service.ts` | Toda a lógica de sync: `syncVisitante`, `syncAllForCondominio`, `tickDiasSemanaSync`, crons |
| `apps/api/src/app/facial/facial-device-client.service.ts` | Comunicação HTTP com Intelbras/Hikvision. Protocolo Dahua: `dahuaUpsertUser`, `dahuaSetFace`, `dahuaRemoveUser` |
| `apps/api/src/app/facial/agent-bridge.service.ts` | Ponte nuvem→LAN: `request(deviceId, method, path, body)` |

### Como `syncVisitante` decide autorizar ou remover
```ts
const autorizado =
  (visitante.liberado === 1 && dentroJanela && diaAutorizado) || dentroDoCondominio;
if (!autorizado) {
  // remove rosto do aparelho e zera face_id no banco
}
// se autorizado → upsert no aparelho com ValidFrom/ValidTo
```
Você **não precisa reimplementar essa lógica** nos crons — basta chamar `this.syncVisitante(id)` e ela decide.

### Como o tick existente funciona (padrão a seguir)
```ts
// No constructor:
setTimeout(() => void this.tickDiasSemanaSync(), 5 * 60 * 1000);
setInterval(() => void this.tickDiasSemanaSync(), 60 * 60 * 1000);

// Método:
private async tickDiasSemanaSync() {
  if (!this.prisma.isConnected) return;
  const agoraBRT = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }),
  );
  if (agoraBRT.getHours() !== 0) return; // só executa à meia-noite
  // ...
}
```

### Protocolo Dahua para listar usuários no aparelho
O Intelbras usa Dahua RPC2. Para listar todos os `UserID` cadastrados no aparelho:

**Passo 1 — contar usuários:**
```
POST /RPC2
{"method":"UserInfo.getCount","params":{"Conditions":{}}}
→ {"result":true,"params":{"Count":42}}
```

**Passo 2 — buscar em páginas de 100:**
```
POST /RPC2
{"method":"UserInfo.getMulti","params":{"Conditions":{},"StartNo":0,"Count":100}}
→ {"result":true,"params":{"UserList":[{"UserID":"abc123","UserName":"Joao"},...]}}
```

`UserID` no aparelho = `face_id` na tabela `visitantes` ou `moradores`.

No cliente existente (`facial-device-client.service.ts`), você vai adicionar um método público `listDahuaUserIds(device)` que retorna `string[]` usando as duas chamadas acima.

---

## Mapa de arquivos a modificar

| Arquivo | O que muda |
|---|---|
| `apps/api/src/app/facial/facial.service.ts` | +3 métodos tick + 3 setInterval no constructor |
| `apps/api/src/app/facial/facial-device-client.service.ts` | +1 método `listDahuaUserIds` para Task 3 |

Nenhum arquivo novo. Nenhuma migração de banco.

---

## Task 1: Cron de expiração automática

**Problema:** Quando `data_hora_termino` passa, o rosto fica no aparelho indefinidamente. O terminal continua abrindo mesmo após o prazo expirar.

**Solução:** A cada 15 minutos, buscar visitantes com `data_hora_termino < agora` e `face_id != null`. Chamar `syncVisitante` para cada um — ele já detecta `dentroJanela=false` e `dentroDoCondominio=false` → remove o rosto.

**Files:**
- Modify: `apps/api/src/app/facial/facial.service.ts` (constructor + novo método)

---

- [ ] **Step 1: Adicionar `tickExpiracaoAutomatica` ao constructor**

Abra `apps/api/src/app/facial/facial.service.ts`. Localize o constructor (linhas ~78-92). Adicione os dois timers após os existentes do `tickDiasSemanaSync`:

```ts
constructor(
  private readonly prisma: PrismaService,
  private readonly client: FacialDeviceClientService,
  private readonly notifications: NotificationsService,
  private readonly enrollSessions: EnrollSessionService,
  private readonly auditoria: AuditoriaService,
  private readonly accessState: AccessStateService,
  private readonly agent: AgentBridgeService,
) {
  // Tick existente — dias da semana
  setTimeout(() => void this.tickDiasSemanaSync(), 5 * 60 * 1000);
  setInterval(() => void this.tickDiasSemanaSync(), 60 * 60 * 1000);

  // Tick novo — expiração automática (a cada 15 min, delay inicial 2 min)
  setTimeout(() => void this.tickExpiracaoAutomatica(), 2 * 60 * 1000);
  setInterval(() => void this.tickExpiracaoAutomatica(), 15 * 60 * 1000);
}
```

- [ ] **Step 2: Implementar o método `tickExpiracaoAutomatica`**

Adicione o método logo após `tickDiasSemanaSync` (por volta da linha 1230, dentro da classe `FacialService`):

```ts
/**
 * Disparo a cada 15 min: remove rostos de visitantes/prestadores cuja
 * janela de validade (data_hora_termino) já expirou e ainda têm face_id
 * no aparelho. Chama syncVisitante que já decide remover via dentroJanela=false.
 */
private async tickExpiracaoAutomatica() {
  if (!this.prisma.isConnected) return;
  try {
    const agora = new Date();
    const expirados = await this.prisma.visitantes.findMany({
      where: {
        data_hora_termino: { lt: agora },
        face_id: { not: null },
        // Não remover quem ainda está dentro (pode precisar sair pelo facial)
        data_saida: { not: null },
      },
      select: { id: true },
    });
    for (const v of expirados) {
      this.syncVisitante(v.id).catch((e: any) =>
        this.logger.warn(`tickExpiracao visitante ${v.id}: ${e?.message ?? e}`),
      );
    }
    if (expirados.length > 0) {
      this.logger.log(`tickExpiracaoAutomatica: ${expirados.length} expirado(s) re-sincronizados`);
    }
  } catch (e: any) {
    this.logger.warn(`tickExpiracaoAutomatica erro: ${e?.message ?? e}`);
  }
}
```

> **Atenção:** O filtro `data_saida: { not: null }` é intencional — quem está DENTRO (`data_saida = null`) pode precisar sair pelo facial mesmo após o prazo. O `syncVisitante` usa `dentroDoCondominio` para proteger esse caso.

- [ ] **Step 3: Build para verificar sem erros**

```
cd click-cond-web
npx nx build api --skip-nx-cache
```

Saída esperada: `Successfully ran target build for project @org/api` (1 warning de source-map é normal).

- [ ] **Step 4: Commit**

```bash
git add click-cond-web/apps/api/src/app/facial/facial.service.ts
git commit -m "feat(facial): cron de expiração automática a cada 15 min

Remove rostos do aparelho quando data_hora_termino passa sem intervenção
manual. Preserva quem ainda está dentro (dentroDoCondominio) para não
bloquear saída legítima."
```

---

## Task 2: Cron de pré-enrolamento

**Problema:** O rosto só vai ao aparelho quando a portaria clica "Liberar". Se o agente estiver lento ou o sync demorar, a pessoa chega antes do rosto estar cadastrado no terminal.

**Solução:** A cada 15 minutos, buscar visitantes com `data_hora_inicio` entre `agora` e `agora + 30min`, `liberado=1`, ainda sem `face_id`. Chamar `syncVisitante` preventivamente para que o rosto já esteja no terminal quando a pessoa chegar.

**Files:**
- Modify: `apps/api/src/app/facial/facial.service.ts` (constructor + novo método)

---

- [ ] **Step 1: Adicionar `tickPreEnrolamento` ao constructor**

No mesmo constructor editado na Task 1, adicione após os timers de expiração:

```ts
// Tick novo — pré-enrolamento 30 min antes da chegada (a cada 15 min, delay 3 min)
setTimeout(() => void this.tickPreEnrolamento(), 3 * 60 * 1000);
setInterval(() => void this.tickPreEnrolamento(), 15 * 60 * 1000);
```

Constructor completo depois das Tasks 1 e 2:

```ts
constructor(
  private readonly prisma: PrismaService,
  private readonly client: FacialDeviceClientService,
  private readonly notifications: NotificationsService,
  private readonly enrollSessions: EnrollSessionService,
  private readonly auditoria: AuditoriaService,
  private readonly accessState: AccessStateService,
  private readonly agent: AgentBridgeService,
) {
  setTimeout(() => void this.tickDiasSemanaSync(), 5 * 60 * 1000);
  setInterval(() => void this.tickDiasSemanaSync(), 60 * 60 * 1000);

  setTimeout(() => void this.tickExpiracaoAutomatica(), 2 * 60 * 1000);
  setInterval(() => void this.tickExpiracaoAutomatica(), 15 * 60 * 1000);

  setTimeout(() => void this.tickPreEnrolamento(), 3 * 60 * 1000);
  setInterval(() => void this.tickPreEnrolamento(), 15 * 60 * 1000);
}
```

- [ ] **Step 2: Implementar o método `tickPreEnrolamento`**

Adicione logo após `tickExpiracaoAutomatica`:

```ts
/**
 * Disparo a cada 15 min: pré-enrola rostos de visitantes/prestadores cuja
 * data_hora_inicio está entre agora e agora+30min, liberado=1, ainda sem
 * face_id. Garante que o terminal já reconhece a pessoa quando ela chegar.
 */
private async tickPreEnrolamento() {
  if (!this.prisma.isConnected) return;
  try {
    const agora = new Date();
    const em30min = new Date(agora.getTime() + 30 * 60 * 1000);
    const prestes = await this.prisma.visitantes.findMany({
      where: {
        liberado: 1,
        foto_pessoa: { not: null },
        face_id: null,                      // ainda não enrolado
        data_hora_inicio: {
          gte: agora,
          lte: em30min,
        },
      },
      select: { id: true },
    });
    for (const v of prestes) {
      this.syncVisitante(v.id).catch((e: any) =>
        this.logger.warn(`tickPreEnrolamento visitante ${v.id}: ${e?.message ?? e}`),
      );
    }
    if (prestes.length > 0) {
      this.logger.log(`tickPreEnrolamento: ${prestes.length} visitante(s) pré-enrolados`);
    }
  } catch (e: any) {
    this.logger.warn(`tickPreEnrolamento erro: ${e?.message ?? e}`);
  }
}
```

- [ ] **Step 3: Build para verificar**

```
cd click-cond-web
npx nx build api --skip-nx-cache
```

Saída esperada: `Successfully ran target build for project @org/api`

- [ ] **Step 4: Commit**

```bash
git add click-cond-web/apps/api/src/app/facial/facial.service.ts
git commit -m "feat(facial): pré-enrolar rostos 30 min antes de data_hora_inicio

Evita que visitante chegue antes do rosto estar no terminal por delay
no sync manual. Cron a cada 15 min detecta chegadas iminentes."
```

---

## Task 3: Varredura de rostos fantasmas

**Problema:** Se o servidor caiu entre o `delete` de um visitante e o `unsyncVisitante`, o `face_id` fica no Intelbras para sempre. A nuvem não tem registro, então ninguém mais consegue remover via sync normal.

**Solução:** Uma vez por dia, consultar o aparelho via `UserInfo/getCount` + `UserInfo/getMulti` (protocolo Dahua), obter todos os `UserID` cadastrados no terminal, comparar com os `face_id` do banco. Os que estão no aparelho mas não no banco são fantasmas — remover via `UserInfo/removeMulti`.

**Files:**
- Modify: `apps/api/src/app/facial/facial-device-client.service.ts` (novo método público)
- Modify: `apps/api/src/app/facial/facial.service.ts` (constructor + novo método)

---

- [ ] **Step 1: Adicionar `listDahuaUserIds` no cliente de dispositivos**

Abra `apps/api/src/app/facial/facial-device-client.service.ts`.

Encontre o final da seção Dahua (antes da seção `// ---------- Hikvision ISAPI ----------`, por volta da linha 762). Adicione o método público:

```ts
/**
 * Lista todos os UserID cadastrados no aparelho Dahua/Intelbras.
 * Pagina em blocos de 100 até esgotar o total reportado pelo aparelho.
 * Retorna array de strings com os UserIDs (= face_id no banco).
 */
async listDahuaUserIds(device: FacialDeviceConfig): Promise<string[]> {
  // Passo 1: contar quantos usuários há no aparelho
  const countResp = await this.agent.request(
    device.id,
    'POST',
    '/RPC2',
    { method: 'UserInfo.getCount', params: { Conditions: {} } },
  );
  const total: number = countResp?.params?.Count ?? 0;
  if (total === 0) return [];

  const ids: string[] = [];
  const PAGE = 100;
  let startNo = 0;

  // Passo 2: paginar em blocos de 100
  while (startNo < total) {
    const resp = await this.agent.request(
      device.id,
      'POST',
      '/RPC2',
      {
        method: 'UserInfo.getMulti',
        params: { Conditions: {}, StartNo: startNo, Count: PAGE },
      },
    );
    const list: Array<{ UserID: string }> = resp?.params?.UserList ?? [];
    for (const u of list) {
      if (u.UserID && u.UserID !== 'FFFFFF') {
        ids.push(u.UserID);
      }
    }
    startNo += PAGE;
    if (list.length < PAGE) break; // última página
  }
  return ids;
}
```

> **Nota sobre `UserID === 'FFFFFF'`:** O Intelbras usa `FFFFFF` como ID de fallback para faces não reconhecidas. Nunca é um usuário real — ignorar.

- [ ] **Step 2: Adicionar `tickFantasmas` ao constructor**

Em `facial.service.ts`, no constructor, adicione após os timers existentes:

```ts
// Tick novo — varredura de fantasmas (uma vez por dia às 3h BRT, delay 10 min)
setTimeout(() => void this.tickFantasmas(), 10 * 60 * 1000);
setInterval(() => void this.tickFantasmas(), 60 * 60 * 1000);
```

Constructor completo (final, com todas as 4 Tasks):

```ts
constructor(
  private readonly prisma: PrismaService,
  private readonly client: FacialDeviceClientService,
  private readonly notifications: NotificationsService,
  private readonly enrollSessions: EnrollSessionService,
  private readonly auditoria: AuditoriaService,
  private readonly accessState: AccessStateService,
  private readonly agent: AgentBridgeService,
) {
  setTimeout(() => void this.tickDiasSemanaSync(), 5 * 60 * 1000);
  setInterval(() => void this.tickDiasSemanaSync(), 60 * 60 * 1000);

  setTimeout(() => void this.tickExpiracaoAutomatica(), 2 * 60 * 1000);
  setInterval(() => void this.tickExpiracaoAutomatica(), 15 * 60 * 1000);

  setTimeout(() => void this.tickPreEnrolamento(), 3 * 60 * 1000);
  setInterval(() => void this.tickPreEnrolamento(), 15 * 60 * 1000);

  setTimeout(() => void this.tickFantasmas(), 10 * 60 * 1000);
  setInterval(() => void this.tickFantasmas(), 60 * 60 * 1000);
}
```

- [ ] **Step 3: Implementar `tickFantasmas`**

Adicione logo após `tickPreEnrolamento` em `facial.service.ts`:

```ts
/**
 * Disparo horário, executa às 3h BRT: compara UserIDs no aparelho com
 * face_ids no banco. Remove do aparelho qualquer ID que não existe mais
 * no banco (fantasmas de visitantes deletados com sync falho).
 */
private async tickFantasmas() {
  if (!this.prisma.isConnected) return;
  const agoraBRT = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }),
  );
  if (agoraBRT.getHours() !== 3) return; // executa só às 3h BRT

  try {
    const devices = await this.prisma.facial_Devices.findMany({
      where: { ativo: 1, tipo: 'facial', fabricante: 'intelbras' },
      select: { id: true, id_condominio: true },
    });

    for (const device of devices) {
      try {
        // 1. Listar UserIDs no aparelho
        const idsNoAparelho = await this.client.listDahuaUserIds(
          { id: device.id } as any,
        );
        if (idsNoAparelho.length === 0) continue;

        // 2. Buscar quais desses existem no banco (visitantes + moradores)
        const [visitantesNoBanco, moradoresNoBanco] = await Promise.all([
          this.prisma.visitantes.findMany({
            where: {
              id_condominio: device.id_condominio,
              face_id: { in: idsNoAparelho },
            },
            select: { face_id: true },
          }),
          this.prisma.moradores.findMany({
            where: {
              id_condominio: device.id_condominio,
              face_id: { in: idsNoAparelho },
            },
            select: { face_id: true },
          }),
        ]);

        const idsNoBanco = new Set([
          ...visitantesNoBanco.map((v) => v.face_id!),
          ...moradoresNoBanco.map((m) => m.face_id!),
        ]);

        // 3. Fantasmas = estão no aparelho mas não no banco
        const fantasmas = idsNoAparelho.filter((id) => !idsNoBanco.has(id));
        if (fantasmas.length === 0) continue;

        // 4. Remover fantasmas do aparelho via Dahua removeMulti
        await this.client.dahuaRemoveUsers(
          { id: device.id } as any,
          fantasmas,
        );
        this.logger.log(
          `tickFantasmas device ${device.id}: ${fantasmas.length} fantasma(s) removido(s) — ${fantasmas.join(', ')}`,
        );
      } catch (e: any) {
        this.logger.warn(
          `tickFantasmas device ${device.id}: ${e?.message ?? e}`,
        );
      }
    }
  } catch (e: any) {
    this.logger.warn(`tickFantasmas erro: ${e?.message ?? e}`);
  }
}
```

- [ ] **Step 4: Expor `dahuaRemoveUsers` no cliente**

Em `facial-device-client.service.ts`, você vai precisar de um método público para remover uma lista de UserIDs. Encontre o método privado de remoção Dahua existente (procure por `removeMulti` ou `dahuaRemove`). Se já existir como privado, torne-o público ou crie um wrapper:

```ts
/**
 * Remove uma lista de UserIDs do aparelho Dahua/Intelbras via UserInfo/removeMulti.
 * Usado pelo tickFantasmas para limpar rostos órfãos.
 */
async dahuaRemoveUsers(
  device: FacialDeviceConfig,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;
  await this.agent.request(
    device.id,
    'POST',
    '/RPC2',
    {
      method: 'UserInfo.removeMulti',
      params: {
        UserList: userIds.map((id) => ({ UserID: id })),
      },
    },
  );
}
```

> **Verifique antes de adicionar:** Procure no arquivo se já existe algum método que chama `UserInfo.removeMulti`. Se existir, reutilize-o ao invés de criar outro. Se for privado, torne-o `async` público.

- [ ] **Step 5: Verificar assinatura de `FacialDeviceConfig`**

Antes do build, confirme que `FacialDeviceConfig` tem campo `id` (number). Procure no arquivo:

```ts
interface FacialDeviceConfig {
  id: number;
  // ...outros campos
}
```

Se `id` não existir, adicione-o à interface.

- [ ] **Step 6: Build para verificar**

```
cd click-cond-web
npx nx build api --skip-nx-cache
```

Saída esperada: `Successfully ran target build for project @org/api`

Se houver erro de tipo em `{ id: device.id } as any`, substitua pelo objeto correto que `listDahuaUserIds` e `dahuaRemoveUsers` esperam — siga o padrão dos outros métodos no cliente.

- [ ] **Step 7: Commit**

```bash
git add click-cond-web/apps/api/src/app/facial/facial.service.ts \
        click-cond-web/apps/api/src/app/facial/facial-device-client.service.ts
git commit -m "feat(facial): varredura diária de rostos fantasmas no terminal

Às 3h BRT, compara UserIDs no aparelho Intelbras com face_ids no banco.
Remove os órfãos (visitantes deletados com sync falho) via UserInfo/removeMulti.
Evita acumulação de biometrias fantasmas que abrem a porta indefinidamente."
```

---

## Step final: Push e verificação

- [ ] **Push para Railway**

```bash
git push origin master
```

- [ ] **Verificar no Railway**

Aguarde deploy (~2 min). No Console do Railway, você deve ver nos logs após 2-3 min:
- `tickExpiracaoAutomatica` e `tickPreEnrolamento` executando sem erros (primeira rodada, provavelmente 0 afetados)
- `tickFantasmas` não executa até 3h BRT

- [ ] **Teste manual — expiração**

1. Crie um visitante com `data_hora_termino = agora + 2 min`, libere, verifique que o rosto foi ao terminal (face_id != null no banco)
2. Aguarde 2 min para a janela expirar
3. Aguarde até 15 min para o tick rodar (ou reinicie o servidor para forçar o setTimeout de 2 min)
4. Verifique no banco: `face_id` do visitante deve ser `null`
5. Tente usar o terminal: deve negar

- [ ] **Teste manual — pré-enrolamento**

1. Crie um visitante com `data_hora_inicio = agora + 10 min`, `liberado=1`, `face_id=null`
2. Aguarde até 15 min para o tick rodar
3. Verifique no banco: `face_id` deve ter sido preenchido
4. Terminal deve reconhecer a pessoa antes do horário de início

---

## Self-Review

**Spec coverage:**
- ✅ Task 1 cobre expiração automática
- ✅ Task 2 cobre pré-enrolamento
- ✅ Task 3 cobre fantasmas biométricos

**Placeholder scan:**
- Nenhum "TBD" ou "TODO" — todo código está completo

**Type consistency:**
- `FacialDeviceConfig` é o mesmo tipo em Tasks 1, 2, 3
- `syncVisitante(v.id)` — `id` é `number`, consistente com Prisma `select: { id: true }`
- `listDahuaUserIds` retorna `string[]`, consumido como `string[]` em `tickFantasmas`
- `dahuaRemoveUsers` recebe `(device, string[])`, chamado com exatamente isso

**Possível armadilha na Task 3:**
O método `agent.request` existente pode ter uma assinatura diferente de `(deviceId, method, path, body)`. Antes de codificar `listDahuaUserIds` e `dahuaRemoveUsers`, abra `agent-bridge.service.ts` e confirme a assinatura do método `request`. Adapte os parâmetros se necessário.
