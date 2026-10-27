## A — Autenticação e tomada de conta

Todas as tarefas rodam no worktree `C:/w/sec` (branch `security-audit-2026-10-26`). Ignore a suíte que já falha antes: `apps/api/src/app/auth/meus-eventos-entrada-manual.spec.ts`.

Ordem obrigatória dentro do grupo: A2 → A3 → A4 mexem na mesma região de `mobile-auth.service.ts` (o "antes" de cada uma é o "depois" da anterior). A6 e A8 mexem em `auth.service.ts`/`auth.controller.ts`/`portaria-web/.../auth.service.ts` em métodos diferentes; A5 e A7 também mexem em `auth.service.ts` em métodos diferentes.

---

### Task A1: `/sindico/update` só re-emite token de síndico para sessão de síndico

Corrige: `mobile-auth/sindico-update-mints-sindico-token-without-role-or-mfa`

**Files:**
- Modify: `click-cond-web/apps/api/src/app/auth/mobile-auth.controller.ts:1` (import) e `:94-99` (`SindicoMobileController.updateSindico`)
- Test: `click-cond-web/apps/api/src/app/auth/sindico-update-papel.spec.ts` (novo)

**Interfaces:**
- Consumes: `papelUsuarioApp(payload): 'Sindico' | 'Morador' | 'Funcionario'` de `usuario-app.guard.ts` (já importado no controller).
- Produces: nada novo. `POST /sindico/update` passa a responder 403 para token de morador/funcionário.

- [ ] **Step 1: Write the failing test**

Criar `click-cond-web/apps/api/src/app/auth/sindico-update-papel.spec.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';
import { SindicoMobileController } from './mobile-auth.controller';
import type { JwtPayload } from './jwt-payload.interface';

/**
 * POST /sindico/update devolve um token typeAccess 'Sindico' de 365 dias. O
 * controller só olhava o id do token: quem entrava por /moradores/login ou
 * /funcionarios/login (sem o 2º fator do login de síndico) numa conta que
 * também tem perfil em Sindicos saía daqui com sessão de síndico.
 */
describe('POST /sindico/update exige sessão de síndico', () => {
  const corpo = { nome: 'Fulano', phone: '17999990000' };
  const servico = () => ({ updateSindico: jest.fn().mockResolvedValue({ token: 't', user: { id: 7 } }) });

  it.each([['Morador'], ['Funcionario']])(
    'token %s da mesma conta NÃO vira token de síndico',
    (papel) => {
      const service = servico();
      const controller = new SindicoMobileController(service as any);
      const payload: JwtPayload = { sub: 7, nome: 'Fulano', typeAccess: papel, user: { id: 7 } };

      expect(() => controller.updateSindico(payload, corpo)).toThrow(ForbiddenException);
      expect(service.updateSindico).not.toHaveBeenCalled();
    },
  );

  it('token de síndico continua atualizando o cadastro', async () => {
    const service = servico();
    const controller = new SindicoMobileController(service as any);
    const payload: JwtPayload = { sub: 7, nome: 'Fulano', typeAccess: 'Sindico', user: { id: 7 } };

    await controller.updateSindico(payload, corpo);
    expect(service.updateSindico).toHaveBeenCalledWith(7, corpo);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts sindico-update-papel`
Expected: FAIL — os dois casos `token Morador/Funcionario da mesma conta NÃO vira token de síndico` falham com "Received function did not throw"; o caso de síndico passa.

- [ ] **Step 3: Write minimal implementation**

Em `click-cond-web/apps/api/src/app/auth/mobile-auth.controller.ts`, linha 1:

Antes:
```ts
import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
```
Depois:
```ts
import { Body, Controller, ForbiddenException, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
```

No `SindicoMobileController` (linhas 94-99):

Antes:
```ts
  @Post('update')
  @HttpCode(200)
  updateSindico(@ReqUser() payload: JwtPayload, @Body() body: any) {
    const idUser = payload.user?.id ?? payload.sub;
    return this.service.updateSindico(Number(idUser), body);
  }
```
Depois:
```ts
  @Post('update')
  @HttpCode(200)
  updateSindico(@ReqUser() payload: JwtPayload, @Body() body: any) {
    // A resposta traz um token de síndico (365 dias). Sem conferir o papel de
    // quem chama, um token de morador/funcionário da mesma conta — emitido sem
    // o 2º fator do login de síndico — virava sessão de síndico só porque a
    // conta tem perfil em Sindicos.
    if (papelUsuarioApp(payload) !== 'Sindico') {
      throw new ForbiddenException('Acesso negado: atualizar o cadastro de síndico exige sessão de síndico.');
    }
    const idUser = payload.user?.id ?? payload.sub;
    return this.service.updateSindico(Number(idUser), body);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts sindico-update-papel new-password-papel`
Expected: PASS (3 testes novos + os de `new-password-papel`).

- [ ] **Step 5: Commit**

```bash
git -C C:/w/sec add click-cond-web/apps/api/src/app/auth/mobile-auth.controller.ts click-cond-web/apps/api/src/app/auth/sindico-update-papel.spec.ts
git -C C:/w/sec commit -m "fix(security): /sindico/update so re-emite token de sindico para sessao de sindico" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A2: cadastro de porteiro não adota conta com vínculo em outro condomínio nem move a equipe dela

Corrige: `mobile-auth/saveMorador-links-existing-users-enables-portaria-password-takeover` (a cadeia é quebrada em `assertLoginLivreParaPortaria` e em `sincronizarUsuarioMobile`; o vínculo silencioso do `saveMorador` em si fica em "Deferred to owner")

**Files:**
- Modify: `click-cond-web/apps/api/src/app/auth/mobile-auth.service.ts:15` (imports), `:3230` (`sincronizarUsuarioMobile`), `:3287` e `:3305` (chamadas), `:3335-3352` (`assertLoginLivreParaPortaria`)
- Test: `click-cond-web/apps/api/src/app/auth/porteiro-conta-existente.spec.ts` (novo)

**Interfaces:**
- Consumes: `idUsuarioDoToken(payload): number | null` de `./usuario-do-token.util`; `usuarioTemVinculoEmOutroCondominio` / `usuarioTemVinculoNoCondominio` de `../common/vinculos-usuario.util`.
- Produces: `private assertLoginLivreParaPortaria(login: string, idCondominio: number, idSolicitante?: number | null)` — A3 altera o corpo deste método. O arquivo de teste `porteiro-conta-existente.spec.ts` e seus helpers `prismaFalso(...)` / `servico(prisma)` são estendidos por A3.

- [ ] **Step 1: Write the failing test**

Criar `click-cond-web/apps/api/src/app/auth/porteiro-conta-existente.spec.ts`:

```ts
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { MobileAuthService } from './mobile-auth.service';
import { TenantAccessService } from './tenant-access.service';
import type { JwtPayload } from './jwt-payload.interface';

/**
 * Users é global e o login do porteiro é livre. Um síndico (inclusive de
 * signup anônimo + /condominio/register) cadastrava um porteiro com o e-mail
 * de outra pessoa, e o loginFuncionario adotava a senha do porteiro como senha
 * da conta dela. O "vínculo neste condomínio" que liberava o cadastro podia ser
 * fabricado antes pelo /moradores/insert (liga conta existente por e-mail/CPF).
 */
type Vinculo = { id_user: number; id_condominio: number };

export function prismaFalso(opts: {
  usuarioPorLogin?: Record<string, any>;
  sindicos?: Vinculo[];
  funcionarios?: Vinculo[];
  moradores?: Vinculo[];
  unidades?: Vinculo[];
  perfisSindico?: number[];
  funcionariosRows?: any[];
  portaria?: any;
}) {
  // Respeita `id_condominio: n`, `{ not: n }` e ausência de filtro, como o Prisma.
  const casa = (v: Vinculo, where: any) =>
    v.id_user === where.id_user &&
    (where.id_condominio === undefined ||
      (typeof where.id_condominio === 'object'
        ? v.id_condominio !== where.id_condominio.not
        : v.id_condominio === where.id_condominio));
  const contar = (lista: Vinculo[] = []) =>
    jest.fn(async ({ where }: any) => lista.filter((v) => casa(v, where)).length);

  return {
    isConnected: true,
    users: {
      findFirst: jest.fn(async ({ where }: any) => {
        const login = where?.login ?? where?.OR?.[0]?.login;
        return opts.usuarioPorLogin?.[login] ?? null;
      }),
      create: jest.fn(async ({ data }: any) => ({ id: 999, photo: null, ...data, funcionarios: [] })),
      update: jest.fn(async () => ({})),
    },
    sindicos: {
      count: jest.fn(async ({ where }: any) => (opts.perfisSindico ?? []).filter((id) => id === where.id_user).length),
    },
    sindicos_Condominios: {
      count: contar(opts.sindicos),
      findFirst: jest.fn(async ({ where }: any) => ((opts.sindicos ?? []).some((v) => casa(v, where)) ? { id: 1 } : null)),
    },
    funcionarios: {
      count: contar(opts.funcionarios),
      findFirst: jest.fn(async ({ where }: any) => (opts.funcionariosRows ?? []).find((f) => casa(f, where)) ?? null),
      create: jest.fn(async ({ data }: any) => ({ id: 500, ...data })),
      update: jest.fn(async () => ({})),
    },
    moradores: { count: contar(opts.moradores) },
    apartamentos_Users: {
      count: jest.fn(async ({ where }: any) =>
        (opts.unidades ?? []).filter((v) =>
          casa(v, { id_user: where.id_user, id_condominio: where.apartamento?.id_condominio }),
        ).length,
      ),
    },
    funcionarios_Portaria: {
      findUnique: jest.fn(async ({ where }: any) =>
        opts.portaria && (where.id === opts.portaria.id || where.login === opts.portaria.login) ? opts.portaria : null,
      ),
      findFirst: jest.fn(async () => opts.portaria ?? null),
      create: jest.fn(async ({ data }: any) => ({ id: 70, ...data })),
      update: jest.fn(async ({ data }: any) => ({ ...opts.portaria, ...data })),
    },
  } as any;
}

export function servico(prisma: any) {
  const jwt: any = { sign: jest.fn(() => 'token-assinado') };
  const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
  const svc = new MobileAuthService(prisma, jwt, {} as any, storage, {} as any, new TenantAccessService(prisma));
  return { svc, jwt };
}

const atacante: JwtPayload = { sub: 20, nome: 'Síndico B', typeAccess: 'Sindico' };

describe('saveFuncionario — conta existente com o mesmo e-mail', () => {
  it('NEGA porteiro com o e-mail de quem tem vínculo em outro condomínio, mesmo com vínculo fabricado aqui', async () => {
    const prisma = prismaFalso({
      usuarioPorLogin: { 'x@t': { id: 10, login: 'x@t', email: 'x@t', password: '$2b$04$hash' } },
      // X é síndico do condomínio 1; o atacante (20) é síndico do 2 e ligou X como morador do 2.
      sindicos: [{ id_user: 10, id_condominio: 1 }, { id_user: 20, id_condominio: 2 }],
      moradores: [{ id_user: 10, id_condominio: 2 }],
    });
    const { svc } = servico(prisma);

    await expect(
      svc.saveFuncionario({ id_condominio: 2, funcionario: { nome: 'P', email: 'x@t', senha: 'escolhida' } }, false, atacante),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.funcionarios_Portaria.create).not.toHaveBeenCalled();
  });

  it('PERMITE o próprio síndico (de mais de um condomínio) cadastrar o login de portaria dele', async () => {
    const prisma = prismaFalso({
      usuarioPorLogin: { 's@t': { id: 20, login: 's@t', email: 's@t', password: '$2b$04$hash' } },
      sindicos: [{ id_user: 20, id_condominio: 2 }, { id_user: 20, id_condominio: 3 }],
    });
    const { svc } = servico(prisma);

    await svc.saveFuncionario({ id_condominio: 2, funcionario: { nome: 'Eu', email: 's@t', senha: 'x' } }, false, atacante);
    expect(prisma.funcionarios_Portaria.create).toHaveBeenCalled();
  });

  it('sincronização não move para este condomínio o vínculo de equipe que a pessoa tem em outro', async () => {
    const prisma = prismaFalso({
      usuarioPorLogin: { 'p@t': { id: 30, login: 'p@t', email: 'p@t', password: '$2b$04$hash' } },
      sindicos: [{ id_user: 20, id_condominio: 2 }],
      funcionariosRows: [{ id: 77, id_user: 30, id_condominio: 1 }],
      portaria: { id: 50, login: 'p@t', email: 'p@t', password: '$2b$04$hash', nome: 'P', telefone: null, turno: null, id_condominio: 2 },
    });
    const { svc } = servico(prisma);

    await svc.saveFuncionario({ id_condominio: 2, funcionario: { id: 50, nome: 'Novo Nome' } }, true, atacante);

    expect(prisma.funcionarios.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 77 } }));
    expect(prisma.funcionarios.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ id_user: 30, id_condominio: 2 }),
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts porteiro-conta-existente`
Expected: FAIL — `NEGA porteiro com o e-mail de quem tem vínculo em outro condomínio...` (promise resolveu; `funcionarios_Portaria.create` foi chamado) e `sincronização não move...` (`funcionarios.update` chamado com `where: { id: 77 }`). O caso `PERMITE o próprio síndico...` passa.

- [ ] **Step 3: Write minimal implementation**

Em `click-cond-web/apps/api/src/app/auth/mobile-auth.service.ts`:

(a) Import, logo após a linha 15 (`import { usuarioTemVinculoEmOutroCondominio, ... } from '../common/vinculos-usuario.util';`), acrescentar:
```ts
import { idUsuarioDoToken } from './usuario-do-token.util';
```

(b) Dentro de `sincronizarUsuarioMobile` (linha 3230):

Antes:
```ts
        const f = await this.prisma.funcionarios.findFirst({ where: { id_user: user.id } });
```
Depois:
```ts
        // Por condomínio: sem o recorte, o vínculo de equipe que a pessoa tem em
        // OUTRO prédio era achado aqui e "movido" para este pelo update abaixo.
        const f = await this.prisma.funcionarios.findFirst({
          where: { id_user: user.id, id_condominio: fp.id_condominio },
        });
```

(c) Edição (linha 3287):

Antes:
```ts
        await this.assertLoginLivreParaPortaria(func.email, atual.id_condominio);
```
Depois:
```ts
        await this.assertLoginLivreParaPortaria(func.email, atual.id_condominio, idUsuarioDoToken(user));
```

(d) Criação (linha 3305):

Antes:
```ts
    await this.assertLoginLivreParaPortaria(loginFinal, idCondominio);
```
Depois:
```ts
    await this.assertLoginLivreParaPortaria(loginFinal, idCondominio, idUsuarioDoToken(user));
```

(e) O método (linhas 3335-3352):

Antes:
```ts
  /**
   * O login do porteiro (Funcionarios_Portaria) é único só na própria tabela. Sem esta checagem,
   * um síndico (inclusive de signup anônimo) cadastrava um porteiro com o e-mail de OUTRA pessoa
   * (síndico/morador de outro condomínio) e, pelo loginFuncionario/selecionarCondominio, herdava a conta dela.
   * Permitido: e-mail sem conta, ou conta que já tem vínculo com ESTE condomínio (ex.: síndico que também é porteiro).
   */
  private async assertLoginLivreParaPortaria(login: string, idCondominio: number) {
    const u = await this.prisma.users.findFirst({
      where: { OR: [{ login }, { email: login }] },
      select: { id: true },
    });
    if (!u) return;
    const aqui = await usuarioTemVinculoNoCondominio(this.prisma as any, u.id, idCondominio);
    if (aqui) return;
    if (await usuarioTemVinculoEmOutroCondominio(this.prisma as any, u.id, idCondominio)) {
      throw new BadRequestException('Já existe uma conta com este e-mail. Use outro e-mail para o porteiro.');
    }
  }
```
Depois:
```ts
  /**
   * O login do porteiro (Funcionarios_Portaria) é único só na própria tabela. Sem esta checagem,
   * um síndico (inclusive de signup anônimo) cadastrava um porteiro com o e-mail de OUTRA pessoa
   * (síndico/morador de outro condomínio) e, pelo loginFuncionario/selecionarCondominio, herdava a conta dela.
   *
   * Vínculo em outro condomínio barra SEMPRE, mesmo havendo vínculo aqui: o vínculo daqui pode ter sido
   * fabricado por este mesmo síndico (o cadastro de morador liga uma conta existente pelo e-mail/CPF).
   * Exceção: a conta é a do próprio solicitante (síndico cadastrando o login de portaria dele) — a sessão
   * prova a posse.
   */
  private async assertLoginLivreParaPortaria(login: string, idCondominio: number, idSolicitante?: number | null) {
    const u = await this.prisma.users.findFirst({
      where: { OR: [{ login }, { email: login }] },
      select: { id: true },
    });
    if (!u) return;
    if (idSolicitante && u.id === idSolicitante) return;
    if (await usuarioTemVinculoEmOutroCondominio(this.prisma as any, u.id, idCondominio)) {
      throw new BadRequestException('Já existe uma conta com este e-mail. Use outro e-mail para o porteiro.');
    }
  }
```

(`usuarioTemVinculoNoCondominio` continua importado: A3 volta a usá-lo aqui e ele já é usado em `loginFuncionario`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts porteiro-conta-existente mobile-auth.authz`
Expected: PASS (3 testes novos + `mobile-auth.authz.spec.ts` inteiro).

- [ ] **Step 5: Commit**

```bash
git -C C:/w/sec add click-cond-web/apps/api/src/app/auth/mobile-auth.service.ts click-cond-web/apps/api/src/app/auth/porteiro-conta-existente.spec.ts
git -C C:/w/sec commit -m "fix(security): porteiro nao adota conta com vinculo em outro condominio nem move a equipe dela" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A3: senha do porteiro nunca vira credencial de uma conta que tem senha própria

Corrige: `mobile-auth.service:loginFuncionario:portaria-password-overwrites-unlinked-user` (os dois ramos: o fallback que grava `Users.password` e o primeiro ramo que emite token para o `Users.id` existente só pela senha da portaria)

**Files:**
- Modify: `click-cond-web/apps/api/src/app/auth/mobile-auth.service.ts:712-715` (1º ramo), `:811-815` (fallback), novo helper logo após `assertLoginLivreParaPortaria`, e o corpo de `assertLoginLivreParaPortaria` (resultado da A2)
- Test: `click-cond-web/apps/api/src/app/auth/porteiro-conta-existente.spec.ts` (acrescentar ao arquivo da A2)

**Interfaces:**
- Consumes: `prismaFalso(...)`, `servico(prisma)`, `atacante` do spec da A2; `assertLoginLivreParaPortaria(login, idCondominio, idSolicitante?)` da A2.
- Produces: `private async contaSoDaEquipeDoCondominio(idUser: number, idCondominio: number): Promise<boolean>`. As duas chamadas `this.verifyPassword(senhaRaw, portaria.password, portaria.id)` continuam com esse texto exato (A4 as altera).

- [ ] **Step 1: Write the failing test**

Acrescentar ao final de `click-cond-web/apps/api/src/app/auth/porteiro-conta-existente.spec.ts`:

```ts
describe('loginFuncionario — senha da portaria x conta existente', () => {
  let hV: string;
  let hA: string;
  beforeAll(async () => {
    hV = await bcrypt.hash('v', 4); // senha do dono da conta
    hA = await bcrypt.hash('a', 4); // senha escolhida por quem cadastrou o porteiro
  });
  const portaria = () => ({ id: 7, login: 'v@t', email: 'v@t', password: hA, id_condominio: 2, nome: 'P', telefone: null, turno: null });

  it('fallback: conta com perfil de síndico NÃO entra com a senha do porteiro e a senha dela não é trocada', async () => {
    const prisma = prismaFalso({
      usuarioPorLogin: { 'v@t': { id: 50, login: 'v@t', email: 'v@t', password: hV, photo: null, funcionarios: [{ id_condominio: 2, nome: 'P' }] } },
      perfisSindico: [50],
      funcionarios: [{ id_user: 50, id_condominio: 2 }],
      portaria: portaria(),
    });
    const { svc, jwt } = servico(prisma);

    await expect(svc.loginFuncionario('v@t', 'a')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.users.update).not.toHaveBeenCalled();
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('1º ramo: conta existente com senha própria e sem vínculo NÃO entra com a senha do porteiro', async () => {
    const prisma = prismaFalso({
      usuarioPorLogin: { 'v@t': { id: 50, login: 'v@t', email: 'v@t', password: hV, photo: null, funcionarios: [] } },
      portaria: portaria(),
    });
    const { svc, jwt } = servico(prisma);

    await expect(svc.loginFuncionario('v@t', 'a')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('1º ramo: o dono da conta entra com a PRÓPRIA senha', async () => {
    const prisma = prismaFalso({
      usuarioPorLogin: { 'v@t': { id: 50, login: 'v@t', email: 'v@t', password: hV, photo: null, funcionarios: [] } },
      portaria: portaria(),
    });
    const { svc } = servico(prisma);

    await expect(svc.loginFuncionario('v@t', 'v')).resolves.toMatchObject({ token: 'token-assinado' });
  });

  it('conta que é só da equipe deste condomínio: a senha redefinida no cadastro do porteiro continua valendo', async () => {
    const hNova = await bcrypt.hash('nova', 4);
    const prisma = prismaFalso({
      usuarioPorLogin: { 'p@t': { id: 60, login: 'p@t', email: 'p@t', password: hV, photo: null, funcionarios: [{ id_condominio: 2, nome: 'P' }] } },
      funcionarios: [{ id_user: 60, id_condominio: 2 }],
      portaria: { id: 8, login: 'p@t', email: 'p@t', password: hNova, id_condominio: 2, nome: 'P', telefone: null, turno: null },
    });
    const { svc } = servico(prisma);

    await expect(svc.loginFuncionario('p@t', 'nova')).resolves.toMatchObject({ token: 'token-assinado' });
    expect(prisma.users.update).toHaveBeenCalledWith({ where: { id: 60 }, data: { password: hNova } });
  });
});

describe('saveFuncionario — conta existente sem vínculo nenhum', () => {
  it('NEGA porteiro com o e-mail de uma conta que não tem vínculo com condomínio algum', async () => {
    const prisma = prismaFalso({
      usuarioPorLogin: { 'v@t': { id: 50, login: 'v@t', email: 'v@t', password: '$2b$04$hash' } },
      perfisSindico: [50],
      sindicos: [{ id_user: 20, id_condominio: 2 }],
    });
    const { svc } = servico(prisma);

    await expect(
      svc.saveFuncionario({ id_condominio: 2, funcionario: { nome: 'P', email: 'v@t', senha: 'a' } }, false, atacante),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.funcionarios_Portaria.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts porteiro-conta-existente`
Expected: FAIL — `fallback: conta com perfil de síndico...` (`users.update` chamado com a senha do porteiro), `1º ramo: conta existente com senha própria...` (promise resolveu com token), `1º ramo: o dono da conta entra com a PRÓPRIA senha` (Unauthorized: hoje só a senha da portaria é aceita) e `NEGA porteiro com o e-mail de uma conta que não tem vínculo...` (resolveu). Passam: os 3 testes da A2 e `conta que é só da equipe...`.

- [ ] **Step 3: Write minimal implementation**

Em `click-cond-web/apps/api/src/app/auth/mobile-auth.service.ts`:

(a) 1º ramo de `loginFuncionario` (linhas 712-715):

Antes:
```ts
      const isMatch = await this.verifyPassword(senhaRaw, portaria.password, portaria.id);
      if (!isMatch) {
        throw new UnauthorizedException('Login ou Senha incorretos');
      }
```
Depois:
```ts
      // Conta Users que já tem senha própria só entra com ELA. A senha do porteiro é escolhida por quem
      // o cadastrou: aceitá-la aqui entregava a conta de outra pessoa (mesmo e-mail) a quem a cadastrou.
      const isMatch = user?.password
        ? await this.verifyPassword(senhaRaw, user.password, user.id)
        : await this.verifyPassword(senhaRaw, portaria.password, portaria.id);
      if (!isMatch) {
        throw new UnauthorizedException('Login ou Senha incorretos');
      }
```

(b) Fallback do 2º ramo (linhas 811-815):

Antes:
```ts
      if (portaria) {
        const isPortariaMatch = await this.verifyPassword(senhaRaw, portaria.password, portaria.id);
        // Só aceita se a portaria é do mesmo condomínio em que esta conta é funcionária.
        const mesmoCondominio = user.funcionarios.some((f) => f.id_condominio === portaria.id_condominio);
        if (isPortariaMatch && mesmoCondominio) {
```
Depois:
```ts
      if (portaria) {
        const isPortariaMatch = await this.verifyPassword(senhaRaw, portaria.password, portaria.id);
        // Só aceita se a portaria é do mesmo condomínio em que esta conta é funcionária E a conta é só da
        // equipe desse condomínio: aí quem cadastrou o porteiro administra TODOS os vínculos dela
        // (vinculos-usuario.util.ts) e pode definir a senha. Conta de síndico/morador, ou com vínculo em
        // outro prédio, entra só com a própria senha — senão o cadastro de porteiro trocava a senha dela.
        const mesmoCondominio = user.funcionarios.some((f) => f.id_condominio === portaria.id_condominio);
        if (
          isPortariaMatch &&
          mesmoCondominio &&
          (await this.contaSoDaEquipeDoCondominio(user.id, portaria.id_condominio))
        ) {
```

(c) `assertLoginLivreParaPortaria` (estado deixado pela A2) — substituir o método inteiro e acrescentar o helper logo depois dele:

Antes:
```ts
  private async assertLoginLivreParaPortaria(login: string, idCondominio: number, idSolicitante?: number | null) {
    const u = await this.prisma.users.findFirst({
      where: { OR: [{ login }, { email: login }] },
      select: { id: true },
    });
    if (!u) return;
    if (idSolicitante && u.id === idSolicitante) return;
    if (await usuarioTemVinculoEmOutroCondominio(this.prisma as any, u.id, idCondominio)) {
      throw new BadRequestException('Já existe uma conta com este e-mail. Use outro e-mail para o porteiro.');
    }
  }
```
Depois:
```ts
  private async assertLoginLivreParaPortaria(login: string, idCondominio: number, idSolicitante?: number | null) {
    const u = await this.prisma.users.findFirst({
      where: { OR: [{ login }, { email: login }] },
      select: { id: true },
    });
    if (!u) return;
    if (idSolicitante && u.id === idSolicitante) return;
    if (await usuarioTemVinculoEmOutroCondominio(this.prisma as any, u.id, idCondominio)) {
      throw new BadRequestException('Já existe uma conta com este e-mail. Use outro e-mail para o porteiro.');
    }
    // Conta existente sem vínculo nenhum (síndico que se cadastrou e ainda não registrou prédio, morador
    // que saiu de todas as unidades): nada prova que quem cadastra o porteiro é o dono dela.
    if (!(await usuarioTemVinculoNoCondominio(this.prisma as any, u.id, idCondominio))) {
      throw new BadRequestException('Já existe uma conta com este e-mail. Use outro e-mail para o porteiro.');
    }
  }

  /**
   * A conta existe só como equipe deste condomínio: nenhum perfil de síndico, nenhum vínculo de
   * síndico/morador/unidade e nenhum vínculo de equipe em outro prédio. Só então o síndico deste
   * condomínio administra todos os vínculos dela e pode definir a senha pelo cadastro do porteiro.
   */
  private async contaSoDaEquipeDoCondominio(idUser: number, idCondominio: number): Promise<boolean> {
    const [perfisSindico, sindicoEm, moradorEm, unidades, equipeFora] = await Promise.all([
      this.prisma.sindicos.count({ where: { id_user: idUser } }),
      this.prisma.sindicos_Condominios.count({ where: { id_user: idUser } }),
      this.prisma.moradores.count({ where: { id_user: idUser } }),
      this.prisma.apartamentos_Users.count({ where: { id_user: idUser } }),
      this.prisma.funcionarios.count({ where: { id_user: idUser, id_condominio: { not: Number(idCondominio) } } }),
    ]);
    return perfisSindico + sindicoEm + moradorEm + unidades + equipeFora === 0;
  }
```

Efeito para usuários legítimos: o porteiro que também é morador/síndico passa a entrar no app com a senha da própria conta (não com a do cadastro de porteiro); porteiro "puro" continua recebendo a senha redefinida pelo síndico.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts porteiro-conta-existente mobile-auth.authz redefinir-senha`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C C:/w/sec add click-cond-web/apps/api/src/app/auth/mobile-auth.service.ts click-cond-web/apps/api/src/app/auth/porteiro-conta-existente.spec.ts
git -C C:/w/sec commit -m "fix(security): senha do porteiro nao vira credencial de conta com senha propria" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A4: migração MD5→bcrypt da portaria grava na própria Funcionarios_Portaria

Corrige: `mobile-auth.service:verifyPassword:portaria-id-migrates-users-row`

**Files:**
- Modify: `click-cond-web/apps/api/src/app/auth/mobile-auth.service.ts:83-106` (`verifyPassword`) e as duas chamadas com `portaria.id` em `loginFuncionario` (estado deixado pela A3)
- Test: `click-cond-web/apps/api/src/app/auth/login-funcionario-md5-portaria.spec.ts` (novo)

**Interfaces:**
- Consumes: código de `loginFuncionario` como a A3 deixou.
- Produces: `private verifyPassword(senhaRaw: string, stored: string | null | undefined, idRegistro: number, tabela: 'users' | 'funcionarios_Portaria' = 'users'): Promise<boolean>` — chamadas existentes com 3 argumentos seguem migrando em Users.

- [ ] **Step 1: Write the failing test**

Criar `click-cond-web/apps/api/src/app/auth/login-funcionario-md5-portaria.spec.ts`:

```ts
import { createHash } from 'crypto';
import { MobileAuthService } from './mobile-auth.service';

/**
 * verifyPassword migrava hash MD5 para bcrypt sempre em Users, com o id que
 * recebia. O loginFuncionario passava Funcionarios_Portaria.id — outra tabela,
 * outra numeração: o login do porteiro trocava a senha do Users de mesmo
 * número (outra pessoa), e a linha da portaria ficava em MD5 para sempre.
 */
describe('loginFuncionario — senha MD5 legada da portaria', () => {
  const md5 = (s: string) => createHash('md5').update(s).digest('hex');
  const portaria = { id: 5, login: 'p', email: null, telefone: null, turno: null, password: md5('x'), id_condominio: 1, nome: 'P' };

  function build(usuarioExistente: any) {
    const prisma: any = {
      isConnected: true,
      users: {
        findFirst: jest.fn(async () => usuarioExistente),
        create: jest.fn(async () => ({ id: 40, photo: null, password: 'h', funcionarios: [] })),
        update: jest.fn(async () => ({})),
      },
      funcionarios_Portaria: {
        findFirst: jest.fn(async () => ({ ...portaria })),
        update: jest.fn(async () => ({})),
      },
      funcionarios: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
        count: jest.fn(async () => 0),
      },
      sindicos: { count: jest.fn(async () => 0) },
      sindicos_Condominios: { count: jest.fn(async () => 0) },
      moradores: { count: jest.fn(async () => 0) },
      apartamentos_Users: { count: jest.fn(async () => 0) },
    };
    const svc = new MobileAuthService(prisma, { sign: jest.fn(() => 't') } as any, {} as any, {} as any, {} as any, {} as any);
    return { svc, prisma };
  }

  it('sem conta Users: migra a linha da portaria (id 5), não o Users id 5', async () => {
    const { svc, prisma } = build(null);
    await svc.loginFuncionario('p', 'x');

    expect(prisma.users.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 5 } }));
    expect(prisma.funcionarios_Portaria.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { password: expect.stringMatching(/^\$2/) },
    });
  });

  it('fallback da conta de equipe: migra a portaria e só grava no Users da própria conta (id 60)', async () => {
    const { svc, prisma } = build({
      id: 60, login: 'p', email: 'p', password: md5('outra'), photo: null,
      funcionarios: [{ id_condominio: 1, nome: 'P' }],
    });
    await svc.loginFuncionario('p', 'x');

    expect(prisma.users.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 5 } }));
    expect(prisma.funcionarios_Portaria.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { password: expect.stringMatching(/^\$2/) },
    });
    expect(prisma.users.update).toHaveBeenCalledWith({ where: { id: 60 }, data: { password: expect.stringMatching(/^\$2/) } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts login-funcionario-md5-portaria`
Expected: FAIL nos dois casos — `users.update` foi chamado com `{ where: { id: 5 }, ... }` e `funcionarios_Portaria.update` não foi chamado.

- [ ] **Step 3: Write minimal implementation**

Em `click-cond-web/apps/api/src/app/auth/mobile-auth.service.ts`, `verifyPassword` (linhas 83-106):

Antes:
```ts
  private async verifyPassword(senhaRaw: string, stored: string | null | undefined, userId: number): Promise<boolean> {
    if (!stored) return false;

    if (stored.startsWith('$2')) {
      return bcrypt.compare(senhaRaw, stored);
    }

    const md5Password = createHash('md5').update(senhaRaw).digest('hex');
    const isMatch = stored === md5Password;

    if (isMatch) {
      try {
        const newHash = await bcrypt.hash(senhaRaw, 10);
        await this.prisma.users.update({
          where: { id: userId },
          data: { password: newHash },
        });
      } catch (e) {
        // Falha na migração não deve bloquear o login
      }
    }

    return isMatch;
  }
```
Depois:
```ts
  /**
   * @param idRegistro id da linha dona do hash: Users.id, ou Funcionarios_Portaria.id quando `tabela`
   *   é 'funcionarios_Portaria'. A migração MD5→bcrypt grava NA tabela de onde o hash veio — gravar em
   *   Users com o id de um porteiro trocava a senha de outra pessoa (outra numeração).
   */
  private async verifyPassword(
    senhaRaw: string,
    stored: string | null | undefined,
    idRegistro: number,
    tabela: 'users' | 'funcionarios_Portaria' = 'users',
  ): Promise<boolean> {
    if (!stored) return false;

    if (stored.startsWith('$2')) {
      return bcrypt.compare(senhaRaw, stored);
    }

    const md5Password = createHash('md5').update(senhaRaw).digest('hex');
    const isMatch = stored === md5Password;

    if (isMatch) {
      try {
        const newHash = await bcrypt.hash(senhaRaw, 10);
        if (tabela === 'funcionarios_Portaria') {
          await this.prisma.funcionarios_Portaria.update({
            where: { id: idRegistro },
            data: { password: newHash },
          });
        } else {
          await this.prisma.users.update({
            where: { id: idRegistro },
            data: { password: newHash },
          });
        }
      } catch (e) {
        // Falha na migração não deve bloquear o login
      }
    }

    return isMatch;
  }
```

Em `loginFuncionario`, 1º ramo (texto deixado pela A3):

Antes:
```ts
        : await this.verifyPassword(senhaRaw, portaria.password, portaria.id);
```
Depois:
```ts
        : await this.verifyPassword(senhaRaw, portaria.password, portaria.id, 'funcionarios_Portaria');
```

No fallback do 2º ramo:

Antes:
```ts
        const isPortariaMatch = await this.verifyPassword(senhaRaw, portaria.password, portaria.id);
```
Depois:
```ts
        const isPortariaMatch = await this.verifyPassword(senhaRaw, portaria.password, portaria.id, 'funcionarios_Portaria');
```

Conferir que não sobrou chamada com `portaria.id` sem o 4º argumento:
Run: `cd C:/w/sec/click-cond-web && grep -n "verifyPassword(senhaRaw, portaria" apps/api/src/app/auth/mobile-auth.service.ts`
Expected: 2 linhas, ambas terminando em `'funcionarios_Portaria');`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts login-funcionario-md5-portaria porteiro-conta-existente sindico-login-mfa senha-bcrypt`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C C:/w/sec add click-cond-web/apps/api/src/app/auth/mobile-auth.service.ts click-cond-web/apps/api/src/app/auth/login-funcionario-md5-portaria.spec.ts
git -C C:/w/sec commit -m "fix(security): migracao MD5 da portaria grava em Funcionarios_Portaria, nao no Users de mesmo id" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A5: QR authorize não compara Users.id com Funcionarios_Portaria.id

Corrige: `auth.service:assertVinculoCondominio:funcionarios-portaria-id-vs-users-id`

**Files:**
- Modify: `click-cond-web/apps/api/src/app/auth/auth.service.ts:449-497` (`assertVinculoCondominio` e seu comentário)
- Test: `click-cond-web/apps/api/src/app/auth/qr-session-typeaccess.spec.ts:59-66` (o caso "porteiro do console" documentava o comportamento vulnerável e é substituído)

**Interfaces:**
- Consumes: nada novo.
- Produces: `assertVinculoCondominio(userId, typeAccess, idCondominio): Promise<'Sindico' | 'Funcionario' | null>` — `null` agora só sai quando o banco está desconectado.

- [ ] **Step 1: Write the failing test**

Em `click-cond-web/apps/api/src/app/auth/qr-session-typeaccess.spec.ts`, linha 1, acrescentar o import:
```ts
import { UnauthorizedException } from '@nestjs/common';
```

Substituir o caso das linhas 59-66:

Antes:
```ts
  it('porteiro do console continua SEM typeAccess — sem alçada no financeiro', async () => {
    const { svc, tokenAssinado } = build({ portaria: true });
    await svc.authorizeQrSession({ sub: 7, nome: 'Carlos', typeAccess: 'Funcionario' }, 'qr', 1);

    const token = tokenAssinado();
    expect(token.typeAccess).toBeUndefined();
    expect(() => assertStaff(token, 'lançar movimento')).toThrow();
  });
```
Depois:
```ts
  /**
   * O sub de token de app é Users.id; Funcionarios_Portaria.id é outra
   * numeração. Comparar os dois deixava um morador cujo Users.id coincidia com
   * o id de um porteiro de OUTRO condomínio mintar token de console lá.
   */
  it.each([['Morador'], ['Funcionario']])(
    'token %s cujo Users.id coincide com um Funcionarios_Portaria.id de outro condomínio NÃO autoriza',
    async (papel) => {
      const { svc, tokenAssinado } = build({ portaria: true });
      await expect(
        svc.authorizeQrSession({ sub: 7, nome: 'Carlos', typeAccess: papel }, 'qr', 99),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(tokenAssinado()).toBeNull();
    },
  );
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts qr-session-typeaccess`
Expected: FAIL — os dois casos novos: "Received promise resolved instead of rejected".

- [ ] **Step 3: Write minimal implementation**

Em `click-cond-web/apps/api/src/app/auth/auth.service.ts` (linhas 449-497):

Antes:
```ts
  /**
   * Garante que o usuário autenticado tem vínculo com o condomínio antes de
   * emitir um token de portaria via QR. Síndico: precisa estar em
   * Sindicos_Condominios. Demais (porteiro/app): via Funcionarios ou
   * Funcionarios_Portaria do condomínio.
   */
  /**
   * Confirma o vínculo com o condomínio e devolve o papel REAL, resolvido no
   * banco (não o que veio no token). Quem chama usa isso para carimbar o
   * typeAccess do token de portaria — daí a diferença entre 'Funcionario'
   * (equipe do condomínio, tem alçada administrativa) e o porteiro do console,
   * que continua sem typeAccess e portanto sem alçada no financeiro.
   */
```
Depois:
```ts
  /**
   * Garante que o usuário autenticado tem vínculo com o condomínio antes de
   * emitir um token de portaria via QR. Síndico: precisa estar em
   * Sindicos_Condominios. Funcionário/morador do app: via Funcionarios.
   *
   * Confirma o vínculo e devolve o papel REAL, resolvido no banco (não o que
   * veio no token). Quem chama usa isso para carimbar o typeAccess do token de
   * portaria.
   *
   * Não há fallback por Funcionarios_Portaria: `userId` é sempre Users.id
   * (idUsuarioDoToken recusa o token do console), e Funcionarios_Portaria.id é
   * outra numeração — a comparação só casava por coincidência, com o porteiro
   * de outra pessoa.
   */
```

E no corpo (linhas 482-496):

Antes:
```ts
    // Funcionário/porteiro: vínculo via Funcionarios (id_user) ou, para o
    // porteiro-web, via Funcionarios_Portaria.
    const func = await this.prisma.funcionarios.findFirst({
      where: { id_user: userId, id_condominio: idCondominio },
      select: { id: true },
    });
    if (func) return 'Funcionario';

    const funcPortaria = await this.prisma.funcionarios_Portaria.findFirst({
      where: { id: userId, id_condominio: idCondominio },
      select: { id: true },
    });
    if (funcPortaria) return null;

    throw new UnauthorizedException('Você não tem vínculo com este condomínio.');
```
Depois:
```ts
    // Funcionário: vínculo via Funcionarios (id_user).
    const func = await this.prisma.funcionarios.findFirst({
      where: { id_user: userId, id_condominio: idCondominio },
      select: { id: true },
    });
    if (func) return 'Funcionario';

    throw new UnauthorizedException('Você não tem vínculo com este condomínio.');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts qr-session-typeaccess login-portaria-typeaccess`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C C:/w/sec add click-cond-web/apps/api/src/app/auth/auth.service.ts click-cond-web/apps/api/src/app/auth/qr-session-typeaccess.spec.ts
git -C C:/w/sec commit -m "fix(security): QR authorize nao compara Users.id com Funcionarios_Portaria.id" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A6: síndico na portaria-web passa pelo mesmo 2º fator do login do app

Corrige: `auth.service:loginPortaria:sindico-session-without-mfa`

**Files:**
- Modify: `click-cond-web/apps/api/src/app/auth/auth.service.ts:1-35` (imports, campo, construtor), `:134-171` (`montarSessaoPortaria`), `:173-300` (`loginPortaria`), novos métodos `exigirMfaSindico` / `verificarMfaPortaria`
- Modify: `click-cond-web/apps/api/src/app/auth/auth.controller.ts:1` (import) e `:45-53` (login) + rota nova `login-portaria/mfa`
- Modify: `click-cond-web/apps/portaria-web/src/app/auth/auth.service.ts:6-20`, `:74-78` (login), novos `verificarMfa`/`reenviarMfa`/`ehDesafioMfa`
- Modify: `click-cond-web/apps/portaria-web/src/app/auth/login-page.component.ts:1-6` (import), `:193` (condição), antes de `<!-- MODO QR CODE DE LOGIN -->` (bloco novo), `:458-500` (estado e handlers)
- Test: `click-cond-web/apps/api/src/app/auth/login-portaria-mfa.spec.ts` (novo), `click-cond-web/apps/portaria-web/src/app/auth/login-mfa.spec.ts` (novo)

**Interfaces:**
- Consumes: `MfaService.isDeviceTrusted(userId, deviceToken?)`, `createChallenge({ id, email, name }): CreateChallengeResult`, `verifyChallenge(mfaToken, code, rememberDevice, meta?): VerifyMfaResult` (`mfa/mfa.service.ts`); `POST /auth/mfa/resend` existente (reenvio, mesmo `mfa_token`).
- Produces:
  - `AuthService` construtor: `(prisma, jwt, qrStore, tenant?, @Optional() mfa?: MfaService)` — specs que passam 3 ou 4 argumentos seguem sem MFA.
  - `AuthService.loginPortaria(login: string, senha: string, deviceToken?: string)` → sessão `{ access_token, id, nome, turno, id_condominio, condominio_nome, condominios }` **ou** `CreateChallengeResult` (`{ mfa_required: true, mfa_token, email_masked, expires_in_seconds }`).
  - `AuthService.verificarMfaPortaria(mfaToken: string, code: string, rememberDevice: boolean, meta?: { userAgent?: string; ip?: string })` → sessão + `device_token?`.
  - `POST /auth/login-portaria` aceita `device_token` no corpo ou header `x-device-token`; `POST /auth/login-portaria/mfa` `{ mfa_token, code, remember_device? }` (público, 10/min).
  - portaria-web: `export interface DesafioMfa`, `export function ehDesafioMfa(res)`, `AuthService.verificarMfa(mfaToken, code, lembrar)`, `AuthService.reenviarMfa(mfaToken)`, chave `localStorage` `portaria_device_token`. `LoginPageComponent`: `mfaToken`, `mfaEmail` (signals), `codigoMfa`, `lembrarDispositivo`, `onSubmitMfa()`, `reenviarCodigo()`, `cancelarMfa()`.

Deploy: API e portaria-web vão juntos — a portaria-web antiga gravaria `access_token` indefinido ao receber o desafio.

- [ ] **Step 1: Write the failing tests**

Criar `click-cond-web/apps/api/src/app/auth/login-portaria-mfa.spec.ts`:

```ts
import * as bcrypt from 'bcrypt';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { JwtPayload } from './jwt-payload.interface';

/**
 * /sindico/login (app) exige aparelho confiável ou código por e-mail. O
 * /auth/login-portaria emitia o mesmo typeAccess 'Sindico' — aceito também
 * nas rotas do app — só com a senha: uma senha vazada pulava o 2º fator.
 */
describe('AuthService.loginPortaria — síndico passa pelo 2º fator', () => {
  const SENHA = 'senha-certa';
  let hash: string;
  beforeAll(async () => {
    hash = await bcrypt.hash(SENHA, 4);
  });

  const desafio = { mfa_required: true as const, mfa_token: 'mfa-1', email_masked: 'si****@demo.com', expires_in_seconds: 600 };

  function build(opts: { comRegistroPortaria: boolean; confiavel?: boolean; semSindico?: boolean }) {
    const assinados: JwtPayload[] = [];
    const usuario = {
      id: 42,
      login: 'sindico@demo.com',
      email: 'sindico@demo.com',
      password: hash,
      sindicos: [{ name: 'Sindica', email: 'sindico@demo.com' }],
      sindicosCondominios: [{ id: 1, id_condominio: 7, condominio: { nome: 'Edifício Demo' } }],
    };
    const prisma: any = {
      isConnected: true,
      funcionarios_Portaria: {
        findFirst: jest.fn(async () =>
          opts.comRegistroPortaria
            ? { id: 3, nome: 'Registro', login: 'sindico@demo.com', password: hash, turno: 'Síndico', id_condominio: 7, ativo: 1 }
            : null,
        ),
        update: jest.fn(),
      },
      condominios: { findUnique: jest.fn(async () => ({ nome: 'Edifício Demo' })) },
      users: {
        findFirst: jest.fn(async () => (opts.semSindico ? null : usuario)),
        findUnique: jest.fn(async () => usuario),
        update: jest.fn(),
      },
    };
    const jwt: any = {
      sign: jest.fn((p: JwtPayload) => {
        assinados.push(p);
        return 'token-portaria';
      }),
    };
    const mfa: any = {
      isDeviceTrusted: jest.fn(async () => !!opts.confiavel),
      createChallenge: jest.fn(async () => desafio),
      verifyChallenge: jest.fn(async () => ({ token: 'token-app-descartado', user: { id: 42 }, device_token: 'dev-1' })),
    };
    const svc = new AuthService(prisma, jwt, { get: jest.fn(), confirm: jest.fn() } as any, undefined, mfa);
    return { svc, jwt, mfa, assinados };
  }

  it.each([[true], [false]])(
    'sem aparelho confiável devolve o desafio e nenhum token (registro de portaria: %s)',
    async (comRegistroPortaria) => {
      const { svc, jwt, mfa } = build({ comRegistroPortaria });
      const res: any = await svc.loginPortaria('sindico@demo.com', SENHA);

      expect(res).toEqual(desafio);
      expect(jwt.sign).not.toHaveBeenCalled();
      expect(mfa.createChallenge).toHaveBeenCalledWith({ id: 42, email: 'sindico@demo.com', name: 'Sindica' });
    },
  );

  it('código certo entrega o token de console do síndico e o token do dispositivo', async () => {
    const { svc, mfa, assinados } = build({ comRegistroPortaria: false });
    await svc.loginPortaria('sindico@demo.com', SENHA);
    const res: any = await svc.verificarMfaPortaria('mfa-1', '123456', true, { ip: '1.2.3.4' });

    expect(mfa.verifyChallenge).toHaveBeenCalledWith('mfa-1', '123456', true, { ip: '1.2.3.4' });
    expect(assinados).toEqual([{ sub: 42, nome: 'Sindica', id_condominio: 7, turno: 'Síndico', typeAccess: 'Sindico' }]);
    expect(res).toMatchObject({
      access_token: 'token-portaria',
      id: 42,
      turno: 'Síndico',
      id_condominio: 7,
      condominios: [{ id: 7, nome: 'Edifício Demo' }],
      device_token: 'dev-1',
    });
  });

  it('desafio é de uso único e não aceita mfa_token que não saiu deste login', async () => {
    const { svc } = build({ comRegistroPortaria: false });
    await svc.loginPortaria('sindico@demo.com', SENHA);
    await svc.verificarMfaPortaria('mfa-1', '123456', false);

    await expect(svc.verificarMfaPortaria('mfa-1', '123456', false)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.verificarMfaPortaria('mfa-do-app', '123456', false)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('aparelho confiável entra direto, como no app', async () => {
    const { svc, mfa } = build({ comRegistroPortaria: true, confiavel: true });
    const res: any = await svc.loginPortaria('sindico@demo.com', SENHA, 'dev-1');

    expect(mfa.isDeviceTrusted).toHaveBeenCalledWith(42, 'dev-1');
    expect(res.access_token).toBe('token-portaria');
    expect(mfa.createChallenge).not.toHaveBeenCalled();
  });

  it('porteiro comum continua sem 2º fator', async () => {
    const { svc, mfa } = build({ comRegistroPortaria: true, semSindico: true });
    const res: any = await svc.loginPortaria('sindico@demo.com', SENHA);

    expect(res.access_token).toBe('token-portaria');
    expect(mfa.isDeviceTrusted).not.toHaveBeenCalled();
  });
});
```

Criar `click-cond-web/apps/portaria-web/src/app/auth/login-mfa.spec.ts`:

```ts
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from './auth.service';
import { LoginPageComponent } from './login-page.component';
import { ThemeService } from '../shared/theme.service';

describe('Login da portaria — 2ª etapa do síndico', () => {
  function build() {
    TestBed.configureTestingModule({
      imports: [LoginPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ThemeService, useValue: { isLight: signal(false), toggleTheme: jest.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(LoginPageComponent);
    return {
      component: fixture.componentInstance,
      http: TestBed.inject(HttpTestingController),
      auth: TestBed.inject(AuthService),
    };
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => TestBed.resetTestingModule());

  it('desafio MFA não grava token e abre a etapa do código', () => {
    const { component, http } = build();
    component.loginValue = 'sindico@demo.com';
    component.senhaValue = 'x';
    component.onSubmit();

    http.expectOne('/api/auth/login-portaria').flush({
      mfa_required: true,
      mfa_token: 'm1',
      email_masked: 'si****@demo.com',
      expires_in_seconds: 600,
    });

    expect(localStorage.getItem('portaria_token')).toBeNull();
    expect(component.mfaToken()).toBe('m1');
    expect(component.mfaEmail()).toBe('si****@demo.com');
  });

  it('código confirmado grava a sessão e o token do dispositivo', () => {
    const { component, http } = build();
    component.mfaToken.set('m1');
    component.codigoMfa = '123456';
    component.lembrarDispositivo = true;
    component.onSubmitMfa();

    const req = http.expectOne('/api/auth/login-portaria/mfa');
    expect(req.request.body).toEqual({ mfa_token: 'm1', code: '123456', remember_device: true });
    req.flush({
      access_token: 'tok',
      id: 1,
      nome: 'S',
      turno: 'Síndico',
      id_condominio: 10,
      condominio_nome: 'C',
      condominios: [{ id: 10, nome: 'C' }],
      device_token: 'dev1',
    });

    expect(localStorage.getItem('portaria_token')).toBe('tok');
    expect(localStorage.getItem('portaria_device_token')).toBe('dev1');
  });

  it('login seguinte envia o token do dispositivo confiável', () => {
    localStorage.setItem('portaria_device_token', 'dev1');
    const { auth, http } = build();
    auth.login('s@d', 'x').subscribe();

    expect(http.expectOne('/api/auth/login-portaria').request.body).toEqual({ login: 's@d', senha: 'x', device_token: 'dev1' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts login-portaria-mfa`
Expected: FAIL — os casos de desafio recebem a sessão com `access_token` (jwt.sign chamado), `svc.verificarMfaPortaria is not a function`, e `aparelho confiável` falha em `isDeviceTrusted` não chamado. `porteiro comum` passa.

Run: `cd C:/w/sec/click-cond-web && npx jest -c apps/portaria-web/jest.config.cts login-mfa`
Expected: FAIL — `component.mfaToken is not a function` / `component.onSubmitMfa is not a function`, e o corpo do login não tem `device_token`.

- [ ] **Step 3: Write minimal implementation**

**API — `click-cond-web/apps/api/src/app/auth/auth.service.ts`**

(a) Imports (linhas 1-9):

Antes:
```ts
import { ForbiddenException, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
```
Depois:
```ts
import { BadRequestException, ForbiddenException, Injectable, Logger, Optional, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
```
E, após `import { TenantAccessService } from './tenant-access.service';`:
```ts
import { MfaService } from './mfa/mfa.service';
```

(b) Campo e construtor (linhas 28-35):

Antes:
```ts
  private readonly portariaJwtExpiresIn = (process.env.PORTARIA_JWT_EXPIRES_IN ?? '24h') as any;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly qrStore: QrSessionStore,
    private readonly tenant?: TenantAccessService,
  ) {}
```
Depois:
```ts
  private readonly portariaJwtExpiresIn = (process.env.PORTARIA_JWT_EXPIRES_IN ?? '24h') as any;
  /**
   * Sessões de síndico aguardando o código do e-mail, por mfa_token. Em memória como o QrSessionStore e o
   * lockout: se a API reiniciar no meio, o síndico só faz login de novo.
   */
  private readonly mfaPendentes = new Map<string, { payload: JwtPayload; resposta: Record<string, unknown>; expiraEm: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly qrStore: QrSessionStore,
    private readonly tenant?: TenantAccessService,
    @Optional() private readonly mfa?: MfaService,
  ) {}
```

(c) `montarSessaoPortaria` (linhas 134-171) — assinatura e final:

Antes:
```ts
  private async montarSessaoPortaria(
    funcionario: { id: number; nome: string; turno: string | null; id_condominio: number },
    login: string,
  ) {
```
Depois:
```ts
  private async montarSessaoPortaria(
    funcionario: { id: number; nome: string; turno: string | null; id_condominio: number },
    login: string,
    deviceToken?: string,
  ) {
```

Antes:
```ts
    return {
      access_token: this.jwt.sign(payload, { expiresIn: this.portariaJwtExpiresIn }),
      id: sindico ? sindico.id : funcionario.id,
      nome: sindico ? sindico.nome : funcionario.nome,
      turno: sindico ? 'Síndico' : funcionario.turno,
      id_condominio: funcionario.id_condominio,
      condominio_nome: cond?.nome || 'Click Condomínio',
      // Só lista os condomínios quando este login É o síndico do condomínio da sessão. Um porteiro cujo
      // login coincide com o e-mail de um síndico de OUTRO condomínio não pode ver nem trocar para os dele.
      condominios: sindico ? await this.condominiosDoSindicoPorLogin(login) : [],
    };
  }
```
Depois:
```ts
    const resposta = {
      id: sindico ? sindico.id : funcionario.id,
      nome: sindico ? sindico.nome : funcionario.nome,
      turno: sindico ? 'Síndico' : funcionario.turno,
      id_condominio: funcionario.id_condominio,
      condominio_nome: cond?.nome || 'Click Condomínio',
      // Só lista os condomínios quando este login É o síndico do condomínio da sessão. Um porteiro cujo
      // login coincide com o e-mail de um síndico de OUTRO condomínio não pode ver nem trocar para os dele.
      condominios: sindico ? await this.condominiosDoSindicoPorLogin(login) : [],
    };

    if (sindico) {
      const desafio = await this.exigirMfaSindico(sindico.id, deviceToken, payload, resposta);
      if (desafio) return desafio;
    }

    return {
      access_token: this.jwt.sign(payload, { expiresIn: this.portariaJwtExpiresIn }),
      ...resposta,
    };
  }
```

(d) `loginPortaria` — assinatura (linha 173):

Antes:
```ts
  async loginPortaria(login: string, senha: string) {
```
Depois:
```ts
  async loginPortaria(login: string, senha: string, deviceToken?: string) {
```

Linha 213:

Antes:
```ts
        return this.montarSessaoPortaria(funcionario, login);
```
Depois:
```ts
        return this.montarSessaoPortaria(funcionario, login, deviceToken);
```

Final do fallback de síndico (linhas 286-299):

Antes:
```ts
    return {
      access_token: this.jwt.sign(sindicoPayload, { expiresIn: this.portariaJwtExpiresIn }),
      id: user.id,
      nome: sindico.name,
      turno: 'Síndico',
      id_condominio: vinculo.id_condominio,
      condominio_nome: vinculo.condominio?.nome || 'Click Condomínio',
      // Síndico pode administrar mais de um condomínio. A web entrava sempre no
      // primeiro vínculo; devolvendo a lista, ela pergunta em qual entrar.
      condominios: user.sindicosCondominios.map((v) => ({
        id: v.id_condominio,
        nome: v.condominio?.nome || 'Condomínio',
      })),
    };
  }
```
Depois:
```ts
    const resposta = {
      id: user.id,
      nome: sindico.name,
      turno: 'Síndico',
      id_condominio: vinculo.id_condominio,
      condominio_nome: vinculo.condominio?.nome || 'Click Condomínio',
      // Síndico pode administrar mais de um condomínio. A web entrava sempre no
      // primeiro vínculo; devolvendo a lista, ela pergunta em qual entrar.
      condominios: user.sindicosCondominios.map((v) => ({
        id: v.id_condominio,
        nome: v.condominio?.nome || 'Condomínio',
      })),
    };

    const desafio = await this.exigirMfaSindico(user.id, deviceToken, sindicoPayload, resposta);
    if (desafio) return desafio;

    return {
      access_token: this.jwt.sign(sindicoPayload, { expiresIn: this.portariaJwtExpiresIn }),
      ...resposta,
    };
  }

  /**
   * Síndico no console passa pelo MESMO 2º fator do login do app (MobileAuthService.loginSindico):
   * aparelho confiável ou código por e-mail. O token do console carrega typeAccess 'Sindico' e vale nas
   * rotas do app, então sem isto uma senha vazada pulava o 2º fator por aqui.
   *
   * Devolve null quando pode entrar direto (aparelho confiável ou MFA não configurado — mesmo critério
   * do app); senão, o desafio, e guarda a sessão já montada até o código ser conferido.
   */
  private async exigirMfaSindico(
    idUser: number,
    deviceToken: string | undefined,
    payload: JwtPayload,
    resposta: Record<string, unknown>,
  ) {
    if (!this.mfa) return null;
    if (await this.mfa.isDeviceTrusted(idUser, deviceToken)) return null;

    const user = await this.prisma.users.findUnique({ where: { id: idUser }, include: { sindicos: true } });
    const sindico = user?.sindicos?.[0];
    const email = (sindico?.email?.trim() && sindico.email.includes('@'))
      ? sindico.email.trim()
      : (user?.email?.trim() && user.email.includes('@'))
        ? user.email.trim()
        : (user?.login?.trim() && user.login.includes('@'))
          ? user.login.trim()
          : '';
    if (!email) {
      throw new BadRequestException(
        'Não há um e-mail válido vinculado a este cadastro de Síndico para envio do código de segurança de 2 etapas. Atualize o e-mail no painel.',
      );
    }

    const desafio = await this.mfa.createChallenge({ id: idUser, email, name: sindico?.name || 'Síndico' });
    const agora = Date.now();
    for (const [token, pendente] of this.mfaPendentes) {
      if (pendente.expiraEm < agora) this.mfaPendentes.delete(token);
    }
    this.mfaPendentes.set(desafio.mfa_token, {
      payload,
      resposta,
      expiraEm: agora + desafio.expires_in_seconds * 1000,
    });
    return desafio;
  }

  /** 2ª etapa do login de síndico no console: confere o código e emite o token de console guardado. */
  async verificarMfaPortaria(
    mfaToken: string,
    code: string,
    rememberDevice: boolean,
    meta?: { userAgent?: string; ip?: string },
  ) {
    const pendente = mfaToken ? this.mfaPendentes.get(mfaToken) : undefined;
    if (!pendente || pendente.expiraEm < Date.now() || !this.mfa) {
      if (mfaToken) this.mfaPendentes.delete(mfaToken);
      throw new UnauthorizedException('Código expirado ou inválido. Faça login novamente.');
    }

    // verifyChallenge confere o código (limite de 5 tentativas) e apaga o desafio. O token de app que
    // ele também assina é descartado: o console recebe o token de console montado no login.
    const verificado = await this.mfa.verifyChallenge(mfaToken, code, rememberDevice, meta);
    this.mfaPendentes.delete(mfaToken);

    return {
      access_token: this.jwt.sign(pendente.payload, { expiresIn: this.portariaJwtExpiresIn }),
      ...pendente.resposta,
      device_token: verificado.device_token,
    };
  }
```

**API — `click-cond-web/apps/api/src/app/auth/auth.controller.ts`**

Após `import type { JwtPayload } from './jwt-payload.interface';` acrescentar:
```ts
import { extractClientIp } from '../common/context/request-context';
```

Linhas 45-53:

Antes:
```ts
  @Public()
  // Throttle estrito no login: 5 tentativas / minuto / IP. Adicional ao
  // throttle global. Protege contra password spray e brute force básico.
  @Throttle({ medium: { limit: 5, ttl: 60_000 } })
  @Post('login-portaria')
  @HttpCode(200)
  login(@Body() body: { login: string; senha: string }) {
    return this.authService.loginPortaria(body.login, body.senha);
  }
```
Depois:
```ts
  @Public()
  // Throttle estrito no login: 5 tentativas / minuto / IP. Adicional ao
  // throttle global. Protege contra password spray e brute force básico.
  @Throttle({ medium: { limit: 5, ttl: 60_000 } })
  @Post('login-portaria')
  @HttpCode(200)
  login(@Body() body: { login: string; senha: string; device_token?: string }, @Req() req: any) {
    const deviceToken = (req?.headers?.['x-device-token'] as string) || body.device_token;
    return this.authService.loginPortaria(body.login, body.senha, deviceToken);
  }

  // 2ª etapa do login de síndico no console (código enviado por e-mail).
  @Public()
  @Throttle({ medium: { limit: 10, ttl: 60_000 } })
  @Post('login-portaria/mfa')
  @HttpCode(200)
  verificarMfaPortaria(
    @Body() body: { mfa_token: string; code: string; remember_device?: boolean },
    @Req() req: any,
  ) {
    return this.authService.verificarMfaPortaria(body.mfa_token, body.code, body.remember_device ?? false, {
      userAgent: req?.headers?.['user-agent'],
      ip: extractClientIp(req) || req?.ip,
    });
  }
```

**portaria-web — `click-cond-web/apps/portaria-web/src/app/auth/auth.service.ts`**

Após a interface `PorteiroInfo` (linha 20) e as constantes (linhas 22-23):

Antes:
```ts
const TOKEN_KEY = 'portaria_token';
const INFO_KEY = 'portaria_info';
```
Depois:
```ts
/** Resposta do login quando o síndico precisa confirmar o código enviado por e-mail. */
export interface DesafioMfa {
  mfa_required: true;
  mfa_token: string;
  email_masked: string;
  expires_in_seconds: number;
}

export function ehDesafioMfa(res: PorteiroInfo | DesafioMfa): res is DesafioMfa {
  return (res as DesafioMfa)?.mfa_required === true;
}

const TOKEN_KEY = 'portaria_token';
const INFO_KEY = 'portaria_info';
/** Aparelho confiável do síndico (30 dias). Fica após o logout, como no app. */
const DEVICE_KEY = 'portaria_device_token';
```

`login` (linhas 74-78):

Antes:
```ts
  login(login: string, senha: string) {
    return this.http
      .post<PorteiroInfo>('/api/auth/login-portaria', { login, senha })
      .pipe(tap((res) => this._persist(res)));
  }
```
Depois:
```ts
  login(login: string, senha: string) {
    return this.http
      .post<PorteiroInfo | DesafioMfa>('/api/auth/login-portaria', {
        login,
        senha,
        device_token: this._deviceToken() ?? undefined,
      })
      // Desafio de 2 etapas não é sessão: nada é gravado até o código ser confirmado.
      .pipe(tap((res) => { if (!ehDesafioMfa(res)) this._persist(res); }));
  }

  verificarMfa(mfaToken: string, code: string, lembrar: boolean) {
    return this.http
      .post<PorteiroInfo & { device_token?: string }>('/api/auth/login-portaria/mfa', {
        mfa_token: mfaToken,
        code,
        remember_device: lembrar,
      })
      .pipe(
        tap((res) => {
          if (res.device_token) {
            try { localStorage.setItem(DEVICE_KEY, res.device_token); } catch { /* sem storage: pede o código de novo */ }
          }
          this._persist(res);
        }),
      );
  }

  reenviarMfa(mfaToken: string) {
    return this.http.post<{ success: boolean; message: string }>('/api/auth/mfa/resend', { mfa_token: mfaToken });
  }

  private _deviceToken(): string | null {
    try {
      return localStorage.getItem(DEVICE_KEY);
    } catch {
      return null;
    }
  }
```

**portaria-web — `click-cond-web/apps/portaria-web/src/app/auth/login-page.component.ts`**

Import (linha 6):

Antes:
```ts
import { AuthService } from './auth.service';
```
Depois:
```ts
import { AuthService, ehDesafioMfa } from './auth.service';
```

Condição do formulário (linha 193):

Antes:
```html
            @if (!isQrMode()) {
```
Depois:
```html
            @if (!isQrMode() && !mfaToken()) {
```

Bloco novo — imediatamente antes da linha `            <!-- MODO QR CODE DE LOGIN -->`:

```html
            <!-- SEGUNDA ETAPA DO SÍNDICO: CÓDIGO ENVIADO POR E-MAIL -->
            @if (mfaToken()) {
              <form (ngSubmit)="onSubmitMfa()" class="space-y-5 animate-fadeIn">
                <div class="space-y-2">
                  <h2
                    class="text-2xl font-extrabold tracking-tight"
                    [ngClass]="isLight() ? 'text-slate-800' : 'text-white'"
                  >Verificação em duas etapas</h2>
                  <p class="text-sm font-light" [ngClass]="isLight() ? 'text-slate-500' : 'text-slate-400'">
                    Enviamos um código de 6 dígitos para {{ mfaEmail() }}.
                  </p>
                </div>

                <input
                  type="text"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  maxlength="6"
                  [(ngModel)]="codigoMfa"
                  name="codigoMfa"
                  required
                  class="w-full border rounded-xl px-4 py-3.5 text-center text-lg tracking-[0.5em] transition shadow-inner focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
                  [ngClass]="isLight()
                    ? 'bg-slate-50 border-slate-200 text-slate-800 placeholder-slate-400'
                    : 'bg-slate-900/60 border-white/10 text-white placeholder-slate-600'"
                  placeholder="000000"
                />

                <label class="flex items-center gap-2 text-xs" [ngClass]="isLight() ? 'text-slate-600' : 'text-slate-400'">
                  <input type="checkbox" [(ngModel)]="lembrarDispositivo" name="lembrarDispositivo" />
                  Confiar neste computador por 30 dias
                </label>

                @if (erro()) {
                  <div class="flex items-center gap-2.5 text-xs text-rose-400 bg-rose-400/10 border border-rose-400/20 rounded-xl px-4 py-3">
                    <span>{{ erro() }}</span>
                  </div>
                }

                <button
                  type="submit"
                  [disabled]="carregando()"
                  class="w-full bg-accent hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-xl px-4 py-3.5 transition shadow-lg shadow-accent/15 active:scale-[0.98]"
                >
                  {{ carregando() ? 'Verificando...' : 'Confirmar código' }}
                </button>

                <div class="flex justify-between text-xs">
                  <button type="button" (click)="cancelarMfa()" class="text-slate-500 hover:text-accent transition">Voltar</button>
                  <button type="button" (click)="reenviarCodigo()" class="text-slate-500 hover:text-accent transition">Reenviar código</button>
                </div>
              </form>
            }

```

Estado (logo após `erro = signal('');`, linha 461):

```ts
  // Segunda etapa do síndico (código por e-mail)
  mfaToken = signal('');
  mfaEmail = signal('');
  codigoMfa = '';
  lembrarDispositivo = true;
```

`onSubmit` (linhas 482-500):

Antes:
```ts
    this.auth.login(this.loginValue, this.senhaValue).subscribe({
      next: () => this.router.navigate([this.destinoPosLogin()]),
```
Depois:
```ts
    this.auth.login(this.loginValue, this.senhaValue).subscribe({
      next: (res) => {
        if (ehDesafioMfa(res)) {
          this.carregando.set(false);
          this.mfaEmail.set(res.email_masked);
          this.mfaToken.set(res.mfa_token);
          return;
        }
        this.router.navigate([this.destinoPosLogin()]);
      },
```

Novos métodos, logo após o fim de `onSubmit()`:

```ts
  onSubmitMfa() {
    const codigo = this.codigoMfa.trim();
    if (!codigo) return;
    this.carregando.set(true);
    this.erro.set('');

    this.auth.verificarMfa(this.mfaToken(), codigo, this.lembrarDispositivo).subscribe({
      next: () => {
        this.mfaToken.set('');
        this.codigoMfa = '';
        this.router.navigate([this.destinoPosLogin()]);
      },
      error: (err) => {
        this.carregando.set(false);
        this.erro.set(err?.error?.message || 'Código inválido ou expirado.');
      },
    });
  }

  reenviarCodigo() {
    this.erro.set('');
    this.auth.reenviarMfa(this.mfaToken()).subscribe({
      error: (err) => this.erro.set(err?.error?.message || 'Não foi possível reenviar o código.'),
    });
  }

  cancelarMfa() {
    this.mfaToken.set('');
    this.codigoMfa = '';
    this.erro.set('');
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts login-portaria-mfa login-portaria-typeaccess qr-session-typeaccess condominio-nome.tenant`
Expected: PASS.

Run: `cd C:/w/sec/click-cond-web && npx jest -c apps/portaria-web/jest.config.cts login-mfa redefinir-senha-page auth.guard auth.interceptor`
Expected: PASS.

Run: `cd C:/w/sec/click-cond-web && npx nx build portaria-web`
Expected: build conclui sem erro de template.

- [ ] **Step 5: Commit**

```bash
git -C C:/w/sec add click-cond-web/apps/api/src/app/auth/auth.service.ts click-cond-web/apps/api/src/app/auth/auth.controller.ts click-cond-web/apps/api/src/app/auth/login-portaria-mfa.spec.ts click-cond-web/apps/portaria-web/src/app/auth/auth.service.ts click-cond-web/apps/portaria-web/src/app/auth/login-page.component.ts click-cond-web/apps/portaria-web/src/app/auth/login-mfa.spec.ts
git -C C:/w/sec commit -m "fix(security): login de sindico na portaria-web exige o mesmo 2o fator do app" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A7: login por QR — token entregue uma vez só e confirmação no app antes de autorizar

Corrige: `auth.service:qr-login-session-not-bound-to-initiator` + `app-qr-web-login-authorize-without-confirmation`

**Files:**
- Modify: `click-cond-web/apps/api/src/app/auth/qr-session.store.ts:49-57` (método novo `consumir`)
- Modify: `click-cond-web/apps/api/src/app/auth/auth.service.ts:504-523` (`getQrStatus`)
- Modify: `click-cond-app/click-cond-app/lib/pages/settings/qr_web_access_page.dart:1-14` (imports), `:48-104` (`_onDetect`), nova função de topo `confirmarEAutorizarQrWeb`
- Test: `click-cond-web/apps/api/src/app/auth/qr-session-entrega-unica.spec.ts` (novo), `click-cond-app/click-cond-app/test/qr_web_access_confirmacao_test.dart` (novo)

**Interfaces:**
- Consumes: `showAppConfirmDialog(context, {title, message, confirmLabel, cancelLabel, icon, iconColor}): Future<bool>` (`lib/widgets/app/app_dialog.dart`); `ApiClient.post` (injeta o `Authorization` via `tokenProvider`).
- Produces: `QrSessionStore.consumir(token: string): void`; Dart top-level `Future<http.Response?> confirmarEAutorizarQrWeb(BuildContext context, {required String qrToken, required int idCondominio, VoidCallback? aoConfirmar})` — devolve `null` quando o usuário cancela.

- [ ] **Step 1: Write the failing tests**

Criar `click-cond-web/apps/api/src/app/auth/qr-session-entrega-unica.spec.ts`:

```ts
import { AuthService } from './auth.service';
import { QrSessionStore } from './qr-session.store';

/**
 * GET /auth/qr/status/:qrToken é público e o qrToken é o próprio conteúdo do
 * QR. O token de portaria era devolvido em TODA consulta até a sessão expirar:
 * quem fotografasse o QR da tela recebia a mesma sessão do navegador legítimo.
 */
describe('Login por QR — token de portaria entregue uma vez só', () => {
  function build() {
    const store = new QrSessionStore();
    const prisma: any = {
      isConnected: true,
      condominios: { findUnique: jest.fn(async () => ({ nome: 'Edifício A' })) },
      sindicos_Condominios: { findFirst: jest.fn(async () => ({ id: 1 })) },
    };
    const svc = new AuthService(prisma, { sign: jest.fn(() => 'token-portaria') } as any, store);
    return { svc };
  }

  it('a segunda consulta depois da confirmação não recebe o token', async () => {
    const { svc } = build();
    const s = svc.createQrSession();
    await svc.authorizeQrSession({ sub: 3, nome: 'S', typeAccess: 'Sindico' }, s.qrToken, 1);

    const primeira = await svc.getQrStatus(s.qrToken);
    expect(primeira).toMatchObject({ status: 'confirmed', access_token: 'token-portaria' });

    const segunda = await svc.getQrStatus(s.qrToken);
    expect(segunda).toEqual({ status: 'expired' });
  });

  it('enquanto pendente, as consultas do navegador continuam vendo "pending"', async () => {
    const { svc } = build();
    const s = svc.createQrSession();

    expect(await svc.getQrStatus(s.qrToken)).toEqual({ status: 'pending' });
    expect(await svc.getQrStatus(s.qrToken)).toEqual({ status: 'pending' });
  });
});
```

Criar `click-cond-app/click-cond-app/test/qr_web_access_confirmacao_test.dart`:

```dart
import 'dart:convert';

import 'package:click/pages/settings/qr_web_access_page.dart';
import 'package:click/utils/api_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// A tela de acesso web autorizava a sessão no instante em que a câmera lia
/// qualquer "qr_...". Quem repassasse o QR da própria tela de login ("escaneia
/// aqui pra eu te ajudar") entrava no console com o acesso do síndico. Agora o
/// app pergunta antes, e só a confirmação chama o servidor.
void main() {
  late List<http.Request> chamadas;

  setUp(() {
    chamadas = [];
    ApiClient.tokenProvider = () => 'token-do-usuario';
    ApiClient.client = MockClient((req) async {
      chamadas.add(req);
      return http.Response('{"success":true}', 200);
    });
  });

  tearDown(ApiClient.restaurarPadroes);

  Future<Future<http.Response?>> abrir(WidgetTester tester) async {
    late Future<http.Response?> resultado;
    await tester.pumpWidget(MaterialApp(
      home: Builder(
        builder: (context) => ElevatedButton(
          onPressed: () {
            resultado = confirmarEAutorizarQrWeb(context, qrToken: 'qr_abc', idCondominio: 7);
          },
          child: const Text('ler'),
        ),
      ),
    ));
    await tester.tap(find.text('ler'));
    await tester.pumpAndSettle();
    return resultado;
  }

  testWidgets('mostra a confirmação e não chama o servidor antes dela', (tester) async {
    await abrir(tester);

    expect(find.text('Liberar acesso ao console web?'), findsOneWidget);
    expect(chamadas, isEmpty);
  });

  testWidgets('Cancelar não autoriza nada', (tester) async {
    final resultado = await abrir(tester);
    await tester.tap(find.text('Cancelar'));
    await tester.pumpAndSettle();

    expect(await resultado, isNull);
    expect(chamadas, isEmpty);
  });

  testWidgets('Autorizar chama POST /auth/qr/authorize com o QR lido', (tester) async {
    final resultado = await abrir(tester);
    await tester.tap(find.text('Autorizar'));
    await tester.pumpAndSettle();

    final resposta = await resultado;
    expect(resposta!.statusCode, 200);
    expect(chamadas, hasLength(1));
    expect(chamadas.single.method, 'POST');
    expect(chamadas.single.url.path, endsWith('/auth/qr/authorize'));
    expect(jsonDecode(chamadas.single.body), {'qrToken': 'qr_abc', 'id_condominio': 7});
  });
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts qr-session-entrega-unica`
Expected: FAIL — `a segunda consulta...`: recebido `{ status: 'confirmed', access_token: 'token-portaria', ... }`, esperado `{ status: 'expired' }`. O caso `pending` passa.

Run: `cd C:/w/sec/click-cond-app/click-cond-app && flutter test test/qr_web_access_confirmacao_test.dart`
Expected: FAIL de compilação — `The method 'confirmarEAutorizarQrWeb' isn't defined`.

- [ ] **Step 3: Write minimal implementation**

**`click-cond-web/apps/api/src/app/auth/qr-session.store.ts`** — após o método `confirm` (linha 57):

```ts

  /**
   * Entrega única: depois que o token de portaria sai pelo status, a sessão
   * deixa de existir — quem fotografou o QR e consulta depois não recebe nada.
   */
  consumir(token: string): void {
    this.sessions.delete(token);
  }
```

**`click-cond-web/apps/api/src/app/auth/auth.service.ts`** — `getQrStatus` (linhas 510-520):

Antes:
```ts
    if (session.status === 'confirmed') {
      return {
```
Depois:
```ts
    if (session.status === 'confirmed') {
      // Uma entrega só: o navegador que gerou o QR consulta a cada 1,5 s e é
      // quem recebe; uma segunda consulta (QR fotografado/repassado) não leva o token.
      this.qrStore.consumir(qrToken);
      return {
```

**`click-cond-app/click-cond-app/lib/pages/settings/qr_web_access_page.dart`**

Imports (linhas 10-12) — `getToken()` sai deste arquivo (o `ApiClient` já injeta o `Authorization`):

Antes:
```dart
import 'package:click/utils/api_config.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/widgets/app/app_dialog.dart';
```
Depois:
```dart
import 'package:click/utils/api_config.dart';
import 'package:click/widgets/app/app_dialog.dart';
```

Função de topo — inserir logo antes de `class QrWebAccessPage extends StatefulWidget {`:

```dart
/// Pergunta ao usuário antes de liberar a sessão web e só então chama
/// POST /auth/qr/authorize. Devolve null quando ele cancela — nada chega ao
/// servidor.
///
/// O QR do console é só um código de sessão: quem estiver com a tela dele
/// recebe o acesso. Autorizar no instante da leitura deixava um golpista
/// repassar o QR da tela de login DELE e entrar no console com o acesso de
/// quem escaneou (QRLjacking).
Future<http.Response?> confirmarEAutorizarQrWeb(
  BuildContext context, {
  required String qrToken,
  required int idCondominio,
  VoidCallback? aoConfirmar,
}) async {
  final confirmou = await showAppConfirmDialog(
    context,
    title: 'Liberar acesso ao console web?',
    message: 'Só autorize se foi VOCÊ quem acabou de abrir a tela de login do console, '
        'em um computador à sua frente. Se alguém te enviou este QR Code ou pediu '
        'para você escaneá-lo, cancele: quem estiver com essa tela entra no console '
        'com o seu acesso.',
    confirmLabel: 'Autorizar',
    cancelLabel: 'Cancelar',
    icon: PhosphorIcons.warningCircleFill,
    iconColor: AppColors.warning,
  );
  if (!confirmou) return null;
  aoConfirmar?.call();
  return ApiClient.post(
    ApiConfig.buildUri('/auth/qr/authorize'),
    headers: {'Content-Type': 'application/json'},
    body: jsonEncode({'qrToken': qrToken, 'id_condominio': idCondominio}),
  );
}

```

`_onDetect` (linhas 48-104):

Antes:
```dart
    setState(() => _isProcessing = true);
    _scannerController.stop();

    // Mostrar loader de autorização
    _showProcessingDialog();
    // Sem esta flag, o jsonDecode lancando (corpo nao-JSON, HTML de proxy)
    // levava o fluxo ao catch, que dava um SEGUNDO pop: o primeiro fechou o
    // loader, o segundo desempilhava a propria tela do scanner. O usuario via
    // a tela sumir sem explicacao — numa tela de autorizacao de sessao web.
    var loaderAberto = true;
    void fecharLoader() {
      if (loaderAberto && mounted) {
        loaderAberto = false;
        Navigator.of(context).pop();
      }
    }

    try {
      final response = await ApiClient.post(
        ApiConfig.buildUri('/auth/qr/authorize'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': getToken(),
        },
        body: jsonEncode({
          'qrToken': code,
          'id_condominio': widget.idCondominio,
        }),
      );

      if (!mounted) return;
      fecharLoader();
```
Depois:
```dart
    setState(() => _isProcessing = true);
    _scannerController.stop();

    // Sem esta flag, o jsonDecode lancando (corpo nao-JSON, HTML de proxy)
    // levava o fluxo ao catch, que dava um SEGUNDO pop: o primeiro fechou o
    // loader, o segundo desempilhava a propria tela do scanner. O usuario via
    // a tela sumir sem explicacao — numa tela de autorizacao de sessao web.
    // O loader só abre depois que o usuário confirma.
    var loaderAberto = false;
    void fecharLoader() {
      if (loaderAberto && mounted) {
        loaderAberto = false;
        Navigator.of(context).pop();
      }
    }

    try {
      final response = await confirmarEAutorizarQrWeb(
        context,
        qrToken: code,
        idCondominio: widget.idCondominio,
        aoConfirmar: () {
          loaderAberto = true;
          _showProcessingDialog();
        },
      );

      if (!mounted) return;
      if (response == null) {
        // Cancelou: nada foi enviado ao servidor. Volta a escanear.
        setState(() => _isProcessing = false);
        _scannerController.start();
        return;
      }
      fecharLoader();
```

(O restante de `_onDetect` — tratamento de `statusCode == 200`, `_getErrorMessage`, `catch` — fica igual.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts qr-session`
Expected: PASS (`qr-session-entrega-unica` e `qr-session-typeaccess`).

Run: `cd C:/w/sec/click-cond-app/click-cond-app && flutter test test/qr_web_access_confirmacao_test.dart && flutter analyze lib/pages/settings/qr_web_access_page.dart`
Expected: 3 testes PASS; analyze sem erros (sem `unused_import`).

- [ ] **Step 5: Commit**

```bash
git -C C:/w/sec add click-cond-web/apps/api/src/app/auth/qr-session.store.ts click-cond-web/apps/api/src/app/auth/auth.service.ts click-cond-web/apps/api/src/app/auth/qr-session-entrega-unica.spec.ts click-cond-app/click-cond-app/lib/pages/settings/qr_web_access_page.dart click-cond-app/click-cond-app/test/qr_web_access_confirmacao_test.dart
git -C C:/w/sec commit -m "fix(security): login por QR entrega o token uma vez e o app confirma antes de autorizar" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A8: troca/redefinição de senha derruba as sessões anteriores

Corrige: `auth:jwt-not-revoked-on-password-reset`

`Users.updated_at` muda em qualquer update (FCM, nome), então não serve. Precisa de coluna nova `Users.senha_alterada_em` — **o SQL abaixo tem de ser aplicado no banco ANTES do deploy** (sem a coluna, `updatePassword`/redefinição passam a dar 500).

**Files:**
- Create: `click-cond-web/prisma/sql/manual_2026-10_users-senha-alterada-em.sql`
- Modify: `click-cond-web/prisma/schema.prisma` (model `Users`, após `updated_at`)
- Create: `click-cond-web/apps/api/src/app/auth/senha-alterada.util.ts`
- Modify: `click-cond-web/apps/api/src/app/auth/jwt.strategy.ts` (arquivo inteiro)
- Modify: `click-cond-web/apps/api/src/app/auth/mobile-auth.service.ts:2803-2806` (redefinição síndico), `:2824-2827` (redefinição morador), `:4580-4583` (`updatePassword`)
- Modify: `click-cond-web/apps/api/src/app/auth/auth.service.ts:380-400` (`changePassword`, ramo síndico) e `auth.controller.ts:72-82`
- Modify: `click-cond-web/apps/portaria-web/src/app/auth/auth.service.ts:118-124` (`alterarSenha`)
- Test: `click-cond-web/apps/api/src/app/auth/revogacao-troca-senha.spec.ts` (novo), `click-cond-web/apps/api/src/app/auth/redefinir-senha.spec.ts:257-262` e `:346-351` (expectativas), `click-cond-web/apps/portaria-web/src/app/auth/alterar-senha-token.spec.ts` (novo)

**Interfaces:**
- Consumes: `ehTokenDeUsuarioApp(payload)` de `usuario-app.guard.ts`.
- Produces:
  - `momentoTrocaSenha(agora?: number): Date` (truncado no segundo) e `tokenAnteriorATrocaDeSenha(iat: number | undefined, senhaAlteradaEm: Date | null | undefined): boolean` em `senha-alterada.util.ts`.
  - `JwtStrategy` construtor `(@Optional() prisma?: PrismaService)`; `validate` vira `async`.
  - `AuthService.changePassword(id, senhaAtual, novaSenha, typeAccess?, sessao?: JwtPayload)` — no ramo síndico devolve também `access_token`.

- [ ] **Step 1: Write the failing tests**

Criar `click-cond-web/apps/api/src/app/auth/revogacao-troca-senha.spec.ts`:

```ts
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { JwtStrategy } from './jwt.strategy';
import { AuthService } from './auth.service';
import { MobileAuthService } from './mobile-auth.service';
import { momentoTrocaSenha } from './senha-alterada.util';

/**
 * Tokens do app valem 365 dias e a JwtStrategy só conferia a assinatura.
 * Redefinir ou trocar a senha depois de perder o celular não tirava o acesso
 * de quem já tinha o token.
 */
describe('JwtStrategy — sessão anterior à troca de senha', () => {
  const trocaEm = new Date('2026-10-26T12:00:00Z');
  const seg = (d: Date) => Math.floor(d.getTime() / 1000);
  const validar = (s: JwtStrategy, p: any) => Promise.resolve().then(() => s.validate(p));

  function build(senhaAlteradaEm: Date | null) {
    const prisma: any = {
      isConnected: true,
      users: { findUnique: jest.fn(async () => ({ senha_alterada_em: senhaAlteradaEm })) },
    };
    return { strategy: new JwtStrategy(prisma), prisma };
  }

  it('recusa token de app emitido antes da troca', async () => {
    const { strategy } = build(trocaEm);
    await expect(
      validar(strategy, { sub: 1, nome: 'M', typeAccess: 'Morador', iat: seg(trocaEm) - 60 }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa também o token de síndico do console (typeAccess Sindico, sub = Users.id)', async () => {
    const { strategy } = build(trocaEm);
    await expect(
      validar(strategy, { sub: 1, nome: 'S', typeAccess: 'Sindico', id_condominio: 7, iat: seg(trocaEm) - 1 }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('aceita token emitido no mesmo segundo da troca ou depois', async () => {
    const { strategy } = build(trocaEm);
    await expect(validar(strategy, { sub: 1, nome: 'M', typeAccess: 'Morador', iat: seg(trocaEm) })).resolves.toBeTruthy();
  });

  it('aceita quando a conta nunca trocou a senha', async () => {
    const { strategy } = build(null);
    await expect(validar(strategy, { sub: 1, nome: 'M', typeAccess: 'Morador', iat: 1 })).resolves.toBeTruthy();
  });

  it('token do porteiro do console (sub = Funcionarios_Portaria.id) não consulta Users', async () => {
    const { strategy, prisma } = build(trocaEm);
    await expect(validar(strategy, { sub: 1, nome: 'P', id_condominio: 2, iat: 1 })).resolves.toBeTruthy();
    expect(prisma.users.findUnique).not.toHaveBeenCalled();
  });
});

describe('troca de senha grava senha_alterada_em', () => {
  it('momentoTrocaSenha trunca no segundo (DATETIME(0) arredondaria para cima)', () => {
    expect(momentoTrocaSenha(1_700_000_000_999).getTime()).toBe(1_700_000_000_000);
  });

  it('app: updatePassword grava o momento junto com o hash', async () => {
    const hash = await bcrypt.hash('atual', 4);
    const prisma: any = {
      isConnected: true,
      users: {
        findUnique: jest.fn(async () => ({ id: 9, password: hash })),
        update: jest.fn(async () => ({
          id: 9, login: 'm@t', photo: null, sindicos: [], moradores: [{ nome: 'M' }], funcionarios: [], sindicosCondominios: [],
        })),
      },
    };
    const svc = new MobileAuthService(prisma, { sign: jest.fn(() => 't') } as any, {} as any, {} as any, {} as any, {} as any);
    await svc.updatePassword(9, 'nova-senha', 'Morador', 'atual');

    expect(prisma.users.update.mock.calls[0][0].data.senha_alterada_em).toBeInstanceOf(Date);
  });

  it('console: changePassword do síndico grava o momento e devolve token novo com o mesmo escopo', async () => {
    const hash = await bcrypt.hash('atual', 4);
    const prisma: any = {
      isConnected: true,
      users: { findUnique: jest.fn(async () => ({ id: 42, password: hash })), update: jest.fn(async () => ({})) },
    };
    const jwt: any = { sign: jest.fn(() => 'token-novo') };
    const svc = new AuthService(prisma, jwt, {} as any);
    const sessao: any = { sub: 42, nome: 'S', id_condominio: 7, turno: 'Síndico', typeAccess: 'Sindico', iat: 1, exp: 2 };

    const res: any = await svc.changePassword(42, 'atual', 'nova-senha', 'Sindico', sessao);

    expect(prisma.users.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { password: expect.stringMatching(/^\$2/), senha_alterada_em: expect.any(Date) },
    });
    expect(jwt.sign).toHaveBeenCalledWith(
      { sub: 42, nome: 'S', id_condominio: 7, turno: 'Síndico', typeAccess: 'Sindico' },
      expect.anything(),
    );
    expect(res.access_token).toBe('token-novo');
  });
});
```

Em `click-cond-web/apps/api/src/app/auth/redefinir-senha.spec.ts`, nas duas expectativas (linhas 257-262 para `id: 55` e 346-351 para `id: 10`):

Antes (cada uma):
```ts
        data: {
          password: expect.stringMatching(/^\$2[aby]\$/),
        },
```
Depois (cada uma):
```ts
        data: {
          password: expect.stringMatching(/^\$2[aby]\$/),
          // Derruba os tokens emitidos antes da redefinição (JwtStrategy compara o iat).
          senha_alterada_em: expect.any(Date),
        },
```

Criar `click-cond-web/apps/portaria-web/src/app/auth/alterar-senha-token.spec.ts`:

```ts
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from './auth.service';

describe('AuthService.alterarSenha — sessão segue com o token novo', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('guarda o access_token devolvido pela troca de senha', () => {
    localStorage.setItem('portaria_token', 'antigo');
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    const auth = TestBed.inject(AuthService);
    const http = TestBed.inject(HttpTestingController);

    auth.alterarSenha('atual', 'nova123').subscribe();
    http.expectOne('/api/auth/change-password').flush({ success: true, message: 'ok', access_token: 'novo' });

    expect(localStorage.getItem('portaria_token')).toBe('novo');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts revogacao-troca-senha redefinir-senha`
Expected: FAIL — `Cannot find module './senha-alterada.util'` (a suíte nova não carrega) e, em `redefinir-senha.spec.ts`, os casos `redefine senha de Morador...` e `redefine senha de Síndico...` falham por faltar `senha_alterada_em` em `data`.

Run: `cd C:/w/sec/click-cond-web && npx jest -c apps/portaria-web/jest.config.cts alterar-senha-token`
Expected: FAIL — esperado `"novo"`, recebido `"antigo"`.

- [ ] **Step 3: Write minimal implementation**

(a) Criar `click-cond-web/prisma/sql/manual_2026-10_users-senha-alterada-em.sql`:

```sql
-- A8 (auth:jwt-not-revoked-on-password-reset)
-- Momento da última troca/redefinição de senha. A JwtStrategy recusa token de
-- usuário do app (e de síndico no console) com iat anterior a este momento.
-- APLICAR ANTES DO DEPLOY: sem a coluna, a troca de senha passa a dar 500.
ALTER TABLE Users ADD COLUMN senha_alterada_em DATETIME NULL DEFAULT NULL;
```

(b) `click-cond-web/prisma/schema.prisma`, model `Users`:

Antes:
```prisma
  updated_at          DateTime                     @default(now()) @updatedAt @db.DateTime(0)
  fcm_token           String?                      @db.VarChar(500)
```
Depois:
```prisma
  updated_at          DateTime                     @default(now()) @updatedAt @db.DateTime(0)
  /// Última troca/redefinição de senha: tokens com iat anterior são recusados (JwtStrategy).
  senha_alterada_em   DateTime?                    @db.DateTime(0)
  fcm_token           String?                      @db.VarChar(500)
```

Regenerar o client: `cd C:/w/sec/click-cond-web && npx prisma generate`

(c) Criar `click-cond-web/apps/api/src/app/auth/senha-alterada.util.ts`:

```ts
/**
 * Momento da troca de senha, truncado no segundo. O `iat` do JWT é em
 * segundos inteiros e a coluna é DATETIME(0), que ARREDONDA a fração: gravar
 * 12:00:00.700 viraria 12:00:01 e o token emitido logo depois (iat 12:00:00)
 * seria recusado.
 */
export function momentoTrocaSenha(agora: number = Date.now()): Date {
  return new Date(Math.floor(agora / 1000) * 1000);
}

/** O token foi emitido antes da última troca de senha da conta. */
export function tokenAnteriorATrocaDeSenha(
  iat: number | undefined,
  senhaAlteradaEm: Date | null | undefined,
): boolean {
  if (!senhaAlteradaEm) return false;
  // Sem iat não há como provar que o token é posterior à troca.
  if (!iat) return true;
  return iat < Math.floor(senhaAlteradaEm.getTime() / 1000);
}
```

(d) `click-cond-web/apps/api/src/app/auth/jwt.strategy.ts` — arquivo inteiro:

Antes:
```ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { JwtPayload } from './jwt-payload.interface';
import { resolveJwtSecret } from './jwt-secret';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
```
Depois:
```ts
import { Injectable, Logger, Optional, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { JwtPayload } from './jwt-payload.interface';
import { resolveJwtSecret } from './jwt-secret';
import { PrismaService } from '../prisma/prisma.service';
import { ehTokenDeUsuarioApp } from './usuario-app.guard';
import { tokenAnteriorATrocaDeSenha } from './senha-alterada.util';

/** Por quanto tempo a data da última troca de senha fica em cache por usuário. */
const CACHE_TROCA_SENHA_MS = 30_000;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);
  private readonly trocaSenhaCache = new Map<number, { valor: Date | null; expira: number }>();

  constructor(@Optional() private readonly prisma?: PrismaService) {
    super({
```

Antes:
```ts
  validate(payload: JwtPayload) {
    return payload;
  }
}
```
Depois:
```ts
  /**
   * Token de usuário do app (e de síndico no console, que também tem sub = Users.id) emitido antes da
   * última troca/redefinição de senha é recusado: sem isto, um token de 365 dias sobrevivia à
   * redefinição feita justamente para tirar o acesso de quem o roubou. Token do porteiro do console
   * (sub = Funcionarios_Portaria.id) e do CRM não passam por aqui.
   *
   * Banco indisponível ou erro na consulta: segue aceitando (o app trata 401 como fim de sessão, e uma
   * queda do banco deslogaria todo mundo). A revogação pode atrasar até CACHE_TROCA_SENHA_MS.
   */
  async validate(payload: JwtPayload & { iat?: number }) {
    if (!this.prisma?.isConnected || !ehTokenDeUsuarioApp(payload)) return payload;
    const idUser = Number(payload.user?.id ?? payload.sub);
    if (!idUser) return payload;

    if (tokenAnteriorATrocaDeSenha(payload.iat, await this.senhaAlteradaEm(idUser))) {
      throw new UnauthorizedException('Sessão encerrada porque a senha foi alterada. Entre novamente.');
    }
    return payload;
  }

  private async senhaAlteradaEm(idUser: number): Promise<Date | null> {
    const agora = Date.now();
    const cache = this.trocaSenhaCache.get(idUser);
    if (cache && cache.expira > agora) return cache.valor;
    try {
      const u = await this.prisma!.users.findUnique({
        where: { id: idUser },
        select: { senha_alterada_em: true },
      });
      const valor = u?.senha_alterada_em ?? null;
      if (this.trocaSenhaCache.size > 10_000) this.trocaSenhaCache.clear();
      this.trocaSenhaCache.set(idUser, { valor, expira: agora + CACHE_TROCA_SENHA_MS });
      return valor;
    } catch (e: any) {
      this.logger.warn(`Não foi possível conferir a troca de senha do usuário ${idUser}: ${e?.message ?? e}`);
      return null;
    }
  }
}
```

(e) `click-cond-web/apps/api/src/app/auth/mobile-auth.service.ts` — import, após `import { idUsuarioDoToken } from './usuario-do-token.util';` (A2):
```ts
import { momentoTrocaSenha } from './senha-alterada.util';
```

Redefinição de síndico (linhas 2803-2806):

Antes:
```ts
    } else if (registro.papel === 'sindico') {
      await this.prisma.users.update({
        where: { id: registro.id_conta },
        data: { password: hash },
      });
```
Depois:
```ts
    } else if (registro.papel === 'sindico') {
      // senha_alterada_em derruba os tokens emitidos antes (JwtStrategy).
      await this.prisma.users.update({
        where: { id: registro.id_conta },
        data: { password: hash, senha_alterada_em: momentoTrocaSenha() },
      });
```

Redefinição de morador (linhas 2822-2827):

Antes:
```ts
      // 'morador'
      await this.prisma.users.update({
        where: { id: registro.id_conta },
        data: { password: hash },
      });
```
Depois:
```ts
      // 'morador'
      await this.prisma.users.update({
        where: { id: registro.id_conta },
        data: { password: hash, senha_alterada_em: momentoTrocaSenha() },
      });
```

`updatePassword` (linhas 4580-4583):

Antes:
```ts
    const hash = await bcrypt.hash(newPasswordPlana, 10);
    const user = await this.prisma.users.update({
      where: { id: idUser },
      data: { password: hash },
```
Depois:
```ts
    const hash = await bcrypt.hash(newPasswordPlana, 10);
    // senha_alterada_em derruba as outras sessões; o token devolvido abaixo é emitido depois e segue valendo.
    const user = await this.prisma.users.update({
      where: { id: idUser },
      data: { password: hash, senha_alterada_em: momentoTrocaSenha() },
```

(f) `click-cond-web/apps/api/src/app/auth/auth.service.ts` — import, após `import { MfaService } from './mfa/mfa.service';` (A6):
```ts
import { momentoTrocaSenha } from './senha-alterada.util';
```

`changePassword` (linhas 380-400):

Antes:
```ts
  async changePassword(id: number, senhaAtual: string, novaSenha: string, typeAccess?: string) {
```
Depois:
```ts
  async changePassword(id: number, senhaAtual: string, novaSenha: string, typeAccess?: string, sessao?: JwtPayload) {
```

Antes:
```ts
      const newHash = await bcrypt.hash(novaSenha, 12);
      await this.prisma.users.update({ where: { id }, data: { password: newHash } });
      return { success: true, message: 'Senha atualizada com sucesso.' };
    }
```
Depois:
```ts
      const newHash = await bcrypt.hash(novaSenha, 12);
      await this.prisma.users.update({ where: { id }, data: { password: newHash, senha_alterada_em: momentoTrocaSenha() } });
      // A troca derruba as sessões anteriores (inclusive esta). Devolve um token novo com o mesmo escopo
      // para o console que fez a troca seguir logado.
      let access_token: string | undefined;
      if (sessao) {
        const novoPayload: any = { ...sessao };
        delete novoPayload.iat;
        delete novoPayload.exp;
        access_token = this.jwt.sign(novoPayload, { expiresIn: this.portariaJwtExpiresIn });
      }
      return { success: true, message: 'Senha atualizada com sucesso.', ...(access_token ? { access_token } : {}) };
    }
```

`click-cond-web/apps/api/src/app/auth/auth.controller.ts` (linha 81):

Antes:
```ts
    return this.authService.changePassword(payload.sub, body.senhaAtual, body.novaSenha, payload.typeAccess);
```
Depois:
```ts
    return this.authService.changePassword(payload.sub, body.senhaAtual, body.novaSenha, payload.typeAccess, payload);
```

(g) `click-cond-web/apps/portaria-web/src/app/auth/auth.service.ts` (linhas 118-124):

Antes:
```ts
  alterarSenha(senhaAtual: string, novaSenha: string) {
    // O id NÃO é mais enviado: o backend identifica o funcionário pelo JWT.
    return this.http.post<{ success: boolean; message: string }>('/api/auth/change-password', {
      senhaAtual,
      novaSenha
    });
  }
```
Depois:
```ts
  alterarSenha(senhaAtual: string, novaSenha: string) {
    // O id NÃO é mais enviado: o backend identifica o funcionário pelo JWT.
    return this.http
      .post<{ success: boolean; message: string; access_token?: string }>('/api/auth/change-password', {
        senhaAtual,
        novaSenha,
      })
      // A troca de senha do síndico derruba as sessões anteriores; a API devolve o token que continua valendo.
      .pipe(tap((res) => { if (res?.access_token) localStorage.setItem(TOKEN_KEY, res.access_token); }));
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts revogacao-troca-senha redefinir-senha update-password-senha-atual login-portaria qr-session usuario-app.guard`
Expected: PASS.

Run: `cd C:/w/sec/click-cond-web && npx jest -c apps/portaria-web/jest.config.cts alterar-senha-token login-mfa`
Expected: PASS.

Run: `cd C:/w/sec/click-cond-web && npx tsc -p apps/api/tsconfig.app.json --noEmit`
Expected: sem erros (o client gerado em (b) conhece `senha_alterada_em`).

- [ ] **Step 5: Aplicar o SQL (ANTES do deploy) e conferir**

O `DATABASE_URL` do `.env` aponta para produção. Aplicar e verificar de fato antes do push:

Run: `cd C:/w/sec/click-cond-web && npx prisma db execute --file prisma/sql/manual_2026-10_users-senha-alterada-em.sql --schema prisma/schema.prisma`
Run: `cd C:/w/sec/click-cond-web && node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.\$queryRawUnsafe(\"SHOW COLUMNS FROM Users LIKE 'senha_alterada_em'\").then(r=>{console.log(r);return p.\$disconnect()})"`
Expected: uma linha com `Field: 'senha_alterada_em'`, `Type: 'datetime'`, `Null: 'YES'`.

- [ ] **Step 6: Commit**

```bash
git -C C:/w/sec add click-cond-web/prisma/sql/manual_2026-10_users-senha-alterada-em.sql click-cond-web/prisma/schema.prisma click-cond-web/apps/api/src/app/auth/senha-alterada.util.ts click-cond-web/apps/api/src/app/auth/jwt.strategy.ts click-cond-web/apps/api/src/app/auth/mobile-auth.service.ts click-cond-web/apps/api/src/app/auth/auth.service.ts click-cond-web/apps/api/src/app/auth/auth.controller.ts click-cond-web/apps/api/src/app/auth/revogacao-troca-senha.spec.ts click-cond-web/apps/api/src/app/auth/redefinir-senha.spec.ts click-cond-web/apps/portaria-web/src/app/auth/auth.service.ts click-cond-web/apps/portaria-web/src/app/auth/alterar-senha-token.spec.ts
git -C C:/w/sec commit -m "fix(security): troca e redefinicao de senha derrubam os tokens emitidos antes" -m "SQL manual (aplicar antes do deploy): prisma/sql/manual_2026-10_users-senha-alterada-em.sql" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Fora do escopo desta tarefa (ver "Deferred to owner"): redefinição pelo papel `funcionario` (troca a senha em Funcionarios_Portaria, não revoga o token de app do Users correspondente), "sair de todos os aparelhos" no logout e o prazo de 365 dias dos tokens.

---

## Deferred to owner

- `mobile-auth/saveMorador-links-existing-users-enables-portaria-password-takeover` — **parte do `saveMorador`**: o cadastro de morador continua ligando, sem consentimento, uma conta `Users` existente achada por e-mail/CPF (inclusive de quem tem vínculo em outro condomínio). A2/A3 fecham a tomada de conta (cadastro de porteiro e `loginFuncionario`), mas recusar o vínculo ou trocá-lo por um convite que o dono aceita muda o cadastro de quem tem unidade em dois prédios — é decisão de produto.
- `auth.service:qr-login-session-not-bound-to-initiator` / `app-qr-web-login-authorize-without-confirmation` — **reforços além da A7**: mostrar no diálogo do app o navegador/IP/horário de quem pediu (precisa gravar esses dados no `qr/session` e criar uma rota de pré-visualização) e um segredo de consulta separado, que não vai no QR, exigido em `qr/status`. A A7 entrega o token uma vez só e exige confirmação; ir além disso muda o protocolo da portaria-web e o texto mostrado ao usuário — decisão de produto/UX.
- `auth:jwt-not-revoked-on-password-reset` — **além da A8**: (1) redefinição pelo papel `funcionario` grava em `Funcionarios_Portaria` e não revoga o token de app do `Users` com o mesmo login (o vínculo por login é exatamente o que A2/A3 restringem; precisa definir qual conta "é" do porteiro); (2) logout derrubando todas as sessões; (3) encurtar os tokens de 365 dias com refresh token. Mudam o comportamento do app para todos os usuários — decisão do dono.
- `auth.service:loginPortaria:sindico-session-without-mfa` — a A6 aplica o 2º fator a toda sessão de síndico no console, como pedido. O verificador registrou que confirmar se o MFA deve mesmo valer para o console é política do dono: confirmar antes do deploy. A6 deve subir junto com a portaria-web.
