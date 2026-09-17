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
});
