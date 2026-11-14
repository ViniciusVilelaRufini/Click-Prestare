import { BadRequestException } from '@nestjs/common';
import { MoradoresService } from './moradores.service';

/**
 * B3: o cadastro gravava Users e Apartamentos_Users fora de transação. Se o Moradores falhava
 * (texto longo demais, por exemplo), ficavam a conta e o vínculo órfãos: o card da unidade contava
 * "1 morador" e o painel aparecia vazio. Agora as três escritas vão na mesma transação.
 */
describe('MoradoresService.create — Users, vínculo e Moradores numa transação (B3)', () => {
  function harness(moradoresCreate: jest.Mock) {
    const tx: any = {
      users: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 99 }), update: jest.fn() },
      apartamentos: { findUnique: jest.fn().mockResolvedValue({ id: 10, id_condominio: 1, bloco: 'A', apto: '101' }) },
      apartamentos_Users: { create: jest.fn().mockResolvedValue({}) },
      moradores: { create: moradoresCreate },
    };
    const prisma: any = {
      isConnected: true,
      $transaction: jest.fn(async (fn: any) => fn(tx)),
      apartamentos: { findUnique: jest.fn().mockResolvedValue({ id: 10, id_condominio: 1, bloco: 'A', apto: '101' }) },
      // Fora da transação só leituras: as escritas direto no prisma estouram o teste.
      users: { create: jest.fn(() => { throw new Error('escrita fora da transação'); }) },
      apartamentos_Users: { create: jest.fn(() => { throw new Error('escrita fora da transação'); }) },
      funcionarios_Portaria: { count: jest.fn().mockResolvedValue(0) },
      moradores: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({ id: 1, nome: 'X', id_user: 99, user: { photo: null, apartamentosUsers: [] } }),
      },
      visitantes: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new MoradoresService(
      prisma,
      { sendWelcomeMorador: jest.fn().mockResolvedValue({}) } as any,
      { isDataUrl: () => false, exigirArquivoDoRegistro: jest.fn(async () => undefined) } as any,
      { syncMorador: jest.fn().mockResolvedValue({}) } as any,
      { registrar: jest.fn().mockResolvedValue({}) } as any,
      { enviarMorador: jest.fn().mockResolvedValue({ enviado: false }) } as any,
    );
    return { service, prisma, tx };
  }

  it('conta, vínculo e cadastro saem pela mesma transação', async () => {
    const { service, prisma, tx } = harness(jest.fn(async ({ data }: any) => ({ id: 1, ...data })));
    await service.create({ nome: 'Ana', id_apartamento: 10, id_condominio: 1 } as any);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.users.create).toHaveBeenCalled();
    expect(tx.apartamentos_Users.create).toHaveBeenCalled();
    expect(tx.moradores.create).toHaveBeenCalled();
  });

  it('Moradores que falha derruba a transação e responde a mensagem de sempre', async () => {
    const { service } = harness(jest.fn(async () => { throw Object.assign(new Error('Data too long'), { code: 'P2000' }); }));
    const erro = await service.create({ nome: 'Ana', id_apartamento: 10, id_condominio: 1 } as any).catch((e) => e);
    expect(erro).toBeInstanceOf(BadRequestException);
    expect(erro.message).toContain('Nao foi possivel cadastrar o morador');
    expect(erro.message).toContain('P2000');
  });
});
