import { BadRequestException } from '@nestjs/common';
import { MoradoresService } from './moradores.service';
import { calcularIdade } from '../common/idade.util';

describe('MoradoresService - Validação de Menor de 18 Anos', () => {
  let service: MoradoresService;
  let prismaMock: any;

  beforeEach(() => {
    prismaMock = {
      isConnected: true,
      apartamentos: {
        findUnique: jest.fn().mockResolvedValue({ id: 10, bloco: 'A', apto: '101' }),
      },
      users: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 99 }),
      },
      apartamentos_Users: {
        create: jest.fn().mockResolvedValue({}),
      },
      moradores: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data })),
        findUnique: jest.fn().mockImplementation(({ where }) => Promise.resolve({
          id: where.id ?? 1,
          nome: 'Teste',
          id_user: 99,
          user: { photo: null, apartamentosUsers: [] },
        })),
      },
      moradores_Historico: {
        create: jest.fn().mockResolvedValue({}),
      },
      facial_Devices: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const mailMock: any = { sendWelcomeMorador: jest.fn().mockResolvedValue({}) };
    const storageMock: any = {
      isDataUrl: jest.fn().mockReturnValue(false),
      uploadDataUrl: jest.fn().mockResolvedValue('https://storage/foto.jpg'),
    };
    const facialMock: any = { syncMorador: jest.fn().mockResolvedValue({}) };
    const auditoriaMock: any = { registrar: jest.fn().mockResolvedValue({}) };
    const superlogicaMock: any = { enviarMorador: jest.fn().mockResolvedValue({ enviado: false }) };

    service = new MoradoresService(prismaMock, mailMock, storageMock, facialMock, auditoriaMock, superlogicaMock);
  });

  it('permite cadastrar morador maior de 18 anos com e-mail e foto', async () => {
    const vinteAnos = new Date();
    vinteAnos.setFullYear(vinteAnos.getFullYear() - 20);

    const dto: any = {
      nome: 'Carlos Maior',
      documento: '12345678900',
      email: 'carlos@teste.com',
      data_nascimento: vinteAnos.toISOString().split('T')[0],
      foto_pessoa: 'data:image/jpeg;base64,12345',
      id_condominio: 1,
      id_apartamento: 10,
    };

    const res = await service.create(dto);
    expect(res).toBeDefined();
    expect(prismaMock.users.create).toHaveBeenCalled();
  });

  it('bloqueia cadastro de morador menor de 18 anos quando informado e-mail/conta', async () => {
    const dezAnos = new Date();
    dezAnos.setFullYear(dezAnos.getFullYear() - 10);

    const dto: any = {
      nome: 'Pedro Menor',
      email: 'pedro@teste.com',
      data_nascimento: dezAnos.toISOString().split('T')[0],
      id_condominio: 1,
      id_apartamento: 10,
    };

    await expect(service.create(dto)).rejects.toThrow(BadRequestException);
    expect(prismaMock.users.create).not.toHaveBeenCalled();
  });

  it('bloqueia cadastro de foto biométrica para morador menor de 18 anos', async () => {
    const quinzeAnos = new Date();
    quinzeAnos.setFullYear(quinzeAnos.getFullYear() - 15);

    const dto: any = {
      nome: 'Ana Menor',
      foto_pessoa: 'data:image/jpeg;base64,foto',
      data_nascimento: quinzeAnos.toISOString().split('T')[0],
      id_condominio: 1,
      id_apartamento: 10,
    };

    await expect(service.create(dto)).rejects.toThrow(BadRequestException);
  });

  it('permite cadastro de dependente menor de 18 anos SEM conta e SEM foto biométrica', async () => {
    const cincoAnos = new Date();
    cincoAnos.setFullYear(cincoAnos.getFullYear() - 5);

    const dto: any = {
      nome: 'Lucas Bebe',
      data_nascimento: cincoAnos.toISOString().split('T')[0],
      id_condominio: 1,
      id_apartamento: 10,
    };

    const res = await service.create(dto);
    expect(res).toBeDefined();
    // Cria apenas registro básico com is_morador = 0 e sem credenciais
    expect(prismaMock.users.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        is_morador: 0,
        login_type: 'dependente_menor',
      }),
    });
  });

  it('recusa cadastro sem data de nascimento quando envia e-mail/credenciais (evita brecha de menor sem checagem)', async () => {
    const dto: any = {
      nome: 'Yasmin Alves Costa',
      email: 'yasmin.alves@mockemail.com',
      documento: '12345678900',
      id_condominio: 1,
      id_apartamento: 10,
      sendCredentials: true,
    };

    await expect(service.create(dto)).rejects.toThrow(BadRequestException);
    expect(prismaMock.users.create).not.toHaveBeenCalled();
  });

  it('recusa cadastro sem data de nascimento quando envia foto facial (evita brecha de menor sem checagem)', async () => {
    const dto: any = {
      nome: 'Rafael Sem Data',
      foto_pessoa: 'data:image/jpeg;base64,foto',
      id_condominio: 1,
      id_apartamento: 10,
    };

    await expect(service.create(dto)).rejects.toThrow(BadRequestException);
    expect(prismaMock.users.create).not.toHaveBeenCalled();
  });

  it('permite cadastrar morador sem data de nascimento quando NÃO há foto facial nem envio de credenciais (importação em lote)', async () => {
    const dto: any = {
      nome: 'Yasmin Alves Costa',
      documento: '12345678900',
      id_condominio: 1,
      id_apartamento: 10,
      sendCredentials: false,
    };

    const res = await service.create(dto);
    expect(res).toBeDefined();
    expect(prismaMock.users.create).toHaveBeenCalled();
  });

  it('importBulk cadastra moradores sem data de nascimento quando a planilha não envia credenciais nem foto', async () => {
    const linhas = [
      {
        nome: 'Yasmin Alves Costa',
        bloco: 'Bloco A',
        apto: '101',
        sendCredentials: false,
      },
      {
        nome: 'Xavier Alves Alves',
        bloco: 'Bloco A',
        apto: '102',
        sendCredentials: false,
      },
    ];

    prismaMock.apartamentos.findFirst = jest.fn().mockResolvedValue({ id: 101, bloco: 'Bloco A', apto: '101' });

    const result = await service.importBulk(1, linhas);
    expect(result.ok).toBe(true);
    expect(result.total).toBe(2);
    expect(result.criados).toHaveLength(2);
    expect(result.erros).toHaveLength(0);
  });

  it('importBulk reporta erro por linha (sem travar o lote) quando a planilha manda credenciais sem data de nascimento', async () => {
    const linhas = [
      {
        nome: 'Yasmin Alves Costa',
        email: 'yasmin.alves@mockemail.com',
        bloco: 'Bloco A',
        apto: '101',
        sendCredentials: true,
      },
    ];

    prismaMock.apartamentos.findFirst = jest.fn().mockResolvedValue({ id: 101, bloco: 'Bloco A', apto: '101' });

    const result = await service.importBulk(1, linhas);
    expect(result.ok).toBe(true);
    expect(result.total).toBe(0);
    expect(result.criados).toHaveLength(0);
    expect(result.erros).toHaveLength(1);
    expect(result.erros[0].nome).toBe('Yasmin Alves Costa');
  });
});

