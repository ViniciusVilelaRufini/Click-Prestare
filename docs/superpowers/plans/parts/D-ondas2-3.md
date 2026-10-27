## D — Ondas 2 e 3: escopo de apartamento, auditoria, consentimento, troca de condomínio, agente e senha inicial

Ordem obrigatória dentro do grupo:
- **D1 → D2 → D3**: mexem nas mesmas regiões de `prestadores.service.ts` e `mudancas.service.ts`; o "antes" de cada uma é o "depois" da anterior.
- **D8 → D9**: mexem no mesmo bloco de criação de `saveMorador` (`mobile-auth.service.ts`) e de `MoradoresService.create`.
- D4, D5, D6 e D7 são independentes entre si e das demais.

Dependências de outros grupos (executados ANTES deste):
- **D3** usa o mesmo helper que a **C3**: `TenantAccessService.assertPermissaoFuncionario(idCondominio, permissao, payload)`, chamado direto no service (C3 não toca `agenda` nem `mudancas`).
- **D5** é escrita contra a assinatura nova da **B5**: `StorageService.deleteUrl(url, prefixosPermitidos)` e as constantes `PREFIXOS_FOTO_*` em `storage.service.ts`.
- **D6** parte do `auth.service.ts` depois da **A5** (QR não compara mais Users.id com Funcionarios_Portaria.id), da **A6** (`montarSessaoPortaria` ganhou o parâmetro `deviceToken` e o desafio de MFA; o bloco `const payload` não mudou) e da **A8** (`JwtStrategy` confere `senha_alterada_em`; `changePassword` re-emite token).
- **D9** é incremento sobre a **A2**: a A2 fecha o cadastro de PORTEIRO e deixou em "Deferred to owner" o fato de o `saveMorador` *ligar* uma conta existente achada por e-mail/CPF. A D9 não mexe no vínculo (continua decisão do dono); ela só impede que esse cadastro *grave credenciais* (login/e-mail/CPF/senha/foto) numa conta que tem vínculo em outro condomínio. A A2 não toca `saveMorador` nem `MoradoresService.create`, então os trechos "antes" abaixo são os do master.

---

### Task D1: criar prestador com o nome de um existente passa pela mesma regra de dono do update

**Fixes fingerprint:** `prestadores.service.create:name-upsert-bypasses-owner-check`

`PrestadoresService.create` faz upsert por `(id_condominio, nome)`: achando um registro com o mesmo nome, ATUALIZA foto, unidade, dias e contato. O `update` exige `assertPodeGerenciarPrestador` (morador só mexe em prestador de apartamento dele; prestador do prédio é da administração), mas o ramo de update do `create` não. Um morador que repete o nome do eletricista do prédio (visível a todos na lista) troca a foto facial dele pela própria e ganha acesso físico com a identidade do prestador.

**Files:**
- Modify: `click-cond-web/apps/api/src/app/prestadores/prestadores.service.ts:303-313` (`create`: busca do existente sobe para antes do upload da foto e passa pela checagem)
- Test: `click-cond-web/apps/api/src/app/prestadores/prestador-upsert-por-nome.spec.ts` (novo)

**Interfaces:**
- Consumes: `private assertPodeGerenciarPrestador(prestador: { id: number; id_apartamento: number | null }, payload?: JwtPayload)` (já existe em `prestadores.service.ts:132`).
- Produces: nada novo. D2 altera o mesmo método `create` a partir do estado deixado aqui (a variável `existing` agora é declarada antes de `fotoPes`/`fotoDoc`).

- [ ] **Step 1: Write the failing test**

Criar `click-cond-web/apps/api/src/app/prestadores/prestador-upsert-por-nome.spec.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';
import { PrestadoresService } from './prestadores.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * `create` faz upsert por nome: com o mesmo nome de um prestador existente,
 * ele ATUALIZA foto, unidade e dias. O update exige ser dono (prestador do
 * prédio é da administração; o do vizinho, do vizinho), mas o ramo de update
 * do create não exigia — bastava repetir o nome do eletricista do prédio,
 * que todo morador vê na lista, para trocar a foto facial dele pela sua.
 */
describe('PrestadoresService.create — upsert por nome respeita o dono', () => {
  const MEU_APTO = 7;
  const morador: JwtPayload = { sub: 50, nome: 'Morador', typeAccess: 'Morador' };
  const sindico: JwtPayload = { sub: 51, nome: 'Síndico', typeAccess: 'Sindico' };

  const doPredio = { id: 101, id_condominio: 1, id_apartamento: null, nome: 'Eletricista do prédio', telefone: '8888', email: null, categorias: null, foto_pessoa: 'https://s3/predio.jpg', foto_documento: null, dias_semana: 'seg' };
  const doVizinho = { ...doPredio, id: 100, id_apartamento: 8, nome: 'Faxineira do 8', foto_pessoa: 'https://s3/vizinho.jpg' };
  const meu = { ...doPredio, id: 102, id_apartamento: MEU_APTO, nome: 'Meu pintor', foto_pessoa: 'https://s3/meu.jpg' };

  function build(existente: any) {
    const prisma: any = {
      isConnected: true,
      prestadores_servico: {
        findFirst: jest.fn(async () => existente),
        update: jest.fn(async ({ data }: any) => ({ ...existente, ...data })),
        create: jest.fn(async ({ data }: any) => ({ id: 999, ...data })),
      },
      // Os aptos 7 e 8 são do condomínio 1 (usado pela checagem de unidade da D2).
      apartamentos: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, id_condominio: 1 })) },
      // O morador 50 mora só no apto 7.
      apartamentos_Users: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.id_user === 50 && where.id_apto === MEU_APTO ? { id_apto: MEU_APTO } : null,
        ),
      },
    };
    const storage: any = { isDataUrl: (v: string) => v.startsWith('data:'), uploadDataUrl: jest.fn(async () => 'https://s3/atacante.jpg') };
    const facial: any = { syncPrestadorServico: jest.fn(async () => undefined) };
    const tenant: any = {
      assertCondominio: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async () => undefined),
    };
    return { svc: new PrestadoresService(prisma, storage, facial, tenant), prisma, storage, facial };
  }

  const dto = (nome: string) => ({
    nome,
    id_condominio: 1,
    id_apartamento: MEU_APTO,
    foto_pessoa: 'data:image/jpeg;base64,AAA',
    dias_semana: 'seg,ter,qua,qui,sex,sab,dom',
  });

  it('NEGA morador sobrescrever o prestador do prédio repetindo o nome (nem sobe a foto)', async () => {
    const { svc, prisma, storage, facial } = build(doPredio);
    await expect(svc.create(dto('Eletricista do prédio'), morador)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.prestadores_servico.update).not.toHaveBeenCalled();
    expect(storage.uploadDataUrl).not.toHaveBeenCalled();
    expect(facial.syncPrestadorServico).not.toHaveBeenCalled();
  });

  it('NEGA morador sobrescrever o prestador do vizinho repetindo o nome', async () => {
    const { svc, prisma } = build(doVizinho);
    await expect(svc.create(dto('Faxineira do 8'), morador)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.prestadores_servico.update).not.toHaveBeenCalled();
  });

  it('PERMITE morador atualizar pelo nome o prestador do próprio apartamento', async () => {
    const { svc, prisma } = build(meu);
    await svc.create(dto('Meu pintor'), morador);
    expect(prisma.prestadores_servico.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 102 } }),
    );
  });

  it('PERMITE o síndico atualizar pelo nome o prestador do prédio', async () => {
    const { svc, prisma } = build(doPredio);
    await svc.create({ ...dto('Eletricista do prédio'), id_apartamento: undefined } as any, sindico);
    expect(prisma.prestadores_servico.update).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts prestador-upsert-por-nome`
Expected: FAIL — os dois casos `NEGA ...`: "Received promise resolved instead of rejected" (o upsert atualizou o registro). Os casos `PERMITE ...` passam.

- [ ] **Step 3: Write minimal implementation**

Em `click-cond-web/apps/api/src/app/prestadores/prestadores.service.ts`, no `create` (linhas 303-313):

Antes:
```ts
    const fotoPes = await this.resolveFoto(dto.foto_pessoa);
    const fotoDoc = await this.resolveFoto(dto.foto_documento);

    const existing = await this.prisma.prestadores_servico.findFirst({
      where: {
        id_condominio: Number(dto.id_condominio),
        nome: dto.nome.trim(),
      },
    });
```
Depois:
```ts
    const existing = await this.prisma.prestadores_servico.findFirst({
      where: {
        id_condominio: Number(dto.id_condominio),
        nome: dto.nome.trim(),
      },
    });
    // Mesmo nome = ATUALIZAÇÃO do cadastro existente (foto facial, unidade,
    // dias). Vale a mesma regra do update: sem isto, um morador repetia o nome
    // do eletricista do prédio — que todo morador vê na lista — ou do
    // prestador do vizinho e trocava a foto que o terminal facial reconhece.
    // Antes do upload, para a foto recusada nem chegar ao storage.
    if (existing) await this.assertPodeGerenciarPrestador(existing, user);

    const fotoPes = await this.resolveFoto(dto.foto_pessoa);
    const fotoDoc = await this.resolveFoto(dto.foto_documento);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts prestadores/`
Expected: PASS (4 testes novos + `prestador-do-vizinho`, `prestadores.authz`, `leitura-prestador`, `unidade-prestador`).

- [ ] **Step 5: Commit**

```bash
git -C C:/w/sec add click-cond-web/apps/api/src/app/prestadores/prestadores.service.ts click-cond-web/apps/api/src/app/prestadores/prestador-upsert-por-nome.spec.ts
git -C C:/w/sec commit -m "fix(security): upsert de prestador por nome exige ser dono do registro existente" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task D2: `id_apartamento` de prestador e mudança preso ao condomínio e ao morador; morador só lista as próprias mudanças

**Fixes fingerprints:** `mobile-crud:id_apartamento-not-bound-to-condominio-or-caller` + `mudancas.service.findAll:morador-scope-trusts-client-id_apto`

Builds on: **D1** (mesmo `create` de `prestadores.service.ts`).

Escrita: o `id_apartamento` do corpo era gravado como veio em `PrestadoresService.create/update` e `MudancasService.create/update`. Um morador agendava mudança para o apto do vizinho, punha o próprio prestador como "do prédio" (`null`, visível a todos e tratado como da administração) ou apontava para apartamento de OUTRO condomínio (a FK `fk_mud_apto` só referencia `Apartamentos.id`). A regra pretendida já existe no delivery (`assertApartamentoDoMorador`): o apartamento é do condomínio da entidade e, para morador do app, é um apartamento dele.

Leitura: `GET /mudancas/get-all` só filtrava por unidade se o cliente mandasse `id_apto`; omitindo, o morador recebia as mudanças de todo o condomínio (unidade, data, hora, nome de quem criou). `GET /mudancas/get` só conferia o tenant.

**Files:**
- Create: `click-cond-web/apps/api/src/app/common/apartamento-gravavel.util.ts`
- Modify: `click-cond-web/apps/api/src/app/prestadores/prestadores.service.ts:8` (import), `create` (bloco deixado pela D1 + as duas gravações de `id_apartamento`), `update` (após `assertPermissaoFuncionario`, ~linha 439)
- Modify: `click-cond-web/apps/api/src/app/mudancas/mudancas.service.ts` (imports, `findAll`, `findOne`, `create`, `update`, novo `aptosDoMorador`)
- Test: `click-cond-web/apps/api/src/app/prestadores/prestador-unidade-gravacao.spec.ts` (novo), `click-cond-web/apps/api/src/app/mudancas/mudancas.apartamento.spec.ts` (novo)

**Interfaces:**
- Consumes: nada de outras tasks.
- Produces (em `common/apartamento-gravavel.util.ts`):
  - `ehMoradorMobile(payload?: JwtPayload): boolean` — token sem `id_condominio` (não é console) e papel que não é síndico/funcionário.
  - `assertApartamentoGravavel(prisma: PrismaApartamentos, idApartamento: number | null, idCondominio: number, payload?: JwtPayload): Promise<void>` — lança `ForbiddenException`.
  - D3 altera `MudancasService.update`/`remove` a partir do estado deixado aqui.

- [ ] **Step 1: Write the failing tests**

Criar `click-cond-web/apps/api/src/app/prestadores/prestador-unidade-gravacao.spec.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';
import { PrestadoresService } from './prestadores.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * A unidade do prestador vinha do corpo e era gravada como veio: o morador
 * apontava o próprio prestador para o apto do vizinho, para "do prédio"
 * (null — diretório visível a todos e tratado como da administração) ou para
 * um apartamento de OUTRO condomínio.
 */
describe('PrestadoresService — id_apartamento gravado só se for do condomínio (e do morador)', () => {
  const MEU_APTO = 7;
  const APTO_VIZINHO = 8;
  const APTO_OUTRO_COND = 90;
  const morador: JwtPayload = { sub: 50, nome: 'Morador', typeAccess: 'Morador' };
  const sindico: JwtPayload = { sub: 51, nome: 'Síndico', typeAccess: 'Sindico' };
  const meu = { id: 102, id_condominio: 1, id_apartamento: MEU_APTO, email: null, nome: 'Meu pintor', telefone: '7777' };

  function build(existente: any = null) {
    const prisma: any = {
      isConnected: true,
      prestadores_servico: {
        findFirst: jest.fn(async () => existente),
        findUnique: jest.fn(async () => meu),
        update: jest.fn(async ({ data }: any) => ({ ...meu, ...data })),
        create: jest.fn(async ({ data }: any) => ({ id: 999, ...data })),
      },
      apartamentos: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === APTO_OUTRO_COND ? { id_condominio: 2 } : { id_condominio: 1 },
        ),
      },
      apartamentos_Users: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.id_user === 50 && where.id_apto === MEU_APTO ? { id_apto: MEU_APTO } : null,
        ),
      },
    };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const facial: any = { syncPrestadorServico: jest.fn(async () => undefined) };
    const tenant: any = {
      assertCondominio: jest.fn(async () => undefined),
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async () => undefined),
    };
    return { svc: new PrestadoresService(prisma, storage, facial, tenant), prisma };
  }

  describe('create', () => {
    it('NEGA morador cadastrar prestador no apto do vizinho', async () => {
      const { svc, prisma } = build();
      await expect(svc.create({ nome: 'X', id_condominio: 1, id_apartamento: APTO_VIZINHO }, morador))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.prestadores_servico.create).not.toHaveBeenCalled();
    });

    it('NEGA morador cadastrar prestador "do prédio" (sem unidade)', async () => {
      const { svc, prisma } = build();
      await expect(svc.create({ nome: 'X', id_condominio: 1 }, morador)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.prestadores_servico.create).not.toHaveBeenCalled();
    });

    it('NEGA apartamento de outro condomínio, mesmo para o síndico', async () => {
      const { svc, prisma } = build();
      await expect(svc.create({ nome: 'X', id_condominio: 1, id_apartamento: APTO_OUTRO_COND }, sindico))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.prestadores_servico.create).not.toHaveBeenCalled();
    });

    it('NEGA o upsert por nome mover o prestador do morador para o vizinho', async () => {
      const { svc, prisma } = build(meu);
      await expect(svc.create({ nome: 'Meu pintor', id_condominio: 1, id_apartamento: APTO_VIZINHO }, morador))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.prestadores_servico.update).not.toHaveBeenCalled();
    });

    it('PERMITE morador no próprio apto e síndico sem unidade (prestador do prédio)', async () => {
      const { svc, prisma } = build();
      await svc.create({ nome: 'X', id_condominio: 1, id_apartamento: MEU_APTO }, morador);
      await svc.create({ nome: 'Y', id_condominio: 1 }, sindico);
      expect(prisma.prestadores_servico.create).toHaveBeenCalledTimes(2);
      expect(prisma.prestadores_servico.create.mock.calls[0][0].data.id_apartamento).toBe(MEU_APTO);
      expect(prisma.prestadores_servico.create.mock.calls[1][0].data.id_apartamento).toBeNull();
    });
  });

  describe('update', () => {
    it('NEGA morador mover o próprio prestador para "do prédio" (null)', async () => {
      const { svc, prisma } = build();
      await expect(svc.update(102, { id_apartamento: null as any }, undefined, morador))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.prestadores_servico.update).not.toHaveBeenCalled();
    });

    it('NEGA morador mover o próprio prestador para o apto do vizinho', async () => {
      const { svc, prisma } = build();
      await expect(svc.update(102, { id_apartamento: APTO_VIZINHO }, undefined, morador))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.prestadores_servico.update).not.toHaveBeenCalled();
    });

    it('PERMITE editar sem mexer na unidade (não consulta apartamento)', async () => {
      const { svc, prisma } = build();
      await svc.update(102, { nome: 'Pintor novo' }, undefined, morador);
      expect(prisma.prestadores_servico.update).toHaveBeenCalled();
      expect(prisma.apartamentos.findUnique).not.toHaveBeenCalled();
    });
  });
});
```

Criar `click-cond-web/apps/api/src/app/mudancas/mudancas.apartamento.spec.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';
import { MudancasService } from './mudancas.service';

/**
 * Mudança libera elevador e portaria. O `id_apartamento` vinha do corpo e era
 * gravado como veio (apto do vizinho, ou de outro condomínio — a FK só aponta
 * para Apartamentos.id). E a listagem só recortava por unidade se o CLIENTE
 * mandasse `id_apto`: omitindo, o morador via as mudanças do prédio inteiro.
 */
describe('MudancasService — unidade da mudança e recorte do morador', () => {
  const morador: any = { sub: 5, nome: 'M', typeAccess: 'Morador', user: { id: 5 } };
  const sindico: any = { sub: 9, nome: 'S', typeAccess: 'Sindico', user: { id: 9 } };

  function build(mudanca: any = { id: 3, id_condominio: 1, id_apartamento: 1, user: 5 }) {
    const prisma: any = {
      isConnected: true,
      apartamentos: {
        // aptos 1 e 2 são do condomínio 1; o 50 é do condomínio 2.
        findUnique: jest.fn(async ({ where }: any) => (where.id === 50 ? { id_condominio: 2 } : { id_condominio: 1 })),
      },
      apartamentos_Users: {
        // o morador 5 mora só no apto 1.
        findFirst: jest.fn(async ({ where }: any) => (where.id_user === 5 && where.id_apto === 1 ? { id_apto: 1 } : null)),
        findMany: jest.fn(async ({ where }: any) => (where.id_user === 5 ? [{ id_apto: 1 }] : [])),
      },
      mudancas: {
        create: jest.fn(async ({ data }: any) => ({ id: 10, ...data })),
        findMany: jest.fn(async () => []),
        findUnique: jest.fn(async () => mudanca),
        update: jest.fn(async ({ data }: any) => ({ ...mudanca, ...data })),
      },
    };
    const tenant: any = {
      assertCondominio: jest.fn(async () => undefined),
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async () => undefined),
    };
    return { service: new MudancasService(prisma, tenant), prisma };
  }

  const nova = (id_apartamento: number) => ({ data: '2026-11-01', hora_inicio: '08:00', id_apartamento, id_condominio: 1, user: 5 });

  it('create: NEGA morador agendar mudança no apto do vizinho', async () => {
    const { service, prisma } = build();
    await expect(service.create(nova(2), morador)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.mudancas.create).not.toHaveBeenCalled();
  });

  it('create: NEGA apartamento de outro condomínio, mesmo para o síndico', async () => {
    const { service, prisma } = build();
    await expect(service.create(nova(50), sindico)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.mudancas.create).not.toHaveBeenCalled();
  });

  it('create: PERMITE morador no próprio apto e síndico em qualquer apto do condomínio', async () => {
    const { service, prisma } = build();
    await service.create(nova(1), morador);
    await service.create(nova(2), sindico);
    expect(prisma.mudancas.create).toHaveBeenCalledTimes(2);
  });

  it('update: NEGA o dono mover a própria mudança para o apto do vizinho', async () => {
    const { service, prisma } = build();
    await expect(service.update(3, { id_apartamento: 2 }, morador)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.mudancas.update).not.toHaveBeenCalled();
  });

  it('findAll: morador sem id_apto vê só as do(s) próprio(s) apto(s) e as que criou', async () => {
    const { service, prisma } = build();
    await service.findAll(1, undefined, morador);
    expect(prisma.mudancas.findMany.mock.calls[0][0].where).toEqual({
      id_condominio: 1,
      OR: [{ user: 5 }, { id_apartamento: { in: [1] } }],
    });
  });

  it('findAll: id_apto de outra unidade é ignorado para o morador', async () => {
    const { service, prisma } = build();
    await service.findAll(1, 2, morador);
    expect(prisma.mudancas.findMany.mock.calls[0][0].where).toEqual({
      id_condominio: 1,
      OR: [{ user: 5 }, { id_apartamento: { in: [1] } }],
    });
  });

  it('findAll: síndico continua vendo tudo, ou o filtro que pediu', async () => {
    const { service, prisma } = build();
    await service.findAll(1, undefined, sindico);
    await service.findAll(1, 2, sindico);
    expect(prisma.mudancas.findMany.mock.calls[0][0].where).toEqual({ id_condominio: 1 });
    expect(prisma.mudancas.findMany.mock.calls[1][0].where).toEqual({ id_condominio: 1, id_apartamento: 2 });
  });

  it('findOne: NEGA morador ler mudança de outra unidade criada por outro', async () => {
    const { service } = build({ id: 4, id_condominio: 1, id_apartamento: 2, user: 77, apartamento: null });
    await expect(service.findOne(4, morador)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('findOne: PERMITE morador ler a do próprio apto', async () => {
    const { service } = build({ id: 3, id_condominio: 1, id_apartamento: 1, user: 77, apartamento: null });
    await expect(service.findOne(3, morador)).resolves.toMatchObject({ id: 3 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts prestador-unidade-gravacao mudancas.apartamento`
Expected: FAIL — todos os casos `NEGA ...` ("Received promise resolved instead of rejected"); `findAll: morador ...` (o `where` recebido é `{ id_condominio: 1 }` / `{ id_condominio: 1, id_apartamento: 2 }`). Os casos `PERMITE ...` e `síndico continua vendo tudo` passam.

- [ ] **Step 3: Write minimal implementation**

(a) Criar `click-cond-web/apps/api/src/app/common/apartamento-gravavel.util.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * `id_apartamento` que vem do corpo (prestador, mudança) é chave estrangeira
 * escolhida pelo cliente. Antes de gravar:
 *  - o apartamento tem de ser do condomínio da entidade (a FK só aponta para
 *    Apartamentos.id e aceitaria apto de outro prédio);
 *  - morador do app só grava apartamento DELE, e nunca "sem unidade" (null é
 *    o diretório do prédio, da administração).
 * Mesma regra do `assertApartamentoDoMorador` do delivery.
 */
type PrismaApartamentos = {
  apartamentos: { findUnique: (a: any) => Promise<{ id_condominio: number } | null> };
  apartamentos_Users: { findFirst: (a: any) => Promise<unknown | null> };
};

/** Morador do app: token sem id_condominio (não é console) e papel que não é síndico/funcionário. */
export function ehMoradorMobile(payload?: JwtPayload): boolean {
  if (!payload) return false;
  const tipo = (payload.typeAccess ?? payload.user?.typeAccess ?? '').toString().toLowerCase();
  return !payload.id_condominio && tipo !== 'sindico' && tipo !== 'funcionario';
}

export async function assertApartamentoGravavel(
  prisma: PrismaApartamentos,
  idApartamento: number | null,
  idCondominio: number,
  payload?: JwtPayload,
): Promise<void> {
  if (idApartamento != null) {
    const apto = await prisma.apartamentos.findUnique({
      where: { id: Number(idApartamento) },
      select: { id_condominio: true },
    });
    if (!apto || Number(apto.id_condominio) !== Number(idCondominio)) {
      throw new ForbiddenException('Apartamento não pertence a este condomínio.');
    }
  }

  if (!ehMoradorMobile(payload)) return;

  if (idApartamento == null) {
    throw new ForbiddenException('Acesso negado: informe um apartamento seu.');
  }
  const userId = Number(payload!.user?.id ?? payload!.sub);
  if (!userId) throw new ForbiddenException('Acesso negado: sessão sem usuário válido.');
  const vinculo = await prisma.apartamentos_Users.findFirst({
    where: { id_user: userId, id_apto: Number(idApartamento) },
    select: { id_apto: true },
  });
  if (!vinculo) {
    throw new ForbiddenException('Acesso negado: este apartamento não é seu.');
  }
}
```

(b) `click-cond-web/apps/api/src/app/prestadores/prestadores.service.ts`

Import — após a linha 8 (`import { assertOperador } from '../auth/tenant.util';`):
```ts
import { assertApartamentoGravavel } from '../common/apartamento-gravavel.util';
```

No `create` (estado deixado pela D1). Antes:
```ts
    if (existing) await this.assertPodeGerenciarPrestador(existing, user);

    const fotoPes = await this.resolveFoto(dto.foto_pessoa);
```
Depois:
```ts
    if (existing) await this.assertPodeGerenciarPrestador(existing, user);

    // Unidade que de fato vai para o banco (no upsert, a ausente mantém a atual):
    // tem de ser do condomínio e, para morador, um apartamento dele.
    const idApartamento = existing
      ? (normalizarIdApartamento(dto.id_apartamento) ?? existing.id_apartamento)
      : (normalizarIdApartamento(dto.id_apartamento) ?? null);
    await assertApartamentoGravavel(this.prisma as any, idApartamento, Number(dto.id_condominio), user);

    const fotoPes = await this.resolveFoto(dto.foto_pessoa);
```

Ainda no `create`, ramo de update. Antes:
```ts
          id_apartamento: normalizarIdApartamento(dto.id_apartamento) ?? existing.id_apartamento,
```
Depois:
```ts
          id_apartamento: idApartamento,
```

Ramo de criação. Antes:
```ts
          id_apartamento: normalizarIdApartamento(dto.id_apartamento) ?? null,
```
Depois:
```ts
          id_apartamento: idApartamento,
```

No `update`. Antes:
```ts
    await this.assertPodeGerenciarPrestador(atual, user);
    await this.tenant.assertPermissaoFuncionario(atual.id_condominio, 'prestadores_servico', user);
```
Depois:
```ts
    await this.assertPodeGerenciarPrestador(atual, user);
    await this.tenant.assertPermissaoFuncionario(atual.id_condominio, 'prestadores_servico', user);
    // assertPodeGerenciarPrestador olha a unidade ATUAL; a nova também tem de ser válida.
    if (dto.id_apartamento !== undefined) {
      await assertApartamentoGravavel(
        this.prisma as any,
        normalizarIdApartamento(dto.id_apartamento) ?? null,
        atual.id_condominio,
        user,
      );
    }
```

(c) `click-cond-web/apps/api/src/app/mudancas/mudancas.service.ts`

Imports (linhas 1-5). Antes:
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import { assertStaff } from '../auth/tenant.util';
import type { JwtPayload } from '../auth/jwt-payload.interface';
```
Depois:
```ts
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import { assertStaff } from '../auth/tenant.util';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { assertApartamentoGravavel, ehMoradorMobile } from '../common/apartamento-gravavel.util';
```

`findAll` (linhas 14-20). Antes:
```ts
  /** Lista todas as mudanças de um condomínio. Sindico vê tudo, morador vê só as do seu apto. */
  async findAll(idCondominio: number, idApto?: number, user?: JwtPayload) {
    await this.tenant.assertCondominio(idCondominio, user);
    const where: any = { id_condominio: Number(idCondominio) };
    if (idApto && Number(idApto) > 0) {
      where.id_apartamento = Number(idApto);
    }
```
Depois:
```ts
  /** Lista todas as mudanças de um condomínio. Sindico vê tudo, morador vê só as do seu apto. */
  async findAll(idCondominio: number, idApto?: number, user?: JwtPayload) {
    await this.tenant.assertCondominio(idCondominio, user);
    const where: any = { id_condominio: Number(idCondominio) };
    if (ehMoradorMobile(user)) {
      // O recorte do morador vem dos vínculos dele, não do `id_apto` do cliente:
      // omitindo o parâmetro, a lista trazia as mudanças do prédio inteiro.
      const { userId, aptos } = await this.aptosDoMorador(Number(idCondominio), user!);
      const alvo = idApto && aptos.includes(Number(idApto)) ? [Number(idApto)] : aptos;
      where.OR = [{ user: userId }, ...(alvo.length ? [{ id_apartamento: { in: alvo } }] : [])];
    } else if (idApto && Number(idApto) > 0) {
      where.id_apartamento = Number(idApto);
    }
```

`findOne` (linhas 34-44). Antes:
```ts
    if (!m) throw new NotFoundException(`Mudança ${id} não encontrada`);
    await this.tenant.assertEntidade(m.id_condominio, user, `mudança #${id}`);
    return this.flatten(m);
  }
```
Depois:
```ts
    if (!m) throw new NotFoundException(`Mudança ${id} não encontrada`);
    await this.tenant.assertEntidade(m.id_condominio, user, `mudança #${id}`);
    if (ehMoradorMobile(user)) {
      const { userId, aptos } = await this.aptosDoMorador(m.id_condominio, user!);
      if (m.user !== userId && !aptos.includes(m.id_apartamento)) {
        throw new ForbiddenException('Acesso negado: esta mudança não é de um apartamento seu.');
      }
    }
    return this.flatten(m);
  }

  /** Users.id do morador e os apartamentos dele neste condomínio. */
  private async aptosDoMorador(idCondominio: number, user: JwtPayload) {
    const userId = Number(user.user?.id ?? user.sub);
    if (!userId) throw new ForbiddenException('Acesso negado: sessão sem usuário válido.');
    const vinculos = await this.prisma.apartamentos_Users.findMany({
      where: { id_user: userId, apartamento: { id_condominio: Number(idCondominio) } },
      select: { id_apto: true },
    });
    return { userId, aptos: [...new Set(vinculos.map((v) => v.id_apto))] };
  }
```

`create` (linhas 53-59). Antes:
```ts
    await this.tenant.assertCondominio(dto.id_condominio, requester);
    return this.prisma.mudancas.create({
      data: {
        data: dto.data ? new Date(dto.data) : null,
        hora_inicio: dto.hora_inicio ? new Date(`1970-01-01T${dto.hora_inicio}:00`) : null,
        id_apartamento: Number(dto.id_apartamento),
```
Depois:
```ts
    await this.tenant.assertCondominio(dto.id_condominio, requester);
    const idApartamento = Number(dto.id_apartamento);
    if (!Number.isInteger(idApartamento) || idApartamento <= 0) {
      throw new BadRequestException('Apartamento não informado.');
    }
    // Do condomínio informado e, para morador, um apartamento dele.
    await assertApartamentoGravavel(this.prisma as any, idApartamento, Number(dto.id_condominio), requester);
    return this.prisma.mudancas.create({
      data: {
        data: dto.data ? new Date(dto.data) : null,
        hora_inicio: dto.hora_inicio ? new Date(`1970-01-01T${dto.hora_inicio}:00`) : null,
        id_apartamento: idApartamento,
```

`update` (linhas 75-80). Antes:
```ts
    const callerId = user?.user?.id ?? user?.sub;
    if (atual.user !== callerId) assertStaff(user, 'editar mudança de outro morador');
    try {
      return await this.prisma.mudancas.update({
```
Depois:
```ts
    const callerId = user?.user?.id ?? user?.sub;
    if (atual.user !== callerId) assertStaff(user, 'editar mudança de outro morador');
    if (dto.id_apartamento !== undefined) {
      await assertApartamentoGravavel(this.prisma as any, Number(dto.id_apartamento), atual.id_condominio, user);
    }
    try {
      return await this.prisma.mudancas.update({
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts prestadores/ mudancas/`
Expected: PASS (testes novos + `prestador-upsert-por-nome`, `prestador-do-vizinho`, `prestadores.authz`, `leitura-prestador`, `unidade-prestador`, `mudancas.permissao`).

- [ ] **Step 5: Commit**

```bash
git -C C:/w/sec add click-cond-web/apps/api/src/app/common/apartamento-gravavel.util.ts click-cond-web/apps/api/src/app/prestadores/prestadores.service.ts click-cond-web/apps/api/src/app/mudancas/mudancas.service.ts click-cond-web/apps/api/src/app/prestadores/prestador-unidade-gravacao.spec.ts click-cond-web/apps/api/src/app/mudancas/mudancas.apartamento.spec.ts
git -C C:/w/sec commit -m "fix(security): id_apartamento de prestador/mudanca preso ao condominio e ao morador; morador lista so as proprias mudancas" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task D3: flags `manutencoes_programadas` e `agendar_mudanca` cobradas na escrita de agenda e na gestão de mudança alheia

**Fixes fingerprint:** `agenda+mudancas:funcionario-permission-flag-not-enforced`

Builds on: **D2** (estado de `MudancasService.update`); reutiliza o mesmo helper da **C3**: `this.tenant.assertPermissaoFuncionario(...)`, chamado direto no service, sem helper novo.

`AgendaService.create/update/remove` e `MudancasService.update/remove` (mudança de OUTRO morador) só exigiam `assertStaff` — "não é morador". O funcionário que o síndico restringiu (flag 0) continuava publicando, editando e apagando Manutenções Programadas (com `alertar_moradores`) e editando/apagando mudanças de qualquer morador. `mudancas.updateStatus` já cobra `agendar_mudanca`; areas-sociais já cobra `manutencoes_programadas`. A edição/remoção da PRÓPRIA mudança continua livre (é o mesmo direito do morador).

**Files:**
- Modify: `click-cond-web/apps/api/src/app/agenda/agenda.service.ts:41-43` (`create`), `:75-76` (`update`), `:99-100` (`remove`)
- Modify: `click-cond-web/apps/api/src/app/mudancas/mudancas.service.ts` (`update` e `remove`, ramo "de outro morador")
- Test: `click-cond-web/apps/api/src/app/agenda/agenda.permissao.spec.ts` (novo), `click-cond-web/apps/api/src/app/mudancas/mudancas.gestao-permissao.spec.ts` (novo)

**Interfaces:**
- Consumes: `TenantAccessService.assertPermissaoFuncionario(idCondominio: number, permissao: PermissaoFuncionario, payload?: JwtPayload): Promise<void>` (mesmo uso da C3).
- Produces: nada novo.

- [ ] **Step 1: Write the failing tests**

Criar `click-cond-web/apps/api/src/app/agenda/agenda.permissao.spec.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';
import { AgendaService } from './agenda.service';

/**
 * O app esconde "Manutenções Programadas" de quem tem a flag
 * `manutencoes_programadas` em 0 (list_agenda.dart), mas o servidor só
 * exigia `assertStaff` — "não é morador". O funcionário restringido pelo
 * síndico publicava, editava e apagava manutenção (com alerta aos moradores)
 * chamando a rota direto.
 */
describe('AgendaService — exige a permissão manutencoes_programadas', () => {
  function build() {
    const tenant = {
      assertCondominio: jest.fn(async () => undefined),
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async (_id: number, flag: string, payload: any) => {
        if (payload?.typeAccess?.toLowerCase() !== 'funcionario') return;
        if (payload.permissoes?.[flag] !== 1) {
          throw new ForbiddenException('Acesso negado: seu perfil não tem permissão para esta área.');
        }
      }),
    };
    const prisma: any = {
      isConnected: true,
      agenda: {
        findUnique: jest.fn(async () => ({ id_condominio: 2 })),
        create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
        update: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
        delete: jest.fn(async () => ({})),
      },
    };
    return { service: new AgendaService(prisma, tenant as any), prisma, tenant };
  }

  const semPermissao: any = { sub: 5, typeAccess: 'Funcionario', user: { id: 5 }, permissoes: { manutencoes_programadas: 0 } };
  const comPermissao: any = { sub: 6, typeAccess: 'Funcionario', user: { id: 6 }, permissoes: { manutencoes_programadas: 1 } };
  const sindico: any = { sub: 9, typeAccess: 'Sindico', user: { id: 9 } };
  const manutencao = { id: 1, titulo: 'Bomba', data_inicio: '2026-11-01' };

  it('NEGA funcionário sem a flag em create/update/remove e não grava nada', async () => {
    const { service, prisma } = build();
    await expect(service.create(2, manutencao, semPermissao)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.update(2, manutencao, semPermissao)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.remove(1, semPermissao)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.agenda.create).not.toHaveBeenCalled();
    expect(prisma.agenda.update).not.toHaveBeenCalled();
    expect(prisma.agenda.delete).not.toHaveBeenCalled();
  });

  it('PERMITE funcionário com a flag e o síndico', async () => {
    const { service, prisma } = build();
    await service.create(2, manutencao, comPermissao);
    await service.update(2, manutencao, sindico);
    await service.remove(1, comPermissao);
    expect(prisma.agenda.create).toHaveBeenCalled();
    expect(prisma.agenda.update).toHaveBeenCalled();
    expect(prisma.agenda.delete).toHaveBeenCalled();
  });

  it('em update/remove checa no condomínio da manutenção, não no id do cliente', async () => {
    const { service, tenant } = build();
    await service.update(999, manutencao, comPermissao);
    expect(tenant.assertPermissaoFuncionario).toHaveBeenCalledWith(2, 'manutencoes_programadas', comPermissao);
  });
});
```

Criar `click-cond-web/apps/api/src/app/mudancas/mudancas.gestao-permissao.spec.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';
import { MudancasService } from './mudancas.service';

/**
 * Editar ou apagar a mudança de OUTRO morador é gestão de mudanças: o app
 * mostra isso só para síndico ou para quem tem `agendar_mudanca`
 * (list_mudancas.dart), e o `updateStatus` já cobrava a flag. `update` e
 * `remove` exigiam só `assertStaff`.
 */
describe('MudancasService — update/remove de mudança alheia exige agendar_mudanca', () => {
  function build() {
    const tenant = {
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async (_id: number, flag: string, payload: any) => {
        if (payload?.typeAccess?.toLowerCase() !== 'funcionario') return;
        if (payload.permissoes?.[flag] !== 1) {
          throw new ForbiddenException('Acesso negado: seu perfil não tem permissão para esta área.');
        }
      }),
    };
    const prisma: any = {
      isConnected: true,
      mudancas: {
        // A mudança é do morador 77, no condomínio 2.
        findUnique: jest.fn(async () => ({ id_condominio: 2, user: 77 })),
        update: jest.fn(async () => ({ id: 3 })),
        delete: jest.fn(async () => ({})),
      },
    };
    return { service: new MudancasService(prisma, tenant as any), prisma, tenant };
  }

  const semPermissao: any = { sub: 5, typeAccess: 'Funcionario', user: { id: 5 }, permissoes: { agendar_mudanca: 0 } };
  const comPermissao: any = { sub: 6, typeAccess: 'Funcionario', user: { id: 6 }, permissoes: { agendar_mudanca: 1 } };
  const sindico: any = { sub: 9, typeAccess: 'Sindico', user: { id: 9 } };

  it('NEGA funcionário sem a flag editar ou apagar mudança de outro morador', async () => {
    const { service, prisma } = build();
    await expect(service.update(3, { data: '2026-11-02' }, semPermissao)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.remove(3, semPermissao)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.mudancas.update).not.toHaveBeenCalled();
    expect(prisma.mudancas.delete).not.toHaveBeenCalled();
  });

  it('PERMITE funcionário com a flag e o síndico', async () => {
    const { service, prisma } = build();
    await service.update(3, { data: '2026-11-02' }, comPermissao);
    await service.remove(3, sindico);
    expect(prisma.mudancas.update).toHaveBeenCalled();
    expect(prisma.mudancas.delete).toHaveBeenCalled();
  });

  it('a própria mudança continua livre (não consulta a flag)', async () => {
    const { service, prisma, tenant } = build();
    const dono: any = { sub: 77, typeAccess: 'Funcionario', user: { id: 77 }, permissoes: { agendar_mudanca: 0 } };
    await service.remove(3, dono);
    expect(prisma.mudancas.delete).toHaveBeenCalled();
    expect(tenant.assertPermissaoFuncionario).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts agenda.permissao mudancas.gestao-permissao`
Expected: FAIL — `NEGA funcionário sem a flag ...` nos dois arquivos ("Received promise resolved instead of rejected") e `em update/remove checa no condomínio da manutenção` (`assertPermissaoFuncionario` nunca chamado). `PERMITE ...` e `a própria mudança continua livre` passam.

- [ ] **Step 3: Write minimal implementation**

(a) `click-cond-web/apps/api/src/app/agenda/agenda.service.ts`

`create` (linhas 41-43). Antes:
```ts
  async create(idCondominio: number, agenda: any, user?: JwtPayload) {
    assertStaff(user, 'cadastrar manutenção programada');
    await this.tenant.assertCondominio(idCondominio, user);
```
Depois:
```ts
  async create(idCondominio: number, agenda: any, user?: JwtPayload) {
    assertStaff(user, 'cadastrar manutenção programada');
    await this.tenant.assertCondominio(idCondominio, user);
    // assertStaff só garante "não é morador": o funcionário com a flag
    // desligada pelo síndico publicava manutenção (com alerta) pela API.
    await this.tenant.assertPermissaoFuncionario(idCondominio, 'manutencoes_programadas', user);
```

`update` (linhas 75-76). Antes:
```ts
    if (!atual) throw new NotFoundException(`Manutenção ${id} não encontrada`);
    await this.tenant.assertEntidade(atual.id_condominio, user, `manutenção #${id}`);

    return this.prisma.agenda.update({
```
Depois:
```ts
    if (!atual) throw new NotFoundException(`Manutenção ${id} não encontrada`);
    await this.tenant.assertEntidade(atual.id_condominio, user, `manutenção #${id}`);
    await this.tenant.assertPermissaoFuncionario(atual.id_condominio, 'manutencoes_programadas', user);

    return this.prisma.agenda.update({
```

`remove` (linhas 99-100). Antes:
```ts
    if (!atual) throw new NotFoundException(`Manutenção ${id} não encontrada`);
    await this.tenant.assertEntidade(atual.id_condominio, user, `manutenção #${id}`);
    await this.prisma.agenda.delete({ where: { id: Number(id) } });
```
Depois:
```ts
    if (!atual) throw new NotFoundException(`Manutenção ${id} não encontrada`);
    await this.tenant.assertEntidade(atual.id_condominio, user, `manutenção #${id}`);
    await this.tenant.assertPermissaoFuncionario(atual.id_condominio, 'manutencoes_programadas', user);
    await this.prisma.agenda.delete({ where: { id: Number(id) } });
```

(b) `click-cond-web/apps/api/src/app/mudancas/mudancas.service.ts` (estado deixado pela D2)

`update`. Antes:
```ts
    const callerId = user?.user?.id ?? user?.sub;
    if (atual.user !== callerId) assertStaff(user, 'editar mudança de outro morador');
    if (dto.id_apartamento !== undefined) {
```
Depois:
```ts
    const callerId = user?.user?.id ?? user?.sub;
    if (atual.user !== callerId) {
      assertStaff(user, 'editar mudança de outro morador');
      // Mesma flag do updateStatus: gerir mudança alheia é "agendar mudança".
      await this.tenant.assertPermissaoFuncionario(atual.id_condominio, 'agendar_mudanca', user);
    }
    if (dto.id_apartamento !== undefined) {
```

`remove`. Antes:
```ts
    const callerId = user?.user?.id ?? user?.sub;
    if (atual.user !== callerId) assertStaff(user, 'remover mudança de outro morador');
    try {
      await this.prisma.mudancas.delete({ where: { id: Number(id) } });
```
Depois:
```ts
    const callerId = user?.user?.id ?? user?.sub;
    if (atual.user !== callerId) {
      assertStaff(user, 'remover mudança de outro morador');
      await this.tenant.assertPermissaoFuncionario(atual.id_condominio, 'agendar_mudanca', user);
    }
    try {
      await this.prisma.mudancas.delete({ where: { id: Number(id) } });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts agenda/ mudancas/`
Expected: PASS (novos + `mudancas.permissao` + `mudancas.apartamento`).

- [ ] **Step 5: Commit**

```bash
git -C C:/w/sec add click-cond-web/apps/api/src/app/agenda/agenda.service.ts click-cond-web/apps/api/src/app/mudancas/mudancas.service.ts click-cond-web/apps/api/src/app/agenda/agenda.permissao.spec.ts click-cond-web/apps/api/src/app/mudancas/mudancas.gestao-permissao.spec.ts
git -C C:/w/sec commit -m "fix(security): flags manutencoes_programadas e agendar_mudanca cobradas na agenda e na gestao de mudanca alheia" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task D4: auditoria global não aceita o condomínio do corpo sem vínculo conferido

**Fixes fingerprint:** `audit-interceptor-body-id_condominio-tenant-attribution`

O `AuditInterceptor` (global) grava `AuditLog` no condomínio `jwtPayload.id_condominio ?? body.id_condominio`. Token de app (síndico/morador/funcionário) e de CRM não tem `id_condominio`, então o corpo decidia: um morador de A mandava `{"id_condominio": B, "nome": "<texto>"}` para `POST /users/remove-fcm-token` e o texto aparecia no relatório de auditoria (e no CSV) do condomínio B.

Correção: o condomínio do registro é (1) o do token (console); senão (2) o `:idCondominio` da URL ou o `id_condominio` do corpo, **só** para token de usuário do app (`idUsuarioDoToken`) e **só** se `TenantAccessService.assertCondominio` confirmar o vínculo. Escrita legítima do app no próprio condomínio continua auditada; CRM sem condomínio no token deixa de ser auditado por este interceptor (o valor era escolhido pelo cliente).

**Files:**
- Modify: `click-cond-web/apps/api/src/app/common/interceptors/audit.interceptor.ts:1-7` (imports), `:25-29` (construtor), `:59-62` (cálculo do condomínio), novo método `condominioDoRegistro`
- Test: `click-cond-web/apps/api/src/app/common/interceptors/audit.interceptor.spec.ts` (novo)

**Interfaces:**
- Consumes: `TenantAccessService.assertCondominio(idCondominio, payload)`; `idUsuarioDoToken(payload): number | null`.
- Produces: `AuditInterceptor` construtor `(prisma, reflector, @Optional() tenant?: TenantAccessService)`; `private condominioDoRegistro(user, jwtPayload, params, body): Promise<number>`.

- [ ] **Step 1: Write the failing test**

Criar `click-cond-web/apps/api/src/app/common/interceptors/audit.interceptor.spec.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor';

/**
 * Token de app e de CRM não carrega id_condominio, e o interceptor caía no
 * `body.id_condominio`: qualquer usuário escrevia no log de auditoria do
 * condomínio que escolhesse (POST /users/remove-fcm-token com
 * {"id_condominio": B, "nome": "..."}).
 */
describe('AuditInterceptor — condomínio do registro', () => {
  function build() {
    const prisma: any = { isConnected: true, auditLog: { create: jest.fn(async () => ({})) } };
    const reflector: any = { getAllAndOverride: () => false };
    const tenant: any = {
      // O morador 1 só tem vínculo com o condomínio 1.
      assertCondominio: jest.fn(async (id: number) => {
        if (id !== 1) throw new ForbiddenException('Acesso negado');
      }),
    };
    return { interceptor: new AuditInterceptor(prisma, reflector, tenant), prisma, tenant };
  }

  async function rodar(interceptor: AuditInterceptor, req: any) {
    const ctx: any = {
      switchToHttp: () => ({ getRequest: () => ({ method: 'POST', url: '/api/users/remove-fcm-token', params: {}, ip: '10.0.0.1', ...req }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    };
    await lastValueFrom(interceptor.intercept(ctx, { handle: () => of({ ok: true }) }));
    // o `tap` grava de forma assíncrona
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  }

  const morador = { sub: 1, nome: 'Morador', typeAccess: 'Morador', user: { id: 1, nome: 'Morador' } };

  it('NÃO grava no condomínio do corpo quando o usuário não tem vínculo com ele', async () => {
    const { interceptor, prisma } = build();
    await rodar(interceptor, { user: morador, body: { id_condominio: 999, nome: 'texto injetado' } });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('token de CRM (sem Users.id) não escolhe o condomínio pelo corpo', async () => {
    const { interceptor, prisma, tenant } = build();
    await rodar(interceptor, { user: { sub: 1, nome: 'CRM', role: 'crm_admin' }, body: { id_condominio: 1 } });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(tenant.assertCondominio).not.toHaveBeenCalled();
  });

  it('grava no condomínio do corpo quando o vínculo do app confere', async () => {
    const { interceptor, prisma } = build();
    await rodar(interceptor, { user: morador, body: { id_condominio: 1, nome: 'ok' } });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id_condominio: 1 }) });
  });

  it('console: usa o condomínio do token e ignora o do corpo', async () => {
    const { interceptor, prisma } = build();
    await rodar(interceptor, { user: { sub: 3, nome: 'Porteiro', id_condominio: 7 }, body: { id_condominio: 999 } });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id_condominio: 7 }) });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts audit.interceptor`
Expected: FAIL — `NÃO grava no condomínio do corpo...` (`auditLog.create` chamado com `id_condominio: 999`) e `token de CRM...` (`auditLog.create` chamado com `id_condominio: 1`). Os outros dois passam.

- [ ] **Step 3: Write minimal implementation**

Em `click-cond-web/apps/api/src/app/common/interceptors/audit.interceptor.ts`:

(a) Imports (linhas 1-7). Antes:
```ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
```
Depois:
```ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Optional } from '@nestjs/common';
```
E, após `import { extractClientIp } from '../context/request-context';`:
```ts
import { TenantAccessService } from '../../auth/tenant-access.service';
import { idUsuarioDoToken } from '../../auth/usuario-do-token.util';
```

(b) Construtor (linhas 25-29). Antes:
```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}
```
Depois:
```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
    @Optional() private readonly tenant?: TenantAccessService,
  ) {}
```

(c) Cálculo do condomínio (linhas 59-62). Antes:
```ts
            // Extrair info do usuário do JWT payload
            const jwtPayload = user?.user ?? user ?? {};
            const idCondominio: number =
              Number(jwtPayload?.id_condominio ?? (user ? body?.id_condominio : 0) ?? 0);
```
Depois:
```ts
            // Extrair info do usuário do JWT payload
            const jwtPayload = user?.user ?? user ?? {};
            const idCondominio = await this.condominioDoRegistro(user, jwtPayload, params, body);
```

(d) Novo método, logo antes de `private parseRequest(`:
```ts
  /**
   * Condomínio em que o registro é gravado. Nunca o corpo sozinho: token de app e de CRM não trazem
   * id_condominio, e o fallback para body.id_condominio deixava qualquer usuário escrever no log de
   * auditoria de OUTRO condomínio (ex.: POST /users/remove-fcm-token com {"id_condominio": B}).
   *  1. id_condominio do token (console/portaria);
   *  2. :idCondominio da URL ou id_condominio do corpo, só para token de usuário do app e só com o
   *     vínculo conferido no banco (TenantAccessService). Sem vínculo: não grava.
   */
  private async condominioDoRegistro(user: any, jwtPayload: any, params: any, body: any): Promise<number> {
    const doToken = Number(user?.id_condominio ?? jwtPayload?.id_condominio ?? 0);
    if (doToken) return doToken;
    if (!user || !this.tenant || !idUsuarioDoToken(user)) return 0;
    const alvo = Number(params?.idCondominio ?? body?.id_condominio ?? 0);
    if (!alvo) return 0;
    try {
      await this.tenant.assertCondominio(alvo, user);
      return alvo;
    } catch {
      return 0;
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts audit.interceptor security-hardening`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C C:/w/sec add click-cond-web/apps/api/src/app/common/interceptors/audit.interceptor.ts click-cond-web/apps/api/src/app/common/interceptors/audit.interceptor.spec.ts
git -C C:/w/sec commit -m "fix(security): auditoria global nao grava no condominio do corpo sem vinculo conferido" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task D5: revogar a biometria apaga do storage a foto do rosto, também de quem nunca foi enrolado

**Fixes fingerprint:** `consent-revoke-face-photo-s3-object-not-deleted`

Builds on: **B5** — usa a assinatura nova `StorageService.deleteUrl(url, prefixosPermitidos)` e acrescenta `PREFIXOS_FOTO_MORADOR` ao lado de `PREFIXOS_FOTO_CONVITE`/`PREFIXOS_FOTO_VISITANTE` que a B5 criou em `storage.service.ts`.

`revogarBiometria` grava `aceito=0`, tira o rosto dos terminais e põe `foto_pessoa=null`, mas o objeto (gravado `public-read` em `moradores/`) continuava no bucket, acessível por quem já tinha a URL. E a limpeza só rodava com `face_id`: morador com foto guardada mas nunca enrolado ficava com `foto_pessoa` no banco. O cadastro grava a mesma URL em `Users.photo`/`profile_image`; com o objeto apagado, esses campos passam a apontar para nada e também são limpos (só quando são exatamente a URL apagada).

Nota para o deploy: o efeito no bucket depende de versionamento/backup do S3, que o código não mostra; se o bucket tiver versionamento, o expurgo LGPD precisa de regra de ciclo de vida para versões antigas.

**Files:**
- Modify: `click-cond-web/apps/api/src/app/common/storage/storage.service.ts` (constante nova junto às da B5)
- Modify: `click-cond-web/apps/api/src/app/consentimentos/consentimentos.service.ts:1-5` (imports), `:29-38` (construtor), `:160-188` (`revogarBiometria`)
- Test: `click-cond-web/apps/api/src/app/consentimentos/revogar-biometria-foto.spec.ts` (novo)

**Interfaces:**
- Consumes: `StorageService.deleteUrl(url: string | null | undefined, prefixosPermitidos: readonly string[]): Promise<boolean>` (B5).
- Produces: `export const PREFIXOS_FOTO_MORADOR: readonly string[] = ['moradores/']` em `storage.service.ts`; `ConsentimentosService` construtor `(prisma, facial, @Optional() storage?: StorageService)` — specs existentes com 2 argumentos continuam válidas.

- [ ] **Step 1: Write the failing test**

Criar `click-cond-web/apps/api/src/app/consentimentos/revogar-biometria-foto.spec.ts`:

```ts
import { ConsentimentosService } from './consentimentos.service';
import { PREFIXOS_FOTO_MORADOR } from '../common/storage/storage.service';

/**
 * Revogar a biometria zerava `foto_pessoa`, mas o objeto da foto do rosto
 * (public-read em moradores/) ficava no bucket para quem já tinha a URL. E
 * quem tinha foto mas nunca foi enrolado (face_id nulo) ficava até com a
 * foto no banco.
 */
describe('ConsentimentosService.revogarBiometria — foto do rosto', () => {
  const FOTO_A = 'https://pub.example.com/moradores/1-a.jpg';
  const FOTO_B = 'https://pub.example.com/moradores/2-b.jpg';

  function build() {
    const moradores = [
      { id: 1, id_user: 7, id_condominio: 1, face_id: 'x', foto_pessoa: FOTO_A },
      { id: 2, id_user: 7, id_condominio: 1, face_id: null, foto_pessoa: FOTO_B },
    ];
    const prisma: any = {
      isConnected: true,
      consentimentos: { create: jest.fn(async () => ({})) },
      moradores: {
        findMany: jest.fn(async () => moradores),
        update: jest.fn(async ({ where, data }: any) => Object.assign(moradores.find((m) => m.id === where.id)!, data)),
      },
      users: { updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    const facial: any = { unsyncMorador: jest.fn(async () => true) };
    const storage: any = { deleteUrl: jest.fn(async () => true) };
    return { svc: new ConsentimentosService(prisma, facial, storage), prisma, storage, moradores };
  }

  it('apaga do storage a foto de todos os moradores do titular, só dentro de moradores/', async () => {
    const { svc, storage } = build();
    await svc.revogarBiometria(7);
    expect(storage.deleteUrl).toHaveBeenCalledWith(FOTO_A, PREFIXOS_FOTO_MORADOR);
    expect(storage.deleteUrl).toHaveBeenCalledWith(FOTO_B, PREFIXOS_FOTO_MORADOR);
  });

  it('morador sem face_id também perde a foto no banco', async () => {
    const { svc, moradores } = build();
    await svc.revogarBiometria(7);
    expect(moradores[1].foto_pessoa).toBeNull();
    expect(moradores[0].foto_pessoa).toBeNull();
  });

  it('limpa Users.photo/profile_image que apontavam para a foto apagada', async () => {
    const { svc, prisma } = build();
    await svc.revogarBiometria(7);
    expect(prisma.users.updateMany).toHaveBeenCalledWith({
      where: { id: 7, photo: { in: [FOTO_A, FOTO_B] } },
      data: { photo: null },
    });
    expect(prisma.users.updateMany).toHaveBeenCalledWith({
      where: { id: 7, profile_image: { in: [FOTO_A, FOTO_B] } },
      data: { profile_image: null },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts revogar-biometria-foto`
Expected: FAIL — o import `PREFIXOS_FOTO_MORADOR` é `undefined` e `storage.deleteUrl` nunca é chamado; `moradores[1].foto_pessoa` continua `FOTO_B`; `users.updateMany` não é chamado.

- [ ] **Step 3: Write minimal implementation**

(a) `click-cond-web/apps/api/src/app/common/storage/storage.service.ts` — logo após a linha que a B5 criou:
```ts
export const PREFIXOS_FOTO_VISITANTE: readonly string[] = ['visitantes/', 'convites/'];
```
acrescentar:
```ts
/** Foto de morador (rosto do facial) nasce em moradores/ (MoradoresService.resolveFoto e saveMorador). */
export const PREFIXOS_FOTO_MORADOR: readonly string[] = ['moradores/'];
```

(b) `click-cond-web/apps/api/src/app/consentimentos/consentimentos.service.ts`

Imports (linhas 1-5). Antes:
```ts
import { ForbiddenException, Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
```
Depois:
```ts
import { ForbiddenException, Injectable, Logger, Inject, Optional, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PREFIXOS_FOTO_MORADOR, StorageService } from '../common/storage/storage.service';
```

Construtor (linhas 29-38). Antes:
```ts
    private readonly facial: FacialService,
  ) {}
```
Depois:
```ts
    private readonly facial: FacialService,
    @Optional() private readonly storage?: StorageService,
  ) {}
```

`revogarBiometria` (linhas 160-188). Antes:
```ts
    let allRemoved = true;
    for (const m of moradores) {
      if (m.face_id && m.id_condominio) {
```
Depois:
```ts
    let allRemoved = true;
    const fotos = new Set<string>();
    for (const m of moradores) {
      if (m.foto_pessoa) fotos.add(m.foto_pessoa);
      if (m.face_id && m.id_condominio) {
```

E, no mesmo método, o fim do laço. Antes:
```ts
              face_sync_error: 'device_offline_pending_retry',
              foto_pessoa: null,
            },
          });
        }
      }
    }

    return {
```
Depois:
```ts
              face_sync_error: 'device_offline_pending_retry',
              foto_pessoa: null,
            },
          });
        }
      } else if (m.foto_pessoa) {
        // Foto guardada mas nunca enrolada (sem face_id): sai do banco também.
        await this.prisma.moradores.update({ where: { id: m.id }, data: { foto_pessoa: null } });
      }
    }

    // O banco só guardava o LINK: o objeto (public-read) seguia no storage para quem já tinha a URL.
    // Users.photo/profile_image recebem a mesma URL no cadastro; apagado o objeto, apontariam para nada.
    if (fotos.size > 0) {
      const urls = [...fotos];
      await this.prisma.users.updateMany({ where: { id: idUser, photo: { in: urls } }, data: { photo: null } });
      await this.prisma.users.updateMany({ where: { id: idUser, profile_image: { in: urls } }, data: { profile_image: null } });
      for (const url of urls) {
        await this.storage?.deleteUrl(url, PREFIXOS_FOTO_MORADOR).catch(() => false);
      }
    }

    return {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts consentimentos/ storage`
Expected: PASS (novo + `consentimentos.spec`, `consentimentos.token-portaria.spec`, `consentimentos.controller.spec`, `consentimentos-terceiros.spec` e o spec de storage da B5).

- [ ] **Step 5: Commit**

```bash
git -C C:/w/sec add click-cond-web/apps/api/src/app/common/storage/storage.service.ts click-cond-web/apps/api/src/app/consentimentos/consentimentos.service.ts click-cond-web/apps/api/src/app/consentimentos/revogar-biometria-foto.spec.ts
git -C C:/w/sec commit -m "fix(security): revogar biometria apaga a foto do rosto do storage, inclusive sem face_id" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task D6: troca de condomínio com namespace explícito no token, condomínio ativo e sem renovar a validade

**Fixes fingerprints:** `auth.selecionarCondominio:remint-skips-condominio-ativo-and-renews-expiry` + `auth.selecionarCondominio:sub-namespace-inferred-from-token-shape`

Builds on: **A5** (o QR não emite mais token "sem typeAccess" por coincidência de `Users.id` com `Funcionarios_Portaria.id`, o pré-requisito da cadeia), **A6** (`montarSessaoPortaria(funcionario, login, deviceToken?)`; o bloco `const payload` abaixo é o mesmo) e **A8** (JwtStrategy recusa token anterior à troca de senha; o re-mint aqui sai com `iat` novo mas nunca passa do `exp` de origem).

Três defeitos no mesmo método:
1. O ramo "porteiro do console" era escolhido pela FORMA do token (sem `typeAccess` + com `id_condominio`), forma que outro emissor (QR) também produzia com `sub = Users.id`. Agora `montarSessaoPortaria` carimba `tipo_sub: 'funcionario_portaria'` no token do porteiro (claim só do servidor) e só esse token entra no ramo.
2. `loginPortaria` recusa condomínio desativado (`condominio: { ativo: 1 }`), a troca não recusava. Agora recusa.
3. O re-mint apagava `exp` e assinava 24h novas: chamar a rota no próprio condomínio renovava a sessão para sempre, sem senha. Agora o token novo vence junto com o de origem (ou antes, pelo teto `PORTARIA_JWT_EXPIRES_IN`).

Compatibilidade: token de porteiro emitido antes do deploy não tem `tipo_sub` e não troca de condomínio até o próximo login (no máximo 24h). Na prática a portaria-web só oferece a troca quando `condominios` vem preenchido, o que só acontece na sessão de síndico (que tem `typeAccess: 'Sindico'` e não usa o ramo).

**Files:**
- Modify: `click-cond-web/apps/api/src/app/auth/jwt-payload.interface.ts` (campo `tipo_sub`)
- Modify: `click-cond-web/apps/api/src/app/auth/auth.service.ts:145-158` (`montarSessaoPortaria`, ramo do porteiro), `:324-378` (`selecionarCondominio`)
- Modify (teste): `click-cond-web/apps/api/src/app/auth/login-portaria-typeaccess.spec.ts:89-115` (duas asserções novas)
- Test: `click-cond-web/apps/api/src/app/auth/selecionar-condominio.spec.ts` (novo)

**Interfaces:**
- Consumes: nada novo.
- Produces: `JwtPayload.tipo_sub?: 'funcionario_portaria'` — só o login do console por `Funcionarios_Portaria` carimba. `selecionarCondominio(payload, idCondominio)` mantém a assinatura e o formato da resposta.

- [ ] **Step 1: Write the failing tests**

Criar `click-cond-web/apps/api/src/app/auth/selecionar-condominio.spec.ts`:

```ts
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import type { JwtPayload } from './jwt-payload.interface';

/**
 * POST /auth/selecionar-condominio é uma segunda porta de emissão de token:
 *  - escolhia o ramo do porteiro (sub = Funcionarios_Portaria.id) pela FORMA
 *    do token, que outros emissores também produzem com sub = Users.id;
 *  - não recusava condomínio desativado no CRM (o loginPortaria recusa);
 *  - apagava o `exp` e dava 24h novas a cada chamada: a sessão nunca vencia.
 */
describe('AuthService.selecionarCondominio', () => {
  const agora = () => Math.floor(Date.now() / 1000);

  function build(opts: { ativos?: Record<number, boolean> } = {}) {
    const ativos = opts.ativos ?? { 7: true, 8: true };
    // Mesmo registro do JwtModule (signOptions 365d), para o merge de opções ser o real.
    const jwt = new JwtService({ secret: 'test', signOptions: { expiresIn: '365d' } });
    const prisma: any = {
      isConnected: true,
      sindicos_Condominios: {
        // O usuário 42 administra 7 e 8.
        findFirst: jest.fn(async ({ where }: any) => {
          if (where.id_user !== 42 || !(where.id_condominio in ativos)) return null;
          if (where.condominio?.ativo === 1 && !ativos[where.id_condominio]) return null;
          return { id: 1, id_condominio: where.id_condominio, condominio: { nome: `C${where.id_condominio}` } };
        }),
      },
      funcionarios_Portaria: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.id === 3 ? { login: 'sindico@demo.com', id_condominio: 7 } : null,
        ),
      },
      users: { findFirst: jest.fn(async () => ({ id: 42, sindicos: [{ id: 1 }] })) },
    };
    const svc = new AuthService(prisma, jwt, { get: jest.fn(), confirm: jest.fn() } as any);
    return { svc, prisma, jwt };
  }

  const sindico = (exp: number): JwtPayload & { iat: number; exp: number } =>
    ({ sub: 42, nome: 'S', id_condominio: 7, turno: 'Síndico', typeAccess: 'Sindico', iat: agora() - 10, exp });

  it('NEGA trocar para condomínio desativado', async () => {
    const { svc, prisma } = build({ ativos: { 7: true, 8: false } });
    await expect(svc.selecionarCondominio(sindico(agora() + 3600), 8)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.sindicos_Condominios.findFirst.mock.calls[0][0].where.condominio).toEqual({ ativo: 1 });
  });

  it('não renova: o token novo vence junto com o de origem', async () => {
    const { svc, jwt } = build();
    const exp = agora() + 60;
    const res = await svc.selecionarCondominio(sindico(exp), 7);
    const novo: any = jwt.decode(res.access_token);
    expect(novo.id_condominio).toBe(7);
    expect(novo.exp).toBeLessThanOrEqual(exp);
  });

  it('token de origem longo (app, 365d) continua limitado ao teto da portaria', async () => {
    const { svc, jwt } = build();
    const res = await svc.selecionarCondominio(sindico(agora() + 300 * 86400), 8);
    const novo: any = jwt.decode(res.access_token);
    expect(novo.exp).toBeLessThanOrEqual(agora() + 86400 + 5);
  });

  it('token sem typeAccess e sem tipo_sub NÃO é tratado como porteiro (sub pode ser Users.id)', async () => {
    const { svc, prisma } = build();
    const formaDoQr: any = { sub: 3, nome: 'X', id_condominio: 7, iat: agora(), exp: agora() + 3600 };
    await expect(svc.selecionarCondominio(formaDoQr, 8)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.funcionarios_Portaria.findFirst).not.toHaveBeenCalled();
  });

  it('porteiro do console (tipo_sub carimbado) cujo login é o síndico continua trocando', async () => {
    const { svc, prisma, jwt } = build();
    const porteiro: any = { sub: 3, nome: 'P', id_condominio: 7, turno: 'Geral', tipo_sub: 'funcionario_portaria', iat: agora(), exp: agora() + 3600 };
    const res = await svc.selecionarCondominio(porteiro, 8);
    expect((jwt.decode(res.access_token) as any)).toMatchObject({ id_condominio: 8, tipo_sub: 'funcionario_portaria' });
    expect(prisma.funcionarios_Portaria.findFirst.mock.calls[0][0].where).toEqual({ id: 3, ativo: 1, condominio: { ativo: 1 } });
  });
});
```

Em `click-cond-web/apps/api/src/app/auth/login-portaria-typeaccess.spec.ts`:

No caso `'síndico que também é funcionário recebe typeAccess=Sindico e passa no assertStaff'`, logo após `expect(token.id_condominio).toBe(7);` acrescentar:
```ts
    // Síndico: sub = Users.id, sem o carimbo do porteiro.
    expect(token.tipo_sub).toBeUndefined();
```

No caso `'porteiro comum continua SEM typeAccess — sem alçada no financeiro'`, logo após `expect(token.sub).toBe(3);` acrescentar:
```ts
    // sub = Funcionarios_Portaria.id, declarado no próprio token (selecionarCondominio depende disto).
    expect(token.tipo_sub).toBe('funcionario_portaria');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts selecionar-condominio login-portaria-typeaccess`
Expected: FAIL — `NEGA trocar para condomínio desativado` (resolveu; `where.condominio` é `undefined`), `não renova...` (`exp` ≈ agora+86400 > origem), `token sem typeAccess e sem tipo_sub...` (`funcionarios_Portaria.findFirst` chamado), `porteiro do console...` (`where` sem `condominio`; token sem `tipo_sub`), e em `login-portaria-typeaccess` o porteiro (`tipo_sub` undefined) — além de erro de tipo TS `Property 'tipo_sub' does not exist on type 'JwtPayload'`. O caso "teto da portaria" passa.

- [ ] **Step 3: Write minimal implementation**

(a) `click-cond-web/apps/api/src/app/auth/jwt-payload.interface.ts`. Antes:
```ts
  /** Marca tokens administrativos do CRM ('crm_admin'). Ausente em tokens de porteiro/app. */
  role?: string;
  user?: any;
}
```
Depois:
```ts
  /** Marca tokens administrativos do CRM ('crm_admin'). Ausente em tokens de porteiro/app. */
  role?: string;
  /**
   * Namespace do `sub` quando ele NÃO é Users.id. Só o login do console por Funcionarios_Portaria
   * carimba 'funcionario_portaria'; nenhum cliente escolhe (vem assinado). Quem precisa saber de
   * que tabela é o `sub` lê isto, nunca a forma do token.
   */
  tipo_sub?: 'funcionario_portaria';
  user?: any;
}
```

(b) `click-cond-web/apps/api/src/app/auth/auth.service.ts`, `montarSessaoPortaria` (linhas 153-158). Antes:
```ts
      : {
          sub: funcionario.id,
          nome: funcionario.nome,
          id_condominio: funcionario.id_condominio,
          turno: funcionario.turno,
        };
```
Depois:
```ts
      : {
          sub: funcionario.id,
          nome: funcionario.nome,
          id_condominio: funcionario.id_condominio,
          turno: funcionario.turno,
          // sub = Funcionarios_Portaria.id: declarado, para ninguém inferir pela forma do token.
          tipo_sub: 'funcionario_portaria',
        };
```

(c) `selecionarCondominio` — ramo do porteiro (linhas 324-330). Antes:
```ts
    } else if (!payload.typeAccess && payload.id_condominio) {
      // Só o token de console do porteiro (sem typeAccess, com condomínio) tem sub = Funcionarios_Portaria.id.
      // Token de app (Morador/Funcionario) tem sub = Users.id e jamais pode cair neste lookup por coincidência de número.
      const funcionario = await this.prisma.funcionarios_Portaria.findFirst({
        where: { id: payload.sub, ativo: 1 },
        select: { login: true, id_condominio: true },
      });
```
Depois:
```ts
    } else if (!payload.typeAccess && payload.id_condominio && payload.tipo_sub === 'funcionario_portaria') {
      // Só o token de console do porteiro tem sub = Funcionarios_Portaria.id, e é o único que o
      // montarSessaoPortaria carimba com tipo_sub. Antes o ramo era escolhido pela FORMA do token
      // (sem typeAccess, com condomínio), que o login por QR também produzia com sub = Users.id.
      const funcionario = await this.prisma.funcionarios_Portaria.findFirst({
        where: { id: payload.sub, ativo: 1, condominio: { ativo: 1 } },
        select: { login: true, id_condominio: true },
      });
```

(d) `selecionarCondominio` — vínculo (linhas 352-355). Antes:
```ts
    const vinculo = await this.prisma.sindicos_Condominios.findFirst({
      where: { id_user: idUserSindico, id_condominio: Number(idCondominio) },
      include: { condominio: { select: { nome: true } } },
    });
```
Depois:
```ts
    const vinculo = await this.prisma.sindicos_Condominios.findFirst({
      // condominio.ativo: o mesmo corte do loginPortaria — condomínio desativado no CRM não ganha sessão.
      where: { id_user: idUserSindico, id_condominio: Number(idCondominio), condominio: { ativo: 1 } },
      include: { condominio: { select: { nome: true } } },
    });
```

(e) `selecionarCondominio` — assinatura (linhas 367-378). Antes:
```ts
    delete (novoPayload as any).iat;
    delete (novoPayload as any).exp;

    return {
      access_token: this.jwt.sign(novoPayload, { expiresIn: this.portariaJwtExpiresIn }),
      id: payload.sub,
```
Depois:
```ts
    delete (novoPayload as any).iat;
    delete (novoPayload as any).exp;

    // Trocar de condomínio não renova a sessão: o token novo vence junto com o de origem (ou antes,
    // pelo teto da portaria). Sem isto, chamar a rota no próprio condomínio a cada 23h mantinha a
    // sessão viva para sempre, sem senha.
    const expOrigem = typeof (payload as any).exp === 'number' ? (payload as any).exp : null;
    const agora = Math.floor(Date.now() / 1000);
    if (expOrigem !== null && expOrigem <= agora) {
      throw new UnauthorizedException('Sessão expirada. Entre novamente.');
    }
    let accessToken = this.jwt.sign(novoPayload, { expiresIn: this.portariaJwtExpiresIn });
    const expNovo = (this.jwt.decode(accessToken) as any)?.exp;
    if (expOrigem !== null && typeof expNovo === 'number' && expNovo > expOrigem) {
      accessToken = this.jwt.sign(novoPayload, { expiresIn: expOrigem - agora });
    }

    return {
      access_token: accessToken,
      id: payload.sub,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts selecionar-condominio login-portaria qr-session sindico-login-mfa revogacao-troca-senha`
Expected: PASS (inclui `login-portaria-mfa` da A6 e `revogacao-troca-senha` da A8).

Run: `cd C:/w/sec/click-cond-web && npx tsc -p apps/api/tsconfig.app.json --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git -C C:/w/sec add click-cond-web/apps/api/src/app/auth/jwt-payload.interface.ts click-cond-web/apps/api/src/app/auth/auth.service.ts click-cond-web/apps/api/src/app/auth/selecionar-condominio.spec.ts click-cond-web/apps/api/src/app/auth/login-portaria-typeaccess.spec.ts
git -C C:/w/sec commit -m "fix(security): selecionar-condominio com namespace explicito do sub, condominio ativo e sem renovar a validade" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task D7: resposta forjada de descoberta na LAN não re-aponta o terminal

**Fixes fingerprint:** `agent/descoberta/unauthenticated-reply-rewrites-device-ip`

A descoberta (DHIP/SADP) aceita qualquer datagrama que pareça resposta: IP e MAC vêm do payload, o remetente nem é lido, e a fusão por MAC fica com a PRIMEIRA resposta. A nuvem casa o device só pelo MAC e reescreve `Facial_Devices.ip/porta`; no poll seguinte o agente manda senha do terminal, fotos de rosto e comandos de porta para o novo endereço. Qualquer host da LAN que conheça o MAC do terminal (está na resposta legítima e na ARP) re-aponta o terminal para si.

A correção fica nas duas pontas, e cada uma fecha uma parte:
- **Agente:** descarta resposta cujo IP declarado difere do remetente (`rinfo.address`) e deixa de fundir o mesmo MAC visto em dois IPs (a nuvem passa a ver o conflito, em vez de "o primeiro ganha").
- **API (passo 3 de `receber`):** não corrige o endereço quando (a) o mesmo MAC aparece em mais de um endereço no relato; (b) o agente relatou o device online no endereço cadastrado com o MAC cadastrado (`macs_cadastrados`); (c) a família do fabricante difere (`dahua` = `intelbras`); (d) as duas séries são conhecidas e diferem.

O caso legítimo (DHCP trocou o IP; o aparelho some do endereço antigo e responde, sozinho, no novo) continua corrigido automaticamente. O atacante na LAN que se declara no próprio IP enquanto o terminal legítimo está online cai em (a) ou (b). A variante de passo 2 (ARP envenenada trocando o MAC aprendido) não é fechada aqui: quem envenena a ARP já intercepta o tráfego para o IP cadastrado, e depois de um MAC trocado, (b) impede que a mesma leitura também mova o endereço.

**Files:**
- Modify: `click-cond-web/agent/src/descoberta/index.js:3-13` (comentário), `:70-73` (`s.on('message', ...)`)
- Modify: `click-cond-web/agent/src/descoberta/formato.js:31-48` (`agruparPorMac`)
- Modify: `click-cond-web/apps/api/src/app/facial/descoberta.service.ts` (função `familiaFabricante` nova; laço do passo 3, linhas 201-210)
- Test: `click-cond-web/agent/test/descoberta-formato.test.js` (caso novo), `click-cond-web/agent/test/descoberta-orquestrador.test.js` (caso novo), `click-cond-web/apps/api/src/app/facial/descoberta.service.spec.ts` (describe novo no fim)

**Interfaces:**
- Consumes: nada de outras tasks. (B4/B8/B9 mexem em validação de IP no cadastro, Basic preemptivo e ACL do agente; nenhuma toca `descoberta/` nem `descoberta.service.ts`.)
- Produces: `agruparPorMac(achados)` passa a devolver um achado por **MAC+IP** (mesmo nome exportado). `familiaFabricante(f: unknown): string` local em `descoberta.service.ts`.

- [ ] **Step 1: Write the failing tests**

Em `click-cond-web/agent/test/descoberta-formato.test.js`, logo após o teste `'agruparPorMac funde o mesmo aparelho e mantém sem-MAC por IP'`:

```js
test('agruparPorMac NÃO funde o mesmo MAC visto em dois IPs (conflito vai para a nuvem)', () => {
  const base = { porta: 80, fabricante: 'intelbras', modelo: null, numero_serie: null, dhcp: null, validado_em_campo: true, classe: null };
  const r = agruparPorMac([
    { ...base, mac: 'b4:4c:3b:f4:e3:01', ip: '192.168.3.175' },
    { ...base, mac: 'b4:4c:3b:f4:e3:01', ip: '192.168.3.66' },
  ]);
  assert.strictEqual(r.length, 2);
  assert.deepStrictEqual(r.map((a) => a.ip).sort(), ['192.168.3.175', '192.168.3.66']);
});
```

Em `click-cond-web/agent/test/descoberta-orquestrador.test.js`, logo após o teste `'descobrir junta resposta DHIP e página Control iD'`:

```js
test('resposta cujo IP declarado não é o do remetente é descartada', async () => {
  // Quem responde é 127.0.0.1, mas o payload diz ser o terminal 192.168.3.175:
  // é assim que um host da LAN tentaria se passar pelo aparelho.
  const forjada = RESPOSTA.replace('"IPAddress":"127.0.0.1"', '"IPAddress":"192.168.3.175"');
  const udp = dgram.createSocket('udp4');
  udp.on('message', (msg, r) => { if (msg.includes('DHDiscover')) udp.send(dhip(forjada), r.port, r.address); });
  await new Promise((ok) => udp.bind(0, '127.0.0.1', ok));
  try {
    const achados = await descobrir({
      varredura: false,
      esperaMs: 500,
      destinos: [{ protocolo: 'dhip', host: '127.0.0.1', porta: udp.address().port }],
    });
    assert.deepStrictEqual(achados, []);
  } finally {
    udp.close();
  }
});
```

No fim de `click-cond-web/apps/api/src/app/facial/descoberta.service.spec.ts`:

```ts
describe('DescobertaService — resposta forjada na LAN não re-aponta o terminal', () => {
  const MAC = 'b4:4c:3b:f4:e3:01';
  const dev = (o: Record<string, unknown> = {}) => ({
    id: 1, id_condominio: 10, ativo: 1, nome: 'facial', fabricante: 'intelbras',
    ip: '192.168.3.175', porta: 80, mac: MAC, numero_serie: 'K3LJ3400209RH', ...o,
  });

  it('mesmo MAC em dois endereços no relato: não corrige', async () => {
    const devs = [dev()];
    const { svc } = montar(devs);
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
    const r = await svc.receber(10, { achados: [achado({ ip: '192.168.3.66' }), achado()] });
    expect(r.ips_corrigidos).toBe(0);
    expect(devs[0].ip).toBe('192.168.3.175');
  });

  it('agente relata o device online no endereço cadastrado com o MAC cadastrado: não corrige', async () => {
    const devs = [dev()];
    const { svc } = montar(devs);
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
    const r = await svc.receber(10, { achados: [achado({ ip: '192.168.3.66' })], macs_cadastrados: [{ id: 1, mac: MAC }] });
    expect(r.ips_corrigidos).toBe(0);
    expect(devs[0].ip).toBe('192.168.3.175');
  });

  it('fabricante de outra família: não corrige', async () => {
    const devs = [dev({ fabricante: 'hikvision' })];
    const { svc } = montar(devs);
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
    const r = await svc.receber(10, { achados: [achado({ ip: '192.168.3.66' })] });
    expect(r.ips_corrigidos).toBe(0);
  });

  it('número de série conhecido e diferente: não corrige', async () => {
    const devs = [dev()];
    const { svc } = montar(devs);
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
    const r = await svc.receber(10, { achados: [achado({ ip: '192.168.3.66', numero_serie: 'OUTRA' })] });
    expect(r.ips_corrigidos).toBe(0);
  });

  it('DHCP de verdade (device cadastrado como dahua, achado intelbras, sumiu do IP antigo): corrige', async () => {
    const devs = [dev({ fabricante: 'dahua' })];
    const { svc } = montar(devs);
    const r = await svc.receber(10, { achados: [achado({ ip: '192.168.3.66' })] });
    expect(r.ips_corrigidos).toBe(1);
    expect(devs[0].ip).toBe('192.168.3.66');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:/w/sec/click-cond-web/agent && node --test test/descoberta-formato.test.js test/descoberta-orquestrador.test.js`
Expected: FAIL — `agruparPorMac NÃO funde...` (`r.length` 1, esperado 2) e `resposta cujo IP declarado...` (achados com `ip: '192.168.3.175'`).

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts descoberta.service`
Expected: FAIL — os quatro casos `não corrige` (`ips_corrigidos` 1). O caso `DHCP de verdade` passa.

- [ ] **Step 3: Write minimal implementation**

(a) `click-cond-web/agent/src/descoberta/index.js`

Comentário do topo (linha 11). Antes:
```js
 *  - MAC que faltar vem da tabela ARP; no fim, um achado por MAC.
```
Depois:
```js
 *  - MAC que faltar vem da tabela ARP; no fim, um achado por MAC+IP.
 *  - Resposta UDP só vale se o IP declarado for o do remetente: o conteúdo
 *    não é autenticado e decide para onde a nuvem aponta o terminal.
```

Handler (linhas 70-73). Antes:
```js
      s.on('message', (msg) => {
        const a = interpretar(msg);
        if (a) achados.push(a);
      });
```
Depois:
```js
      s.on('message', (msg, rinfo) => {
        const a = interpretar(msg);
        // IP e MAC vêm do payload, que qualquer host da LAN escreve. O IP declarado
        // tem de ser o de quem mandou: senão um host se passaria por outro endereço.
        if (a && a.ip === rinfo.address) achados.push(a);
      });
```

(b) `click-cond-web/agent/src/descoberta/formato.js`, `agruparPorMac` (linhas 31-48). Antes:
```js
/**
 * Um aparelho pode responder por dois caminhos (multicast + varredura, ou
 * duas interfaces). Funde por MAC; os campos não nulos do repetido preenchem
 * os que faltavam. Sem MAC (ARP ainda não viu o IP), agrupa por IP.
 */
function agruparPorMac(achados) {
  const porChave = new Map();
  for (const a of achados) {
    const chave = a.mac || `ip:${a.ip}`;
```
Depois:
```js
/**
 * Um aparelho pode responder por dois caminhos (multicast + varredura, ou
 * duas interfaces). Funde por MAC+IP; os campos não nulos do repetido
 * preenchem os que faltavam. Sem MAC (ARP ainda não viu o IP), agrupa por IP.
 *
 * O mesmo MAC em dois IPs NÃO é fundido: um dos dois é falso (resposta
 * forjada na LAN) ou a rede está quebrada. Antes ficava a primeira resposta,
 * e a nuvem "corrigia" o IP do terminal para quem respondesse mais rápido;
 * mandando as duas, a nuvem vê o conflito e não mexe.
 */
function agruparPorMac(achados) {
  const porChave = new Map();
  for (const a of achados) {
    const chave = a.mac ? `${a.mac}|${a.ip}` : `ip:${a.ip}`;
```

(c) `click-cond-web/apps/api/src/app/facial/descoberta.service.ts`

Logo após a função `prefixo24` (linha ~85):
```ts
/** Intelbras é OEM da Dahua (mesmo protocolo): as duas grafias são a mesma família. */
function familiaFabricante(f: unknown): string {
  const s = String(f ?? '').trim().toLowerCase();
  return s === 'dahua' ? 'intelbras' : s;
}
```

Passo 3 (linhas 201-210). Antes:
```ts
    for (const a of achados) {
      if (!a.mac) continue;
      const d = devices.find((x) => x.mac === a.mac);
      if (!d || (d.ip === a.ip && d.porta === a.porta)) continue;
      if (devices.some((o) => o.id !== d.id && o.ip === a.ip)) continue;
```
Depois:
```ts
    for (const a of achados) {
      if (!a.mac) continue;
      const d = devices.find((x) => x.mac === a.mac);
      if (!d || (d.ip === a.ip && d.porta === a.porta)) continue;
      if (devices.some((o) => o.id !== d.id && o.ip === a.ip)) continue;
      // A resposta de descoberta não é autenticada: qualquer host da LAN que saiba o MAC
      // se declara "o terminal" no próprio IP, e o próximo poll mandaria para lá a senha,
      // as fotos e os comandos de porta. Só segue a mudança quando nada a contradiz.
      const enderecosDoMac = new Set(achados.filter((x) => x.mac === a.mac).map((x) => `${x.ip}:${x.porta}`));
      const onlineNoCadastro = macs_cadastrados.some((m) => m.id === d.id && m.mac === d.mac);
      const outraFamilia = !!d.fabricante && familiaFabricante(d.fabricante) !== familiaFabricante(a.fabricante);
      const outraSerie = !!d.numero_serie && !!a.numero_serie && d.numero_serie !== a.numero_serie;
      if (enderecosDoMac.size > 1 || onlineNoCadastro || outraFamilia || outraSerie) {
        this.logger.warn(
          `Correção de IP ignorada: dispositivo ${d.id} (${d.ip}:${d.porta}) → ${a.ip}:${a.porta} contradita ` +
            `(enderecos=${enderecosDoMac.size}, online_no_cadastro=${onlineNoCadastro}, fabricante=${outraFamilia}, serie=${outraSerie})`,
        );
        continue;
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:/w/sec/click-cond-web/agent && node --test test/`
Expected: PASS (todos os testes do agente).

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts descoberta descobertos`
Expected: PASS (`descoberta.service.spec` inteiro, `agent-descobertos.controller.spec`, `facial-descobertos.controller.spec`).

- [ ] **Step 5: Commit**

```bash
git -C C:/w/sec add click-cond-web/agent/src/descoberta/index.js click-cond-web/agent/src/descoberta/formato.js click-cond-web/agent/test/descoberta-formato.test.js click-cond-web/agent/test/descoberta-orquestrador.test.js click-cond-web/apps/api/src/app/facial/descoberta.service.ts click-cond-web/apps/api/src/app/facial/descoberta.service.spec.ts
git -C C:/w/sec commit -m "fix(security): resposta forjada de descoberta na LAN nao re-aponta o terminal" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Deploy: a parte do agente só vale depois de publicar uma versão nova do agente (workflow de release do agente); a parte da API protege sozinha os agentes já instalados nos casos (b), (c) e (d).

---

### Task D8: senha inicial do morador nunca é o CPF

**Fixes fingerprint:** `crm-superlogica.criarMoradoresDosContatos:cpf-digits-initial-password`

O ponto de derivação comum é a escolha da senha inicial em `MoradoresService.create` e `MobileAuthService.saveMorador`: sem envio de credenciais (`sendCredentials` falso/omitido), a senha virava os dígitos do CPF, com login = e-mail e sem troca obrigatória. CPF não é segredo: quem sabe o e-mail e o CPF entra na conta (token de 365 dias). A importação da Superlógica usa a mesma derivação (hoje barrada antes pela falta de data de nascimento; passa a ser segura quando passar a mandar a data).

Correção: senha inicial SEMPRE aleatória. Com envio, ela vai no e-mail de boas-vindas (igual a hoje). Sem envio, ninguém a conhece e a conta é ativada depois por "Enviar credenciais" (`sendCredentials`, que já gera senha aleatória e manda por e-mail) ou "Esqueci a senha". O login continua sendo o e-mail; o CPF continua só como identificador.

**Files:**
- Modify: `click-cond-web/apps/api/src/app/moradores/moradores.service.ts:5` (import removido), `:756-762`
- Modify: `click-cond-web/apps/api/src/app/auth/mobile-auth.service.ts:3728` (comentário), `:3741-3746`
- Test: `click-cond-web/apps/api/src/app/moradores/moradores-senha-inicial.spec.ts` (novo), `click-cond-web/apps/api/src/app/auth/cadastro-morador-senha-inicial.spec.ts` (novo)

**Interfaces:**
- Consumes: `MoradoresService.gerarSenhaAleatoria()`, `MobileAuthService.gerarNovaSenha()` (privados, já existem).
- Produces: nada novo. D9 altera os ramos "conta existente" desses mesmos métodos a partir do estado deixado aqui (as variáveis `senhaInicial`/`senhaHash`/`passwordWasSet` seguem com os mesmos nomes).

- [ ] **Step 1: Write the failing tests**

Criar `click-cond-web/apps/api/src/app/moradores/moradores-senha-inicial.spec.ts`:

```ts
import * as bcrypt from 'bcrypt';
import { MoradoresService } from './moradores.service';

/**
 * Sem "Enviar credenciais", a conta nascia com login = e-mail e senha = dígitos
 * do CPF, sem troca obrigatória. CPF não é segredo.
 */
describe('MoradoresService.create — senha inicial nunca é o CPF', () => {
  const CPF = '529.982.247-25';
  const CPF_DIGITOS = '52998224725';

  function build() {
    const prisma: any = {
      isConnected: true,
      moradores: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 300, ...data })),
        count: jest.fn(async () => 0),
      },
      visitantes: { findFirst: jest.fn(async () => null) },
      users: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 900, ...data })),
        update: jest.fn(async () => ({})),
      },
      apartamentos: { findUnique: jest.fn(async () => null) },
      apartamentos_Users: { create: jest.fn(async () => ({})), count: jest.fn(async () => 0) },
      sindicos_Condominios: { count: jest.fn(async () => 0) },
      funcionarios: { count: jest.fn(async () => 0) },
    };
    const mail: any = { sendWelcomeMorador: jest.fn(async () => ({})), sendWelcomeMoradorExisting: jest.fn(async () => ({})) };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const svc = new MoradoresService(prisma, mail, storage, {} as any, { registrar: jest.fn(async () => ({})) } as any, { enviarMorador: jest.fn(async () => ({ enviado: false })) } as any);
    jest.spyOn(svc as any, 'carregarContextoMorador').mockResolvedValue(null);
    jest.spyOn(svc, 'findOne').mockResolvedValue({} as any);
    return { svc, prisma, mail };
  }

  const dto = (over: any = {}) => ({
    nome: 'Morador QA', email: 'qa@x.com', documento: CPF, data_nascimento: '1990-01-01', id_condominio: 1, ...over,
  });

  it.each([[false], [undefined]])('sendCredentials=%p: a senha gravada não é o CPF e nada é enviado', async (envio) => {
    const { svc, prisma, mail } = build();
    await svc.create(dto({ sendCredentials: envio }) as any);
    const hash = prisma.users.create.mock.calls[0][0].data.password;
    expect(hash).toMatch(/^\$2/);
    expect(await bcrypt.compare(CPF_DIGITOS, hash)).toBe(false);
    expect(await bcrypt.compare(CPF, hash)).toBe(false);
    expect(mail.sendWelcomeMorador).not.toHaveBeenCalled();
  });

  it('sendCredentials=true: a senha enviada é a gravada (comportamento mantido)', async () => {
    const { svc, prisma, mail } = build();
    await svc.create(dto({ sendCredentials: true }) as any);
    const hash = prisma.users.create.mock.calls[0][0].data.password;
    const [, , enviada] = mail.sendWelcomeMorador.mock.calls[0];
    expect(await bcrypt.compare(enviada, hash)).toBe(true);
    expect(enviada).not.toBe(CPF_DIGITOS);
  });
});
```

Criar `click-cond-web/apps/api/src/app/auth/cadastro-morador-senha-inicial.spec.ts`:

```ts
import * as bcrypt from 'bcrypt';
import { MobileAuthService } from './mobile-auth.service';

/** Mesmo defeito no cadastro pelo app (saveMorador): sem envio, senha = CPF. */
describe('saveMorador — senha inicial nunca é o CPF', () => {
  const CPF = '52998224725';
  const sindico = { sub: 1, nome: 'Síndico', typeAccess: 'Sindico' } as any;

  function montar() {
    const prisma: any = {
      isConnected: true,
      apartamentos: { findUnique: jest.fn(async () => ({ id: 11, id_condominio: 1, bloco: 'A', apto: '101' })) },
      moradores: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 500, ...data })),
        count: jest.fn(async () => 0),
      },
      users: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 900, ...data })),
        update: jest.fn(async () => ({})),
      },
      apartamentos_Users: { findFirst: jest.fn(async () => null), create: jest.fn(async () => ({})), count: jest.fn(async () => 0) },
      sindicos_Condominios: { count: jest.fn(async () => 0) },
      funcionarios: { count: jest.fn(async () => 0) },
    };
    const mail: any = { sendWelcomeMorador: jest.fn(async () => ({})), sendWelcomeMoradorExisting: jest.fn(async () => ({})) };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const tenant: any = { assertCondominio: jest.fn(async () => undefined) };
    const superlogica: any = { enviarMorador: jest.fn(async () => undefined) };
    const svc = new MobileAuthService(prisma, { sign: jest.fn() } as any, mail, storage, {} as any, tenant, {} as any, {} as any, {} as any, superlogica);
    return { svc, prisma, mail };
  }

  it('sendCredentials=false: Users nasce com senha que não é o CPF e nada é enviado', async () => {
    const { svc, prisma, mail } = montar();
    await svc.saveMorador(
      { morador: { nome: 'QA', documento: CPF, email: 'qa@x.com', data_nascimento: '01/01/1990', id_apto: 11, sendCredentials: false } },
      false,
      sindico,
    );
    const hash = prisma.users.create.mock.calls[0][0].data.password;
    expect(await bcrypt.compare(CPF, hash)).toBe(false);
    expect(mail.sendWelcomeMorador).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts moradores-senha-inicial cadastro-morador-senha-inicial`
Expected: FAIL — `sendCredentials=false` / `undefined` em `moradores-senha-inicial` e o caso de `saveMorador`: `expect(received).toBe(false)` com `received: true` (`bcrypt.compare('52998224725', hash)`). O caso `sendCredentials=true` passa.

- [ ] **Step 3: Write minimal implementation**

(a) `click-cond-web/apps/api/src/app/moradores/moradores.service.ts`

Linha 5 — remover (fica sem uso):
```ts
import { somenteDigitos } from '../common/documento.util';
```

Linhas 756-762. Antes:
```ts
    // Senha inicial temporária gerada de forma aleatória quando as credenciais são enviadas,
    // evitando expor documento/CPF como credencial de acesso.
    const senhaAleatoria = this.gerarSenhaAleatoria();
    const senhaInicial = (dto.sendCredentials && dto.email)
      ? senhaAleatoria
      : (somenteDigitos(dto.documento) || senhaAleatoria);
    const senhaHash = await bcrypt.hash(senhaInicial, 10);
```
Depois:
```ts
    // Senha inicial SEMPRE aleatória. Com sendCredentials ela vai no e-mail de boas-vindas;
    // sem, ninguém a conhece e a conta é ativada por "Enviar credenciais" ou "Esqueci a senha".
    // Antes, sem o envio, virava os dígitos do CPF — que não é segredo.
    const senhaInicial = this.gerarSenhaAleatoria();
    const senhaHash = await bcrypt.hash(senhaInicial, 10);
```

(b) `click-cond-web/apps/api/src/app/auth/mobile-auth.service.ts` (`somenteDigitos` continua importado: é usado em `saveFuncionario`, linha 3311)

Linha 3728. Antes:
```ts
      // Cria/reutiliza Users por email OU cpf — senha inicial = documento ou '123456'
```
Depois:
```ts
      // Cria/reutiliza Users por email OU cpf — senha inicial aleatória
```

Linhas 3741-3746. Antes:
```ts
      const senhaInicial = (mor.email && mor.sendCredentials !== false)
        ? this.gerarNovaSenha()
        : (somenteDigitos(cpf) || this.gerarNovaSenha());
      // bcrypt: a senha inicial sao os digitos do CPF, que nao e segredo. Em
      // MD5 sem sal, qualquer vazamento do banco entrega a senha na hora.
      const senhaHash = await bcrypt.hash(senhaInicial, 10);
```
Depois:
```ts
      // Senha inicial SEMPRE aleatória. Com envio de credenciais ela vai no e-mail
      // de boas-vindas; sem, ninguém a conhece e a conta é ativada depois por
      // "Enviar credenciais" (moradores.sendCredentials) ou "Esqueci a senha".
      // Antes, sem o envio, virava os dígitos do CPF — que não é segredo.
      const senhaInicial = this.gerarNovaSenha();
      const senhaHash = await bcrypt.hash(senhaInicial, 10);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts moradores/ senha-inicial morador-menor-biometria senha-bcrypt crm-superlogica mobile-auth.authz`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C C:/w/sec add click-cond-web/apps/api/src/app/moradores/moradores.service.ts click-cond-web/apps/api/src/app/auth/mobile-auth.service.ts click-cond-web/apps/api/src/app/moradores/moradores-senha-inicial.spec.ts click-cond-web/apps/api/src/app/auth/cadastro-morador-senha-inicial.spec.ts
git -C C:/w/sec commit -m "fix(security): senha inicial do morador sempre aleatoria, nunca os digitos do CPF" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Nota para o dono (não bloqueia a task): moradores criados até agora sem envio de credenciais têm como senha os dígitos do CPF. Como o banco ainda só tem dados de teste, nada a migrar hoje; se já houver contas reais no deploy, rodar "Enviar credenciais" para elas ou invalidar essas senhas.

---

### Task D9: cadastro de morador não grava credenciais numa conta que tem vínculo em outro condomínio

**Fixes fingerprint:** `mobile-auth.saveMorador:existing-user-credential-overwrite-cross-tenant`

Builds on: **A2** (incremento: a A2 fechou o cadastro de porteiro e deixou o *vínculo* silencioso do `saveMorador` em "Deferred to owner"; esta task não mexe no vínculo, só no que é gravado na conta) e **D8** (estado de `senhaInicial`/`senhaHash` nos mesmos métodos).

`Users` é global. O `saveMorador` (staff em `moradores/insert`; proprietário em `moradores/insert-familiar`) acha a conta por e-mail OU CPF em qualquer condomínio e, se faltar login/senha/e-mail, grava o e-mail e uma senha que quem cadastra conhece (mandada para o e-mail dele). Com o CPF de um morador de outro condomínio cadastrado sem e-mail, o atacante vira dono da conta da vítima (token de morador com os vínculos dela no outro prédio). `MoradoresService.create` tem a mesma porta (acha por e-mail e grava login+senha se faltar qualquer um). A política do projeto já existe (`vinculos-usuario.util.ts`) e é aplicada em `sendCredentials` e na edição do `saveMorador`; faltava nos dois ramos "conta existente" da criação.

Correção: se a conta tem vínculo em outro condomínio, o cadastro só liga a pessoa ao apartamento; não grava login, e-mail, CPF, senha nem foto na conta. Conta só deste condomínio (ou sem vínculo) segue como hoje.

**Files:**
- Modify: `click-cond-web/apps/api/src/app/auth/mobile-auth.service.ts:3774-3792` (`saveMorador`, ramo `if (existing)`)
- Modify: `click-cond-web/apps/api/src/app/moradores/moradores.service.ts:797-818` (`create`, ramo `if (existing)`)
- Test: `click-cond-web/apps/api/src/app/auth/cadastro-morador-conta-existente.spec.ts` (novo), `click-cond-web/apps/api/src/app/moradores/moradores-conta-existente.spec.ts` (novo)

**Interfaces:**
- Consumes: `usuarioTemVinculoEmOutroCondominio(prisma, idUser, idCondominio): Promise<boolean>` de `../common/vinculos-usuario.util` (já importado nos dois arquivos).
- Produces: nada novo.

- [ ] **Step 1: Write the failing tests**

Criar `click-cond-web/apps/api/src/app/auth/cadastro-morador-conta-existente.spec.ts`:

```ts
import { MobileAuthService } from './mobile-auth.service';

/**
 * Users é global. O cadastro de morador achava a conta pelo CPF em QUALQUER
 * condomínio e, faltando login/senha/e-mail, gravava o e-mail de quem
 * cadastrava e uma senha que ele conhecia — tomando a conta de um morador de
 * outro prédio. A A2 deixou o VÍNCULO para o dono decidir; aqui só se impede
 * gravar credenciais nessa conta.
 */
describe('saveMorador — conta existente com vínculo em outro condomínio', () => {
  const CPF = '52998224725';
  const sindico = { sub: 1, nome: 'Síndico A', typeAccess: 'Sindico' } as any;
  const vitima = { id: 70, cpf: CPF, email: null, login: null, password: null, name: 'Vítima', phone: '17999990000' };

  function montar(vinculoFora: boolean) {
    // Respeita `id_condominio: { not: n }` como o util de vínculos consulta.
    const contaFora = jest.fn(async ({ where }: any) => (vinculoFora && where.id_condominio?.not !== undefined ? 1 : 0));
    const prisma: any = {
      isConnected: true,
      apartamentos: { findUnique: jest.fn(async () => ({ id: 11, id_condominio: 1, bloco: 'A', apto: '101' })) },
      moradores: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 500, ...data })),
        count: contaFora,
      },
      users: {
        findFirst: jest.fn(async () => ({ ...vitima })),
        create: jest.fn(),
        update: jest.fn(async () => ({})),
      },
      apartamentos_Users: { findFirst: jest.fn(async () => null), create: jest.fn(async () => ({})), count: jest.fn(async () => 0) },
      sindicos_Condominios: { count: jest.fn(async () => 0) },
      funcionarios: { count: jest.fn(async () => 0) },
    };
    const mail: any = { sendWelcomeMorador: jest.fn(async () => ({})), sendWelcomeMoradorExisting: jest.fn(async () => ({})) };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const tenant: any = { assertCondominio: jest.fn(async () => undefined) };
    const superlogica: any = { enviarMorador: jest.fn(async () => undefined) };
    const svc = new MobileAuthService(prisma, { sign: jest.fn() } as any, mail, storage, {} as any, tenant, {} as any, {} as any, {} as any, superlogica);
    return { svc, prisma, mail };
  }

  const corpo = (sendCredentials: boolean) => ({
    morador: { nome: 'Outro nome', documento: CPF, email: 'atacante@x.com', data_nascimento: '01/01/1990', id_apto: 11, sendCredentials },
  });

  it.each([[true], [false]])('NÃO grava login/e-mail/senha na conta de outro condomínio (sendCredentials=%p)', async (envio) => {
    const { svc, prisma, mail } = montar(true);
    await svc.saveMorador(corpo(envio), false, sindico);
    expect(prisma.users.update).not.toHaveBeenCalled();
    expect(mail.sendWelcomeMorador).not.toHaveBeenCalled();
    // O vínculo ao apartamento continua (decisão de produto deferida na A2).
    expect(prisma.apartamentos_Users.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ id_apto: 11, id_user: 70 }),
    });
  });

  it('conta sem vínculo fora deste condomínio continua recebendo login e senha', async () => {
    const { svc, prisma } = montar(false);
    await svc.saveMorador(corpo(true), false, sindico);
    expect(prisma.users.update).toHaveBeenCalledWith({
      where: { id: 70 },
      data: expect.objectContaining({ login: 'atacante@x.com', email: 'atacante@x.com', password: expect.stringMatching(/^\$2/) }),
    });
  });
});
```

Criar `click-cond-web/apps/api/src/app/moradores/moradores-conta-existente.spec.ts`:

```ts
import { MoradoresService } from './moradores.service';

/** Mesma porta no cadastro do console: conta achada por e-mail, login+senha gravados se faltasse qualquer um. */
describe('MoradoresService.create — conta existente com vínculo em outro condomínio', () => {
  const existente = { id: 70, email: 'v@x.com', login: null, password: '$2b$10$senhaDaVitima', photo: null };

  function build(vinculoFora: boolean) {
    const contaFora = jest.fn(async ({ where }: any) => (vinculoFora && where.id_condominio?.not !== undefined ? 1 : 0));
    const prisma: any = {
      isConnected: true,
      moradores: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 300, ...data })),
        count: contaFora,
      },
      visitantes: { findFirst: jest.fn(async () => null) },
      users: {
        findFirst: jest.fn(async () => ({ ...existente })),
        create: jest.fn(),
        update: jest.fn(async () => ({})),
      },
      apartamentos: { findUnique: jest.fn(async () => null) },
      apartamentos_Users: { create: jest.fn(async () => ({})), count: jest.fn(async () => 0) },
      sindicos_Condominios: { count: jest.fn(async () => 0) },
      funcionarios: { count: jest.fn(async () => 0) },
    };
    const mail: any = { sendWelcomeMorador: jest.fn(async () => ({})), sendWelcomeMoradorExisting: jest.fn(async () => ({})) };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const svc = new MoradoresService(prisma, mail, storage, {} as any, { registrar: jest.fn(async () => ({})) } as any, { enviarMorador: jest.fn(async () => ({ enviado: false })) } as any);
    jest.spyOn(svc as any, 'carregarContextoMorador').mockResolvedValue(null);
    jest.spyOn(svc, 'findOne').mockResolvedValue({} as any);
    return { svc, prisma, mail };
  }

  const dto = { nome: 'V', email: 'v@x.com', data_nascimento: '1990-01-01', id_condominio: 1, sendCredentials: true };

  it('NÃO troca login/senha da conta que tem vínculo em outro condomínio', async () => {
    const { svc, prisma, mail } = build(true);
    await svc.create(dto as any);
    expect(prisma.users.update).not.toHaveBeenCalled();
    expect(mail.sendWelcomeMorador).not.toHaveBeenCalled();
    expect(prisma.moradores.create.mock.calls[0][0].data.id_user).toBe(70);
  });

  it('conta só deste condomínio continua recebendo login/senha', async () => {
    const { svc, prisma } = build(false);
    await svc.create(dto as any);
    expect(prisma.users.update).toHaveBeenCalledWith({
      where: { id: 70 },
      data: expect.objectContaining({ login: 'v@x.com', password: expect.stringMatching(/^\$2/) }),
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts cadastro-morador-conta-existente moradores-conta-existente`
Expected: FAIL — os casos `NÃO grava...` / `NÃO troca...`: `users.update` foi chamado (com `login`, `email`/`password`) e `sendWelcomeMorador` chamado. Os casos "continua recebendo" passam.

- [ ] **Step 3: Write minimal implementation**

(a) `click-cond-web/apps/api/src/app/auth/mobile-auth.service.ts`, `saveMorador`, ramo `if (existing)` (linhas 3774-3792). Antes:
```ts
        userId = existing.id;
        // Garante que o usuário tem login/senha para acessar o app
        const patch: any = {};
        if (!existing.login && mor.email) patch.login = mor.email;
        if (!existing.password) {
          patch.password = senhaHash;
          passwordWasSet = true;
        }
        if (!existing.email && mor.email) patch.email = mor.email;
        if (!existing.cpf && cpf) patch.cpf = cpf;
        if (!existing.phone && mor.telefone) patch.phone = mor.telefone;
        if (!existing.name && mor.nome) patch.name = mor.nome;
        // Não troca a foto de quem já tem conta em outro condomínio.
        if (photoUrl !== null && !(await usuarioTemVinculoEmOutroCondominio(this.prisma as any, existing.id, idCondominio))) {
          patch.photo = photoUrl;
          patch.profile_image = photoUrl;
        }
```
Depois:
```ts
        userId = existing.id;
        // Users é global. Conta com vínculo em OUTRO condomínio só é ligada a este apartamento:
        // login, e-mail, CPF, senha e foto dela não são gravados aqui (vinculos-usuario.util).
        // Antes, quem cadastrava achava a conta pelo CPF, gravava o PRÓPRIO e-mail como login
        // e uma senha que conhecia, e entrava como a pessoa — com os vínculos dela no outro prédio.
        const contaDeOutroCondominio = await usuarioTemVinculoEmOutroCondominio(this.prisma as any, existing.id, idCondominio);
        const patch: any = {};
        if (!contaDeOutroCondominio) {
          // Garante que o usuário tem login/senha para acessar o app
          if (!existing.login && mor.email) patch.login = mor.email;
          if (!existing.password) {
            patch.password = senhaHash;
            passwordWasSet = true;
          }
          if (!existing.email && mor.email) patch.email = mor.email;
          if (!existing.cpf && cpf) patch.cpf = cpf;
        }
        if (!existing.phone && mor.telefone) patch.phone = mor.telefone;
        if (!existing.name && mor.nome) patch.name = mor.nome;
        // Não troca a foto de quem já tem conta em outro condomínio.
        if (photoUrl !== null && !contaDeOutroCondominio) {
          patch.photo = photoUrl;
          patch.profile_image = photoUrl;
        }
```

E o e-mail de boas-vindas (linhas ~3877-3887), para não avisar um endereço que não é o da conta. Antes:
```ts
      if (mor.email && mor.sendCredentials !== false) {
        if (passwordWasSet) {
```
Depois:
```ts
      if (mor.email && mor.sendCredentials !== false && (passwordWasSet || !existing || existing.email === mor.email)) {
        if (passwordWasSet) {
```

(b) `click-cond-web/apps/api/src/app/moradores/moradores.service.ts`, `create`, ramo `if (existing)` (linhas 801-818). Antes:
```ts
      if (existing) {
        userId = existing.id;
        // Atualiza login e password caso estejam vazios para permitir acesso, e as fotos
        const userUpdates: any = {};
        if (!existing.login || !existing.password) {
          userUpdates.login = dto.email;
          userUpdates.password = senhaHash;
          passwordWasSet = true;
        }
        if (fotoPessoaUrl) {
          userUpdates.photo = fotoPessoaUrl;
          userUpdates.profile_image = fotoPessoaUrl;
        }
```
Depois:
```ts
      if (existing) {
        userId = existing.id;
        // Users é global: conta com vínculo em OUTRO condomínio só é ligada a este cadastro.
        // Login, senha e foto dela não são tocados (vinculos-usuario.util; mesma regra do sendCredentials).
        const contaDeOutroCondominio = await usuarioTemVinculoEmOutroCondominio(this.prisma as any, existing.id, dto.id_condominio);
        // Atualiza login e password caso estejam vazios para permitir acesso, e as fotos
        const userUpdates: any = {};
        if (!contaDeOutroCondominio && (!existing.login || !existing.password)) {
          userUpdates.login = dto.email;
          userUpdates.password = senhaHash;
          passwordWasSet = true;
        }
        if (fotoPessoaUrl && !contaDeOutroCondominio) {
          userUpdates.photo = fotoPessoaUrl;
          userUpdates.profile_image = fotoPessoaUrl;
        }
```

E o e-mail de boas-vindas (linha ~911). Antes:
```ts
    if (dto.sendCredentials && dto.email) {
      this.fireWelcomeEmail(dto.email, dto.nome, passwordWasSet ? senhaInicial : undefined);
    }
```
Depois:
```ts
    // Conta de outro condomínio não recebeu senha nova: não há credencial a enviar.
    if (dto.sendCredentials && dto.email && passwordWasSet) {
      this.fireWelcomeEmail(dto.email, dto.nome, senhaInicial);
    }
```

> Nota: esta última mudança também deixa de mandar o e-mail "você já tem conta" (`sendWelcomeMoradorExisting`) quando a conta existente já tinha login e senha. Se o dono quiser manter esse aviso para contas do próprio condomínio, trocar a condição por `dto.sendCredentials && dto.email && (passwordWasSet || !existing)` com `existing` içado para fora do `if (dto.email)` — o teste `NÃO troca...` continua válido nos dois casos, porque `sendWelcomeMorador` (com senha) é o que ele verifica.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts conta-existente senha-inicial moradores/ morador-menor-biometria mobile-auth.authz porteiro-conta-existente`
Expected: PASS (inclui `porteiro-conta-existente` da A2).

- [ ] **Step 5: Commit**

```bash
git -C C:/w/sec add click-cond-web/apps/api/src/app/auth/mobile-auth.service.ts click-cond-web/apps/api/src/app/moradores/moradores.service.ts click-cond-web/apps/api/src/app/auth/cadastro-morador-conta-existente.spec.ts click-cond-web/apps/api/src/app/moradores/moradores-conta-existente.spec.ts
git -C C:/w/sec commit -m "fix(security): cadastro de morador nao grava credenciais em conta com vinculo em outro condominio" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Deferred to owner

Nenhum fingerprint deste grupo ficou inteiro fora do plano. Restam pontos de borda para o dono decidir:

- `mobile-auth.saveMorador:existing-user-credential-overwrite-cross-tenant` — **o vínculo em si**: D9 impede gravar credenciais, mas o cadastro continua LIGANDO ao apartamento uma conta achada por e-mail/CPF em outro condomínio (sem aceite do dono da conta). É o mesmo ponto que a A2 deixou em "Deferred to owner"; trocar por convite muda o cadastro de quem tem unidade em dois prédios.
- `auth.selecionarCondominio:remint-skips-condominio-ativo-and-renews-expiry` — **calibração além da D6**: o token de síndico do APP (365 dias) e o ramo de síndico do `TenantAccessService.assertCondominio` também não conferem `condominio.ativo` a cada requisição, então desativar o condomínio no CRM não derruba sessões já emitidas. Conferir `ativo` por requisição custa uma consulta em toda rota; precisa de decisão de produto/desempenho (ou cache). E o re-mint de `changePassword` criado pela A8 também reinicia a validade (é o mesmo padrão, mas exige a senha atual, então foi mantido).
- `agent/descoberta/unauthenticated-reply-rewrites-device-ip` — **confirmação pelo operador**: a D7 só segue a correção automática quando nada a contradiz. Trocar a correção silenciosa por confirmação no portal (o verificador sugeriu) muda o fluxo da etapa 3 do agente e o tempo de recuperação quando o DHCP troca o IP do terminal. É decisão de produto.
