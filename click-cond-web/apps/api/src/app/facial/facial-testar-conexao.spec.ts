import { FacialService } from './facial.service';
import { FacialController } from './facial.controller';

/**
 * "Testar conexão" (POST facial/devices/:id/test) com diagnóstico:
 *  - devolve `{ online, motivo, detalhe?, mensagem }` — `mensagem` é o texto
 *    pronto para o operador, por motivo; `online` segue para a tela atual;
 *  - quando quem está fora é o AGENTE (ou a marca nem fala HTTP) não sabemos o
 *    estado do aparelho: NÃO grava a transição de status (que registraria o
 *    aparelho como offline e poderia abrir ocorrência indevida).
 *
 * Mocks, sem banco e sem aparelho.
 */
describe('FacialService.testDevice — diagnóstico da conexão', () => {
  const DEVICE = {
    id: 5,
    id_condominio: 10,
    nome: 'Facial Portaria',
    tipo: 'facial',
    fabricante: 'intelbras',
    ip: '192.168.3.175',
    porta: 80,
    api_user: 'admin',
    api_password: null,
    id_area_social: null,
  };

  function build(diagnostico: any) {
    const prisma: any = {
      facial_Devices: { findUnique: jest.fn(async () => ({ ...DEVICE })) },
      areas_Sociais: { findMany: jest.fn(async () => []) },
    };
    const client: any = {
      diagnosticar: jest.fn(async () => diagnostico),
      ping: jest.fn(async () => {
        throw new Error('testDevice não deve mais usar ping()');
      }),
    };
    const svc = new FacialService(
      prisma, client, null as any, null as any, null as any,
      null as any, null as any, null as any, null as any, null as any,
    );
    const transicao = jest
      .spyOn(svc as any, 'handleDeviceStatusTransition')
      .mockResolvedValue(undefined);
    return { svc, client, transicao };
  }

  it('sucesso: online, sem motivo, e grava a transição para online', async () => {
    const { svc, client, transicao } = build({ ok: true, motivo: null });

    const r = await svc.testDevice(5);

    expect(r).toEqual({ online: true, motivo: null, mensagem: 'Aparelho respondeu normalmente.' });
    expect(client.diagnosticar).toHaveBeenCalledWith(
      expect.objectContaining({ id: 5, ip: '192.168.3.175', porta: 80, fabricante: 'intelbras' }),
    );
    expect(transicao).toHaveBeenCalledTimes(1);
    expect(transicao).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }), true, true);
  });

  it.each([
    [
      'credencial_invalida',
      'O aparelho respondeu, mas recusou o usuário ou a senha. Confira as credenciais cadastradas.',
    ],
    [
      'sem_resposta',
      'O aparelho não respondeu nesse endereço. Confira o IP, o cabo de rede e se ele está ligado.',
    ],
    ['recusado', 'Há um equipamento nesse IP, mas a porta informada está fechada. Confira a porta.'],
    [
      'protocolo_inesperado',
      'O equipamento respondeu de um jeito inesperado para esta marca. Confira se o fabricante selecionado está correto.',
    ],
  ])('%s: offline com a mensagem do motivo, e a transição para offline é mantida', async (motivo, mensagem) => {
    const { svc, transicao } = build({ ok: false, motivo, detalhe: 'HTTP 401' });

    const r = await svc.testDevice(5);

    expect(r).toEqual({ online: false, motivo, detalhe: 'HTTP 401', mensagem });
    expect(transicao).toHaveBeenCalledTimes(1);
    expect(transicao).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }), false, true);
  });

  it.each([
    [
      'agente_offline',
      'O Agente Local deste condomínio não está conectado. Verifique se o computador da portaria está ligado e com internet.',
    ],
    ['marca_sem_http', 'Esta marca não é controlada pela rede por aqui; o teste de conexão não se aplica.'],
  ])('%s: offline com a mensagem do motivo e SEM transição de status', async (motivo, mensagem) => {
    const { svc, transicao } = build({ ok: false, motivo });

    const r = await svc.testDevice(5);

    expect(r).toEqual({ online: false, motivo, mensagem });
    expect(r).not.toHaveProperty('detalhe');
    expect(transicao).not.toHaveBeenCalled();
  });

  it('a rota POST devices/:id/test repassa o objeto inteiro do service', async () => {
    const resposta = {
      online: false,
      motivo: 'recusado',
      detalhe: 'connect ECONNREFUSED',
      mensagem: 'Há um equipamento nesse IP, mas a porta informada está fechada. Confira a porta.',
    };
    const service: any = {
      getDevice: jest.fn(async () => ({ id: 5, id_condominio: 10 })),
      testDevice: jest.fn(async () => resposta),
    };
    const ctrl = new FacialController(service, null as any, null as any, null as any);

    await expect(ctrl.test(5, { sub: 3, id_condominio: 10 } as any)).resolves.toBe(resposta);
  });
});
