import { VisitantesService } from './visitantes.service';

/**
 * O cadastro na portaria só tinha "Cadastrar e liberar": a visita nascia
 * liberada, com PIN, rosto enrolado e push de "chegou" para o morador. Quem
 * queria pedir autorização clicava depois em Solicitar — o morador recebia um
 * segundo aviso contraditório, e o visitante já estava liberado.
 * "Cadastrar e pedir autorização" cria sem liberação, sem PIN, sem facial e
 * sem o push de chegada, e dispara o pedido ao morador da unidade.
 */
describe('create (Pessoas/Visitas) — Cadastrar e pedir autorização', () => {
  const original = process.env['PESSOAS_MIGRATION_ENABLED'];
  beforeEach(() => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
  });
  afterEach(() => {
    if (original === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = original;
  });

  function montar() {
    const prisma: any = {
      isConnected: true,
      pessoas: {},
      visitas: {},
      users: { findMany: jest.fn(async () => [{ fcm_token: 'tok', name: 'Morador', phone: null }]) },
    };
    const notifications: any = { sendPushNotification: jest.fn(), sendWhatsApp: jest.fn() };
    const visitasService: any = {
      criarVisita: jest.fn(async (dados: any) => ({
        id: 1000300,
        id_pessoa: 2000300,
        id_condominio: 1,
        id_apartamento: dados.id_apartamento,
        is_visitante: 1,
        is_prestador: 0,
        liberado: dados.liberado,
        codigo_acesso: dados.codigo_acesso,
        pessoa: { id: 2000300, nome: 'QA_Pedir', tipo_pessoa: 'visitante', foto_pessoa: 'https://f/x.jpg' },
        apartamento: { bloco: 'A', apto: '106' },
      })),
    };
    const tenant: any = { assertPermissaoFuncionario: jest.fn(async () => undefined) };
    const svc = new VisitantesService(
      prisma, notifications, { isDataUrl: () => false } as any, {} as any, { registrar: jest.fn() } as any, tenant,
      { emitToCondominio: jest.fn() } as any, visitasService,
    );
    const s = svc as any;
    jest.spyOn(s, 'assertPodeUsarApartamento').mockResolvedValue(undefined);
    jest.spyOn(s, 'verificarSeBloqueadoPessoa').mockResolvedValue(false);
    jest.spyOn(s, 'aptosDoMoradorMobile').mockResolvedValue(undefined);
    jest.spyOn(s, 'resolveFoto').mockImplementation(async (v: any) => v ?? null);
    jest.spyOn(s, 'gerarPinUnicoVisita').mockResolvedValue('123456');
    jest.spyOn(s, 'desativarOutrosCodigosVisita').mockResolvedValue(undefined);
    jest.spyOn(s, 'fireFacialSyncPessoa').mockImplementation(() => undefined);
    jest.spyOn(s, 'solicitarAutorizacaoViaPessoasVisitas').mockResolvedValue({ ok: true });
    return { svc, s, prisma, visitasService, notifications };
  }

  const porteiro = { sub: 3, nome: 'QA porteiro', id_condominio: 1, turno: 'Diurno' } as any;
  const dto = {
    nome: 'QA_Pedir',
    id_apartamento: 106,
    id_condominio: 1,
    foto_pessoa: 'https://f/x.jpg',
    data_hora_inicio: '2026-11-13 10:00',
    data_hora_termino: '2026-11-13 14:00',
  };

  it('pedir autorização: sem liberação, sem PIN, sem facial, sem push de chegada; dispara o pedido', async () => {
    const { svc, s, prisma, visitasService, notifications } = montar();
    await svc.create({ ...dto, pedir_autorizacao: true } as any, porteiro);
    const dados = visitasService.criarVisita.mock.calls[0][0];
    expect(dados.liberado).toBe(0);
    expect(dados.codigo_acesso).toBeNull();
    expect(prisma.users.findMany).not.toHaveBeenCalled();
    expect(notifications.sendPushNotification).not.toHaveBeenCalled();
    expect(s.fireFacialSyncPessoa).not.toHaveBeenCalled();
    expect(s.desativarOutrosCodigosVisita).not.toHaveBeenCalled();
    expect(s.solicitarAutorizacaoViaPessoasVisitas).toHaveBeenCalledWith(1000300, porteiro);
  });

  it('Cadastrar e liberar continua igual', async () => {
    const { svc, s, visitasService, notifications } = montar();
    await svc.create({ ...dto } as any, porteiro);
    const dados = visitasService.criarVisita.mock.calls[0][0];
    expect(dados.liberado).toBe(1);
    expect(dados.codigo_acesso).toBe('123456');
    expect(notifications.sendPushNotification).toHaveBeenCalled();
    expect(s.fireFacialSyncPessoa).toHaveBeenCalledWith(2000300);
    expect(s.solicitarAutorizacaoViaPessoasVisitas).not.toHaveBeenCalled();
  });

  it('morador não usa o fluxo (o pedido é ação da portaria)', async () => {
    const { svc, s, visitasService } = montar();
    const morador = { sub: 50, nome: 'Morador', typeAccess: 'Morador' } as any;
    await svc.create({ ...dto, pedir_autorizacao: true } as any, morador);
    expect(visitasService.criarVisita.mock.calls[0][0].liberado).toBe(1);
    expect(s.solicitarAutorizacaoViaPessoasVisitas).not.toHaveBeenCalled();
  });
});
