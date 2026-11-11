import { BadRequestException } from '@nestjs/common';
import { StorageService } from './storage.service';
import { MoradoresService } from '../../moradores/moradores.service';
import { PrestadoresService } from '../../prestadores/prestadores.service';
import { EncomendasService } from '../../encomendas/encomendas.service';
import { AreasSociaisService } from '../../areas-sociais/areas-sociais.service';
import { DeliveryService } from '../../delivery/delivery.service';
import { OcorrenciasService } from '../../ocorrencias/ocorrencias.service';
import { PessoasController } from '../../pessoas/pessoas.controller';
import { PessoasService } from '../../pessoas/pessoas.service';
import { FinanceiroService } from '../../financeiro/financeiro.service';

/**
 * Demais cadastros com campo de arquivo vindo do cliente (portaria-web, CRM,
 * app). Mesma regra em todos: data URL nova vira upload, a mesma chave já
 * gravada naquela entidade passa, vazio passa; qualquer outra URL do bucket é
 * 400 "Arquivo inválido." — a API assina toda URL do bucket que devolve.
 */
describe('cadastros — campos de arquivo recebidos do cliente', () => {
  const BUCKET = 'prestare-arquivos-teste';
  const BASE = `https://${BUCKET}.s3.sa-east-1.amazonaws.com`;
  const MINHA = `${BASE}/moradores/1700000000000-minha.jpg`;
  const ALHEIA = `${BASE}/moradores/1700000000000-alheia.jpg`;
  const porteiro: any = { sub: 3, nome: 'Porteiro', id_condominio: 1 };
  const sindico: any = { sub: 7, nome: 'Síndico', typeAccess: 'Sindico' };
  const ambienteOriginal = { ...process.env };

  function storageReal() {
    process.env.AWS_ACCESS_KEY_ID = 'AKIAEXEMPLOEXEMPLO00';
    process.env.AWS_SECRET_ACCESS_KEY = 'segredo-de-teste-que-nao-existe-na-aws';
    process.env.AWS_S3_BUCKET_NAME = BUCKET;
    process.env.AWS_S3_BASE_URL = BASE;
    process.env.AWS_S3_BUCKET_REGION = 'sa-east-1';
    for (const k of ['R2_ACCESS_KEY_ID', 'R2_BUCKET', 'R2_PUBLIC_URL', 'R2_ENDPOINT']) delete process.env[k];
    const storage = new StorageService();
    jest.spyOn(storage, 'uploadDataUrl').mockResolvedValue(`${BASE}/x/1800000000000-nova.jpg`);
    return storage;
  }

  afterEach(() => {
    process.env = { ...ambienteOriginal };
    jest.restoreAllMocks();
  });

  const tenant: any = {
    assertCondominio: jest.fn(async () => undefined),
    assertEntidade: jest.fn(async () => undefined),
    assertPermissaoFuncionario: jest.fn(async () => undefined),
  };
  const notifications: any = { sendPushNotification: jest.fn(), sendWhatsApp: jest.fn() };

  async function arquivoInvalido(p: Promise<unknown>) {
    const erro: any = await p.catch((e) => e);
    expect(erro).toBeInstanceOf(BadRequestException);
    expect(erro.message).toBe('Arquivo inválido.');
  }

  /** Fluxo aceito: passou da checagem e chegou na escrita (o resto do fluxo não interessa aqui). */
  async function chegouNaEscrita(p: Promise<unknown>, escrita: jest.Mock) {
    const erro: any = await p.catch((e) => e);
    expect(erro?.message).not.toBe('Arquivo inválido.');
    expect(escrita).toHaveBeenCalled();
  }

  describe('MoradoresService (portaria-web)', () => {
    function build() {
      const prisma: any = {
        isConnected: true,
        moradores: {
          findUnique: jest.fn(async () => ({
            id: 11, id_user: 7, id_condominio: 1, email: 'm@x.com', data_nascimento: new Date('1990-01-01'),
            foto_pessoa: MINHA, foto_documento: null, user: { id: 7, photo: MINHA, profile_image: null },
          })),
          findFirst: jest.fn(async () => null),
          create: jest.fn(async () => ({ id: 12 })),
        },
        visitantes: { findFirst: jest.fn(async () => null) },
        users: { findFirst: jest.fn(async () => null) },
        $transaction: jest.fn(async () => {
          throw new Error('fim do teste');
        }),
      };
      const service = new MoradoresService(prisma, {} as any, storageReal(), {} as any, { registrar: jest.fn() } as any, {} as any);
      return { service, prisma };
    }

    it('editar com chave de outro registro: 400 e nada gravado', async () => {
      const { service, prisma } = build();
      await arquivoInvalido(service.update(11, { foto_pessoa: ALHEIA }, porteiro));
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('editar reenviando a mesma chave: aceito', async () => {
      const { service, prisma } = build();
      await chegouNaEscrita(service.update(11, { foto_pessoa: MINHA }, porteiro), prisma.$transaction);
    });

    it('criar com URL do bucket: 400', async () => {
      const { service, prisma } = build();
      await arquivoInvalido(
        service.create({ nome: 'Novo', id_condominio: 1, data_nascimento: '1990-01-01', foto_pessoa: MINHA } as any, porteiro),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('PrestadoresService', () => {
    function build() {
      const existente = { id: 4, id_condominio: 1, id_apartamento: null, nome: 'Eletricista', email: null, telefone: null, foto_pessoa: MINHA, foto_documento: null };
      const prisma: any = {
        isConnected: true,
        prestadores_servico: {
          findUnique: jest.fn(async () => existente),
          findFirst: jest.fn(async () => existente),
          update: jest.fn(async ({ data }: any) => ({ ...existente, ...data })),
          create: jest.fn(async ({ data }: any) => ({ id: 5, ...data })),
        },
      };
      const facial: any = { syncPrestadorServico: jest.fn(async () => ({})) };
      return { service: new PrestadoresService(prisma, storageReal(), facial, tenant), prisma };
    }

    it('editar com chave de outro registro: 400; com a mesma: aceito', async () => {
      const { service, prisma } = build();
      await arquivoInvalido(service.update(4, { foto_pessoa: ALHEIA }, 1, porteiro));
      expect(prisma.prestadores_servico.update).not.toHaveBeenCalled();
      await service.update(4, { foto_pessoa: MINHA }, 1, porteiro);
      expect(prisma.prestadores_servico.update.mock.calls[0][0].data.foto_pessoa).toBe(MINHA);
    });

    it('cadastrar de novo o mesmo prestador (mesmo nome) reenviando a foto dele: aceito; outra: 400', async () => {
      const { service, prisma } = build();
      await arquivoInvalido(service.create({ nome: 'Eletricista', id_condominio: 1, foto_pessoa: ALHEIA } as any, porteiro));
      await service.create({ nome: 'Eletricista', id_condominio: 1, foto_pessoa: MINHA } as any, porteiro);
      expect(prisma.prestadores_servico.update.mock.calls[0][0].data.foto_pessoa).toBe(MINHA);
    });
  });

  describe('EncomendasService', () => {
    function build() {
      const encomenda = { id: 3, id_condominio: 1, foto_volume: MINHA, retirado_foto: null, retirado_assinatura: null, status: 'Aguardando' };
      const prisma: any = {
        isConnected: true,
        encomendas: {
          findUnique: jest.fn(async () => encomenda),
          findFirst: jest.fn(async () => null),
          update: jest.fn(async ({ data }: any) => ({ ...encomenda, ...data })),
          updateMany: jest.fn(async () => ({ count: 1 })),
          create: jest.fn(async ({ data }: any) => ({ id: 9, ...data })),
        },
      };
      const service = new EncomendasService(prisma, notifications, storageReal(), { registrar: jest.fn() } as any, tenant);
      return { service, prisma };
    }

    it('editar a foto do volume com chave de outro registro: 400; com a mesma: aceito', async () => {
      const { service, prisma } = build();
      await arquivoInvalido(service.update(3, { foto_volume: ALHEIA }, porteiro));
      expect(prisma.encomendas.update).not.toHaveBeenCalled();
      await service.update(3, { foto_volume: MINHA }, porteiro);
      expect(prisma.encomendas.update.mock.calls[0][0].data.foto_volume).toBe(MINHA);
    });

    it('registrar encomenda com URL do bucket: 400', async () => {
      const { service, prisma } = build();
      await arquivoInvalido(
        service.create({ id_condominio: 1, descricao: 'Caixa', destinatario_apto: '1', foto_volume: MINHA } as any, porteiro),
      );
      expect(prisma.encomendas.create).not.toHaveBeenCalled();
    });

    it('retirada com assinatura ou foto que é URL do bucket alheia: 400', async () => {
      const { service, prisma } = build();
      await arquivoInvalido(service.retirar(3, 'Ana', undefined, ALHEIA, undefined, porteiro));
      await arquivoInvalido(service.retirar(3, 'Ana', undefined, undefined, ALHEIA, porteiro));
      expect(prisma.encomendas.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('AreasSociaisService (imagem da área)', () => {
    function build() {
      const prisma: any = {
        isConnected: true,
        areas_Sociais: {
          findFirst: jest.fn(async () => ({ imagem: MINHA })),
          create: jest.fn(async () => ({ id: 1 })),
          updateMany: jest.fn(async () => ({ count: 1 })),
        },
      };
      return { service: new AreasSociaisService(prisma, notifications, storageReal(), {} as any, tenant), prisma };
    }

    it('editar com chave de outra área: 400; com a mesma: aceito', async () => {
      const { service, prisma } = build();
      await arquivoInvalido(service.update(1, { id: 2, nome: 'Salão', imagem: ALHEIA }, porteiro));
      expect(prisma.areas_Sociais.updateMany).not.toHaveBeenCalled();
      await service.update(1, { id: 2, nome: 'Salão', imagem: MINHA }, porteiro);
      expect(prisma.areas_Sociais.updateMany.mock.calls[0][0].data.imagem).toBe(MINHA);
    });

    it('criar com URL do bucket: 400', async () => {
      const { service, prisma } = build();
      await arquivoInvalido(service.insert(1, { nome: 'Salão', imagem: MINHA }, porteiro));
      expect(prisma.areas_Sociais.create).not.toHaveBeenCalled();
    });

    // `horarios` é JSON livre do cliente, devolvido parseado a todo o
    // condomínio: sem saneamento, `{ foto: <URL do bucket> }` lá dentro saía
    // assinado pelo interceptor (que casa chave de arquivo em qualquer nível).
    const contaminado = [
      {
        nome: 'Segunda',
        foto: ALHEIA,
        horarios: [
          { horarioDe: '08:00', horarioAte: '12:00', url: ALHEIA, efeito: 'abrir_url', valor: ALHEIA },
          { horarioDe: ALHEIA, horarioAte: '13:00' },
          { horarioDe: '14:00', horarioAte: '18:00' },
        ],
      },
      { foto: ALHEIA },
      'lixo',
    ];
    const saneado = [
      { nome: 'Segunda', horarios: [{ horarioDe: '08:00', horarioAte: '12:00' }, { horarioDe: '14:00', horarioAte: '18:00' }] },
      // Dia sem `nome` ganha o nome pelo índice da semana (o app faz
      // `nome.substring(0, 3)` e quebrava com a grade gravada pela portaria).
      { nome: 'Terça', horarios: [] },
      { nome: 'Quarta', horarios: [] },
    ];

    it('o último bloco da noite terminando em 24:00 (gerado pelo app) é preservado', async () => {
      const { service, prisma } = build();
      const grade = [{ nome: 'Segunda', horarios: [{ horarioDe: '22:00', horarioAte: '23:00' }, { horarioDe: '23:00', horarioAte: '24:00' }] }];
      await service.insert(1, { nome: 'Salão', horarios: grade }, porteiro);
      expect(JSON.parse(prisma.areas_Sociais.create.mock.calls[0][0].data.horarios)).toEqual(grade);
    });

    it('dia sem nome (ou com nome inválido) ganha o nome do app pelo índice; nome válido é preservado', async () => {
      const { service, prisma } = build();
      const semNome = Array.from({ length: 7 }, () => ({ horarios: [{ horarioDe: '08:00', horarioAte: '22:00' }] }));
      semNome[1] = { nome: 'Tu', horarios: [] } as any; // curto demais para o substring(0, 3) do app
      semNome[2] = { nome: 'Quarta-feira', horarios: [] } as any;
      await service.insert(1, { nome: 'Salão', horarios: semNome }, porteiro);
      const nomes = JSON.parse(prisma.areas_Sociais.create.mock.calls[0][0].data.horarios).map((d: any) => d.nome);
      expect(nomes).toEqual(['Segunda', 'Terça', 'Quarta-feira', 'Quinta', 'Sexta', 'Sábado', 'Domingo']);
    });

    it('criar: horarios é saneado para o formato da grade (chaves desconhecidas e horas inválidas caem)', async () => {
      const { service, prisma } = build();
      await service.insert(1, { nome: 'Salão', horarios: contaminado }, porteiro);
      expect(JSON.parse(prisma.areas_Sociais.create.mock.calls[0][0].data.horarios)).toEqual(saneado);
    });

    it('editar: horarios em string JSON também é saneado; JSON inválido vira grade vazia', async () => {
      const { service, prisma } = build();
      await service.update(1, { id: 2, nome: 'Salão', horarios: JSON.stringify(contaminado) }, porteiro);
      expect(JSON.parse(prisma.areas_Sociais.updateMany.mock.calls[0][0].data.horarios)).toEqual(saneado);
      await service.update(1, { id: 2, nome: 'Salão', horarios: '{"foto":' }, porteiro);
      expect(JSON.parse(prisma.areas_Sociais.updateMany.mock.calls[1][0].data.horarios)).toEqual([]);
    });
  });

  describe('DeliveryService (foto do entregador)', () => {
    function build() {
      const entregador = { id: 7, id_condominio: 1, foto: MINHA, veiculos: [] };
      const tx: any = {
        deliveryEntregadores: {
          create: jest.fn(async ({ data }: any) => ({ id: 8, ...data })),
          update: jest.fn(async () => ({})),
          findUnique: jest.fn(async () => entregador),
        },
        deliveryVeiculos: { create: jest.fn(), update: jest.fn(), deleteMany: jest.fn() },
      };
      const prisma: any = {
        isConnected: true,
        deliveryEntregadores: { findUnique: jest.fn(async () => entregador) },
        $transaction: jest.fn(async (fn: any) => fn(tx)),
      };
      return { service: new DeliveryService(prisma, notifications, tenant, storageReal()), tx };
    }

    it('cadastrar com URL do bucket: 400', async () => {
      const { service, tx } = build();
      await arquivoInvalido(service.criarEntregador({ id_condominio: 1, nome: 'João', foto: MINHA } as any, porteiro));
      expect(tx.deliveryEntregadores.create).not.toHaveBeenCalled();
    });

    it('editar com chave de outro registro: 400; com a mesma: aceito', async () => {
      const { service, tx } = build();
      await arquivoInvalido(service.atualizarEntregador(7, { foto: ALHEIA } as any, sindico));
      expect(tx.deliveryEntregadores.update).not.toHaveBeenCalled();
      await chegouNaEscrita(service.atualizarEntregador(7, { foto: MINHA } as any, sindico), tx.deliveryEntregadores.update);
    });
  });

  describe('OcorrenciasService (anexos)', () => {
    it('abrir ocorrência com anexo que é URL do bucket: 400', async () => {
      const prisma: any = { isConnected: true, ocorrencias: { create: jest.fn(async () => ({ id: 1 })) } };
      const service = new OcorrenciasService(prisma, notifications, tenant, storageReal());
      await arquivoInvalido(service.create({ descricao: 'Vazamento', id_condominio: 1, anexos: ALHEIA } as any));
      expect(prisma.ocorrencias.create).not.toHaveBeenCalled();
    });

    it('anexo "data:...;URL do bucket" também é recusado (data URL não pula a conferência por parte)', async () => {
      const prisma: any = { isConnected: true, ocorrencias: { create: jest.fn(async () => ({ id: 1 })) } };
      const service = new OcorrenciasService(prisma, notifications, tenant, storageReal());
      await arquivoInvalido(
        service.create({ descricao: 'Vazamento', id_condominio: 1, anexos: `data:image/png;base64,AAAA;${ALHEIA}` } as any),
      );
      expect(prisma.ocorrencias.create).not.toHaveBeenCalled();
    });

    it('anexo "externo;URL do bucket" também é recusado (cada parte é conferida)', async () => {
      const prisma: any = { isConnected: true, ocorrencias: { create: jest.fn(async () => ({ id: 1 })) } };
      const service = new OcorrenciasService(prisma, notifications, tenant, storageReal());
      await arquivoInvalido(
        service.create({ descricao: 'Vazamento', id_condominio: 1, anexos: `https://exemplo.com/a.jpg;${ALHEIA}` } as any),
      );
      expect(prisma.ocorrencias.create).not.toHaveBeenCalled();
    });
  });

  describe('PessoasController (POST /condominios/:id/pessoas)', () => {
    function build() {
      const pessoa = { id: 1, id_condominio: 1, nome: 'Ana', doc_identificacao: '52998224725', foto_pessoa: MINHA, foto_documento: null };
      const prisma: any = {
        isConnected: true,
        pessoas: {
          findFirst: jest.fn(async ({ where }: any) =>
            where.doc_identificacao === pessoa.doc_identificacao || where.id === pessoa.id ? pessoa : null,
          ),
          create: jest.fn(async ({ data }: any) => ({ id: 2, ...data })),
          update: jest.fn(async ({ data }: any) => ({ ...pessoa, ...data })),
        },
      };
      const service = new PessoasService(prisma);
      return { ctrl: new PessoasController(service, storageReal()), prisma };
    }

    it('pessoa nova com URL do bucket: 400', async () => {
      const { ctrl, prisma } = build();
      await arquivoInvalido(ctrl.criar(1, { nome: 'Bia', doc_identificacao: '11144477735', foto_pessoa: MINHA } as any, porteiro));
      expect(prisma.pessoas.create).not.toHaveBeenCalled();
    });

    it('pessoa existente (mesmo documento) reenviando a foto dela: aceito; outra: 400', async () => {
      const { ctrl, prisma } = build();
      await arquivoInvalido(ctrl.criar(1, { nome: 'Ana', doc_identificacao: '52998224725', foto_pessoa: ALHEIA } as any, porteiro));
      expect(prisma.pessoas.update).not.toHaveBeenCalled();
      await expect(
        ctrl.criar(1, { nome: 'Ana', doc_identificacao: '52998224725', foto_pessoa: MINHA } as any, porteiro),
      ).resolves.toBeTruthy();
    });
  });

  describe('FinanceiroService (foto/boleto do lançamento)', () => {
    it('lançar com foto ou boleto que é URL do bucket: 400', async () => {
      const prisma: any = { isConnected: true, financeiro: { create: jest.fn(async () => ({ id: 1 })) } };
      const fechamento: any = { assertPodeAlterar: jest.fn(async () => undefined) };
      const service = new FinanceiroService(prisma, storageReal(), {} as any, notifications, { registrar: jest.fn() } as any, fechamento, tenant);
      await arquivoInvalido(service.insert(1, { nome: 'Luz', valor: '10,00', tipo: 'D', photo: ALHEIA }, 'Op', sindico));
      await arquivoInvalido(service.insert(1, { nome: 'Luz', valor: '10,00', tipo: 'D', url_boleto: ALHEIA }, 'Op', sindico));
      expect(prisma.financeiro.create).not.toHaveBeenCalled();
    });
  });
});
