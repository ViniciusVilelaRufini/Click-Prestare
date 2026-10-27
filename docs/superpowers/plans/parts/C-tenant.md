## C — Isolamento de tenant, regras de negócio, API legada e CI

Tasks in this group are independent of each other except where noted:

- C1 and C3 both edit `areas-sociais.service.ts`, but in different methods (`updateAgendamento` in C1; `insertAgendamento`/`removeAgendamento` in C3).
- C2 and C3 both edit `visitantes.service.ts`, but in different hunks.

Apply them in ID order and the before/after snippets still match.

Test command prefix for every API task: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts <fragment>`. Ignore the pre-existing failing suite `apps/api/src/app/auth/meus-eventos-entrada-manual.spec.ts`.

---

### Task C1: Reservation edit (`agendamento/update`) requires an operator and the `areas_sociais` flag

**Fixes fingerprint:** `areas-sociais/updateAgendamento-sem-papel`

**Why:** `AreasSociaisService.updateAgendamento` only runs `tenant.assertEntidade`. Any morador with an apartment in the condominium can therefore do three things through POST `/areas-sociais/agendamento/update`: write `status: 'aprovado'` on his own pending reservation, move a reservation onto an occupied slot, or cancel or move another apartment's reservation. `FacialService.tickReservasAreas` then enrolls the residents of 'aprovado' reservations on the area terminal.

No client calls this route: the app and portaria-web use `update-status`, and the legacy Express route is commented out with `typeAccess: ['Sindico']`. So restricting it to operators breaks no legitimate user. The sibling `updateStatusAgendamento` already uses `assertOperador` plus `assertPermissaoFuncionario(..., 'areas_sociais', ...)`, and this task applies the same pair here.

**Files:**
- Modify: `click-cond-web/apps/api/src/app/areas-sociais/areas-sociais.service.ts` (method `updateAgendamento`, ~line 1541-1550)
- Test: `click-cond-web/apps/api/src/app/areas-sociais/areas-sociais.update-agendamento.authz.spec.ts` (new)

**Interfaces:**
- Consumes: `assertOperador` (already imported from `../auth/tenant.util`) and `TenantAccessService.assertPermissaoFuncionario(idCondominio, 'areas_sociais', payload)`.
- Produces: nothing new. The signature `updateAgendamento(agendamento: any, user?: JwtPayload)` is unchanged.

- [ ] **Step 1: Write the failing test**

Create `click-cond-web/apps/api/src/app/areas-sociais/areas-sociais.update-agendamento.authz.spec.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';
import { AreasSociaisService } from './areas-sociais.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * POST /areas-sociais/agendamento/update gravava data, horário, convidados e
 * STATUS de qualquer reserva do condomínio só com o vínculo de tenant: um
 * morador auto-aprovava a própria reserva (e o tick facial enrolava o
 * apartamento no terminal da área) ou cancelava/remarcava a do vizinho.
 * Editar reserva é operação — mesmo par de checagens do updateStatusAgendamento.
 */
describe('AreasSociaisService.updateAgendamento — exige operador e flag areas_sociais', () => {
  function build(flagAreas = 1) {
    const prisma: any = {
      isConnected: true,
      areas_Sociais_Agendamentos: {
        // Reserva 10 é do morador 1 (apto 100), condomínio 1, ainda pendente.
        findUnique: jest.fn(async () => ({
          id: 10,
          id_user: 1,
          id_apartamento: 100,
          status: 'pendente',
          area: { id_condominio: 1 },
        })),
        update: jest.fn(async ({ data }: any) => ({ id: 10, ...data })),
      },
      // Morador 2 mora no condomínio 1 (apto 200): passa no tenant — o que
      // se testa aqui é o papel, não o isolamento por condomínio.
      apartamentos_Users: {
        findFirst: jest.fn(async ({ where }: any) => (Number(where?.id_user) === 2 ? { id_apto: 200 } : null)),
      },
      sindicos_Condominios: {
        findFirst: jest.fn(async ({ where }: any) => (Number(where?.id_user) === 9 ? { id: 1 } : null)),
      },
      // Vínculo do funcionário e a flag pedida saem da mesma linha.
      funcionarios: { findFirst: jest.fn(async () => ({ id: 1, areas_sociais: flagAreas })) },
    };
    const tenant = new TenantAccessService(prisma);
    const svc = new AreasSociaisService(prisma, {} as any, {} as any, {} as any, tenant);
    return { svc, prisma };
  }

  const moradorB: JwtPayload = { sub: 2, nome: 'Morador B', typeAccess: 'Morador' };
  const sindico: JwtPayload = { sub: 9, nome: 'Síndico', typeAccess: 'Sindico' };
  const funcionario: JwtPayload = { sub: 5, nome: 'Zelador', typeAccess: 'Funcionario' };

  it('NEGA morador aprovar reserva pelo update', async () => {
    const { svc, prisma } = build();
    await expect(svc.updateAgendamento({ id: 10, status: 'aprovado' }, moradorB)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.areas_Sociais_Agendamentos.update).not.toHaveBeenCalled();
  });

  it('NEGA morador remarcar a reserva de outro apartamento', async () => {
    const { svc, prisma } = build();
    await expect(svc.updateAgendamento({ id: 10, data: '01/01/2030' }, moradorB)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.areas_Sociais_Agendamentos.update).not.toHaveBeenCalled();
  });

  it('NEGA funcionário sem a flag areas_sociais', async () => {
    const { svc, prisma } = build(0);
    await expect(svc.updateAgendamento({ id: 10, status: 'cancelado' }, funcionario)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.areas_Sociais_Agendamentos.update).not.toHaveBeenCalled();
  });

  it('PERMITE o síndico do condomínio', async () => {
    const { svc, prisma } = build();
    await svc.updateAgendamento({ id: 10, status: 'cancelado' }, sindico);
    expect(prisma.areas_Sociais_Agendamentos.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { status: 'cancelado' },
    });
  });

  it('PERMITE funcionário com a flag', async () => {
    const { svc, prisma } = build(1);
    await svc.updateAgendamento({ id: 10, convidados: 3 }, funcionario);
    expect(prisma.areas_Sociais_Agendamentos.update).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts areas-sociais.update-agendamento.authz`

Expected: FAIL. The three `NEGA ...` tests fail with `Received promise resolved instead of rejected`, because `update` is called. The two `PERMITE` tests pass.

- [ ] **Step 3: Write the minimal implementation**

In `click-cond-web/apps/api/src/app/areas-sociais/areas-sociais.service.ts`, method `updateAgendamento`:

Before:
```ts
    if (!atual) throw new NotFoundException('Agendamento não encontrado.');
    await this.tenant.assertEntidade(atual.area?.id_condominio, user, `agendamento #${agendamento.id}`);

    const updateData: any = {};
```

After:
```ts
    if (!atual) throw new NotFoundException('Agendamento não encontrado.');
    await this.tenant.assertEntidade(atual.area?.id_condominio, user, `agendamento #${agendamento.id}`);
    // Editar data/horário/status de uma reserva é operação: o vínculo com o
    // condomínio deixava qualquer morador auto-aprovar a própria reserva (o
    // tick facial enrola quem está 'aprovado') ou mexer na do vizinho. Mesmo
    // par de checagens do updateStatusAgendamento. Nenhum cliente usa esta
    // rota hoje — app e portaria-web decidem pelo update-status.
    assertOperador(user, 'editar reserva');
    await this.tenant.assertPermissaoFuncionario(atual.area?.id_condominio, 'areas_sociais', user);

    const updateData: any = {};
```

(The `before` snippet's first two lines are unique because they appear together only in `updateAgendamento`. If the editor matches more than once, anchor on the line ``await this.tenant.assertEntidade(atual.area?.id_condominio, user, `agendamento #${agendamento.id}`);``, which appears only here.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts areas-sociais`

Expected: PASS. All `areas-sociais*` suites pass, including the new one.

- [ ] **Step 5: Commit**

```bash
cd C:/w/sec
git add click-cond-web/apps/api/src/app/areas-sociais/areas-sociais.service.ts click-cond-web/apps/api/src/app/areas-sociais/areas-sociais.update-agendamento.authz.spec.ts
git commit -m "fix(security): edicao de reserva exige operador e flag areas_sociais

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task C2: A resident cannot overwrite a visitor identity (Pessoa) shared with another unit, or revoke that unit's PIN

**Fixes fingerprint:** `pessoas/atualizarSeNecessario-identidade-compartilhada`

**Why:** With `PESSOAS_MIGRATION_ENABLED='true'`, `Pessoas` is unique per (condominium, document), and every apartment's `Visitas` point at the same row and the same face.

A morador of apartment A who creates a visit with the document number of apartment B's visitor causes four things:
1. `PessoasService.atualizarSeNecessario` replaces `nome`/`foto_pessoa`/`foto_documento`.
2. `desativarOutrosCodigosVisita` sets `liberado=0` and `codigo_acesso=null` on B's open visit.
3. The facial sync re-enrolls the face with the attacker's photo.
4. `updateViaPessoasVisitas` lets him rewrite the shared Pessoa later, through his own visit.

**The invariant:** a principal whose authority covers only some apartments must not mutate identity or authorization that belongs to other apartments.

**Legitimate behavior that stays:**
- An operator corrects a name or photo, and a new registration revokes the previous PIN. This behavior is covered by `visitantes.write-surface.pessoas-visitas.spec.ts`.
- A morador whose Pessoa has visits only in his own apartments still corrects name and photo.

**Scope:**
- The create path (`createViaPessoasVisitas`, which the public invite confirmation also reaches through `ConvitesService` → `visitantes.create(..., user)`) and the update path (`updateViaPessoasVisitas`).
- The other two callers of `desativarOutrosCodigosVisita` (`novaVisitaParaPessoaViaPessoasVisitas`, `liberarAcessoViaPessoasVisitas`) are listed under "Deferred to owner".

**Deploy note:** the code path only runs when `PESSOAS_MIGRATION_ENABLED='true'` in the EB environment, and the owner should confirm that value. The fix is safe either way.

**Files:**
- Modify: `click-cond-web/apps/api/src/app/pessoas/pessoas.service.ts`: export `OpcoesObterOuCriar` and `pessoaTemVisitaForaDosAptos`, and add `opts` to `obterOuCriar`/`atualizarSeNecessario`.
- Modify: `click-cond-web/apps/api/src/app/visitas/visitas.service.ts`: add `opts` to `criarVisita`.
- Modify: `click-cond-web/apps/api/src/app/visitantes/visitantes.service.ts`:
  - change the import (line 24)
  - add the `aptosDoMoradorMobile` helper
  - add the `aptosDoChamador` param to `desativarOutrosCodigosVisita`
  - edit `createViaPessoasVisitas` (~2066-2093)
  - edit `updateViaPessoasVisitas` (~2468-2476)
- Test: `click-cond-web/apps/api/src/app/visitantes/identidade-compartilhada.pessoas-visitas.spec.ts` (new)

**Interfaces:**
- Produces (pessoas.service.ts):
  - `export interface OpcoesObterOuCriar { aptosDoChamador?: number[] }`
  - `export async function pessoaTemVisitaForaDosAptos(prisma: PrismaService, idPessoa: number, aptos: number[]): Promise<boolean>`
  - `PessoasService.obterOuCriar(idCondominio: number, dto: CriarPessoaDto, opts?: OpcoesObterOuCriar)`
- Produces (visitas.service.ts): `VisitasService.criarVisita(dto: CriarVisitaDto, opts?: OpcoesObterOuCriar)`
- Produces (visitantes.service.ts, private):
  - `aptosDoMoradorMobile(payload?: JwtPayload): Promise<number[] | undefined>`
  - `desativarOutrosCodigosVisita(idCondominio, idPessoa, idVisitaAtual, aptosDoChamador?: number[])`

- [ ] **Step 1: Write the failing test**

Create `click-cond-web/apps/api/src/app/visitantes/identidade-compartilhada.pessoas-visitas.spec.ts`:

```ts
import { VisitantesService } from './visitantes.service';
import { PessoasService } from '../pessoas/pessoas.service';
import { VisitasService } from '../visitas/visitas.service';

/**
 * A Pessoa é uma linha só por (condomínio, documento): todas as visitas de
 * todos os apartamentos apontam para ela e para o mesmo rosto no terminal.
 * O morador do apto 100 que cadastrava visita com o documento do visitante
 * do apto 200 trocava nome/foto dessa pessoa e derrubava o PIN da visita do
 * 200 — autoridade de um apartamento agindo sobre outro.
 */
describe('Pessoa compartilhada entre apartamentos — morador não reescreve identidade alheia', () => {
  const original = process.env['PESSOAS_MIGRATION_ENABLED'];
  beforeEach(() => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
  });
  afterEach(() => {
    if (original === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = original;
  });

  const DOC = '52998224725';
  // Morador 2 só tem o apto 100.
  const moradorA = { sub: 2, nome: 'Morador A', typeAccess: 'Morador' } as any;
  const porteiro = { sub: 3, nome: 'Porteiro', id_condominio: 1 } as any;

  function build(opts: { aptoDaVisitaExistente: number }) {
    let visitasSeq = 60;
    const pessoas: any[] = [
      {
        id: 7,
        id_condominio: 1,
        nome: 'Real',
        doc_identificacao: DOC,
        foto_pessoa: 'F1',
        foto_documento: null,
        face_id: 'face-7',
        tipo_pessoa: 'visitante',
      },
    ];
    const visitas: any[] = [
      {
        id: 50,
        id_pessoa: 7,
        id_condominio: 1,
        id_apartamento: opts.aptoDaVisitaExistente,
        liberado: 1,
        codigo_acesso: '111111',
        data_entrada: null,
        data_saida: null,
        bloqueado: 0,
      },
    ];
    const comRelacoes = (v: any) => ({
      ...v,
      pessoa: pessoas.find((p) => p.id === v.id_pessoa),
      apartamento: { id: v.id_apartamento, bloco: 'A', apto: String(v.id_apartamento) },
    });

    const prisma: any = {
      isConnected: true,
      visitantes: { findFirst: jest.fn(async () => null) }, // unicidade de PIN
      pessoas: {
        findFirst: jest.fn(async ({ where }: any) => {
          if (where.bloqueado === 1) return null;
          return (
            pessoas.find(
              (p) =>
                p.id_condominio === where.id_condominio &&
                !!where.doc_identificacao &&
                p.doc_identificacao === where.doc_identificacao,
            ) ?? null
          );
        }),
        create: jest.fn(),
        update: jest.fn(async ({ where, data }: any) => {
          const p = pessoas.find((x) => x.id === where.id);
          Object.assign(p, data);
          return p;
        }),
      },
      visitas: {
        findFirst: jest.fn(async () => null), // unicidade de PIN
        findUnique: jest.fn(async ({ where }: any) => {
          const v = visitas.find((x) => x.id === where.id);
          return v ? comRelacoes(v) : null;
        }),
        count: jest.fn(
          async ({ where }: any) =>
            visitas.filter(
              (v) =>
                v.id_pessoa === where.id_pessoa &&
                !(where.id_apartamento?.notIn ?? []).includes(v.id_apartamento),
            ).length,
        ),
        create: jest.fn(async ({ data }: any) => {
          const nova = {
            id: visitasSeq++,
            bloqueado: 0,
            data_entrada: null,
            data_saida: null,
            ...data,
            created_at: new Date('2026-10-20T12:00:00Z'),
            updated_at: new Date('2026-10-20T12:00:00Z'),
          };
          visitas.push(nova);
          return comRelacoes(nova);
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const v = visitas.find((x) => x.id === where.id);
          Object.assign(v, data);
          return comRelacoes(v);
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          let count = 0;
          for (const v of visitas) {
            if (v.id_condominio !== where.id_condominio || v.id_pessoa !== where.id_pessoa) continue;
            if (where.id?.not !== undefined && v.id === where.id.not) continue;
            if (where.id_apartamento?.in && !where.id_apartamento.in.includes(v.id_apartamento)) continue;
            if (v.data_entrada !== null || v.data_saida !== null) continue;
            Object.assign(v, data);
            count++;
          }
          return { count };
        }),
      },
      apartamentos: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, id_condominio: 1 })) },
      apartamentos_Users: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.id_user === 2 && where.id_apto === 100 ? { id_apto: 100 } : null,
        ),
        findMany: jest.fn(async ({ where }: any) => (where.id_user === 2 ? [{ id_apto: 100 }] : [])),
      },
      users: { findMany: jest.fn(async () => []) },
    };

    const pessoasService = new PessoasService(prisma);
    const visitasService = new VisitasService(prisma, pessoasService);
    const facial: any = { syncPessoa: jest.fn().mockResolvedValue({}) };
    const tenant: any = {
      assertCondominio: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async () => undefined),
    };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const notifications: any = { sendPushNotification: jest.fn(), sendWhatsApp: jest.fn() };
    const service = new VisitantesService(
      prisma,
      notifications,
      storage,
      facial,
      { registrar: jest.fn() } as any,
      tenant,
      {} as any,
      visitasService,
    );
    return { service, prisma, pessoas, visitas };
  }

  const novaVisita = { nome: 'Z', doc_identificacao: DOC, foto_pessoa: 'F2', id_apartamento: 100, id_condominio: 1 };

  it('morador do 100 não troca nome/foto da Pessoa que tem visita no 200', async () => {
    const { service, prisma, pessoas } = build({ aptoDaVisitaExistente: 200 });
    await service.create({ ...novaVisita } as any, moradorA);
    expect(prisma.pessoas.update).not.toHaveBeenCalled();
    expect(pessoas[0].nome).toBe('Real');
    expect(pessoas[0].foto_pessoa).toBe('F1');
  });

  it('e não revoga o PIN da visita em aberto do outro apartamento', async () => {
    const { service, visitas } = build({ aptoDaVisitaExistente: 200 });
    await service.create({ ...novaVisita } as any, moradorA);
    const doVizinho = visitas.find((v) => v.id === 50);
    expect(doVizinho.liberado).toBe(1);
    expect(doVizinho.codigo_acesso).toBe('111111');
  });

  it('Pessoa só do próprio apartamento: a correção de nome continua valendo e o PIN antigo cai', async () => {
    const { service, pessoas, visitas } = build({ aptoDaVisitaExistente: 100 });
    await service.create({ ...novaVisita } as any, moradorA);
    expect(pessoas[0].nome).toBe('Z');
    const anterior = visitas.find((v) => v.id === 50);
    expect(anterior.liberado).toBe(0);
    expect(anterior.codigo_acesso).toBeNull();
  });

  it('operador continua corrigindo a identidade e revogando o PIN anterior', async () => {
    const { service, pessoas, visitas } = build({ aptoDaVisitaExistente: 200 });
    await service.create({ ...novaVisita } as any, porteiro);
    expect(pessoas[0].nome).toBe('Z');
    expect(visitas.find((v) => v.id === 50).liberado).toBe(0);
  });

  it('update da própria visita não reescreve a Pessoa compartilhada', async () => {
    const { service, prisma, visitas } = build({ aptoDaVisitaExistente: 200 });
    visitas.push({
      id: 61,
      id_pessoa: 7,
      id_condominio: 1,
      id_apartamento: 100,
      liberado: 1,
      codigo_acesso: '222222',
      data_entrada: null,
      data_saida: null,
      bloqueado: 0,
    });
    await service.update({ id: 61, nome: 'Z', foto_pessoa: 'F2' } as any, moradorA);
    expect(prisma.visitas.update).toHaveBeenCalled();
    expect(prisma.pessoas.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts identidade-compartilhada`

Expected: FAIL in 3 tests:
- `morador do 100 não troca...`: `pessoas.update` was called, so nome is 'Z'.
- `e não revoga o PIN...`: `liberado` is 0.
- `update da própria visita...`: `pessoas.update` was called.

The other 2 tests pass.

- [ ] **Step 3: Write the minimal implementation**

**3a.** In `click-cond-web/apps/api/src/app/pessoas/pessoas.service.ts`, add after the imports (before `@Injectable()`):

```ts
export interface OpcoesObterOuCriar {
  /**
   * Apartamentos do MORADOR que está registrando a visita. Presente só quando
   * o chamador é morador do app; operador (portaria/síndico/funcionário) não
   * manda. Com ele, uma Pessoa já existente só tem a identidade reescrita se
   * não tiver visita em apartamento fora desta lista.
   */
  aptosDoChamador?: number[];
}

/**
 * A Pessoa é uma linha só por (condomínio, documento), compartilhada por
 * todas as visitas de todos os apartamentos — e pelo mesmo rosto no terminal.
 * Morador só tem autoridade sobre os apartamentos dele: se a Pessoa tem visita
 * em outro, nome/fotos dela não são dele para trocar.
 */
export async function pessoaTemVisitaForaDosAptos(
  prisma: PrismaService,
  idPessoa: number,
  aptos: number[],
): Promise<boolean> {
  const n = await prisma.visitas.count({
    where: { id_pessoa: Number(idPessoa), id_apartamento: { notIn: aptos.map(Number) } },
  });
  return n > 0;
}
```

In the same file, change `atualizarSeNecessario`.

Before:
```ts
  private async atualizarSeNecessario(existente: any, dto: CriarPessoaDto) {
    const updateData: any = {};
```

After:
```ts
  private async atualizarSeNecessario(existente: any, dto: CriarPessoaDto, opts?: OpcoesObterOuCriar) {
    // Identidade compartilhada com outro apartamento: o morador anexa a visita
    // dele à Pessoa como ela está, sem trocar nome/fotos de quem o vizinho
    // autorizou (e cujo rosto está no terminal).
    if (
      opts?.aptosDoChamador &&
      (await pessoaTemVisitaForaDosAptos(this.prisma, existente.id, opts.aptosDoChamador))
    ) {
      return existente;
    }
    const updateData: any = {};
```

In the same file, change `obterOuCriar`.

Before:
```ts
  async obterOuCriar(idCondominio: number, dto: CriarPessoaDto) {
```
After:
```ts
  async obterOuCriar(idCondominio: number, dto: CriarPessoaDto, opts?: OpcoesObterOuCriar) {
```

Before:
```ts
      if (existentePorDoc) {
        return this.atualizarSeNecessario(existentePorDoc, dto);
      }
```
After:
```ts
      if (existentePorDoc) {
        return this.atualizarSeNecessario(existentePorDoc, dto, opts);
      }
```

Before:
```ts
      if (existentePorFace) {
        return this.atualizarSeNecessario(existentePorFace, dto);
      }
```
After:
```ts
      if (existentePorFace) {
        return this.atualizarSeNecessario(existentePorFace, dto, opts);
      }
```

**3b.** In `click-cond-web/apps/api/src/app/visitas/visitas.service.ts`:

Before:
```ts
import { PessoasService } from '../pessoas/pessoas.service';
```
After:
```ts
import { OpcoesObterOuCriar, PessoasService } from '../pessoas/pessoas.service';
```

Before:
```ts
  async criarVisita(dto: CriarVisitaDto) {
    await this.assertApartamentoDoCondominio(Number(dto.id_apartamento), Number(dto.id_condominio));
    const pessoa = await this.pessoasService.obterOuCriar(Number(dto.id_condominio), dto.pessoa);
```
After:
```ts
  async criarVisita(dto: CriarVisitaDto, opts?: OpcoesObterOuCriar) {
    await this.assertApartamentoDoCondominio(Number(dto.id_apartamento), Number(dto.id_condominio));
    // `opts` só chega quando quem registra é morador (VisitantesService). Sem
    // ele a chamada fica idêntica à anterior (visitas.service.spec confere os
    // argumentos exatos).
    const pessoa = opts
      ? await this.pessoasService.obterOuCriar(Number(dto.id_condominio), dto.pessoa, opts)
      : await this.pessoasService.obterOuCriar(Number(dto.id_condominio), dto.pessoa);
```

**3c.** In `click-cond-web/apps/api/src/app/visitantes/visitantes.service.ts`, make the following changes.

Import (line 24).

Before:
```ts
import { PessoasService } from '../pessoas/pessoas.service';
```
After:
```ts
import { PessoasService, pessoaTemVisitaForaDosAptos } from '../pessoas/pessoas.service';
```

`desativarOutrosCodigosVisita`: add the helper above it and the optional scope.

Before:
```ts
  private async desativarOutrosCodigosVisita(
    idCondominio: number,
    idPessoa: number,
    idVisitaAtual: number,
  ): Promise<void> {
    if (!this.prisma.isConnected) return;
    await this.prisma.visitas.updateMany({
      where: {
        id_condominio: Number(idCondominio),
        id_pessoa: Number(idPessoa),
        id: { not: Number(idVisitaAtual) },
        data_entrada: null,
        data_saida: null,
      },
```
After:
```ts
  /**
   * Apartamentos do morador do app; `undefined` para operador (portaria-web,
   * síndico, funcionário) ou chamada interna. Mesma definição de "morador
   * mobile" de assertPodeAcessarVisita/assertPodeUsarApartamento.
   */
  private async aptosDoMoradorMobile(payload?: JwtPayload): Promise<number[] | undefined> {
    if (!payload) return undefined;
    const tipo = (payload.typeAccess ?? payload.user?.typeAccess ?? '').toString().toLowerCase();
    const ehMoradorMobile = !payload.id_condominio && tipo !== 'sindico' && tipo !== 'funcionario';
    if (!ehMoradorMobile) return undefined;
    const userId = Number(payload.user?.id ?? payload.sub);
    const vinculos = await this.prisma.apartamentos_Users.findMany({
      where: { id_user: userId },
      select: { id_apto: true },
    });
    return vinculos.map((v) => Number(v.id_apto));
  }

  private async desativarOutrosCodigosVisita(
    idCondominio: number,
    idPessoa: number,
    idVisitaAtual: number,
    // Morador: só revoga códigos das visitas dos apartamentos DELE. A visita
    // em aberto do vizinho para a mesma Pessoa não é dele para derrubar.
    aptosDoChamador?: number[],
  ): Promise<void> {
    if (!this.prisma.isConnected) return;
    await this.prisma.visitas.updateMany({
      where: {
        id_condominio: Number(idCondominio),
        id_pessoa: Number(idPessoa),
        id: { not: Number(idVisitaAtual) },
        data_entrada: null,
        data_saida: null,
        ...(aptosDoChamador ? { id_apartamento: { in: aptosDoChamador } } : {}),
      },
```

`createViaPessoasVisitas`: compute the caller's apartments and pass them along.

Before:
```ts
    const pin = await this.gerarPinUnicoVisita();

    const visita = await this.visitasService.criarVisita({
      id_condominio: Number(dto.id_condominio),
```
After:
```ts
    const pin = await this.gerarPinUnicoVisita();
    // Morador: a Pessoa (e o PIN) de outro apartamento não são dele — ver
    // OpcoesObterOuCriar e desativarOutrosCodigosVisita.
    const aptosDoChamador = await this.aptosDoMoradorMobile(operador);

    const visita = await this.visitasService.criarVisita({
      id_condominio: Number(dto.id_condominio),
```

Before:
```ts
      dias_semana: dto.dias_semana ?? null,
      categorias: dto.categorias ?? null,
    } as any);
```
After:
```ts
      dias_semana: dto.dias_semana ?? null,
      categorias: dto.categorias ?? null,
    } as any, aptosDoChamador ? { aptosDoChamador } : undefined);
```

Before:
```ts
    // vínculo estrutural.
    await this.desativarOutrosCodigosVisita(visita.id_condominio, visita.id_pessoa, visita.id);
```
After:
```ts
    // vínculo estrutural.
    await this.desativarOutrosCodigosVisita(visita.id_condominio, visita.id_pessoa, visita.id, aptosDoChamador);
```

`updateViaPessoasVisitas`: drop the identity fields for a morador when the Pessoa is shared.

Before:
```ts
    if (fotoPes !== undefined) pessoaData.foto_pessoa = fotoPes;
    if (fotoDoc !== undefined) pessoaData.foto_documento = fotoDoc;

    let updatedVisita: any;
```
After:
```ts
    if (fotoPes !== undefined) pessoaData.foto_pessoa = fotoPes;
    if (fotoDoc !== undefined) pessoaData.foto_documento = fotoDoc;

    // Pessoa compartilhada com outro apartamento: o morador edita a visita
    // dele (janela, dias), não nome/documento/fotos de quem o vizinho
    // autorizou. Ignora em vez de recusar — o app manda o formulário inteiro
    // em toda edição, e recusar travaria até a troca de horário.
    if (Object.keys(pessoaData).length > 0) {
      const aptosDoChamador = await this.aptosDoMoradorMobile(payload);
      if (
        aptosDoChamador &&
        (await pessoaTemVisitaForaDosAptos(this.prisma, ref.id_pessoa, aptosDoChamador))
      ) {
        this.logger.warn(
          `[visitantes.update] Pessoa ${ref.id_pessoa} tem visita em outro apartamento; dados pessoais ignorados para morador.`,
        );
        for (const k of Object.keys(pessoaData)) delete pessoaData[k];
      }
    }

    let updatedVisita: any;
```

(The `if (fotoPes !== undefined) pessoaData.foto_pessoa = fotoPes;` line exists only in `updateViaPessoasVisitas`, and `let updatedVisita: any;` appears once in the file.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts identidade-compartilhada pessoas visitas visitantes convites`

Expected: PASS. That covers the new suite plus the existing `pessoas*`, `visitas.service.spec`, `visitantes*` and `convites*` suites. In particular, `write-surface.pessoas-visitas` "registrar a mesma pessoa de novo revoga o PIN" and "registrar com o nome corrigido" still pass, because they call `create` without a payload, so `aptosDoChamador` is undefined.

- [ ] **Step 5: Commit**

```bash
cd C:/w/sec
git add click-cond-web/apps/api/src/app/pessoas/pessoas.service.ts click-cond-web/apps/api/src/app/visitas/visitas.service.ts click-cond-web/apps/api/src/app/visitantes/visitantes.service.ts click-cond-web/apps/api/src/app/visitantes/identidade-compartilhada.pessoas-visitas.spec.ts
git commit -m "fix(security): morador nao reescreve Pessoa compartilhada nem derruba PIN de outro apto

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task C3: Funcionario flags enforced on edit/delete visit and on reservations made or removed on someone else's behalf

**Fixes fingerprint:** `tenant/assertPermissaoFuncionario-cobertura-parcial` (only the write paths whose intent is clear; check-in, liberar, check-out and authorization decisions are deferred)

**Why:** `assertPermissaoFuncionario` exists because the per-module `Funcionarios` flags were enforced only in the app UI. In production there is a funcionario the síndico restricted on purpose. Today it is enforced on:
- `prestadores`: create, update, clearFoto and remove
- visitas: `create` only
- reservations: area CRUD and `updateStatusAgendamento` only

**Gaps closed here:**
1. `VisitantesService.update`/`remove` (both the legacy and the Pessoas paths), under flag `cadastrar_visitante`. Editing or deleting a visit is the same "cadastro" the flag already gates on create. This matches `prestadores` update/remove.
2. `insertAgendamento` with `agendarPeloSindico` (the reservation is created already `aprovado` for any apartment, and its residents are enrolled on the facial terminal), under flag `areas_sociais`.
3. `removeAgendamento` of a reservation that is not the caller's own, under flag `areas_sociais`.

The existing `areas-sociais.permissao.spec.ts` states that the flag deliberately does NOT apply to a funcionario booking for himself. Both reservation checks therefore apply only to on-behalf-of actions. `updateAgendamento` is covered by Task C1.

**Files:**
- Modify: `click-cond-web/apps/api/src/app/areas-sociais/areas-sociais.service.ts` (`insertAgendamento` ~line 679; `removeAgendamento` ~lines 876-880)
- Modify: `click-cond-web/apps/api/src/app/visitantes/visitantes.service.ts` (new private `assertFlagCadastrarVisitante`; `removeViaPessoasVisitas` ~2398; `updateViaPessoasVisitas` ~2453; `update` ~3581; `remove` ~3678)
- Modify (mock only, because the new call hits `tenant.assertPermissaoFuncionario` on hand-written tenant mocks):
  - `click-cond-web/apps/api/src/app/areas-sociais/areas-sociais.reserva-pela-portaria.spec.ts`
  - `click-cond-web/apps/api/src/app/visitantes/excluir-visita-do-app.spec.ts`
  - `click-cond-web/apps/api/src/app/visitantes/excluir-visita-registrada.pessoas-visitas.spec.ts`
  - `click-cond-web/apps/api/src/app/visitantes/visitantes.write-surface.pessoas-visitas.spec.ts`
- Test: `click-cond-web/apps/api/src/app/areas-sociais/areas-sociais.permissao-reservas.spec.ts` (new)
- Test: `click-cond-web/apps/api/src/app/visitantes/permissao-cadastrar-visitante.spec.ts` (new)

**Interfaces:**
- Consumes: `TenantAccessService.assertPermissaoFuncionario(idCondominio: number, permissao: PermissaoFuncionario, payload?: JwtPayload)`.
- Produces: private `VisitantesService.assertFlagCadastrarVisitante(idCondominio: number, payload?: JwtPayload): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Create `click-cond-web/apps/api/src/app/areas-sociais/areas-sociais.permissao-reservas.spec.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';
import { AreasSociaisService } from './areas-sociais.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * A flag `areas_sociais` é o que o síndico usa para tirar do funcionário a
 * gestão de reservas. Ela era cobrada no CRUD de área e no aprovar/recusar,
 * mas não em reservar EM NOME de um apartamento (nasce 'aprovado' e enrola o
 * apartamento no facial) nem em apagar a reserva de outro morador.
 * A reserva do próprio funcionário continua livre (areas-sociais.permissao.spec).
 */
describe('AreasSociaisService — flag areas_sociais nas reservas em nome de terceiros', () => {
  beforeAll(() => jest.useFakeTimers({ advanceTimers: true }).setSystemTime(new Date(Date.UTC(2026, 0, 1, 12, 0, 0))));
  afterAll(() => jest.useRealTimers());

  function build(flagAreas: number, reserva?: any) {
    const prisma: any = {
      isConnected: true,
      areas_Sociais: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === 30 ? { id: 30, id_condominio: 2, precisa_autorizacao: 1 } : null,
        ),
      },
      areas_Sociais_Agendamentos: {
        findMany: jest.fn(async () => []),
        create: jest.fn(async () => ({ id: 500, status: 'aprovado' })),
        findUnique: jest.fn(async () => (reserva ? { ...reserva } : null)),
        update: jest.fn(async ({ data }: any) => ({ ...reserva, ...data })),
        delete: jest.fn(async () => ({})),
      },
      areas_Sociais_Manutencoes: { findMany: jest.fn(async () => []) },
      apartamentos: { findUnique: jest.fn(async () => ({ id_condominio: 2 })) },
      apartamentos_Users: {
        findFirst: jest.fn(async () => ({ id_user: 5 })),
        findMany: jest.fn(async () => []),
      },
      sindicos_Condominios: { findFirst: jest.fn(async () => null) },
      // Vínculo do funcionário com o condomínio 2 e a flag pedida.
      funcionarios: {
        findFirst: jest.fn(async ({ where }: any) =>
          Number(where?.id_condominio) === 2 ? { id: 1, areas_sociais: flagAreas, manutencoes_programadas: 1 } : null,
        ),
      },
    };
    const facial: any = { syncReservaArea: jest.fn().mockResolvedValue({}) };
    const tenant = new TenantAccessService(prisma);
    const svc = new AreasSociaisService(
      prisma,
      { sendPushNotification: jest.fn() } as any,
      { isDataUrl: () => false, uploadDataUrl: jest.fn() } as any,
      facial,
      tenant,
    );
    return { svc, prisma };
  }

  const funcionario: JwtPayload = { sub: 6, nome: 'Zelador', typeAccess: 'Funcionario' };
  const emNomeDoApto = {
    id_area_social: 30,
    id_apartamento: 100,
    data: '20/05/2026',
    horaDe: '10:00',
    horaAte: '11:00',
    agendarPeloSindico: true,
  };

  it('NEGA reservar em nome de apartamento sem a flag', async () => {
    const { svc, prisma } = build(0);
    await expect(svc.insertAgendamento({ ...emNomeDoApto }, 6, 'Funcionario', funcionario)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.areas_Sociais_Agendamentos.create).not.toHaveBeenCalled();
  });

  it('PERMITE reservar em nome de apartamento com a flag', async () => {
    const { svc, prisma } = build(1);
    await svc.insertAgendamento({ ...emNomeDoApto }, 6, 'Funcionario', funcionario);
    expect(prisma.areas_Sociais_Agendamentos.create).toHaveBeenCalled();
  });

  it('NEGA apagar a reserva de OUTRO morador sem a flag', async () => {
    const { svc, prisma } = build(0, { id: 500, id_user: 5, status: 'pendente', area: { id_condominio: 2 } });
    await expect(svc.removeAgendamento(500, 6, 'Funcionario', funcionario)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.areas_Sociais_Agendamentos.delete).not.toHaveBeenCalled();
  });

  it('PERMITE o funcionário apagar a PRÓPRIA reserva mesmo sem a flag', async () => {
    const { svc, prisma } = build(0, { id: 501, id_user: 6, status: 'pendente', area: { id_condominio: 2 } });
    await svc.removeAgendamento(501, 6, 'Funcionario', funcionario);
    expect(prisma.areas_Sociais_Agendamentos.delete).toHaveBeenCalled();
  });
});
```

Create `click-cond-web/apps/api/src/app/visitantes/permissao-cadastrar-visitante.spec.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';
import { VisitantesService } from './visitantes.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * `cadastrar_visitante` era cobrada só no create(): o funcionário restringido
 * pelo síndico seguia editando (datas, apartamento, identidade) e apagando
 * qualquer visita do condomínio. Editar/excluir é o mesmo "cadastro" — mesmo
 * critério dos prestadores (update/remove).
 */
describe('VisitantesService — flag cadastrar_visitante em editar/excluir visita', () => {
  const original = process.env['PESSOAS_MIGRATION_ENABLED'];
  afterEach(() => {
    if (original === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = original;
  });

  const funcionario: JwtPayload = { sub: 5, nome: 'Zelador', typeAccess: 'Funcionario' };

  function build(flag: number) {
    const visita = {
      id: 50,
      id_pessoa: 7,
      id_condominio: 1,
      id_apartamento: 100,
      is_prestador: 0,
      data_entrada: null,
      data_saida: null,
      pessoa: { id: 7, nome: 'Fulano', doc_identificacao: null, face_id: null },
    };
    const visitante = { id: 500, id_condominio: 1, id_apartamento: 100, nome: 'Fulano', is_prestador: 0, face_id: null };
    const prisma: any = {
      isConnected: true,
      // Vínculo com o condomínio 1 e a flag saem da mesma linha.
      funcionarios: { findFirst: jest.fn(async () => ({ id: 1, cadastrar_visitante: flag })) },
      pessoas: { update: jest.fn(async () => ({ id: 7, nome: 'X' })) },
      visitas: {
        findUnique: jest.fn(async () => ({ ...visita })),
        update: jest.fn(async () => ({ ...visita, apartamento: { bloco: 'A', apto: '100' } })),
        delete: jest.fn(async () => ({ ...visita })),
      },
      visitantes: {
        findUnique: jest.fn(async () => ({ ...visitante })),
        update: jest.fn(async () => ({ ...visitante })),
        delete: jest.fn(async () => ({ ...visitante })),
      },
      vagas: { updateMany: jest.fn(async () => ({ count: 0 })) },
      $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    };
    const facial: any = {
      syncPessoa: jest.fn().mockResolvedValue({}),
      syncVisitante: jest.fn().mockResolvedValue({}),
      unsyncVisitante: jest.fn().mockResolvedValue(true),
    };
    const tenant = new TenantAccessService(prisma);
    const svc = new VisitantesService(
      prisma,
      {} as any,
      { isDataUrl: () => false, uploadDataUrl: jest.fn() } as any,
      facial,
      { registrar: jest.fn() } as any,
      tenant,
    );
    return { svc, prisma };
  }

  describe('Pessoas/Visitas (flag de migração ligada)', () => {
    beforeEach(() => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    });

    it('NEGA editar visita sem a flag', async () => {
      const { svc, prisma } = build(0);
      await expect(svc.update({ id: 50, nome: 'X' } as any, funcionario)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.visitas.update).not.toHaveBeenCalled();
    });

    it('NEGA excluir visita sem a flag', async () => {
      const { svc, prisma } = build(0);
      await expect(svc.remove(50, funcionario)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.visitas.delete).not.toHaveBeenCalled();
    });

    it('PERMITE excluir com a flag', async () => {
      const { svc, prisma } = build(1);
      await expect(svc.remove(50, funcionario)).resolves.toEqual({ success: true });
      expect(prisma.visitas.delete).toHaveBeenCalled();
    });
  });

  describe('legado Visitantes (flag de migração desligada)', () => {
    beforeEach(() => {
      delete process.env['PESSOAS_MIGRATION_ENABLED'];
    });

    it('NEGA editar visita sem a flag', async () => {
      const { svc, prisma } = build(0);
      await expect(svc.update({ id: 500, dias_semana: 'seg' } as any, funcionario)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.visitantes.update).not.toHaveBeenCalled();
    });

    it('NEGA excluir visita sem a flag', async () => {
      const { svc, prisma } = build(0);
      await expect(svc.remove(500, funcionario)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.visitantes.delete).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts areas-sociais.permissao-reservas permissao-cadastrar-visitante`

Expected: FAIL. Every `NEGA ...` test fails with `Received promise resolved instead of rejected`: 2 in the reservations suite and 4 in the visitantes suite. The `PERMITE ...` tests pass.

- [ ] **Step 3: Write the minimal implementation**

**3a.** `click-cond-web/apps/api/src/app/areas-sociais/areas-sociais.service.ts`, `insertAgendamento`:

Before:
```ts
    if (peloSindico) assertOperador(user, 'agendar em nome de outro morador (auto-aprovação)');
```
After:
```ts
    if (peloSindico) {
      assertOperador(user, 'agendar em nome de outro morador (auto-aprovação)');
      // Reservar em nome de um apartamento nasce 'aprovado' e enrola os
      // moradores dele no facial da área: é gestão de reservas, a mesma
      // decisão que a flag `areas_sociais` já controla no aprovar/recusar.
      // A reserva do próprio funcionário (sem agendarPeloSindico) não passa
      // por aqui — ver areas-sociais.permissao.spec.
      await this.tenant.assertPermissaoFuncionario(areaAlvo.id_condominio, 'areas_sociais', user);
    }
```

In the same file, `removeAgendamento`:

Before:
```ts
    if (typeAccess === 'Morador') {
      if (agTenantCheck.id_user !== Number(userId)) {
        throw new ForbiddenException('Você só pode remover seus próprios agendamentos.');
      }
    }
```
After:
```ts
    if (typeAccess === 'Morador') {
      if (agTenantCheck.id_user !== Number(userId)) {
        throw new ForbiddenException('Você só pode remover seus próprios agendamentos.');
      }
    }
    // Apagar a reserva de OUTRO morador é gestão de reservas: o funcionário
    // precisa da flag `areas_sociais`. A própria reserva ele apaga como
    // qualquer morador.
    if (agTenantCheck.id_user !== Number(userId)) {
      await this.tenant.assertPermissaoFuncionario(agTenantCheck.area?.id_condominio, 'areas_sociais', user);
    }
```

**3b.** `click-cond-web/apps/api/src/app/visitantes/visitantes.service.ts`.

Add the helper right before `private async assertPodeAcessarVisitante(idVisitante: number, payload?: JwtPayload) {`:

```ts
  /**
   * Flag `cadastrar_visitante` do funcionário do app nas ESCRITAS sobre uma
   * visita que já existe (editar, excluir) — mesmo critério do create() e dos
   * prestadores (update/remove). Só funcionário é afetado (o helper central
   * retorna cedo para os demais). Sem payload é chamada interna: não cobra.
   */
  private async assertFlagCadastrarVisitante(idCondominio: number, payload?: JwtPayload): Promise<void> {
    if (!payload) return;
    await this.tenant.assertPermissaoFuncionario(idCondominio, 'cadastrar_visitante', payload);
  }

```

`removeViaPessoasVisitas`. Before:
```ts
    const v = await this.assertPodeAcessarVisita(id, payload);
```
After:
```ts
    const v = await this.assertPodeAcessarVisita(id, payload);
    await this.assertFlagCadastrarVisitante(v.id_condominio, payload);
```

`updateViaPessoasVisitas`. Before:
```ts
    const ref = await this.assertPodeAcessarVisita(dto.id, payload);
```
After:
```ts
    const ref = await this.assertPodeAcessarVisita(dto.id, payload);
    await this.assertFlagCadastrarVisitante(ref.id_condominio, payload);
```

`update` (legacy path). Before:
```ts
    await this.assertPodeAcessarVisitante(dto.id, payload);
```
After:
```ts
    const refLegado = await this.assertPodeAcessarVisitante(dto.id, payload);
    await this.assertFlagCadastrarVisitante(refLegado.id_condominio, payload);
```

`remove` (legacy path). Before:
```ts
    // condomínio deles. Mesma regra de todas as outras ações da visita.
    await this.assertPodeAcessarVisitante(id, payload);
```
After:
```ts
    // condomínio deles. Mesma regra de todas as outras ações da visita.
    const refLegado = await this.assertPodeAcessarVisitante(id, payload);
    await this.assertFlagCadastrarVisitante(refLegado.id_condominio, payload);
```

**3c.** Hand-written tenant mocks now need the method, so add `assertPermissaoFuncionario` to each.

`click-cond-web/apps/api/src/app/areas-sociais/areas-sociais.reserva-pela-portaria.spec.ts`. Before:
```ts
    const tenant: any = { assertEntidade: jest.fn(async () => undefined) };
```
After:
```ts
    const tenant: any = {
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async () => undefined),
    };
```

`click-cond-web/apps/api/src/app/visitantes/excluir-visita-do-app.spec.ts`. Before:
```ts
    const tenant: any = {
      assertCondominio: jest.fn(async () => undefined),
      assertEntidade: jest.fn(async () => undefined),
    };
```
After:
```ts
    const tenant: any = {
      assertCondominio: jest.fn(async () => undefined),
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async () => undefined),
    };
```

`click-cond-web/apps/api/src/app/visitantes/excluir-visita-registrada.pessoas-visitas.spec.ts`. Before:
```ts
    const tenant: any = { assertCondominio: jest.fn(async () => undefined) };
```
After:
```ts
    const tenant: any = {
      assertCondominio: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async () => undefined),
    };
```

`click-cond-web/apps/api/src/app/visitantes/visitantes.write-surface.pessoas-visitas.spec.ts`. Edit only the occurrence inside the test `remove() apaga a Visita, solta a vaga por id_visita...` (~line 165). It is the one followed by `const service = new VisitantesService(` with `facial, auditoria, tenant, {} as any, {} as any,`.

Before:
```ts
      const facial: any = { syncPessoa: jest.fn().mockResolvedValue({}) };
      const tenant: any = { assertCondominio: jest.fn().mockResolvedValue(true) };
```
After:
```ts
      const facial: any = { syncPessoa: jest.fn().mockResolvedValue({}) };
      const tenant: any = {
        assertCondominio: jest.fn().mockResolvedValue(true),
        assertPermissaoFuncionario: jest.fn().mockResolvedValue(true),
      };
```

(The other `tenant: any = { assertCondominio: ... }` at ~line 343 serves no-payload calls, so the helper returns early and that mock needs no change.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts areas-sociais visitantes`

Expected: PASS. All `areas-sociais*` and `visitantes*` suites pass, including the two new ones.

- [ ] **Step 5: Commit**

```bash
cd C:/w/sec
git add click-cond-web/apps/api/src/app/areas-sociais/areas-sociais.service.ts click-cond-web/apps/api/src/app/visitantes/visitantes.service.ts click-cond-web/apps/api/src/app/areas-sociais/areas-sociais.permissao-reservas.spec.ts click-cond-web/apps/api/src/app/visitantes/permissao-cadastrar-visitante.spec.ts click-cond-web/apps/api/src/app/areas-sociais/areas-sociais.reserva-pela-portaria.spec.ts click-cond-web/apps/api/src/app/visitantes/excluir-visita-do-app.spec.ts click-cond-web/apps/api/src/app/visitantes/excluir-visita-registrada.pessoas-visitas.spec.ts click-cond-web/apps/api/src/app/visitantes/visitantes.write-surface.pessoas-visitas.spec.ts
git commit -m "fix(security): flags do funcionario em editar/excluir visita e reservas em nome de terceiros

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task C4: Vehicle create/update binds `id_morador` and `id_tag` to the URL condominium

**Fixes fingerprint:** `api/veiculos:create-update:id_morador-id_tag-not-tenant-bound`

**Why:** `VeiculosService.create` stores the URL `idMorador` and the body `id_tag` as given, and `update` checks only that the vehicle is in condominium A. An operator of A can therefore do three things:
- link a vehicle to condominium B's morador, which then appears in B's app, consumes B's parking quota, and leaks B's name/bloco in A's list and CSV;
- attach B's RFID tag;
- read `tag.codigo` of any tag system-wide from the `include: { tag: true }` response by iterating `id_tag`.

`Tags` and `Moradores` both carry `id_condominio`.

**Deploy note:** `Moradores.id_condominio` is nullable. Before deploy, run `SELECT COUNT(*) FROM Moradores WHERE id_condominio IS NULL;` against the RDS. Rows with NULL would now get 404 on vehicle create and must be backfilled from their apartment first.

**Files:**
- Modify: `click-cond-web/apps/api/src/app/veiculos/veiculos.service.ts` (`create` ~45-59, `update` ~61-80, new private `assertTagDoCondominio`)
- Test: `click-cond-web/apps/api/src/app/veiculos/veiculos.tenant.spec.ts` (new; the module has no spec yet)

**Interfaces:**
- Produces: private `VeiculosService.assertTagDoCondominio(idCondominio: number, idTag: number | null): Promise<void>`. The public signatures of `create(idCondominio, idMorador, dto)` and `update(idCondominio, id, dto)` are unchanged.

- [ ] **Step 1: Write the failing test**

Create `click-cond-web/apps/api/src/app/veiculos/veiculos.tenant.spec.ts`:

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { VeiculosService } from './veiculos.service';

/**
 * O TenantGuard só amarra o :idCondominio da URL. O morador (URL) e a tag
 * (corpo) eram gravados sem conferir o condomínio: o operador do condomínio 1
 * ligava veículo a morador do 2 (aparece no app dele, consome a vaga dele) ou
 * a uma tag do 2 — e a resposta trazia tag.codigo, a credencial RFID alheia.
 */
describe('VeiculosService — morador e tag precisam ser do condomínio da rota', () => {
  function build() {
    const prisma: any = {
      // Morador 10 e tag 70 são do condomínio 1; morador 20 e tag 80, do 2.
      moradores: {
        findFirst: jest.fn(async ({ where }: any) => (where.id === 10 && where.id_condominio === 1 ? { id: 10 } : null)),
      },
      tags: {
        findFirst: jest.fn(async ({ where }: any) => (where.id === 70 && where.id_condominio === 1 ? { id: 70 } : null)),
      },
      veiculos: {
        create: jest.fn(async ({ data }: any) => ({
          id: 1,
          ...data,
          tag: data.id_tag ? { id: data.id_tag, codigo: 'DUMMY' } : null,
        })),
        findFirst: jest.fn(async ({ where }: any) =>
          where.id === 5 && where.id_condominio === 1 ? { id: 5, id_condominio: 1 } : null,
        ),
        update: jest.fn(async ({ data }: any) => ({ id: 5, ...data })),
      },
    };
    return { svc: new VeiculosService(prisma), prisma };
  }

  it('NEGA cadastrar veículo para morador de outro condomínio', async () => {
    const { svc, prisma } = build();
    await expect(svc.create(1, 20, { placa: 'AAA0A00' })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.veiculos.create).not.toHaveBeenCalled();
  });

  it('NEGA cadastrar veículo com tag de outro condomínio', async () => {
    const { svc, prisma } = build();
    await expect(svc.create(1, 10, { placa: 'AAA0A00', id_tag: 80 })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.veiculos.create).not.toHaveBeenCalled();
  });

  it('NEGA trocar a tag do veículo por uma de outro condomínio (e não devolve o codigo)', async () => {
    const { svc, prisma } = build();
    await expect(svc.update(1, 5, { placa: 'AAA0A01', id_tag: 80 })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.veiculos.update).not.toHaveBeenCalled();
  });

  it('PERMITE morador e tag do próprio condomínio', async () => {
    const { svc, prisma } = build();
    await svc.create(1, 10, { placa: 'AAA0A00', id_tag: 70 });
    expect(prisma.veiculos.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ id_morador: 10, id_tag: 70, id_condominio: 1 }) }),
    );
  });

  it('PERMITE editar sem tag sem consultar Tags', async () => {
    const { svc, prisma } = build();
    await svc.update(1, 5, { placa: 'AAA0A01', id_tag: null });
    expect(prisma.tags.findFirst).not.toHaveBeenCalled();
    expect(prisma.veiculos.update).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts veiculos.tenant`

Expected: FAIL. The three `NEGA ...` tests fail with `Received promise resolved instead of rejected`, and the two `PERMITE` tests pass.

- [ ] **Step 3: Write the minimal implementation**

In `click-cond-web/apps/api/src/app/veiculos/veiculos.service.ts`:

Before:
```ts
  async create(idCondominio: number, idMorador: number, dto: VeiculoDto) {
    const data = this.normalizar(dto);
    data.placa = validarPlaca(data.placa);
    try {
```
After:
```ts
  /**
   * `id_tag` vem do corpo e `Veiculos.id_tag` referencia Tags só por id: sem
   * esta checagem o operador anexava a tag de outro condomínio — e a resposta
   * (`include: { tag: true }`) devolvia o `codigo` RFID dela.
   */
  private async assertTagDoCondominio(idCondominio: number, idTag: number | null): Promise<void> {
    if (idTag == null) return;
    const tag = await this.prisma.tags.findFirst({
      where: { id: Number(idTag), id_condominio: idCondominio },
      select: { id: true },
    });
    if (!tag) throw new BadRequestException('Tag inválida para este condomínio.');
  }

  async create(idCondominio: number, idMorador: number, dto: VeiculoDto) {
    const data = this.normalizar(dto);
    data.placa = validarPlaca(data.placa);
    // O morador vem da URL e o TenantGuard só amarra o :idCondominio: confere
    // que ele é deste condomínio, senão o veículo aparecia no app (e na cota
    // de vagas) de um morador de outro prédio.
    const morador = await this.prisma.moradores.findFirst({
      where: { id: Number(idMorador), id_condominio: idCondominio },
      select: { id: true },
    });
    if (!morador) throw new NotFoundException(`Morador ${idMorador} não encontrado`);
    await this.assertTagDoCondominio(idCondominio, data.id_tag);
    try {
```

Before:
```ts
    if (!existing) throw new NotFoundException(`Veículo ${id} não encontrado`);
    const data = this.normalizar(dto);
    data.placa = validarPlaca(data.placa);
    try {
      return await this.prisma.veiculos.update({
```
After:
```ts
    if (!existing) throw new NotFoundException(`Veículo ${id} não encontrado`);
    const data = this.normalizar(dto);
    data.placa = validarPlaca(data.placa);
    await this.assertTagDoCondominio(idCondominio, data.id_tag);
    try {
      return await this.prisma.veiculos.update({
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts veiculos`

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd C:/w/sec
git add click-cond-web/apps/api/src/app/veiculos/veiculos.service.ts click-cond-web/apps/api/src/app/veiculos/veiculos.tenant.spec.ts
git commit -m "fix(security): veiculo so liga a morador e tag do proprio condominio

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task C5: Ocorrência assignment accepts only staff of the ocorrência's condominium

**Fixes fingerprint:** `api/ocorrencias:atribuir:id_responsavel-not-tenant-bound`

**Why:** `OcorrenciasService.atribuir` (reached by PATCH `/condominios/:id/ocorrencias/:id/responsavel` and by the app's POST `/ocorrencias/update-responsavel`) stores any `Users.id`. `findOne`/`findAll` then resolve `responsavelNome` without a tenant filter, so staff of condominium A can enumerate user names system-wide and send an "Ocorrência atribuída a você" push to users of other condominiums.

The assignable set is already defined by `listFuncionariosAtribuiveis`, which maps active `Funcionarios_Portaria` of the condominium to `Users.id` by login. The app picker (`detail_ocorrencia.dart` → `apiGetAll("funcionarios")` → `MobileAuthService.getAllFuncionarios`) builds `id_user` the same way, so legitimate picks are unchanged. The app's fallback `f['id']`, used when `id_user` is null, sends a `Funcionarios_Portaria.id`, which is not a `Users.id` and was already a wrong assignment. That case now gets a 400.

**Files:**
- Modify: `click-cond-web/apps/api/src/app/ocorrencias/ocorrencias.service.ts` (`loadParaMutacaoStaff` ~50-55 returns the loaded row; `atribuir` ~353-355)
- Test: `click-cond-web/apps/api/src/app/ocorrencias/atribuir-responsavel.tenant.spec.ts` (new)

**Interfaces:**
- Produces: private `loadParaMutacaoStaff(...)` now returns `{ id_condominio: number }`. Existing callers ignore the return value. `atribuir(id, idResponsavel, user)` signature is unchanged.

- [ ] **Step 1: Write the failing test**

Create `click-cond-web/apps/api/src/app/ocorrencias/atribuir-responsavel.tenant.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { OcorrenciasService } from './ocorrencias.service';

/**
 * `id_responsavel` era um Users.id global, sem conferir o condomínio: a
 * equipe do condomínio 1 atribuía a ocorrência a qualquer usuário do sistema,
 * lia o nome dele de volta em responsavelNome e disparava push para ele.
 * O conjunto atribuível já existe: listFuncionariosAtribuiveis.
 */
describe('OcorrenciasService.atribuir — responsável precisa ser da equipe do condomínio', () => {
  const sindico: any = { sub: 1, typeAccess: 'Sindico', user: { id: 1 } };

  function build() {
    const prisma: any = {
      ocorrencias: {
        findUnique: jest.fn(async () => ({ id_condominio: 1 })),
        update: jest.fn(async ({ data }: any) => ({ id: 7, ...data, categoria: null })),
      },
      // Equipe do condomínio 1: o porteiro com login porteiro@a → Users.id 31.
      funcionarios_Portaria: {
        findMany: jest.fn(async () => [{ id: 3, login: 'porteiro@a', nome: 'Porteiro A', turno: 'Diurno', ativo: 1 }]),
      },
      users: {
        findMany: jest.fn(async () => [{ id: 31, login: 'porteiro@a' }]),
        findUnique: jest.fn(async () => ({ fcm_token: 'tok' })),
      },
    };
    const notifications: any = { sendPushNotification: jest.fn(async () => 'ok') };
    const tenant: any = { assertEntidade: jest.fn(async () => undefined) };
    return { svc: new OcorrenciasService(prisma, notifications, tenant), prisma, notifications };
  }

  it('NEGA atribuir a um usuário que não é da equipe do condomínio', async () => {
    const { svc, prisma, notifications } = build();
    await expect(svc.atribuir(7, 99, sindico)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.ocorrencias.update).not.toHaveBeenCalled();
    expect(notifications.sendPushNotification).not.toHaveBeenCalled();
  });

  it('PERMITE atribuir a funcionário do condomínio e avisa por push', async () => {
    const { svc, prisma, notifications } = build();
    await svc.atribuir(7, 31, sindico);
    expect(prisma.ocorrencias.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { id_responsavel: 31 } }),
    );
    expect(notifications.sendPushNotification).toHaveBeenCalled();
  });

  it('desatribuir (null) não consulta a equipe', async () => {
    const { svc, prisma } = build();
    await svc.atribuir(7, null, sindico);
    expect(prisma.funcionarios_Portaria.findMany).not.toHaveBeenCalled();
    expect(prisma.ocorrencias.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { id_responsavel: null } }),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts atribuir-responsavel.tenant`

Expected: FAIL. `NEGA atribuir a um usuário que não é da equipe...` fails with `Received promise resolved instead of rejected`. The other two pass.

- [ ] **Step 3: Write the minimal implementation**

In `click-cond-web/apps/api/src/app/ocorrencias/ocorrencias.service.ts`:

Before:
```ts
    if (!o) throw new NotFoundException(`Ocorrência ${id} não encontrada`);
    await this.tenant.assertEntidade(o.id_condominio, user, `ocorrência #${id}`);
  }
```
After:
```ts
    if (!o) throw new NotFoundException(`Ocorrência ${id} não encontrada`);
    await this.tenant.assertEntidade(o.id_condominio, user, `ocorrência #${id}`);
    return o;
  }
```

Before:
```ts
  async atribuir(id: number, idResponsavel: number | null, user?: JwtPayload) {
    await this.loadParaMutacaoStaff(id, user, 'atribuir ocorrência');
    let updated;
```
After:
```ts
  async atribuir(id: number, idResponsavel: number | null, user?: JwtPayload) {
    const o = await this.loadParaMutacaoStaff(id, user, 'atribuir ocorrência');
    // O responsável vem do corpo como Users.id global: precisa estar na
    // equipe atribuível DESTE condomínio (a mesma lista que o app e o console
    // mostram). Sem isso, a equipe de um condomínio lia o nome de qualquer
    // usuário do sistema (responsavelNome) e mandava push para ele.
    if (idResponsavel != null) {
      const atribuiveis = await this.listFuncionariosAtribuiveis(o.id_condominio);
      if (!atribuiveis.some((f) => f.id_user === Number(idResponsavel))) {
        throw new BadRequestException('Responsável inválido: escolha um funcionário deste condomínio.');
      }
    }
    let updated;
```

(`BadRequestException` is already imported in this file.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts ocorrencias`

Expected: PASS. All `ocorrencias*` suites pass, including the existing `ocorrencias-push.spec.ts` (`updateResposta`/`updateStatus` ignore the new return value).

- [ ] **Step 5: Commit**

```bash
cd C:/w/sec
git add click-cond-web/apps/api/src/app/ocorrencias/ocorrencias.service.ts click-cond-web/apps/api/src/app/ocorrencias/atribuir-responsavel.tenant.spec.ts
git commit -m "fix(security): responsavel da ocorrencia precisa ser da equipe do condominio

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task C6: Legacy Express API refuses to start without JWT_SECRET / SESSION_SECRET

**Fixes fingerprint:** `legacy-api-jwt-public-fallback-secret`

**Why:** `click-cond-api/click-cond-api/src/configs/config.js` signs and verifies every legacy JWT with `process.env.JWT_SECRET || 'fallback-secret-for-dev-only'`, and `app.js:51` uses `SESSION_SECRET || 'dev-session-secret'`. Both literals are in the repository. An instance started without the env (for example, from `.env.example`, which lists neither) accepts forged tokens for any user against the database it points at, and per owner notes the dev `.env` points at the production RDS.

The fix mirrors the NestJS `resolveJwtSecret` (`apps/api/src/app/auth/jwt-secret.ts`): no literal; throw at boot unless `NODE_ENV === 'test'`. This is stricter than "fail closed outside development", deliberately: a development instance also reaches the production RDS. The owner's local `click-cond-api/click-cond-api/.env` already defines both variables (non-empty), so `npm run dev` keeps working. The legacy package uses no `NODE_ENV` anywhere else and has no test runner, so the test uses `node:test` and has no dependencies.

**Files:**
- Create: `click-cond-api/click-cond-api/src/configs/secrets.js`
- Modify: `click-cond-api/click-cond-api/src/configs/config.js:3`
- Modify: `click-cond-api/click-cond-api/app.js` (require near the top and line 51)
- Modify: `click-cond-api/click-cond-api/.env.example` (document both vars)
- Test: `click-cond-api/click-cond-api/test/secrets.test.js` (new)

**Interfaces:**
- Produces: `module.exports = { resolveSecret }`, with `resolveSecret(name: string, env = process.env): string`.

- [ ] **Step 1: Write the failing test**

Create `click-cond-api/click-cond-api/test/secrets.test.js`:

```js
// Roda com: node --test test/secrets.test.js  (sem dependências)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const { resolveSecret } = require('../src/configs/secrets');

function envSem(...nomes) {
  const env = { ...process.env };
  for (const n of nomes) delete env[n];
  delete env.NODE_ENV;
  return env;
}

test('resolveSecret devolve o valor definido no ambiente', () => {
  assert.equal(resolveSecret('JWT_SECRET', { JWT_SECRET: 'segredo-de-verdade' }), 'segredo-de-verdade');
});

test('resolveSecret recusa segredo ausente ou em branco fora de teste', () => {
  assert.throws(() => resolveSecret('JWT_SECRET', {}), /JWT_SECRET não está definido/);
  assert.throws(() => resolveSecret('JWT_SECRET', { JWT_SECRET: '   ', NODE_ENV: 'production' }), /JWT_SECRET/);
  assert.throws(() => resolveSecret('SESSION_SECRET', { NODE_ENV: 'development' }), /SESSION_SECRET/);
});

test('em NODE_ENV=test usa um segredo só de teste', () => {
  assert.equal(resolveSecret('JWT_SECRET', { NODE_ENV: 'test' }), 'test-only-JWT_SECRET');
});

test('config.js não carrega sem JWT_SECRET (sem fallback público)', () => {
  const r = spawnSync(process.execPath, ['-e', "require('./src/configs/config.js')"], {
    cwd: ROOT,
    env: envSem('JWT_SECRET'),
    encoding: 'utf8',
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /JWT_SECRET não está definido/);
});

test('config.js usa o JWT_SECRET do ambiente', () => {
  const r = spawnSync(
    process.execPath,
    ['-e', "process.stdout.write(require('./src/configs/config.js').jwt.secretKey)"],
    { cwd: ROOT, env: { ...envSem('JWT_SECRET'), JWT_SECRET: 'abc123-def456' }, encoding: 'utf8' },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'abc123-def456');
});

test('nenhum segredo literal sobra em config.js e app.js', () => {
  const config = fs.readFileSync(path.join(ROOT, 'src/configs/config.js'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  assert.doesNotMatch(config, /fallback-secret/);
  assert.doesNotMatch(app, /dev-session-secret/);
  assert.match(app, /resolveSecret\('SESSION_SECRET'\)/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:/w/sec/click-cond-api/click-cond-api && node --test test/secrets.test.js`

Expected: FAIL. Loading the file throws `Cannot find module '../src/configs/secrets'`, so the test file reports a failure.

- [ ] **Step 3: Write the minimal implementation**

Create `click-cond-api/click-cond-api/src/configs/secrets.js`:

```js
/**
 * Lê um segredo obrigatório do ambiente (JWT_SECRET, SESSION_SECRET).
 *
 * Sem fallback embutido: antes, uma env ausente fazia a API legada subir
 * assinando/verificando token com um literal que está no repositório —
 * qualquer um forjava sessão de qualquer usuário no banco para onde a
 * instância aponta (e o .env de desenvolvimento aponta para o RDS de
 * produção). Mesmo critério do resolveJwtSecret da API NestJS
 * (click-cond-web/apps/api/src/app/auth/jwt-secret.ts): sem a env, não sobe.
 *
 * NODE_ENV=test usa um valor só de teste para os testes rodarem sem .env.
 */
function resolveSecret(name, env = process.env) {
  const value = env[name];
  if (typeof value === 'string' && value.trim().length > 0) return value;
  if (env.NODE_ENV === 'test') return `test-only-${name}`;
  throw new Error(
    `${name} não está definido. Configure a variável de ambiente antes de iniciar a API legada.`,
  );
}

module.exports = { resolveSecret };
```

`click-cond-api/click-cond-api/src/configs/config.js`. Before:
```js
module.exports = {
    jwt: {
      secretKey: process.env.JWT_SECRET || 'fallback-secret-for-dev-only',
    },
```
After:
```js
const { resolveSecret } = require('./secrets');

module.exports = {
    jwt: {
      secretKey: resolveSecret('JWT_SECRET'),
    },
```

`click-cond-api/click-cond-api/app.js`. Before:
```js
const compression = require('compression');
```
After:
```js
const compression = require('compression');
const { resolveSecret } = require('./src/configs/secrets');
```

Before:
```js
app.use(session({ secret: process.env.SESSION_SECRET || 'dev-session-secret' }));
```
After:
```js
app.use(session({ secret: resolveSecret('SESSION_SECRET') }));
```

`click-cond-api/click-cond-api/.env.example`: append:
```
# Segredos obrigatórios: sem eles a API não sobe (não há fallback no código).
# Gere valores longos e aleatórios, ex.: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
JWT_SECRET=
SESSION_SECRET=
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd C:/w/sec/click-cond-api/click-cond-api && node --test test/secrets.test.js`

Expected: PASS. All 6 tests pass (`# pass 6`, `# fail 0`).

- [ ] **Step 5: Commit**

```bash
cd C:/w/sec
git add click-cond-api/click-cond-api/src/configs/secrets.js click-cond-api/click-cond-api/src/configs/config.js click-cond-api/click-cond-api/app.js click-cond-api/click-cond-api/.env.example click-cond-api/click-cond-api/test/secrets.test.js
git commit -m "fix(security): api legada nao sobe sem JWT_SECRET/SESSION_SECRET

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Owner follow-up:** confirm that no legacy Express instance is reachable, or that every running one sets both variables to random values. Any token ever signed with the old literal stays valid on an instance that still runs the old code.

---

### Task C7: Production deploy, signing and migration jobs run only from the protected branch, behind the `production` environment

**Fixes fingerprints:** `gha-prod-deploy-secrets-any-ref-no-environment`, `gha-db-migration-unbound-ref`

**Why:** The workflows let a dispatch from any ref reach production with production secrets:
- `ci.yml` runs its "Empacotar" and "Deploy no AWS Elastic Beanstalk" steps for any `workflow_dispatch`, from any ref, using `AWS_*`.
- `deploy-api.yml`, `ios-release.yml` (`ASC_*`/`MATCH_*` signing and App Store upload) and `prepare-api-domain.yml` (`AWS_*`) have no `environment:` and no ref guard.
- `database-migration.yml` runs the dispatched ref's SQL and runner script against production. Its only gate is `environment: production`, whose protection rules are not visible in source.

A repository writer who cannot merge to master/main can therefore ship unreviewed code to the production API, sign and submit an app build, or run SQL on RDS.

**Source fix:**
- Every job that references `secrets.` gets `environment: production` plus `if: github.ref == 'refs/heads/<master|main>'`.
- `ci.yml` moves the deploy into its own `deploy` job. The `api` job, which also runs for PRs, no longer sees AWS credentials. It only builds and uploads the bundle on master.
- `permissions: contents: read` is added to `ci.yml` and `ios-release.yml`.

**The source guard is not enough on its own.** Repository-scoped secrets can still be read by a writer who pushes a new workflow file on a side branch. The decisive control is GitHub configuration, which only the owner can do (see "Owner configuration" at the end of this task).

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/deploy-api.yml` (job `deploy`)
- Modify: `.github/workflows/database-migration.yml` (job `migrate`)
- Modify: `.github/workflows/ios-release.yml` (top level and job `build`)
- Modify: `.github/workflows/prepare-api-domain.yml` (job `certificate`)
- Test: `click-cond-web/scripts/test/workflows-gate.test.mjs` (new; uses `js-yaml`, which is already present in `click-cond-web/node_modules`)

**Interfaces:** none (CI configuration). The new `ci.yml` job ID is `deploy`. It downloads the artifact `deploy-api-aws` uploaded by job `api`.

- [ ] **Step 1: Write the failing test**

Create `click-cond-web/scripts/test/workflows-gate.test.mjs`:

```js
// Roda com: cd click-cond-web && node --test scripts/test/workflows-gate.test.mjs
//
// Regra: todo job de workflow que usa `secrets.` precisa (1) do environment
// `production` e (2) de um `if` que o prenda a refs/heads/master ou main.
// Sem isso, um workflow_dispatch de qualquer branch chegava em produção com
// as credenciais da AWS / da Apple.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const here = path.dirname(fileURLToPath(import.meta.url));
const WF_DIR = path.resolve(here, '../../../.github/workflows');
const REF_PROTEGIDA = /github\.ref\s*==\s*'refs\/heads\/(master|main)'/;

function workflows() {
  return fs
    .readdirSync(WF_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => ({ arquivo: f, wf: yaml.load(fs.readFileSync(path.join(WF_DIR, f), 'utf8')) }));
}

function nomeDoEnvironment(job) {
  if (!job.environment) return null;
  return typeof job.environment === 'string' ? job.environment : job.environment.name;
}

test('todo job que usa segredo está no environment production e preso a master/main', () => {
  const violacoes = [];
  for (const { arquivo, wf } of workflows()) {
    for (const [id, job] of Object.entries(wf.jobs ?? {})) {
      if (!JSON.stringify(job).includes('secrets.')) continue;
      if (nomeDoEnvironment(job) !== 'production') violacoes.push(`${arquivo}:${id} sem environment production`);
      if (!REF_PROTEGIDA.test(String(job.if ?? ''))) violacoes.push(`${arquivo}:${id} sem if de ref protegida`);
    }
  }
  assert.deepEqual(violacoes, []);
});

test('ci.yml: o job api (que roda em PR) não tem credencial nenhuma', () => {
  const ci = workflows().find((w) => w.arquivo === 'ci.yml').wf;
  assert.equal(JSON.stringify(ci.jobs.api).includes('secrets.'), false);
  assert.ok(ci.jobs.deploy, 'job deploy existe');
  assert.deepEqual([].concat(ci.jobs.deploy.needs), ['api']);
});

test('database-migration.yml só roda a partir do master', () => {
  const mig = workflows().find((w) => w.arquivo === 'database-migration.yml').wf;
  assert.match(String(mig.jobs.migrate.if ?? ''), /github\.ref\s*==\s*'refs\/heads\/master'/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:/w/sec/click-cond-web && node --test scripts/test/workflows-gate.test.mjs`

Expected: FAIL.
- Test 1 lists violations including:
  - `ci.yml:api sem environment production`
  - `deploy-api.yml:deploy sem environment production`
  - `database-migration.yml:migrate sem if de ref protegida`
  - `ios-release.yml:build sem environment production`
  - `prepare-api-domain.yml:certificate sem environment production`
- Test 2 fails because `ci.yml` job `api` contains `secrets.`.
- Test 3 fails because `migrate.if` is undefined.

- [ ] **Step 3: Write the minimal implementation**

**`.github/workflows/ci.yml`.** Add a top-level `permissions` after `on`.

Before:
```yaml
  pull_request:
  workflow_dispatch:

# Um push novo cancela a execução anterior da mesma branch — não adianta
```
After:
```yaml
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

# Um push novo cancela a execução anterior da mesma branch — não adianta
```

Job `api` concurrency: the EB serialization moves to the new `deploy` job.

Before:
```yaml
    # No master este job publica no mesmo ambiente EB que o deploy-api.yml
    # (push em main). Mesmo grupo = fila: sem isso os dois colidiam e um
    # falhava com "Environment ... Must be Ready".
    concurrency:
      group: ${{ github.ref == 'refs/heads/master' && 'elastic-beanstalk-api-production' || format('ci-api-{0}', github.ref) }}
      cancel-in-progress: false
```
After:
```yaml
    # A publicação no EB saiu deste job (ver `deploy`): ele roda em PR e não
    # deve ter credencial nenhuma.
    concurrency:
      group: ci-api-${{ github.ref }}
      cancel-in-progress: false
```

Replace the last two steps of job `api` (from the comment `# Deploy contínuo da API na AWS Elastic Beanstalk:` through `wait_for_environment_recovery: 180`) and add the `deploy` job before `app:`.

Before:
```yaml
      # Deploy contínuo da API na AWS Elastic Beanstalk:
      # Roda apenas em push na branch master após os testes e builds passarem.
      - name: Empacotar API para Elastic Beanstalk
        if: (github.ref == 'refs/heads/master' && github.event_name == 'push') || github.event_name == 'workflow_dispatch'
        run: node scripts/migration/bundle-eb.mjs

      - name: Deploy no AWS Elastic Beanstalk
        if: (github.ref == 'refs/heads/master' && github.event_name == 'push') || github.event_name == 'workflow_dispatch'
        uses: einaregilsson/beanstalk-deploy@v22
        with:
          aws_access_key: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws_secret_key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          application_name: click-prestare-api
          environment_name: Clickprestareapi-env
          version_label: "v-${{ github.run_number }}-${{ github.sha }}"
          region: sa-east-1
          deployment_package: click-cond-web/deploy-api-aws.zip
          use_existing_version_if_available: true
          wait_for_deployment: true
          wait_for_environment_recovery: 180

  app:
```
After:
```yaml
      # Deploy contínuo da API na AWS Elastic Beanstalk. Aqui só empacota (no
      # master: push ou disparo manual A PARTIR do master); quem publica é o
      # job `deploy`, o único com as credenciais da AWS. Antes, um
      # workflow_dispatch de QUALQUER branch publicava o código dela.
      - name: Empacotar API para Elastic Beanstalk
        if: github.ref == 'refs/heads/master' && github.event_name != 'pull_request'
        run: node scripts/migration/bundle-eb.mjs

      - name: Guardar pacote do Elastic Beanstalk
        if: github.ref == 'refs/heads/master' && github.event_name != 'pull_request'
        uses: actions/upload-artifact@v4
        with:
          name: deploy-api-aws
          path: click-cond-web/deploy-api-aws.zip
          retention-days: 1

  deploy:
    name: Deploy no AWS Elastic Beanstalk
    needs: api
    if: github.ref == 'refs/heads/master' && github.event_name != 'pull_request'
    runs-on: ubuntu-latest
    # Segredos da AWS ficam no environment `production` (regras de proteção e
    # branches permitidas configuradas no GitHub).
    environment: production
    # Mesmo ambiente EB que o deploy-api.yml (push em main). Mesmo grupo =
    # fila: sem isso os dois colidiam e um falhava com "Environment ... Must
    # be Ready".
    concurrency:
      group: elastic-beanstalk-api-production
      cancel-in-progress: false
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: deploy-api-aws

      - name: Deploy no AWS Elastic Beanstalk
        uses: einaregilsson/beanstalk-deploy@v22
        with:
          aws_access_key: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws_secret_key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          application_name: click-prestare-api
          environment_name: Clickprestareapi-env
          version_label: "v-${{ github.run_number }}-${{ github.sha }}"
          region: sa-east-1
          deployment_package: deploy-api-aws.zip
          use_existing_version_if_available: true
          wait_for_deployment: true
          wait_for_environment_recovery: 180

  app:
```

**`.github/workflows/deploy-api.yml`.** Before:
```yaml
jobs:
  deploy:
    name: Build and deploy API
    runs-on: ubuntu-latest
```
After:
```yaml
jobs:
  deploy:
    name: Build and deploy API
    # Só a partir da main (push ou disparo manual NA main): antes, disparar de
    # qualquer branch publicava o código dela em produção.
    if: github.ref == 'refs/heads/main'
    environment: production
    runs-on: ubuntu-latest
```

**`.github/workflows/database-migration.yml`.** Before:
```yaml
  migrate:
    name: Apply selected migration
    runs-on: ubuntu-latest
    environment: production
```
After:
```yaml
  migrate:
    name: Apply selected migration
    # O SQL e o próprio run-sql-migration.mjs saem do checkout da ref
    # disparada: só o master (protegido) pode fornecê-los.
    if: github.ref == 'refs/heads/master'
    runs-on: ubuntu-latest
    environment: production
```

**`.github/workflows/ios-release.yml`.** Before:
```yaml
          - testflight
          - app-store

jobs:
  build:
    name: Build e envio
    runs-on: macos-15
```
After:
```yaml
          - testflight
          - app-store

permissions:
  contents: read

jobs:
  build:
    name: Build e envio
    # Assinar e enviar à Apple só a partir de branch protegida: o Matchfile
    # diz que acesso ao código não pode bastar para assinar.
    if: github.ref == 'refs/heads/master' || github.ref == 'refs/heads/main'
    environment: production
    runs-on: macos-15
```

**`.github/workflows/prepare-api-domain.yml`.** Before:
```yaml
jobs:
  certificate:
    runs-on: ubuntu-latest
```
After:
```yaml
jobs:
  certificate:
    if: github.ref == 'refs/heads/master'
    environment: production
    runs-on: ubuntu-latest
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd C:/w/sec/click-cond-web && node --test scripts/test/workflows-gate.test.mjs`

Expected: PASS (`# pass 3`, `# fail 0`).

Optional: if `actionlint` is installed, run it as an extra syntax check: `cd C:/w/sec && actionlint .github/workflows/*.yml`. It should print no errors.

- [ ] **Step 5: Commit**

```bash
cd C:/w/sec
git add .github/workflows/ci.yml .github/workflows/deploy-api.yml .github/workflows/database-migration.yml .github/workflows/ios-release.yml .github/workflows/prepare-api-domain.yml click-cond-web/scripts/test/workflows-gate.test.mjs
git commit -m "fix(security): deploy, assinatura iOS e migracao so de master/main no environment production

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Owner configuration (required; source cannot enforce it):**
1. Settings → Environments → `production`: under "Deployment branches and tags", choose "Selected branches" and allow only `master` and `main`. Optionally add required reviewers. Note that reviewers make every master push wait for an approval before the EB deploy.
2. Move `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `DATABASE_URL`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8_BASE64`, `MATCH_GIT_URL`, `MATCH_PASSWORD` and `MATCH_GIT_BASIC_AUTHORIZATION` into the `production` environment's secrets, and then delete the repository-level copies. Until then, a writer can read them from a new workflow on a side branch.
3. Add branch protection or rulesets on `master` and `main` (require PR review, no force-push).
4. Prefer separate AWS principals, or OIDC roles, for the EB deploy and for the RDS security-group change in the migration workflow.

The first push after merge also shows whether the `production` environment already exists. GitHub creates it on first use if it does not.

---

### Task C8: Tracked scripts no longer hardcode account passwords

**Fixes fingerprint:** `repo-hardcoded-account-passwords-scripts`

**Why:** Tracked scripts create or reset accounts in the database from `.env`, which points at the production RDS, using literal passwords that anyone who read the repository has seen. The repository was public before. The affected scripts and accounts:

| Script | Account | Password |
|---|---|---|
| `click-cond-web/scripts/create-sindico.ts` | `sindico.teste@clickprestarecondominios.com.br` | `sindico123` |
| `click-cond-web/scripts/criar-sindico-portaria.ts` | portaria login `sindico@click.com`, turno Síndico | `clickpassword123` |
| `click-cond-web/scripts/seed-teste-banco.ts` | `morador.teste*@exemplo.com` | `123456` |
| `click-cond-api/click-cond-api/create_sindico_railway.js` | `sindico@click.com` | `sindico123` |
| `click-cond-api/click-cond-api/create_final_user.js`, `populate_railway.js` | `fui@eu.com` | `999888` |
| `click-cond-api/click-cond-api/create_user.js`, `fix_user.js`, `debug_login.js` | `teste@click.com` | `123456` |
| `click-cond-api/click-cond-api/test_login.js` | `morador@teste.com` | `123456` |

All of them now read the password from the required env var `SCRIPT_PASSWORD`. Account-creating scripts require at least 12 characters, and the scripts stop printing the password.

**Owner must rotate:** removing the literals from HEAD does not change the accounts or git history. See the follow-up after Step 5.

**Files:**
- Modify: `click-cond-web/scripts/create-sindico.ts:30,96`
- Modify: `click-cond-web/scripts/criar-sindico-portaria.ts:22,63`
- Modify: `click-cond-web/scripts/seed-teste-banco.ts:185`
- Modify: `click-cond-api/click-cond-api/create_final_user.js:15`
- Modify: `click-cond-api/click-cond-api/create_sindico_railway.js:17,49`
- Modify: `click-cond-api/click-cond-api/create_user.js:15,18`
- Modify: `click-cond-api/click-cond-api/debug_login.js:14,28`
- Modify: `click-cond-api/click-cond-api/fix_user.js:15,18`
- Modify: `click-cond-api/click-cond-api/populate_railway.js:18,71`
- Modify: `click-cond-api/click-cond-api/test_login.js:5`
- Test: `click-cond-web/scripts/test/sem-senha-literal.test.mjs` (new)

**Interfaces:** the env var `SCRIPT_PASSWORD` (required by every script above).

- [ ] **Step 1: Write the failing test**

Create `click-cond-web/scripts/test/sem-senha-literal.test.mjs`:

```js
// Roda com: cd click-cond-web && node --test scripts/test/sem-senha-literal.test.mjs
//
// Os scripts que criam/resetam contas rodam contra o banco do .env (o RDS de
// produção). Senha literal neles vira credencial conhecida por quem leu o
// repositório. A senha vem de SCRIPT_PASSWORD.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '../../..');

const PADROES = [
  // const SENHA = 'x' / const pass = "x" / password: 'x' (literal de 4+ chars)
  /\b(password|senha|SENHA|[a-zA-Z]*[pP]ass)[A-Za-z_]*\s*[:=]\s*['"][^'"$]{4,}['"]/,
  // bcrypt.hash('literal', ...)
  /bcrypt\.hash\(\s*['"]/,
  // as senhas que já vazaram, em qualquer forma (inclusive em console.log)
  /['"](?:123456|999888|sindico123|clickpassword123)['"]/,
];

function arquivosAlvo() {
  const saida = execFileSync(
    'git',
    ['ls-files', '--', 'click-cond-web/scripts', 'click-cond-api/click-cond-api'],
    { cwd: REPO, encoding: 'utf8' },
  );
  return saida
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((f) => /\.(ts|js|mjs)$/.test(f))
    .filter((f) => !f.startsWith('click-cond-web/scripts/test/'))
    // Na API legada só os scripts soltos da raiz (src/ é o servidor).
    .filter((f) => f.startsWith('click-cond-web/scripts/') || f.split('/').length === 3);
}

test('nenhum script versionado traz senha literal', () => {
  const achados = [];
  for (const rel of arquivosAlvo()) {
    const linhas = fs.readFileSync(path.join(REPO, rel), 'utf8').split(/\r?\n/);
    linhas.forEach((linha, i) => {
      if (linha.includes('process.env')) return;
      if (PADROES.some((re) => re.test(linha))) achados.push(`${rel}:${i + 1}: ${linha.trim()}`);
    });
  }
  assert.deepEqual(achados, []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:/w/sec/click-cond-web && node --test scripts/test/sem-senha-literal.test.mjs`

Expected: FAIL. The `achados` array lists 13 lines:
- `create_final_user.js:15`
- `create_sindico_railway.js:17` and `:49`
- `create_user.js:15`
- `debug_login.js:14` and `:28`
- `fix_user.js:15`
- `populate_railway.js:18` and `:71`
- `test_login.js:5`
- `create-sindico.ts:30`
- `criar-sindico-portaria.ts:22`
- `seed-teste-banco.ts:185`

- [ ] **Step 3: Write the minimal implementation**

**`click-cond-web/scripts/create-sindico.ts`.** Before:
```ts
  const SENHA = 'sindico123';
```
After:
```ts
  // Senha da conta: nunca literal (este script grava no banco do .env, que é
  // o RDS de produção). Ex.: SCRIPT_PASSWORD='...' npx tsx scripts/create-sindico.ts
  const SENHA = process.env['SCRIPT_PASSWORD'] ?? '';
  if (SENHA.length < 12) {
    throw new Error('Defina SCRIPT_PASSWORD (mínimo 12 caracteres) com a senha da conta.');
  }
```
Before:
```ts
    console.log('   Senha.....:', SENHA);
```
After:
```ts
    console.log('   Senha.....: (a definida em SCRIPT_PASSWORD)');
```

**`click-cond-web/scripts/criar-sindico-portaria.ts`.** Before:
```ts
    const senhaPlana = "clickpassword123";
```
After:
```ts
    // Nunca literal: grava no banco do .env (RDS de produção).
    const senhaPlana = process.env['SCRIPT_PASSWORD'] ?? '';
    if (senhaPlana.length < 12) {
      throw new Error('Defina SCRIPT_PASSWORD (mínimo 12 caracteres) com a senha da conta.');
    }
```
Before:
```ts
    console.log(`Senha de Segurança:     ${senhaPlana}`);
```
After:
```ts
    console.log(`Senha de Segurança:     (a definida em SCRIPT_PASSWORD)`);
```

**`click-cond-web/scripts/seed-teste-banco.ts`.** Before:
```ts
  const senhaPadrao = await bcrypt.hash('123456', 10);
```
After:
```ts
  // Senha dos moradores de teste: nunca literal (o seed roda no banco do .env).
  const senhaSeed = process.env['SCRIPT_PASSWORD'] ?? '';
  if (senhaSeed.length < 12) {
    throw new Error('Defina SCRIPT_PASSWORD (mínimo 12 caracteres) para a senha dos moradores do seed.');
  }
  const senhaPadrao = await bcrypt.hash(senhaSeed, 10);
```

**`click-cond-api/click-cond-api/create_final_user.js`.** Before:
```js
  const pass = '999888';
```
After:
```js
  const pass = process.env.SCRIPT_PASSWORD || '';
  if (pass.length < 12) throw new Error('Defina SCRIPT_PASSWORD (mínimo 12 caracteres) com a senha da conta.');
```

**`click-cond-api/click-cond-api/create_sindico_railway.js`.** Before:
```js
  const pass = 'sindico123';
```
After:
```js
  const pass = process.env.SCRIPT_PASSWORD || '';
  if (pass.length < 12) throw new Error('Defina SCRIPT_PASSWORD (mínimo 12 caracteres) com a senha da conta.');
```
Before:
```js
    console.log("\nSUCCESS! Sindico 'sindico@click.com' / 'sindico123' is ready on AWS RDS.");
```
After:
```js
    console.log(`\nSUCCESS! Sindico '${email}' is ready on AWS RDS (senha: a de SCRIPT_PASSWORD).`);
```

**`click-cond-api/click-cond-api/create_user.js`.** Before:
```js
  const pass = '123456';
```
After:
```js
  const pass = process.env.SCRIPT_PASSWORD || '';
  if (pass.length < 12) throw new Error('Defina SCRIPT_PASSWORD (mínimo 12 caracteres) com a senha da conta.');
```
Before:
```js
  console.log(`Creating fresh user ${email} with password ${pass}...`);
```
After:
```js
  console.log(`Creating fresh user ${email} (senha: a de SCRIPT_PASSWORD)...`);
```

**`click-cond-api/click-cond-api/fix_user.js`.** Before:
```js
  const newPass = '123456';
```
After:
```js
  const newPass = process.env.SCRIPT_PASSWORD || '';
  if (newPass.length < 12) throw new Error('Defina SCRIPT_PASSWORD (mínimo 12 caracteres) com a nova senha.');
```
Before:
```js
  console.log(`Reseting password for ${email} to ${newPass}...`);
```
After:
```js
  console.log(`Reseting password for ${email} (nova senha: a de SCRIPT_PASSWORD)...`);
```

**`click-cond-api/click-cond-api/populate_railway.js`.** Before:
```js
  const pass = '999888';
```
After:
```js
  const pass = process.env.SCRIPT_PASSWORD || '';
  if (pass.length < 12) throw new Error('Defina SCRIPT_PASSWORD (mínimo 12 caracteres) com a senha da conta.');
```
Before:
```js
    console.log("\nSUCCESS! User 'fui@eu.com' / '999888' is now ready on AWS RDS cloud.");
```
After:
```js
    console.log(`\nSUCCESS! User '${email}' is now ready on AWS RDS cloud (senha: a de SCRIPT_PASSWORD).`);
```

**`click-cond-api/click-cond-api/debug_login.js`.** It tests an existing login, so it needs no minimum length. Before:
```js
  const pass = '123456';
```
After:
```js
  const pass = process.env.SCRIPT_PASSWORD || '';
  if (!pass) throw new Error('Defina SCRIPT_PASSWORD com a senha a testar.');
```
Before:
```js
  console.log("MySQL MD5('123456'):", md5Rows[0].my_md5);
```
After:
```js
  console.log('MySQL MD5(SCRIPT_PASSWORD):', md5Rows[0].my_md5);
```

**`click-cond-api/click-cond-api/test_login.js`.** Before:
```js
const data = JSON.stringify({
  login: 'morador@teste.com',
  password: '123456'
});
```
After:
```js
if (!process.env.SCRIPT_PASSWORD) throw new Error('Defina SCRIPT_PASSWORD com a senha a testar.');
const data = JSON.stringify({
  login: 'morador@teste.com',
  password: process.env.SCRIPT_PASSWORD
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd C:/w/sec/click-cond-web && node --test scripts/test/sem-senha-literal.test.mjs`

Expected: PASS (`# pass 1`, `# fail 0`).

Then check that the JS scripts still parse: `cd C:/w/sec/click-cond-api/click-cond-api && for f in create_final_user.js create_sindico_railway.js create_user.js debug_login.js fix_user.js populate_railway.js test_login.js; do node --check "$f" || echo "FALHOU $f"; done`. Expected: no `FALHOU` lines.

For the 3 TS scripts, the edits are confined to expressions that the TS checker types as `string`. Optionally compare `npx tsc --noEmit --skipLibCheck --esModuleInterop --target es2020 --module commonjs scripts/create-sindico.ts scripts/criar-sindico-portaria.ts scripts/seed-teste-banco.ts` before and after the change: the after run must show no new errors.

- [ ] **Step 5: Commit**

```bash
cd C:/w/sec
git add click-cond-web/scripts/create-sindico.ts click-cond-web/scripts/criar-sindico-portaria.ts click-cond-web/scripts/seed-teste-banco.ts click-cond-web/scripts/test/sem-senha-literal.test.mjs click-cond-api/click-cond-api/create_final_user.js click-cond-api/click-cond-api/create_sindico_railway.js click-cond-api/click-cond-api/create_user.js click-cond-api/click-cond-api/debug_login.js click-cond-api/click-cond-api/fix_user.js click-cond-api/click-cond-api/populate_railway.js click-cond-api/click-cond-api/test_login.js
git commit -m "fix(security): scripts leem a senha de SCRIPT_PASSWORD em vez de literal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Owner follow-up (required):** the literals stay in git history, and the accounts keep the old passwords until someone changes them. In production RDS, find these accounts and disable them, delete them, or reset them to random passwords:
- `Users`: login/email `sindico.teste@clickprestarecondominios.com.br`, `sindico@click.com`, `fui@eu.com`, `teste@click.com`, `morador@teste.com`, and `morador.teste%@exemplo.com`
- `Funcionarios_Portaria`: login `sindico@click.com`

This overlaps the pending "4 contas com senha do repo" item from the 20/10 sweep.

---

## Deferred to owner

- **`api/ocorrencias:categorias:global-table-mutable-by-any-tenant-staff`.** `Ocorrencias_Categorias` has no `id_condominio`, and the service comment says the categories are deliberately global. The safe fix is either per-condominium categories, which needs a nullable `id_condominio` column, scoping list/create/update/delete, system rows that stay read-only, and validation of `tipo` on create, or restricting the mutations to a platform admin. The owner has to decide which taxonomy model is intended: one central list, or each síndico editing his own. Either choice changes what síndicos can do in the app today (`ocorrencias/categorias/insert` from the app).
- **`tenant/assertPermissaoFuncionario-cobertura-parcial`, remaining routes.** These are `checkIn`, `checkOut`, `liberarAcesso`, `solicitarAutorizacao`, `autorizar` and `negar` in `VisitantesService`. These are portaria operations that a funcionario may need to perform without the "cadastrar visitante" permission. The source does not say whether `cadastrar_visitante` is meant to gate them. C3 covers update/remove of visits and the on-behalf reservation writes, whose intent the flag's design makes clear.
- **`pessoas/atualizarSeNecessario-identidade-compartilhada`, remaining PIN revocation.** C2 covers the create and update paths. `novaVisitaParaPessoaViaPessoasVisitas` and `liberarAcessoViaPessoasVisitas` also call `desativarOutrosCodigosVisita` with no apartment scope, so a morador who releases or re-creates his own visit of a shared Pessoa still revokes other units' open PINs. The code comments state the "one active code per Pessoa" rule globally, so the owner must decide whether it should be per apartment. If the answer is yes, pass `await this.aptosDoMoradorMobile(payload)` as the 4th argument at both call sites; the helper is added by C2. Also confirm `PESSOAS_MIGRATION_ENABLED` in the EB environment.
