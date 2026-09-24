import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MoradoresService } from './moradores.service';
import * as bcrypt from 'bcrypt';

describe('MoradoresService - Envio de Credenciais Aleatórias', () => {
  let service: MoradoresService;
  let prismaMock: any;
  let mailMock: any;
  let storageMock: any;
  let facialMock: any;
  let auditoriaMock: any;
  let superlogicaMock: any;

  beforeEach(() => {
    prismaMock = {
      isConnected: true,
      moradores: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      users: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      apartamentos: {
        findUnique: jest.fn().mockResolvedValue({ id: 1, bloco: 'A', apto: '106' }),
      },
      apartamentos_Users: {
        create: jest.fn().mockResolvedValue({}),
      },
      facial_Devices: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    mailMock = {
      sendWelcomeMorador: jest.fn().mockResolvedValue({}),
      sendWelcomeMoradorExisting: jest.fn().mockResolvedValue({}),
    };
    storageMock = {
      isDataUrl: jest.fn().mockReturnValue(false),
      uploadDataUrl: jest.fn().mockResolvedValue(null),
    };
    facialMock = { syncMorador: jest.fn().mockResolvedValue({}) };
    auditoriaMock = { registrar: jest.fn().mockResolvedValue({}) };
    superlogicaMock = { enviarMorador: jest.fn().mockResolvedValue({ enviado: false }) };

    service = new MoradoresService(
      prismaMock,
      mailMock,
      storageMock,
      facialMock,
      auditoriaMock,
      superlogicaMock,
    );
  });

  it('sendCredentials gera uma senha temporária aleatória e NUNCA usa o CPF da pessoa', async () => {
    const cpfMorador = '453.466.488-52';
    const cpfDigitos = '45346648852';
    const emailMorador = 'vinicius.silva@mockemail.com';

    prismaMock.moradores.findUnique.mockResolvedValue({
      id: 10,
      nome: 'Vinicius Silva',
      documento: cpfMorador,
      email: emailMorador,
      telefone: '11999998888',
      id_condominio: 1,
      id_user: 99,
      user: {
        photo: null,
        apartamentosUsers: [{ id_apto: 1 }],
      },
    });

    const res = await service.sendCredentials(10);
    expect(res).toEqual({ ok: true });

    // Verifica que o e-mail de boas-vindas foi disparado
    expect(mailMock.sendWelcomeMorador).toHaveBeenCalledTimes(1);
    const [destEmail, destNome, senhaEnviada] = mailMock.sendWelcomeMorador.mock.calls[0];

    expect(destEmail).toBe(emailMorador);
    expect(destNome).toBe('Vinicius Silva');

    // A senha enviada NUNCA pode ser o CPF (nem com pontuação nem só dígitos)
    expect(senhaEnviada).not.toBe(cpfMorador);
    expect(senhaEnviada).not.toBe(cpfDigitos);
    expect(senhaEnviada).not.toBe('123456');

    // A senha deve ser aleatória de 8 caracteres alfanuméricos hex
    expect(senhaEnviada).toMatch(/^[0-9a-f]{8}$/);

    // O hash salvo em users.update deve corresponder à senha gerada
    expect(prismaMock.users.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 99 },
        data: expect.objectContaining({
          login: emailMorador,
          password: expect.any(String),
        }),
      }),
    );

    const savedHash = prismaMock.users.update.mock.calls[0][0].data.password;
    const match = await bcrypt.compare(senhaEnviada, savedHash);
    expect(match).toBe(true);

    const matchCpf = await bcrypt.compare(cpfDigitos, savedHash);
    expect(matchCpf).toBe(false);
  });

  it('sendCredentials cria/vincula user se id_user for nulo no morador', async () => {
    prismaMock.moradores.findUnique.mockResolvedValue({
      id: 20,
      nome: 'Maria Sem User',
      documento: '12345678901',
      email: 'maria@semuser.com',
      telefone: '11988887777',
      id_condominio: 1,
      id_user: null,
      user: null,
    });

    prismaMock.users.findFirst.mockResolvedValue(null);
    prismaMock.users.create.mockResolvedValue({ id: 50 });

    const res = await service.sendCredentials(20);
    expect(res).toEqual({ ok: true });

    expect(prismaMock.users.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'maria@semuser.com',
          login: 'maria@semuser.com',
        }),
      }),
    );

    expect(prismaMock.moradores.update).toHaveBeenCalledWith({
      where: { id: 20 },
      data: { id_user: 50 },
    });

    expect(prismaMock.users.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 50 },
      }),
    );
  });

  it('sendCredentials lança NotFoundException se morador não tiver e-mail', async () => {
    prismaMock.moradores.findUnique.mockResolvedValue({
      id: 30,
      nome: 'Morador Sem Email',
      documento: '11122233344',
      email: null,
      id_condominio: 1,
      user: null,
    });

    await expect(service.sendCredentials(30)).rejects.toThrow(NotFoundException);
    expect(mailMock.sendWelcomeMorador).not.toHaveBeenCalled();
  });
});
