import { MoradoresService } from './moradores.service';

/**
 * Rodada 2 de ciclos (cadastros):
 * A1 — a lista do console não devolvia tag_rfid nem qrcode_acesso; a tela regravava '' e a API
 *      apagava a tag e o QR do morador em qualquer edição.
 * A2 — editar um morador com duas unidades apagava todos os vínculos dele no condomínio
 *      (deleteMany) e recriava um só, com prazo novo de +45 dias.
 */

function novoServico(prisma: any) {
  const service = new MoradoresService(
    prisma,
    {} as any,
    { isDataUrl: jest.fn().mockReturnValue(false), uploadDataUrl: jest.fn() } as any,
    { syncMorador: jest.fn().mockResolvedValue({}) } as any,
    { registrar: jest.fn().mockResolvedValue({}) } as any,
    { enviarMorador: jest.fn().mockResolvedValue({ enviado: false }) } as any,
  );
  return service;
}

const semVinculoFora = {
  sindicos_Condominios: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
  funcionarios: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
};

describe('A1 — MoradoresService.findAll devolve tag RFID e QR Code', () => {
  const linha = {
    id: 43,
    id_user: 41,
    id_condominio: 1,
    nome: 'Ana',
    tag_rfid: 'ABC123',
    qrcode_acesso: 'QR-9',
    foto_pessoa: null,
    user: { photo: null, apartamentosUsers: [{ id_apto: 7 }] },
  };

  it('na lista do condomínio inteiro', async () => {
    const prisma: any = {
      isConnected: true,
      ...semVinculoFora,
      moradores: { findMany: jest.fn().mockResolvedValue([linha]) },
      apartamentos_Users: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const [m] = await novoServico(prisma).findAll(1);
    expect(m).toEqual(expect.objectContaining({ tag_rfid: 'ABC123', qrcode_acesso: 'QR-9' }));
  });

  it('na lista filtrada por apartamento', async () => {
    const prisma: any = {
      isConnected: true,
      ...semVinculoFora,
      moradores: { findMany: jest.fn().mockResolvedValue([]) },
      apartamentos_Users: {
        findMany: jest.fn().mockResolvedValue([
          {
            id_user: 41,
            id_apto: 7,
            tipo: 'proprietario',
            apartamento: { id: 7, id_condominio: 1, bloco: 'A', apto: '101' },
            user: { id: 41, photo: null, email: null, phone: null, cpf: null, moradores: [linha] },
          },
        ]),
      },
    };
    const [m] = await novoServico(prisma).findAll(1, undefined, 7);
    expect(m).toEqual(expect.objectContaining({ tag_rfid: 'ABC123', qrcode_acesso: 'QR-9' }));
  });

  it('sem tag e sem QR, devolve null (não omite o campo)', async () => {
    const prisma: any = {
      isConnected: true,
      ...semVinculoFora,
      moradores: { findMany: jest.fn().mockResolvedValue([{ ...linha, tag_rfid: null, qrcode_acesso: null }]) },
      apartamentos_Users: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const [m] = await novoServico(prisma).findAll(1);
    expect(m).toHaveProperty('tag_rfid', null);
    expect(m).toHaveProperty('qrcode_acesso', null);
  });
});

describe('A2 — MoradoresService.update troca só o vínculo da unidade trocada', () => {
  /** Morador 43 (Users 41) do condomínio 1, com vínculos nos aptos 7 e 8 (vínculos 70 e 80). */
  function harness(vinculos = [{ id: 70, id_apto: 7 }, { id: 80, id_apto: 8 }], outrasLinhas: any[] = []) {
    const tx: any = {
      apartamentos_Users: {
        findMany: jest.fn().mockResolvedValue(vinculos),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      apartamentos: {
        findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, bloco: 'A', apto: String(100 + where.id), id_condominio: 1 })),
      },
      moradores: {
        update: jest.fn().mockResolvedValue({ id: 43, id_user: 41, id_condominio: 1, nome: 'Ana' }),
        // Outras linhas de Moradores do mesmo morador neste condomínio (nenhuma aqui).
        findMany: jest.fn().mockResolvedValue(outrasLinhas),
      },
      users: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma: any = {
      isConnected: true,
      ...semVinculoFora,
      $transaction: jest.fn(async (fn: any) => fn(tx)),
      moradores: {
        findUnique: jest.fn().mockResolvedValue({ id: 43, id_user: 41, id_condominio: 1, tipo: 'proprietario', nome: 'Ana' }),
        count: jest.fn().mockResolvedValue(0),
      },
      apartamentos_Users: { count: jest.fn().mockResolvedValue(0) },
      users: { update: jest.fn().mockResolvedValue({}) },
    };
    const service = novoServico(prisma);
    jest.spyOn(service as any, 'assertCredencialDisponivel').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'carregarContextoMorador').mockResolvedValue(null);
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 43 } as any);
    return { service, tx };
  }

  it('trocar o 101 pelo 109 muda só aquele vínculo, sem apagar o 102 nem recriar com prazo novo', async () => {
    const { service, tx } = harness();

    await service.update(43, { id_apartamento: 9, id_apartamento_anterior: 7 } as any);

    expect(tx.apartamentos_Users.deleteMany).not.toHaveBeenCalled();
    expect(tx.apartamentos_Users.create).not.toHaveBeenCalled();
    expect(tx.apartamentos_Users.update).toHaveBeenCalledTimes(1);
    const arg = tx.apartamentos_Users.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 70 });
    expect(arg.data.id_apto).toBe(9);
    expect(arg.data).not.toHaveProperty('vencimento');
  });

  it('só os vínculos deste condomínio são considerados', async () => {
    const { service, tx } = harness();

    await service.update(43, { id_apartamento: 9, id_apartamento_anterior: 7 } as any);

    expect(tx.apartamentos_Users.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id_user: 41, apartamento: { id_condominio: 1 } } }),
    );
  });

  it('salvar com a mesma unidade não mexe em vínculo nenhum', async () => {
    const { service, tx } = harness();

    await service.update(43, { id_apartamento: 7, id_apartamento_anterior: 7, telefone: '1' } as any);

    expect(tx.apartamentos_Users.deleteMany).not.toHaveBeenCalled();
    expect(tx.apartamentos_Users.create).not.toHaveBeenCalled();
    expect(tx.apartamentos_Users.update).not.toHaveBeenCalled();
  });

  it('trocar para uma unidade que ele já tem junta os dois: some só o vínculo antigo', async () => {
    const { service, tx } = harness();

    await service.update(43, { id_apartamento: 8, id_apartamento_anterior: 7 } as any);

    expect(tx.apartamentos_Users.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [70] } } });
    expect(tx.apartamentos_Users.create).not.toHaveBeenCalled();
    expect(tx.apartamentos_Users.update).not.toHaveBeenCalled();
  });

  it('linha sem vínculo identificável indo para a unidade que OUTRA linha já ocupa: recusa também', async () => {
    // Linha sem bloco/apto, dois vínculos e sem a anterior: não há vínculo a trocar, mas o texto mudaria.
    const { service, tx } = harness(undefined, [{ bloco: 'A', apartamento: '108' }]);

    await expect(service.update(43, { id_apartamento: 8 } as any)).rejects.toThrow(
      'Este morador já está cadastrado nessa unidade.',
    );
    expect(tx.moradores.update).not.toHaveBeenCalled();
  });

  it('trocar para uma unidade que OUTRA linha dele já ocupa: recusa sem mexer em nada', async () => {
    // A unidade 8 do mock é A/108; a outra linha do mesmo morador já é do "Bloco A" 108.
    const { service, tx } = harness(undefined, [{ bloco: 'Bloco A', apartamento: '108' }]);

    await expect(service.update(43, { id_apartamento: 8, id_apartamento_anterior: 7 } as any)).rejects.toThrow(
      'Este morador já está cadastrado nessa unidade.',
    );
    expect(tx.apartamentos_Users.deleteMany).not.toHaveBeenCalled();
    expect(tx.moradores.update).not.toHaveBeenCalled();
  });

  it('sem a unidade anterior e com vínculo único, troca esse vínculo (como antes)', async () => {
    const { service, tx } = harness([{ id: 70, id_apto: 7 }]);

    await service.update(43, { id_apartamento: 9 } as any);

    expect(tx.apartamentos_Users.deleteMany).not.toHaveBeenCalled();
    expect(tx.apartamentos_Users.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 70 }, data: expect.objectContaining({ id_apto: 9 }) }),
    );
  });

  it('unidade anterior que não é deste condomínio, com vínculo único aqui: troca esse vínculo', async () => {
    const { service, tx } = harness([{ id: 70, id_apto: 7 }]);

    await service.update(43, { id_apartamento: 9, id_apartamento_anterior: 555 } as any);

    expect(tx.apartamentos_Users.deleteMany).not.toHaveBeenCalled();
    expect(tx.apartamentos_Users.update).toHaveBeenCalledWith({ where: { id: 70 }, data: { id_apto: 9 } });
  });

  it('sem a unidade anterior e com duas unidades, acrescenta a nova sem apagar as outras', async () => {
    const { service, tx } = harness();

    await service.update(43, { id_apartamento: 9 } as any);

    expect(tx.apartamentos_Users.deleteMany).not.toHaveBeenCalled();
    expect(tx.apartamentos_Users.update).not.toHaveBeenCalled();
    expect(tx.apartamentos_Users.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ id_apto: 9, id_user: 41 }) }),
    );
  });

  it('sem vínculo nenhum, cria o vínculo da unidade escolhida', async () => {
    const { service, tx } = harness([]);

    await service.update(43, { id_apartamento: 9, id_apartamento_anterior: 0 } as any);

    expect(tx.apartamentos_Users.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ id_apto: 9, id_user: 41 }) }),
    );
  });

  it('editar sem mandar a unidade não toca nos vínculos', async () => {
    const { service, tx } = harness();

    await service.update(43, { telefone: '11988887777' } as any);

    expect(tx.apartamentos_Users.findMany).not.toHaveBeenCalled();
    expect(tx.apartamentos_Users.deleteMany).not.toHaveBeenCalled();
    expect(tx.apartamentos_Users.create).not.toHaveBeenCalled();
    expect(tx.apartamentos_Users.update).not.toHaveBeenCalled();
  });
});
