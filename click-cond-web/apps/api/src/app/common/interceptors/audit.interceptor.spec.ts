import { ForbiddenException } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { AuditInterceptor, redigirSegredos } from './audit.interceptor';

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

describe('AuditInterceptor — conteúdo do registro', () => {
  const porteiro = { sub: 3, nome: 'Porteiro', id_condominio: 7 };

  /** Roda uma requisição do console e devolve o `data` gravado em audit_logs (ou undefined). */
  async function gravar(req: any, response: any = { ok: true }) {
    const prisma: any = { isConnected: true, auditLog: { create: jest.fn(async () => ({})) } };
    const reflector: any = { getAllAndOverride: () => false };
    const interceptor = new AuditInterceptor(prisma, reflector);
    const ctx: any = {
      switchToHttp: () => ({ getRequest: () => ({ method: 'POST', url: '/api/x', params: {}, body: {}, ip: '10.0.0.1', user: porteiro, ...req }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    };
    await lastValueFrom(interceptor.intercept(ctx, { handle: () => of(response) }));
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    return prisma.auditLog.create.mock.calls[0]?.[0]?.data;
  }

  describe('módulo', () => {
    it.each([
      ['/api/condominios/7/visitantes', 'visitantes'],
      ['/api/encomendas/retirar', 'encomendas'],
      ['/api/areas-sociais/insert', 'areas-sociais'],
      ['/api/areasSociais/insert', 'areas-sociais'],
      ['/api/condominios/7/regras-acesso', 'regras-acesso'],
      ['/api/condominios/7/caminhos-acesso/3', 'caminhos-acesso'],
      ['/api/condominios/7/tags', 'tags'],
      ['/api/condominios/7/visitas/9/check-in', 'visitas'],
      ['/api/condominios/7/pessoas', 'pessoas'],
      ['/api/facial/devices/4/trigger', 'facial'],
      ['/api/vagas/liberar', 'vagas'],
      ['/api/veiculos/insert', 'veiculos'],
      ['/api/funcionarios/update', 'funcionarios'],
      ['/api/convites/5/confirmar', 'convites'],
      ['/api/delivery/entregadores', 'delivery'],
      ['/api/users/settings', 'users'],
      ['/api/condominio/update-address', 'condominios'],
      ['/api/auth/change-password', 'auth'],
    ])('%s → %s', async (url, modulo) => {
      const data = await gravar({ url });
      expect(data.modulo).toBe(modulo);
      expect(data.descricao).not.toMatch(/Sistema/);
    });

    it('casa o segmento inteiro, não o prefixo', async () => {
      const data = await gravar({ url: '/api/authorize-algo/5' });
      expect(data.modulo).toBe('sistema');
    });

    it('usa rótulo legível nos módulos novos', async () => {
      const data = await gravar({ url: '/api/condominios/7/regras-acesso' });
      expect(data.descricao).toBe('Criação em Regras de Acesso');
    });

    it('módulo desconhecido: descrição traz método e rota, sem query string', async () => {
      const data = await gravar({ url: '/api/coisa-nova/12/acao?token=abc123&x=1' });
      expect(data.modulo).toBe('sistema');
      expect(data.descricao).toBe('Criação em Sistema (POST /coisa-nova/12/acao)');
    });

    it('módulo desconhecido: mantém o nome depois da rota', async () => {
      const data = await gravar({ method: 'PUT', url: '/api/coisa-nova/12', body: { nome: 'Fulano' } });
      expect(data.descricao).toBe('Atualização em Sistema (PUT /coisa-nova/12): "Fulano"');
    });

    it('módulo desconhecido: não grava segmento opaco (token) da rota', async () => {
      const data = await gravar({ url: '/api/coisa-nova/9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c/result' });
      expect(data.descricao).not.toContain('9f8a7b6c');
      expect(data.descricao).toMatch(/^Criação em Sistema \(POST \/coisa-nova\/[^/]+\/result\)$/);
    });
  });

  describe('detalhes', () => {
    it('é JSON válido e cabe em 2000 caracteres mesmo com corpo grande', async () => {
      const body: any = { titulo: 'Aviso' };
      for (let i = 0; i < 40; i++) body['campo_' + i] = 'x'.repeat(100) + ' fim';
      const data = await gravar({ url: '/api/condominios/7/comunicados', body });
      expect(data.detalhes.length).toBeLessThanOrEqual(2000);
      const parsed = JSON.parse(data.detalhes);
      expect(parsed._truncado).toBe(true);
      expect(parsed.chaves).toEqual(expect.arrayContaining(['titulo', 'campo_0']));
    });

    it('continua válido quando nem a lista de chaves cabe', async () => {
      const body: any = {};
      for (let i = 0; i < 400; i++) body['chave_bem_comprida_numero_' + i] = i;
      const data = await gravar({ url: '/api/condominios/7/comunicados', body });
      expect(data.detalhes.length).toBeLessThanOrEqual(2000);
      expect(JSON.parse(data.detalhes)._truncado).toBe(true);
    });

    it('corpo pequeno é gravado inteiro', async () => {
      const data = await gravar({ url: '/api/condominios/7/comunicados', body: { titulo: 'Aviso', n: 1 } });
      expect(JSON.parse(data.detalhes)).toEqual({ titulo: 'Aviso', n: 1 });
    });
  });

  describe('redigirSegredos', () => {
    it('troca data: URL e base64 longo por marcador com o tamanho', () => {
      const b64 = 'QUJD'.repeat(200);
      const dataUrl = 'data:image/png;base64,' + b64;
      const r: any = redigirSegredos({ imagem: dataUrl, anexo: b64, lista: [{ arquivo: dataUrl }], nome: 'ok' });
      const json = JSON.stringify(r);
      expect(json).not.toContain('QUJDQUJD');
      expect(r.imagem).toContain(String(dataUrl.length));
      expect(r.anexo).toContain(String(b64.length));
      expect(r.lista[0].arquivo).toContain(String(dataUrl.length));
      expect(r.imagem.length).toBeLessThan(80);
      expect(r.nome).toBe('ok');
    });

    it('troca texto muito longo por marcador e preserva texto normal', () => {
      const longo = 'palavra '.repeat(400);
      const r: any = redigirSegredos({ texto: longo, curto: 'Rua das Flores, 123 - Bloco A' });
      expect(r.texto).toContain(String(longo.length));
      expect(r.texto.length).toBeLessThan(80);
      expect(r.curto).toBe('Rua das Flores, 123 - Bloco A');
    });

    it('descarta codigo_acesso, pin e otp sem atingir palavras que os contêm', () => {
      const r: any = redigirSegredos({
        codigo_acesso: '1234',
        codigoAcesso: '1234',
        pin: '9999',
        novo_pin: '1',
        pinAcesso: '2',
        otp: '123456',
        codigoOtp: '3',
        shipping: 'correios',
        opiniao: 'boa',
        captopril: 'x',
        aninhado: { PIN: '0000', manter: 1 },
      });
      expect(Object.keys(r).sort()).toEqual(['aninhado', 'captopril', 'opiniao', 'shipping']);
      expect(r.aninhado).toEqual({ manter: 1 });
    });
  });

  describe('entidade_id', () => {
    it('id não numérico vira null em vez de NaN', async () => {
      const data = await gravar({ url: '/api/condominios/7/visitantes' }, { id: 'abc-123' });
      expect(data.entidade_id).toBeNull();
    });

    it('id não inteiro ou fora do Int vira null', async () => {
      expect((await gravar({ url: '/api/condominios/7/visitantes' }, { id: 1.5 })).entidade_id).toBeNull();
      expect((await gravar({ url: '/api/condominios/7/visitantes' }, { id: '99999999999' })).entidade_id).toBeNull();
    });

    it('id numérico (número ou string) continua gravado', async () => {
      expect((await gravar({ url: '/api/condominios/7/visitantes' }, { id: 42 })).entidade_id).toBe(42);
      expect((await gravar({ url: '/api/condominios/7/visitantes', params: { id: '15' } })).entidade_id).toBe(15);
    });
  });
});

/**
 * O log guardava o autor só por nome e e-mail. `autor_id` + `autor_tipo` dizem
 * quem foi e em qual tabela procurar o id: o `sub` do console do porteiro é
 * Funcionarios_Portaria.id, o do app/síndico é Users.id — numerações diferentes.
 */
describe('AuditInterceptor — autor do registro', () => {
  async function gravar(user: any, body: any = {}) {
    const prisma: any = { isConnected: true, auditLog: { create: jest.fn(async () => ({})) } };
    const reflector: any = { getAllAndOverride: () => false };
    const tenant: any = { assertCondominio: jest.fn(async () => undefined) };
    const interceptor = new AuditInterceptor(prisma, reflector, tenant);
    const ctx: any = {
      switchToHttp: () => ({ getRequest: () => ({ method: 'POST', url: '/api/condominios/7/visitantes', params: {}, body, ip: '10.0.0.1', user }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    };
    await lastValueFrom(interceptor.intercept(ctx, { handle: () => of({ ok: true }) }));
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    return prisma.auditLog.create.mock.calls[0]?.[0]?.data;
  }

  it('porteiro do console: id em Funcionarios_Portaria', async () => {
    const data = await gravar({ sub: 3, nome: 'Porteiro', id_condominio: 7, turno: 'Noite', tipo_sub: 'funcionario_portaria' });
    expect(data).toMatchObject({ autor_id: 3, autor_tipo: 'funcionario_portaria' });
  });

  it('síndico logado no console: id em Users', async () => {
    const data = await gravar({ sub: 42, nome: 'Sindica', id_condominio: 7, turno: 'Síndico', typeAccess: 'Sindico' });
    expect(data).toMatchObject({ autor_id: 42, autor_tipo: 'user' });
  });

  it('token do app (payload aninhado em user): Users.id de user.id, não o sub', async () => {
    const data = await gravar(
      { sub: 999, typeAccess: 'Morador', user: { id: 11, nome: 'Morador', typeAccess: 'Morador' } },
      { id_condominio: 7 },
    );
    expect(data).toMatchObject({ autor_id: 11, autor_tipo: 'user', usuario_nome: 'Morador' });
  });

  it('token de console sem tipo_sub nem typeAccess: tabela do sub desconhecida, não adivinha', async () => {
    const data = await gravar({ sub: 3, nome: 'Antigo', id_condominio: 7 });
    expect(data.id_condominio).toBe(7);
    expect(data.autor_id).toBeNull();
    expect(data.autor_tipo).toBeNull();
  });
});
