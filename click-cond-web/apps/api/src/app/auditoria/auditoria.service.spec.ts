import { Logger } from '@nestjs/common';
import { AuditoriaService } from './auditoria.service';
import { contextoDaRequisicao, requestContext } from '../common/context/request-context';

/**
 * audit_logs identificava o autor só por nome e e-mail (texto livre, que muda e
 * se repete). `autor_id` + `autor_tipo` dizem quem foi e em qual tabela o id vive.
 */
describe('AuditoriaService.registrar — autor', () => {
  function build() {
    const prisma: any = { auditLog: { create: jest.fn(async () => ({})) } };
    return { svc: new AuditoriaService(prisma), prisma };
  }

  const base = { id_condominio: 7, usuario_nome: 'Zé', acao: 'LOGIN' as const, modulo: 'auth', descricao: 'x' };

  it('grava autor_id e autor_tipo quando informados', async () => {
    const { svc, prisma } = build();
    await svc.registrar({ ...base, autor_id: 3, autor_tipo: 'funcionario_portaria' });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ autor_id: 3, autor_tipo: 'funcionario_portaria', acao: 'LOGIN' }),
    });
  });

  it('fora de requisição (job/tick) sem autor informado: sistema, sem id', async () => {
    const { svc, prisma } = build();
    await svc.registrar(base);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ autor_id: null, autor_tipo: 'sistema' }),
    });
  });

  it('falha do banco não propaga', async () => {
    const { svc, prisma } = build();
    prisma.auditLog.create.mockRejectedValue(new Error('Unknown column autor_id'));
    const erro = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await expect(svc.registrar({ ...base, autor_id: 3, autor_tipo: 'funcionario_portaria' })).resolves.toBeUndefined();
    erro.mockRestore();
  });
});

/**
 * Produção: 90 de 101 chamadas de registrar não passavam o autor, e 582 de 711 linhas ficaram sem
 * autor_tipo. O autor vem do token da requisição em curso (AsyncLocalStorage guarda o `req`; o
 * passport preenche req.user depois, no mesmo objeto).
 */
describe('AuditoriaService.registrar — autor derivado da requisição', () => {
  function build() {
    const prisma: any = { auditLog: { create: jest.fn(async () => ({})) } };
    return { svc: new AuditoriaService(prisma), prisma };
  }
  const base = { id_condominio: 7, usuario_nome: 'Sistema / Portaria', acao: 'DELETE' as const, modulo: 'visitas', descricao: 'x' };
  const dados = (prisma: any) => prisma.auditLog.create.mock.calls[0][0].data;

  /** Simula o middleware: contexto criado antes do passport; req.user preenchido depois. */
  async function naRequisicao<T>(user: any, fn: () => Promise<T>): Promise<T> {
    const req: any = { ip: '10.0.0.1', headers: {} };
    return requestContext.run(contextoDaRequisicao(req), async () => {
      req.user = user; // passport, depois do middleware
      return fn();
    });
  }

  it('síndico logado (app): autor user + nome real no lugar do rótulo genérico', async () => {
    const { svc, prisma } = build();
    const sindico = {
      sub: 42,
      typeAccess: 'Sindico',
      user: { id: 42, nome: 'Maria Síndica', email: 'maria@x.com', typeAccess: 'Sindico' },
    };
    await naRequisicao(sindico, () => svc.registrar(base));
    expect(dados(prisma)).toMatchObject({
      autor_id: 42,
      autor_tipo: 'user',
      usuario_nome: 'Maria Síndica',
      usuario_email: 'maria@x.com',
    });
  });

  it('porteiro do console: Funcionarios_Portaria + nome do token', async () => {
    const { svc, prisma } = build();
    const porteiro = { sub: 3, nome: 'João Porteiro', id_condominio: 7, tipo_sub: 'funcionario_portaria' };
    await naRequisicao(porteiro, () => svc.registrar({ ...base, usuario_nome: 'Portaria' }));
    expect(dados(prisma)).toMatchObject({ autor_id: 3, autor_tipo: 'funcionario_portaria', usuario_nome: 'João Porteiro' });
  });

  it.each(['Sistema', 'Sistema / Portaria', 'Portaria / Sistema', 'Portaria', 'Morador', 'sistema'])(
    'rótulo genérico "%s" vira o nome do token',
    async (rotulo) => {
      const { svc, prisma } = build();
      await naRequisicao({ sub: 3, nome: 'Ana', tipo_sub: 'funcionario_portaria' }, () =>
        svc.registrar({ ...base, usuario_nome: rotulo }),
      );
      expect(dados(prisma).usuario_nome).toBe('Ana');
    },
  );

  it('nome específico do chamador é mantido', async () => {
    const { svc, prisma } = build();
    await naRequisicao({ sub: 3, nome: 'Ana', tipo_sub: 'funcionario_portaria' }, () =>
      svc.registrar({ ...base, usuario_nome: 'Carlos (visitante)' }),
    );
    expect(dados(prisma).usuario_nome).toBe('Carlos (visitante)');
  });

  it('autor explícito do chamador é respeitado', async () => {
    const { svc, prisma } = build();
    await naRequisicao({ sub: 3, nome: 'Ana', tipo_sub: 'funcionario_portaria' }, () =>
      svc.registrar({ ...base, autor_id: 99, autor_tipo: 'user', usuario_nome: 'Zé' }),
    );
    expect(dados(prisma)).toMatchObject({ autor_id: 99, autor_tipo: 'user', usuario_nome: 'Zé' });
  });

  it('requisição sem usuário autenticado: sistema e nome do chamador intocado', async () => {
    const { svc, prisma } = build();
    await naRequisicao(undefined, () => svc.registrar(base));
    expect(dados(prisma)).toMatchObject({
      autor_id: null,
      autor_tipo: 'sistema',
      usuario_nome: 'Sistema / Portaria',
      usuario_email: null,
    });
  });

  it('manterNome: nome de aparelho ("Portaria") não vira o nome do operador logado', async () => {
    const { svc, prisma } = build();
    await naRequisicao({ sub: 3, nome: 'Ana', email: 'ana@x.com', tipo_sub: 'funcionario_portaria' }, () =>
      svc.registrar({ ...base, usuario_nome: 'Portaria', manterNome: true }),
    );
    expect(dados(prisma)).toMatchObject({ usuario_nome: 'Portaria', usuario_email: null, autor_id: 3 });
  });

  it('e-mail explícito do chamador não é trocado', async () => {
    const { svc, prisma } = build();
    await naRequisicao({ sub: 3, nome: 'Ana', email: 'ana@x.com', tipo_sub: 'funcionario_portaria' }, () =>
      svc.registrar({ ...base, usuario_email: 'outro@x.com' }),
    );
    expect(dados(prisma).usuario_email).toBe('outro@x.com');
  });
});

describe('AuditoriaService.registrar — redação e limites', () => {
  function build() {
    const prisma: any = { auditLog: { create: jest.fn(async () => ({})) } };
    return { svc: new AuditoriaService(prisma), prisma };
  }
  const base = { id_condominio: 7, usuario_nome: 'Zé', acao: 'CREATE' as const, modulo: 'visitantes', descricao: 'x' };
  const dados = (prisma: any) => prisma.auditLog.create.mock.calls[0][0].data;

  it('mascara CPF e telefone e omite segredos nos detalhes', async () => {
    const { svc, prisma } = build();
    await svc.registrar({
      ...base,
      detalhes: { nome: 'Carlos', documento: '45346648852', senha: 'x', visitante: { telefone: '17996608148' } },
    });
    const det = dados(prisma).detalhes as string;
    expect(det).not.toContain('45346648852');
    expect(det).not.toContain('17996608148');
    expect(det).not.toContain('senha');
    expect(JSON.parse(det)).toMatchObject({ nome: 'Carlos', documento: '***.***.*88-52' });
  });

  it('detalhes grandes viram JSON válido de até 2000 caracteres', async () => {
    const { svc, prisma } = build();
    const detalhes: any = {};
    for (let i = 0; i < 40; i++) detalhes['campo_' + i] = 'x'.repeat(100);
    await svc.registrar({ ...base, detalhes });
    const det = dados(prisma).detalhes as string;
    expect(det.length).toBeLessThanOrEqual(2000);
    expect(JSON.parse(det)._truncado).toBe(true);
  });

  it('sem detalhes continua null', async () => {
    const { svc, prisma } = build();
    await svc.registrar(base);
    expect(dados(prisma).detalhes).toBeNull();
  });

  it('corta os campos no tamanho da coluna', async () => {
    const { svc, prisma } = build();
    await svc.registrar({
      ...base,
      usuario_nome: 'n'.repeat(400),
      usuario_email: 'e'.repeat(400),
      acao: 'A'.repeat(80) as any,
      modulo: 'm'.repeat(150),
      descricao: 'd'.repeat(5000),
      ip: '1'.repeat(80),
    });
    const d = dados(prisma);
    expect(d.usuario_nome).toHaveLength(255);
    expect(d.usuario_email).toHaveLength(255);
    expect(d.acao).toHaveLength(50);
    expect(d.modulo).toHaveLength(100);
    expect(d.descricao).toHaveLength(2000);
    expect(d.ip.length).toBeLessThanOrEqual(45);
  });
});

describe('AuditoriaService.registrar — falha de gravação', () => {
  it('loga ERROR padronizado (o alarme conta linhas ERROR), sem os detalhes, e não lança', async () => {
    const prisma: any = {
      auditLog: {
        create: jest.fn(async () => {
          throw new Error('Data too long for column');
        }),
      },
    };
    const svc = new AuditoriaService(prisma);
    const erro = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await expect(
      svc.registrar({
        id_condominio: 7,
        usuario_nome: 'Zé',
        acao: 'CREATE',
        modulo: 'visitas',
        descricao: 'x',
        detalhes: { observacao: 'MARCADOR123' },
      }),
    ).resolves.toBeUndefined();
    expect(erro).toHaveBeenCalledTimes(1);
    const msg = String(erro.mock.calls[0][0]);
    expect(msg).toMatch(/^AUDITORIA_FALHA modulo=visitas acao=CREATE: .*Data too long/);
    expect(msg).not.toContain('MARCADOR123');
    erro.mockRestore();
  });
});

/** O contexto da requisição não segura o `req` (corpo de até 35 MB) em recursos assíncronos longos. */
describe('contextoDaRequisicao', () => {
  it('guarda ip, user-agent e só uma referência fraca ao req', () => {
    const req: any = { ip: '::ffff:10.0.0.9', headers: { 'user-agent': 'UA' }, body: { grande: 'x' } };
    const ctx: any = contextoDaRequisicao(req);
    expect(ctx).not.toHaveProperty('req');
    expect(ctx.ip).toBe('10.0.0.9');
    expect(ctx.userAgent).toBe('UA');
    expect(ctx.reqRef).toBeInstanceOf(WeakRef);
    req.user = { sub: 1 };
    expect(ctx.reqRef.deref().user).toEqual({ sub: 1 });
  });
});
