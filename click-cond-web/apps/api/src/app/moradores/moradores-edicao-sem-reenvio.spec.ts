import { MoradoresService } from './moradores.service';

/**
 * M3: a tela reenviava e-mail e foto em todo salvar. Para o morador vindo do app ou da Superlógica
 * (com e-mail e foto, sem nascimento) até corrigir o telefone dava "data de nascimento obrigatória",
 * e toda edição disparava o sync facial. A idade só é conferida quando e-mail, foto ou a própria
 * data mudam; o sync só roda quando a foto muda.
 * M4: o catch do update escondia a mensagem real ("Apartamento não pertence a este condomínio").
 */
describe('MoradoresService.update — só valida e sincroniza o que mudou (M3, M4)', () => {
  const FOTO = 'https://bucket/moradores/rosto.jpg';

  function harness(over: any = {}) {
    const registro: any = {
      id: 5,
      id_condominio: 1,
      id_user: 50,
      nome: 'Vinda Do App',
      documento: null,
      email: 'app@x.com',
      telefone: '11999990000',
      tipo: 'proprietario',
      bloco: 'A',
      apartamento: '101',
      data_nascimento: null,
      foto_pessoa: FOTO,
      foto_documento: null,
      tag_rfid: null,
      qrcode_acesso: null,
      face_id: 'F1',
      extra2: null,
      user: { id: 50, photo: FOTO, profile_image: FOTO, apartamentosUsers: [] },
      ...over,
    };
    const prisma: any = {
      isConnected: true,
      moradores: {
        findUnique: jest.fn().mockResolvedValue(registro),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...registro, ...data })),
        count: jest.fn().mockResolvedValue(0),
      },
      users: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn().mockResolvedValue({}) },
      apartamentos_Users: {
        findMany: jest.fn().mockResolvedValue([{ id: 900, id_apto: 10, apartamento: { bloco: 'A', apto: '101' } }]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(), create: jest.fn(), deleteMany: jest.fn(), updateMany: jest.fn(),
      },
      apartamentos: { findUnique: jest.fn().mockResolvedValue({ id: 77, id_condominio: 2, bloco: 'X', apto: '1' }) },
      sindicos_Condominios: { count: jest.fn().mockResolvedValue(0) },
      funcionarios: { count: jest.fn().mockResolvedValue(0) },
      funcionarios_Portaria: { count: jest.fn().mockResolvedValue(0) },
      visitantes: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    prisma.$transaction = jest.fn((fn: any) => fn(prisma));
    const storage: any = {
      isDataUrl: (v: string) => String(v).startsWith('data:'),
      uploadDataUrl: jest.fn().mockResolvedValue('https://bucket/moradores/nova.jpg'),
      exigirArquivoDoRegistro: jest.fn(async () => undefined),
    };
    const facial: any = { syncMorador: jest.fn().mockResolvedValue({}) };
    const service = new MoradoresService(
      prisma,
      {} as any,
      storage,
      facial,
      { registrar: jest.fn().mockResolvedValue({}) } as any,
      {} as any,
    );
    return { service, prisma, facial };
  }

  it('corrigir o telefone reenviando o mesmo e-mail e a mesma foto passa sem nascimento e não sincroniza', async () => {
    const { service, prisma, facial } = harness();
    await service.update(5, { telefone: '11988887777', email: 'app@x.com', foto_pessoa: FOTO } as any);
    expect(prisma.moradores.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ telefone: '11988887777' }) }),
    );
    expect(facial.syncMorador).not.toHaveBeenCalled();
    // A foto que não mudou não regrava a foto de perfil do app.
    expect(prisma.users.update.mock.calls.some((c: any[]) => 'photo' in (c[0]?.data ?? {}))).toBe(false);
  });

  it('foto nova continua exigindo a data de nascimento', async () => {
    const { service, prisma } = harness();
    await expect(service.update(5, { foto_pessoa: 'data:image/jpeg;base64,AAA' } as any)).rejects.toThrow(/data de nascimento/);
    expect(prisma.moradores.update).not.toHaveBeenCalled();
  });

  it('foto nova de adulto sincroniza com o facial', async () => {
    const { service, facial } = harness({ data_nascimento: new Date('1980-04-19') });
    await service.update(5, { foto_pessoa: 'data:image/jpeg;base64,AAA' } as any);
    expect(facial.syncMorador).toHaveBeenCalledWith(5);
  });

  it('preencher a data de adulto depois, com foto no cadastro, leva o rosto ao facial', async () => {
    const { service, facial } = harness();
    await service.update(5, { data_nascimento: '1980-04-19' } as any);
    expect(facial.syncMorador).toHaveBeenCalledWith(5);
  });

  it('data trocada sem foto no cadastro não sincroniza', async () => {
    const { service, facial } = harness({ foto_pessoa: null, email: null });
    await service.update(5, { data_nascimento: '1980-04-19' } as any);
    expect(facial.syncMorador).not.toHaveBeenCalled();
  });

  it('e-mail trocado continua exigindo a data de nascimento', async () => {
    const { service } = harness();
    await expect(service.update(5, { email: 'novo@x.com' } as any)).rejects.toThrow(/data de nascimento/);
  });

  it('data trocada para menor, com e-mail no cadastro, é recusada', async () => {
    const { service } = harness({ data_nascimento: new Date('1980-04-19') });
    const dez = new Date();
    dez.setFullYear(dez.getFullYear() - 10);
    await expect(
      service.update(5, { data_nascimento: dez.toISOString().slice(0, 10), email: 'app@x.com' } as any),
    ).rejects.toThrow(/menor|18/i);
  });

  it('M4: apartamento de outro condomínio sai com a mensagem real', async () => {
    const { service } = harness();
    await expect(service.update(5, { id_apartamento: 77, id_apartamento_anterior: 10 } as any)).rejects.toThrow(
      'Apartamento não pertence a este condomínio.',
    );
  });
});
