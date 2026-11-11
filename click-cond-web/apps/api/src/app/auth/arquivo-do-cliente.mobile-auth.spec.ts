import { BadRequestException } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';
import { StorageService } from '../common/storage/storage.service';

/**
 * Campos de arquivo da superfície do app (mobile-auth). A saída da API assina
 * qualquer URL do bucket: aceitar uma URL do bucket arbitrária na foto do
 * perfil fazia de qualquer URL guardada (de outro cadastro, de um ex-porteiro)
 * um link renovável para sempre. Só passam data URL nova, a mesma chave já
 * gravada naquela entidade, ou vazio.
 */
describe('mobile-auth — campos de arquivo recebidos do cliente', () => {
  const BUCKET = 'prestare-arquivos-teste';
  const BASE = `https://${BUCKET}.s3.sa-east-1.amazonaws.com`;
  const MINHA = `${BASE}/sindicos/1700000000000-minha.jpg`;
  const ALHEIA = `${BASE}/moradores/1700000000000-alheia.jpg`;
  const NOVA = `${BASE}/sindicos/1800000000000-nova.jpg`;
  const DATA_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  const ambienteOriginal = { ...process.env };

  function storageReal() {
    process.env.AWS_ACCESS_KEY_ID = 'AKIAEXEMPLOEXEMPLO00';
    process.env.AWS_SECRET_ACCESS_KEY = 'segredo-de-teste-que-nao-existe-na-aws';
    process.env.AWS_S3_BUCKET_NAME = BUCKET;
    process.env.AWS_S3_BASE_URL = BASE;
    process.env.AWS_S3_BUCKET_REGION = 'sa-east-1';
    for (const k of ['R2_ACCESS_KEY_ID', 'R2_BUCKET', 'R2_PUBLIC_URL', 'R2_ENDPOINT']) delete process.env[k];
    const storage = new StorageService();
    jest.spyOn(storage, 'uploadDataUrl').mockResolvedValue(NOVA);
    return storage;
  }

  afterEach(() => {
    process.env = { ...ambienteOriginal };
    jest.restoreAllMocks();
  });

  function servico(prisma: any, storage: StorageService) {
    const tenant: any = {
      assertCondominio: jest.fn(async () => undefined),
      assertEntidade: jest.fn(async () => undefined),
    };
    const jwt: any = { sign: jest.fn(() => 'token') };
    return new MobileAuthService(prisma, jwt, {} as any, storage, {} as any, tenant, {} as any, {} as any, {} as any, {} as any);
  }

  async function arquivoInvalido(p: Promise<unknown>) {
    const erro: any = await p.catch((e) => e);
    expect(erro).toBeInstanceOf(BadRequestException);
    expect(erro.message).toBe('Arquivo inválido.');
  }

  describe('updateSindico (normalizarFoto)', () => {
    function build() {
      const tx: any = { users: { update: jest.fn(async () => ({})) }, sindicos: { update: jest.fn(async () => ({})) } };
      const prisma: any = {
        isConnected: true,
        users: {
          findUnique: jest.fn(async () => ({
            id: 7, name: 'Síndico', email: 's@x.com', login: 's@x.com', photo: MINHA, profile_image: null,
            sindicos: [{ id: 3, name: 'Síndico', email: 's@x.com', date_birth: null }],
          })),
        },
        $transaction: jest.fn(async (fn: any) => fn(tx)),
      };
      const storage = storageReal();
      return { service: servico(prisma, storage), prisma, tx, storage };
    }

    it('chave de outro registro: 400 e nada é gravado', async () => {
      const { service, prisma } = build();
      await arquivoInvalido(service.updateSindico(7, { photo: ALHEIA }));
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('a mesma chave já gravada é aceita (o app reenvia a foto que recebeu)', async () => {
      const { service, tx } = build();
      await service.updateSindico(7, { photo: MINHA });
      expect(tx.users.update.mock.calls[0][0].data.photo).toBe(MINHA);
    });

    it('data URL nova vira upload', async () => {
      const { service, tx, storage } = build();
      await service.updateSindico(7, { photo: DATA_URL });
      expect(storage.uploadDataUrl).toHaveBeenCalledWith(DATA_URL, 'sindicos', 'profile');
      expect(tx.users.update.mock.calls[0][0].data.photo).toBe(NOVA);
    });

    it('vazio limpa a foto', async () => {
      const { service, tx } = build();
      await service.updateSindico(7, { photo: '' });
      expect(tx.users.update.mock.calls[0][0].data.photo).toBe('');
    });

    it('URL fora do bucket segue a regra de antes (gravada como veio)', async () => {
      const { service, tx } = build();
      await service.updateSindico(7, { photo: 'https://exemplo.com/eu.jpg' });
      expect(tx.users.update.mock.calls[0][0].data.photo).toBe('https://exemplo.com/eu.jpg');
    });
  });

  describe('updateInfosCondominio (foto do condomínio)', () => {
    const sindico: any = { sub: 7, typeAccess: 'Sindico' };
    function build() {
      const prisma: any = {
        isConnected: true,
        condominios: {
          findUnique: jest.fn(async () => ({ photo: MINHA })),
          update: jest.fn(async () => ({})),
        },
      };
      return { service: servico(prisma, storageReal()), prisma };
    }

    it('chave de outro registro: 400', async () => {
      const { service, prisma } = build();
      await arquivoInvalido(service.updateInfosCondominio({ condominio: { id: 1, photo: ALHEIA } }, sindico));
      expect(prisma.condominios.update).not.toHaveBeenCalled();
    });

    it('a mesma chave é aceita', async () => {
      const { service, prisma } = build();
      await service.updateInfosCondominio({ condominio: { id: 1, photo: MINHA } }, sindico);
      expect(prisma.condominios.update.mock.calls[0][0].data.photo).toBe(MINHA);
    });
  });

  describe('updateInfosFuncionario (o próprio funcionário)', () => {
    function build() {
      const tx: any = { funcionarios: { update: jest.fn(async () => ({})) }, users: { update: jest.fn(async () => ({})) } };
      const prisma: any = {
        isConnected: true,
        funcionarios: { findFirst: jest.fn(async () => ({ id: 4, id_user: 9 })) },
        users: {
          findUnique: jest.fn(async () => ({ id: 9, photo: MINHA, profile_image: MINHA, funcionarios: [{}] })),
          findFirst: jest.fn(async () => null),
        },
        $transaction: jest.fn(async (fn: any) => fn(tx)),
      };
      return { service: servico(prisma, storageReal()), prisma, tx };
    }

    it('chave de outro registro: 400', async () => {
      const { service, prisma } = build();
      await arquivoInvalido(service.updateInfosFuncionario({ funcionario: { photo: ALHEIA } }, { sub: 9 } as any));
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('a mesma chave é aceita', async () => {
      const { service, tx } = build();
      await service.updateInfosFuncionario({ funcionario: { photo: MINHA } }, { sub: 9 } as any);
      expect(tx.users.update.mock.calls[0][0].data.photo).toBe(MINHA);
    });
  });

  describe('saveFuncionario (síndico cadastra/edita o porteiro)', () => {
    const sindico: any = { sub: 7, typeAccess: 'Sindico' };
    function build() {
      const prisma: any = {
        isConnected: true,
        funcionarios_Portaria: {
          findUnique: jest.fn(async ({ where }: any) =>
            where.id === 5 ? { id: 5, login: 'porteiro@x.com', id_condominio: 1 } : null,
          ),
          update: jest.fn(async () => ({ id: 5, login: 'porteiro@x.com', id_condominio: 1, nome: 'Porteiro' })),
          create: jest.fn(async () => ({ id: 6 })),
        },
        users: {
          // `where.OR` é a checagem de login livre do cadastro novo: e-mail sem conta.
          findFirst: jest.fn(async ({ where }: any) =>
            where.OR ? null : { id: 9, password: 'h', photo: MINHA, profile_image: MINHA },
          ),
          update: jest.fn(async () => ({})),
        },
        funcionarios: { findFirst: jest.fn(async () => ({ id: 4 })), update: jest.fn(async () => ({})) },
      };
      return { service: servico(prisma, storageReal()), prisma };
    }

    it('edição com chave de outro registro: 400 e nada é gravado', async () => {
      const { service, prisma } = build();
      await arquivoInvalido(service.saveFuncionario({ funcionario: { id: 5, photo: ALHEIA } }, true, sindico));
      expect(prisma.funcionarios_Portaria.update).not.toHaveBeenCalled();
    });

    it('edição com a mesma chave é aceita', async () => {
      const { service, prisma } = build();
      await service.saveFuncionario({ funcionario: { id: 5, photo: MINHA } }, true, sindico);
      expect(prisma.users.update.mock.calls[0][0].data.photo).toBe(MINHA);
    });

    it('cadastro novo com URL do bucket: 400 (não há foto gravada para reenviar)', async () => {
      const { service, prisma } = build();
      await arquivoInvalido(
        service.saveFuncionario(
          { id_condominio: 1, funcionario: { nome: 'Novo', email: 'novo@x.com', photo: MINHA } },
          false,
          sindico,
        ),
      );
      expect(prisma.funcionarios_Portaria.create).not.toHaveBeenCalled();
    });
  });

  describe('saveMorador', () => {
    function build() {
      const tx: any = { moradores: { update: jest.fn(async () => ({})) }, users: { update: jest.fn(async () => ({})) } };
      const prisma: any = {
        isConnected: true,
        moradores: {
          findUnique: jest.fn(async () => ({
            id: 11, id_user: 7, id_condominio: 1, email: 'm@x.com', data_nascimento: null, extra2: null,
            foto_pessoa: MINHA, user: { id: 7, photo: MINHA, profile_image: null },
          })),
          findFirst: jest.fn(async () => null),
          create: jest.fn(async () => ({ id: 12 })),
        },
        users: {
          findUnique: jest.fn(async () => null),
          findFirst: jest.fn(async () => null),
          create: jest.fn(async () => ({ id: 50 })),
        },
        apartamentos_Users: { create: jest.fn(async () => ({})) },
        apartamentos: { findUnique: jest.fn(async () => ({ id: 100, id_condominio: 1, bloco: 'A', apto: '1' })) },
        $transaction: jest.fn(async (fn: any) => fn(tx)),
      };
      return { service: servico(prisma, storageReal()), prisma, tx };
    }
    const morador: any = { sub: 7, typeAccess: 'Morador' };
    const sindico: any = { sub: 1, typeAccess: 'Sindico' };

    it('edição com chave de outro registro: 400 e nada é gravado', async () => {
      const { service, prisma } = build();
      await arquivoInvalido(service.saveMorador({ morador: { id: 11, photo: ALHEIA } }, true, morador));
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('edição com a mesma chave é aceita', async () => {
      const { service, tx } = build();
      await service.saveMorador({ morador: { id: 11, photo: MINHA } }, true, morador);
      expect(tx.moradores.update.mock.calls[0][0].data.foto_pessoa).toBe(MINHA);
    });

    it('cadastro novo com URL do bucket: 400 e nada é criado', async () => {
      const { service, prisma } = build();
      await arquivoInvalido(
        service.saveMorador(
          {
            id_condominio: 1,
            morador: { id_apto: 100, nome: 'Novo', data_nascimento: '01/01/1990', photo: MINHA, skipSuperlogica: true },
          },
          false,
          sindico,
        ),
      );
      expect(prisma.moradores.create).not.toHaveBeenCalled();
    });
  });

  describe('retirarEncomendaMorador (foto da retirada)', () => {
    function build() {
      const prisma: any = {
        isConnected: true,
        encomendas: {
          findUnique: jest.fn(async () => ({
            id: 3, id_condominio: 1, destinatario_apto: '1', destinatario_bloco: 'A', status: 'Aguardando', retirado_foto: null,
          })),
          update: jest.fn(async () => ({})),
        },
        moradores: { findMany: jest.fn(async () => [{ id_condominio: 1, apartamento: '1', bloco: 'A', nome: 'M' }]) },
      };
      return { service: servico(prisma, storageReal()), prisma };
    }

    it('URL do bucket que não é a desta encomenda: 400', async () => {
      const { service, prisma } = build();
      await arquivoInvalido(service.retirarEncomendaMorador(7, 3, ALHEIA));
      expect(prisma.encomendas.update).not.toHaveBeenCalled();
    });

    it('data URL vira upload', async () => {
      const { service, prisma } = build();
      await service.retirarEncomendaMorador(7, 3, DATA_URL);
      expect(prisma.encomendas.update.mock.calls[0][0].data.retirado_foto).toBe(NOVA);
    });
  });
});
