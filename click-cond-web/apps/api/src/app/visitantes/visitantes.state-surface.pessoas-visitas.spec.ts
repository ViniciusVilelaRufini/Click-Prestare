import { isAutorizacaoAtual, VisitantesService } from './visitantes.service';
import { PessoasService } from '../pessoas/pessoas.service';
import { VisitasService } from '../visitas/visitas.service';

function buildStateHarness() {
  // A janela de validade é calculada em relação a "agora" — não a uma data
  // fixa — para que o teste continue exercendo o comportamento real (PIN
  // dentro do período) em vez de apodrecer no dia seguinte ao em que foi
  // escrito.
  const agora = Date.now();
  const inicioVigencia = new Date(agora - 4 * 60 * 60 * 1000); // 4h atrás
  const terminoVigencia = new Date(agora + 4 * 60 * 60 * 1000); // 4h à frente

  const pessoas: any[] = [
    {
      id: 10,
      id_condominio: 1,
      nome: 'Mariana Lima',
      doc_identificacao: '12345678900',
      tipo_pessoa: 'visitante',
      face_id: 'face-mariana',
      bloqueado: 0,
      foto_pessoa: 'https://cdn.exemplo.com/mariana.jpg',
      foto_documento: null,
    },
  ];

  const visitas: any[] = [
    {
      id: 50,
      id_pessoa: 10,
      id_condominio: 1,
      id_apartamento: 101,
      user: 1,
      is_visitante: 1,
      is_prestador: 0,
      liberado: 1,
      bloqueado: 0,
      codigo_acesso: '123456',
      data_hora_inicio: inicioVigencia,
      data_hora_termino: terminoVigencia,
      data_entrada: null,
      data_saida: null,
      auth_status: null,
      auth_solicitado_em: null,
      auth_respondido_em: null,
      auth_respondido_por: null,
      created_at: inicioVigencia,
      updated_at: inicioVigencia,
    },
  ];

  const prisma: any = {
    isConnected: true,
    visitantes: {
      checkIn: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    pessoas: {
      findUnique: jest.fn(async ({ where }: any) => pessoas.find((p) => p.id === where.id) ?? null),
      findFirst: jest.fn(async ({ where }: any) => {
        return (
          pessoas.find((p) => {
            if (p.id_condominio !== where.id_condominio) return false;
            if (where.doc_identificacao) return p.doc_identificacao === where.doc_identificacao;
            if (where.face_id) return p.face_id === where.face_id;
            return false;
          }) ?? null
        );
      }),
      findMany: jest.fn(async () => pessoas),
    },
    visitas: {
      findUnique: jest.fn(async ({ where, include }: any) => {
        const v = visitas.find((x) => x.id === where.id);
        if (!v) return null;
        const res: any = { ...v };
        if (include?.pessoa) res.pessoa = pessoas.find((p) => p.id === v.id_pessoa);
        if (include?.apartamento) res.apartamento = { id: v.id_apartamento, bloco: 'A', apto: '101' };
        if (include?.criadoPor) res.criadoPor = { id: v.user, name: 'Morador Teste' };
        if (include?.condominio) res.condominio = { nome: 'Condomínio Solar' };
        return res;
      }),
      findFirst: jest.fn(async ({ where, include }: any) => {
        const v = visitas.find((x) => {
          if (where.id_condominio && x.id_condominio !== where.id_condominio) return false;
          if (where.codigo_acesso && x.codigo_acesso !== where.codigo_acesso) return false;
          if (where.data_saida === null && x.data_saida !== null) return false;
          return true;
        });
        if (!v) return null;
        const res: any = { ...v };
        if (include?.pessoa) res.pessoa = pessoas.find((p) => p.id === v.id_pessoa);
        if (include?.apartamento) res.apartamento = { id: v.id_apartamento, bloco: 'A', apto: '101' };
        if (include?.criadoPor) res.criadoPor = { id: v.user, name: 'Morador Teste' };
        return res;
      }),
      findMany: jest.fn(async ({ where }: any) => {
        return visitas.filter((v) => {
          if (where?.id_condominio && v.id_condominio !== where.id_condominio) return false;
          if (where?.id_pessoa && v.id_pessoa !== where.id_pessoa) return false;
          if (where?.id_apartamento?.in && !where.id_apartamento.in.includes(v.id_apartamento)) return false;
          if (where?.NOT?.id && v.id === where.NOT.id) return false;
          return true;
        }).map((v) => ({
          ...v,
          pessoa: pessoas.find((p) => p.id === v.id_pessoa),
          apartamento: { id: v.id_apartamento, bloco: 'A', apto: '101' },
          condominio: { nome: 'Condomínio Solar' },
        }));
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const v = visitas.find((x) => x.id === where.id);
        if (!v) throw new Error('Not found');
        Object.assign(v, data);
        return {
          ...v,
          pessoa: pessoas.find((p) => p.id === v.id_pessoa),
          apartamento: { id: v.id_apartamento, bloco: 'A', apto: '101' },
        };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const v of visitas) {
          if (where.id_condominio && v.id_condominio !== where.id_condominio) continue;
          if (where.id_pessoa && v.id_pessoa !== where.id_pessoa) continue;
          if (where.id?.not && v.id === where.id.not) continue;
          Object.assign(v, data);
          count++;
        }
        return { count };
      }),
    },
    vagas: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    apartamentos: {
      findUnique: jest.fn().mockResolvedValue({ id: 101, id_condominio: 1 }),
    },
    apartamentos_Users: {
      findMany: jest.fn().mockResolvedValue([{ id_apto: 101 }]),
      findFirst: jest.fn().mockResolvedValue({ id_apto: 101 }),
    },
    users: {
      findMany: jest.fn().mockResolvedValue([{ id: 1, name: 'Morador', phone: '11999999999', fcm_token: 'token1234567890' }]),
      findUnique: jest.fn().mockResolvedValue({ id: 1, name: 'Morador' }),
    },
    acessos_Facial: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    facial_Devices: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  const pessoasService = new PessoasService(prisma);
  const visitasService = new VisitasService(prisma, pessoasService);

  const auditoria: any = { registrar: jest.fn() };
  const notifications: any = { sendPushNotification: jest.fn(), sendWhatsApp: jest.fn() };
  const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
  const facial: any = {
    syncVisitante: jest.fn().mockResolvedValue({}),
    syncPessoa: jest.fn().mockResolvedValue({}),
  };
  const tenant: any = {
    assertCondominio: jest.fn().mockResolvedValue(true),
    assertPermissaoFuncionario: jest.fn().mockResolvedValue(true),
  };
  const realtime: any = {
    emitToCondominio: jest.fn(),
  };

  const service = new VisitantesService(
    prisma,
    notifications,
    storage,
    facial,
    auditoria,
    tenant,
    realtime,
    visitasService,
  );

  return { service, prisma, pessoas, visitas, facial, auditoria, realtime };
}

describe('VisitantesService — ações de estado e leituras Pessoas/Visitas (Task 5)', () => {
  it('considera autorização antiga expirada e autorização recente válida', () => {
    const agora = Date.now();
    expect(isAutorizacaoAtual({ auth_status: 'autorizado', auth_respondido_em: new Date(agora - 11 * 60 * 1000) }, agora)).toBe(false);
    expect(isAutorizacaoAtual({ auth_status: 'autorizado', auth_respondido_em: new Date(agora - 2 * 60 * 1000) }, agora)).toBe(true);
  });

  const originalFlag = process.env['PESSOAS_MIGRATION_ENABLED'];

  afterEach(() => {
    if (originalFlag === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = originalFlag;
  });

  describe('com PESSOAS_MIGRATION_ENABLED=true', () => {
    beforeEach(() => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    });

    it('checkIn() atualiza visitas, dispara syncPessoa e emite evento realtime', async () => {
      const { service, prisma, facial, auditoria, realtime } = buildStateHarness();
      const payload: any = { id_condominio: 1, sub: 99, nome: 'Portaria' };

      const res = await service.checkIn(50, payload);

      expect(res).toEqual({ ok: true });
      expect(prisma.visitas.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 50 },
          data: expect.objectContaining({
            data_entrada: expect.any(Date),
            data_saida: null,
            liberado: 1,
            user: 99,
          }),
        }),
      );
      expect(facial.syncPessoa).toHaveBeenCalledWith(10);
      expect(realtime.emitToCondominio).toHaveBeenCalledWith(1, 'visitante.checkin', { id: 50 });
      expect(auditoria.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          acao: 'CHECK_IN',
          modulo: 'visitas',
          entidade_id: 50,
        }),
      );
    });

    it('liberarAcesso() atualiza visitas.liberado=1 e revoga outros códigos da mesma pessoa', async () => {
      const { service, prisma, facial, auditoria } = buildStateHarness();
      const payload: any = { id_condominio: 1, sub: 99, nome: 'Portaria' };

      const res = await service.liberarAcesso(50, payload);

      expect(res).toEqual({ ok: true });
      expect(prisma.visitas.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 50 },
          data: expect.objectContaining({
            liberado: 1,
            data_entrada: null,
            data_saida: null,
          }),
        }),
      );
      expect(prisma.visitas.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id_pessoa: 10,
            id: { not: 50 },
          }),
          data: {
            liberado: 0,
            codigo_acesso: null,
          },
        }),
      );
      expect(facial.syncPessoa).toHaveBeenCalledWith(10);
      expect(auditoria.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          acao: 'UPDATE',
          modulo: 'visitas',
          entidade_id: 50,
        }),
      );
    });

    it('checkOut() encerra visita, desocupa vaga por id_visita e chama syncPessoa', async () => {
      const { service, prisma, facial, auditoria } = buildStateHarness();
      const payload: any = { id_condominio: 1, sub: 99, nome: 'Portaria' };

      const res = await service.checkOut(50, payload);

      expect(res).toEqual({ ok: true });
      expect(prisma.visitas.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 50 },
          data: expect.objectContaining({
            data_saida: expect.any(Date),
            codigo_acesso: null,
            liberado: 0,
          }),
        }),
      );
      expect(prisma.vagas.updateMany).toHaveBeenCalledWith({
        where: { id_visita: 50 },
        data: { ativo: 0, id_visita: null, placa: null },
      });
      expect(facial.syncPessoa).toHaveBeenCalledWith(10);
      expect(auditoria.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          acao: 'CHECK_OUT',
          modulo: 'visitas',
          entidade_id: 50,
        }),
      );
    });

    it('solicitarAutorizacao(), autorizar() e negar() controlam auth_status', async () => {
      const { service, prisma, facial, realtime } = buildStateHarness();
      const payload: any = { id_condominio: 1, sub: 1, user: { id: 1, name: 'Morador' } };

      // Solicitar
      await service.solicitarAutorizacao(50, payload);
      expect(prisma.visitas.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ auth_status: 'pendente', liberado: 0 }),
        }),
      );
      expect(realtime.emitToCondominio).toHaveBeenCalledWith(1, 'visitante.autorizacao_solicitada', { id: 50 });

      // Autorizar com entrada
      await service.autorizar(50, payload, true);
      expect(prisma.visitas.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ auth_status: 'autorizado', liberado: 1, data_entrada: expect.any(Date) }),
        }),
      );
      expect(facial.syncPessoa).toHaveBeenCalledWith(10);

      // Negar
      await service.negar(50, payload);
      expect(prisma.visitas.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ auth_status: 'negado', liberado: 0 }),
        }),
      );
      expect(realtime.emitToCondominio).toHaveBeenCalledWith(1, 'visitante.negado', { id: 50 });
    });

    it('validarCodigo() valida PIN na tabela Visitas + Pessoas e retorna LGPD sanitizado', async () => {
      const { service } = buildStateHarness();

      const res = await service.validarCodigo(1, '123456');

      expect(res).toEqual(
        expect.objectContaining({
          id: 50,
          nome: 'Mariana Lima',
          doc_identificacao: '12345678900',
          apto: '101',
          apto_bloco: 'A',
          codigo_acesso: null,
          temPinAtivo: true,
          status_vigencia: 'ATIVO',
        }),
      );
    });

    it('findOne() devolve contrato v75 com dados mesclados de Visita e Pessoa', async () => {
      const { service } = buildStateHarness();
      const payload: any = { id_condominio: 1, sub: 99 };

      const res = await service.findOne(50, payload);

      expect(res).toEqual(
        expect.objectContaining({
          id: 50,
          nome: 'Mariana Lima',
          doc_identificacao: '12345678900',
          id_apartamento: 101,
          apartamento: { id: 101, bloco: 'A', apto: '101' },
          face_id: 'face-mariana',
        }),
      );
    });

    it('detalhes() retorna perfil, timeline e estatísticas via Pessoas/Visitas', async () => {
      const { service } = buildStateHarness();
      const payload: any = { id_condominio: 1, sub: 99 };

      const res = await service.detalhes(50, payload);

      expect(res).toHaveProperty('visitante');
      expect(res).toHaveProperty('stats');
      expect(res).toHaveProperty('timeline');
      expect(res.visitante.id).toBe(50);
      expect(res.visitante.nome).toBe('Mariana Lima');
      expect(res.visitante.doc_identificacao).toBe('12345678900');
    });

    it('findAll() retorna lista mapeada com pessoa e apartamento', async () => {
      const { service } = buildStateHarness();

      const res = await service.findAll(1);

      expect(res.length).toBe(1);
      expect(res[0]).toEqual(
        expect.objectContaining({
          id: 50,
          nome: 'Mariana Lima',
          doc_identificacao: '12345678900',
          apartamento: { id: 101, bloco: 'A', apto: '101' },
        }),
      );
    });

    it('listarPendentes() filtra solicitações pendentes recentes', async () => {
      const { service, prisma } = buildStateHarness();
      const payload: any = { sub: 1, user: { id: 1 } };
      // Marca como pendente
      await prisma.visitas.update({
        where: { id: 50 },
        data: { auth_status: 'pendente', auth_solicitado_em: new Date() },
      });

      const res = await service.listarPendentes(1, payload);

      expect(res.length).toBe(1);
      expect(res[0]).toEqual(
        expect.objectContaining({
          id: 50,
          nome: 'Mariana Lima',
          apto: '101',
          apto_bloco: 'A',
        }),
      );
    });

    it('findAllMobile() retorna visitas mapeadas com isolamento de apartamento do usuário', async () => {
      const { service } = buildStateHarness();

      const res = await service.findAllMobile(1, undefined, undefined, 0, 1);

      expect(res.length).toBe(1);
      expect(res[0]).toEqual(
        expect.objectContaining({
          id: 50,
          nome: 'Mariana Lima',
          condominio_nome: 'Condomínio Solar',
          codigo_acesso: null,
        }),
      );
    });

    it('findAllMobile() migrado não cria PIN durante uma leitura', async () => {
      const { service, prisma } = buildStateHarness();
      prisma.visitas.findMany.mockResolvedValue([{
        id: 51, id_pessoa: 10, id_condominio: 1, id_apartamento: 101,
        codigo_acesso: null, data_saida: null,
        data_hora_inicio: new Date(), data_hora_termino: new Date(Date.now() + 3600000),
        pessoa: { id: 10, nome: 'Mariana Lima', tipo_pessoa: 'visitante' },
        apartamento: { bloco: 'A', apto: '101' }, condominio: { nome: 'Condomínio Solar' },
      }]);

      const res = await service.findAllMobile(1, undefined, undefined, 0, 1);

      expect(res).toHaveLength(1);
      expect(res[0].codigo_acesso).toBeNull();
      expect(prisma.visitas.update).not.toHaveBeenCalled();
    });

    it('checkIn() rejeita autorização migrada expirada', async () => {
      const { service, prisma } = buildStateHarness();
      prisma.visitas.findUnique.mockResolvedValue({
        id: 50, id_condominio: 1, id_apartamento: 101, id_pessoa: 10,
        auth_status: 'autorizado',
        auth_respondido_em: new Date(Date.now() - 11 * 60 * 1000),
        data_entrada: null, data_saida: null, bloqueado: 0,
        pessoa: { id: 10, nome: 'Mariana Lima', bloqueado: 0 },
      });

      await expect(service.checkIn(50, { sub: 1, id_condominio: 1 } as any))
        .rejects.toThrow(/expirada/i);
      expect(prisma.visitas.update).not.toHaveBeenCalled();
    });
  });

  describe('com PESSOAS_MIGRATION_ENABLED=false (default)', () => {
    beforeEach(() => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
    });

    it('checkIn() e liberarAcesso() continuam delegando para a tabela legada Visitantes', async () => {
      const { service, prisma } = buildStateHarness();
      prisma.visitantes.findUnique.mockResolvedValue({
        id: 77,
        id_condominio: 1,
        id_apartamento: 101,
        nome: 'Legado',
        bloqueado: 0,
        auth_status: null,
      });
      prisma.visitantes.update.mockResolvedValue({
        id: 77,
        id_condominio: 1,
        id_apartamento: 101,
        nome: 'Legado',
        is_prestador: 0,
      });

      const res = await service.checkIn(77, { id_condominio: 1, sub: 1 } as any);

      expect(res).toEqual({ ok: true });
      expect(prisma.visitantes.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 77 },
        }),
      );
      expect(prisma.visitas.update).not.toHaveBeenCalled();
    });

    it('findAllMobile() legado não cria PIN durante uma leitura', async () => {
      const { service, prisma } = buildStateHarness();
      prisma.visitantes.findMany.mockResolvedValue([{
        id: 88, id_condominio: 1, id_apartamento: 101, nome: 'QA legado',
        codigo_acesso: null, data_saida: null,
        apartamento: { bloco: 'A', apto: '101' }, condominio: { nome: 'Condomínio Solar' },
      }]);

      const res = await service.findAllMobile(1, undefined, undefined, 0, 1);

      expect(res).toHaveLength(1);
      expect(res[0].codigo_acesso).toBeNull();
      expect(prisma.visitantes.update).not.toHaveBeenCalled();
      expect(prisma.visitantes.findFirst).not.toHaveBeenCalled();
    });
  });
});
