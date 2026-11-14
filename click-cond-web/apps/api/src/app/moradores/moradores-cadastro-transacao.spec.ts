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
    const storage: any = {
      isDataUrl: (v: string) => String(v ?? '').startsWith('data:'),
      exigirArquivoDoRegistro: jest.fn(async () => undefined),
      uploadDataUrl: jest.fn(async () => 'https://bucket/moradores/nova.jpg'),
      deleteUrl: jest.fn(async () => true),
    };
    const service = new MoradoresService(
      prisma,
      { sendWelcomeMorador: jest.fn().mockResolvedValue({}) } as any,
      storage,
      { syncMorador: jest.fn().mockResolvedValue({}) } as any,
      { registrar: jest.fn().mockResolvedValue({}) } as any,
      { enviarMorador: jest.fn().mockResolvedValue({ enviado: false }) } as any,
    );
    return { service, prisma, tx, storage };
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

  it('idade recusada antes do upload: a foto nem sobe', async () => {
    const { service, storage } = harness(jest.fn(async ({ data }: any) => ({ id: 1, ...data })));
    await expect(
      service.create({ nome: 'Ana', id_apartamento: 10, id_condominio: 1, foto_pessoa: 'data:image/jpeg;base64,AAA' } as any),
    ).rejects.toThrow(/data de nascimento/);
    expect(storage.uploadDataUrl).not.toHaveBeenCalled();
  });

  it('transação que falha apaga do bucket a foto que esta chamada subiu, só dentro de moradores/', async () => {
    const { service, storage } = harness(jest.fn(async () => { throw new Error('Data too long'); }));
    await service
      .create({ nome: 'Ana', id_apartamento: 10, id_condominio: 1, data_nascimento: '1980-04-19', foto_pessoa: 'data:image/jpeg;base64,AAA' } as any)
      .catch(() => undefined);
    expect(storage.deleteUrl).toHaveBeenCalledWith('https://bucket/moradores/nova.jpg', ['moradores/']);
  });

  it('arquivo que já existia (URL, não upload desta chamada) nunca é apagado', async () => {
    const { service, storage } = harness(jest.fn(async () => { throw new Error('Data too long'); }));
    await service
      .create({ nome: 'Ana', id_apartamento: 10, id_condominio: 1, data_nascimento: '1980-04-19', foto_documento: 'https://bucket/moradores/antigo.jpg' } as any)
      .catch(() => undefined);
    expect(storage.deleteUrl).not.toHaveBeenCalled();
  });
});
