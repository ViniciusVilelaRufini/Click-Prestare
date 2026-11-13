/**
 * Visitante com vaga cedida tem usos ilimitados no aparelho (entra e sai com
 * o carro quantas vezes quiser) — mas só enquanto a vaga vale. Com `fim` no
 * passado a vaga seguia `ativo = 1` (nada a encerra) e o visitante continuava
 * com passagens ilimitadas. Agora vaga de visitante vencida conta como inativa.
 */
let FacialService: any;

describe('FacialService — vaga vencida não dá usos ilimitados', () => {
  beforeAll(() => {
    jest.useFakeTimers({ advanceTimers: true });
    process.env.FACIAL_INTEGRATION_ENABLED = 'true';
    jest.isolateModules(() => {
      FacialService = require('./facial.service').FacialService;
    });
  });
  afterAll(() => jest.useRealTimers());

  const device = { id: 900, id_condominio: 1, fabricante: 'intelbras', ativo: 1, tipo: 'facial', sentido: 'entrada' };

  function casa(v: any, where: any): boolean {
    for (const [k, cond] of Object.entries(where ?? {})) {
      if (k === 'OR') {
        if (!(cond as any[]).some((c) => casa(v, c))) return false;
      } else if (cond === null) {
        if (v[k] != null) return false;
      } else if (typeof cond === 'object' && !(cond instanceof Date)) {
        const c = cond as any;
        if ('not' in c && v[k] === c.not) return false;
        if ('gt' in c && !(v[k] != null && v[k] > c.gt)) return false;
      } else if (v[k] !== cond) return false;
    }
    return true;
  }

  function build(fimVaga: Date) {
    const vagas = [{ id: 1, id_visita: 60, id_visitante: null, ativo: 1, tipo_ocupacao: 'visitante', fim: fimVaga }];
    const prisma: any = {
      isConnected: true,
      pessoas: { update: jest.fn() },
      facial_Devices: { findMany: jest.fn(async () => [device]) },
      vagas: { count: jest.fn(async ({ where }: any) => vagas.filter((v) => casa(v, where)).length) },
      regras_Acesso: { findMany: jest.fn(async () => []) },
    };
    const client = {
      enrollPerson: jest.fn(async () => ({ faceId: 'face_1' })),
      updatePerson: jest.fn(async () => undefined),
      removePerson: jest.fn(async () => undefined),
    };
    const svc = new FacialService(
      prisma, client, {} as any, {} as any, {} as any, {} as any,
      { isDeviceOnline: () => true, dispatchCommand: jest.fn() } as any,
      {} as any,
      { autorizouBiometria: jest.fn(async () => true) } as any,
      { autorizouBiometria: jest.fn(async () => true) } as any,
    );
    jest.spyOn(svc as any, 'fetchPhotoAsBase64').mockResolvedValue('base64foto');
    return { svc, client };
  }

  function pessoa() {
    const agora = Date.now();
    return {
      id: 30, id_condominio: 1, nome: 'Visitante', foto_pessoa: 'http://foto.jpg', face_id: null, tipo_pessoa: 'visitante',
      visitas: [{
        id: 60, liberado: 1, bloqueado: 0, is_prestador: 0,
        data_hora_inicio: new Date(agora - 10_000), data_hora_termino: new Date(agora + 3_600_000),
        data_entrada: null, data_saida: null, dias_semana: null,
      }],
    };
  }

  it('vaga dentro do prazo: usos ilimitados (-1)', async () => {
    const { svc, client } = build(new Date(Date.now() + 3_600_000));
    await svc.pushPessoaToDevices(pessoa());
    expect(client.enrollPerson).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userTimes: -1 }));
  });

  it('vaga com fim no passado: contador comum, não ilimitado', async () => {
    const { svc, client } = build(new Date(Date.now() - 60_000));
    await svc.pushPessoaToDevices(pessoa());
    const [, payload] = client.enrollPerson.mock.calls[0];
    expect(payload.userTimes).not.toBe(-1);
  });
});
