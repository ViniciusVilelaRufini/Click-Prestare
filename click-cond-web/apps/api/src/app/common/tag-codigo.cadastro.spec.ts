import { BadRequestException } from '@nestjs/common';
import { MobileAuthService } from '../auth/mobile-auth.service';
import { MoradoresService } from '../moradores/moradores.service';
import { VisitantesService } from '../visitantes/visitantes.service';

/**
 * Todo ponto que GRAVA um código de tag grava a forma normalizada e recusa
 * código inválido — senão o leitor (que manda hex/decimal/Wiegand) e o
 * cadastro voltam a divergir. Tags.service tem o spec dele em veiculos/.
 */
describe('cadastro de tag — código normalizado em todos os pontos', () => {
  describe('app do morador (vincularTagAoVeiculo)', () => {
    function build(opts: { tagExistente?: any; veiculoEmOutro?: any; veiculoAtualComATag?: boolean } = {}) {
      const prisma: any = {
        tags: {
          findUnique: jest.fn(async () => opts.tagExistente ?? null),
          // Unicidade por variantes (assertTagNaoEmUso): sem conflito aqui —
          // a regra em si está em tag-em-uso.util.spec.ts.
          findFirst: jest.fn(async () => null),
          upsert: jest.fn(async ({ where }: any) => ({
            id: opts.tagExistente?.id ?? 70,
            ...where.id_condominio_codigo,
          })),
        },
        moradores: { findFirst: jest.fn(async () => null) },
        visitantes: { findFirst: jest.fn(async () => null) },
        veiculos: {
          findFirst: jest.fn(async ({ where }: any) => {
            if (typeof where.id === 'number') return opts.veiculoAtualComATag ? { id: where.id } : null;
            return opts.veiculoEmOutro ?? null;
          }),
          update: jest.fn(async () => ({})),
        },
      };
      const svc: any = Object.create(MobileAuthService.prototype);
      svc.prisma = prisma;
      return { svc, prisma };
    }

    it('grava o código normalizado e vincula', async () => {
      const { svc, prisma } = build();

      await svc.vincularTagAoVeiculo(1, 5, ' 00bc:61:4e ');

      expect(prisma.tags.upsert.mock.calls[0][0].where.id_condominio_codigo).toEqual({
        id_condominio: 1,
        codigo: 'BC614E',
      });
      expect(prisma.tags.upsert.mock.calls[0][0].create.codigo).toBe('BC614E');
      expect(prisma.veiculos.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { id_tag: 70 } });
    });

    it('código vazio continua desvinculando', async () => {
      const { svc, prisma } = build();

      await svc.vincularTagAoVeiculo(1, 5, '   ');

      expect(prisma.veiculos.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { id_tag: null } });
      expect(prisma.tags.upsert).not.toHaveBeenCalled();
    });

    it('código inválido é recusado com mensagem clara', async () => {
      const { svc, prisma } = build();

      await expect(svc.vincularTagAoVeiculo(1, 5, 'TAG#1')).rejects.toThrow(/tag inválido/i);

      expect(prisma.tags.upsert).not.toHaveBeenCalled();
      expect(prisma.veiculos.update).not.toHaveBeenCalled();
    });

    it('tag em outro veículo ativo continua recusada', async () => {
      const { svc } = build({ veiculoEmOutro: { id: 9 } });

      await expect(svc.vincularTagAoVeiculo(1, 5, 'BC614E')).rejects.toThrow(
        'Esta tag já está vinculada a outro veículo.',
      );
    });

    // Sem isto o bloqueio feito pela portaria era desfeito pelo próprio
    // morador: bastava salvar o veículo com o código (o upsert reativava).
    it('morador NÃO reativa tag bloqueada pela portaria', async () => {
      const { svc, prisma } = build({ tagExistente: { id: 70, ativo: 0 } });

      await expect(svc.vincularTagAoVeiculo(1, 5, 'BC614E')).rejects.toThrow(/bloqueada/i);

      expect(prisma.tags.upsert).not.toHaveBeenCalled();
      expect(prisma.veiculos.update).not.toHaveBeenCalled();
    });

    it('editar o veículo que já tem a tag bloqueada não falha nem reativa', async () => {
      const { svc, prisma } = build({ tagExistente: { id: 70, ativo: 0 }, veiculoAtualComATag: true });

      await expect(svc.vincularTagAoVeiculo(1, 5, 'BC614E')).resolves.toBeUndefined();

      expect(prisma.tags.upsert).not.toHaveBeenCalled();
    });
  });

  describe('morador (tag_rfid)', () => {
    function build() {
      const prisma: any = {
        isConnected: true,
        apartamentos: {
          findUnique: jest.fn().mockResolvedValue({ id: 10, id_condominio: 1, bloco: 'A', apto: '101' }),
        },
        users: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 99 }),
        },
        funcionarios_Portaria: { count: jest.fn().mockResolvedValue(0) }, // login de portaria livre
        apartamentos_Users: { create: jest.fn().mockResolvedValue({}) },
        moradores: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 1, ...data })),
          findUnique: jest.fn().mockImplementation(({ where }: any) =>
            Promise.resolve({
              id: where.id ?? 1,
              nome: 'Teste',
              id_user: 99,
              user: { photo: null, apartamentosUsers: [] },
            }),
          ),
        },
        visitantes: { findFirst: jest.fn().mockResolvedValue(null) },
        tags: { findFirst: jest.fn().mockResolvedValue(null) },
        moradores_Historico: { create: jest.fn().mockResolvedValue({}) },
        facial_Devices: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const svc = new MoradoresService(
        prisma,
        { sendWelcomeMorador: jest.fn().mockResolvedValue({}) } as any,
        { isDataUrl: jest.fn().mockReturnValue(false), uploadDataUrl: jest.fn() } as any,
        { syncMorador: jest.fn().mockResolvedValue({}) } as any,
        { registrar: jest.fn().mockResolvedValue({}) } as any,
        { enviarMorador: jest.fn().mockResolvedValue({ enviado: false }) } as any,
      );
      return { svc, prisma };
    }
    const dto = (tag: any): any => ({
      nome: 'Carlos',
      documento: '12345678900',
      email: 'carlos@teste.com',
      data_nascimento: '1990-01-01',
      id_condominio: 1,
      id_apartamento: 10,
      tag_rfid: tag,
    });

    it('cadastro grava a tag normalizada (e confere duplicidade pela forma normalizada)', async () => {
      const { svc, prisma } = build();

      await svc.create(dto(' 00bc:61:4e '));

      expect(prisma.moradores.create.mock.calls[0][0].data.tag_rfid).toBe('BC614E');
      // A duplicidade é conferida por VARIANTES (normalizado + outras bases).
      const filtro = prisma.visitantes.findFirst.mock.calls[0][0].where.tag_rfid.in;
      expect(filtro).toEqual(expect.arrayContaining(['BC614E', '12345678']));
    });

    it('sem tag continua gravando null', async () => {
      const { svc, prisma } = build();

      await svc.create(dto(undefined));

      expect(prisma.moradores.create.mock.calls[0][0].data.tag_rfid).toBeNull();
    });

    it('tag inválida é recusada antes de gravar', async () => {
      const { svc, prisma } = build();

      await expect(svc.create(dto('TAG#1'))).rejects.toThrow(/tag inválido/i);

      expect(prisma.moradores.create).not.toHaveBeenCalled();
    });
  });

  describe('visitante/prestador (atualizarPessoa)', () => {
    const flag = process.env['PESSOAS_MIGRATION_ENABLED'];
    beforeAll(() => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    });
    afterAll(() => {
      if (flag === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
      else process.env['PESSOAS_MIGRATION_ENABLED'] = flag;
    });

    function build() {
      const svc: any = Object.create(VisitantesService.prototype);
      // Sem tag gravada e sem conflito: `tagIgualAGravada` e a unicidade por
      // variantes (tag-em-uso.util.spec.ts) não acham nada.
      svc.prisma = {
        pessoas: {},
        visitas: { findFirst: jest.fn(async () => null) },
        tags: { findFirst: jest.fn(async () => null) },
        moradores: { findFirst: jest.fn(async () => null) },
      };
      svc.atualizarPessoaViaPessoasVisitas = jest.fn(async () => ({ ok: true }));
      return svc;
    }

    it('grava a tag normalizada', async () => {
      const svc = build();

      await svc.atualizarPessoa(1, 10, { tag_rfid: ' 00bc:61:4e ' });

      expect(svc.atualizarPessoaViaPessoasVisitas).toHaveBeenCalledWith(
        1,
        10,
        expect.objectContaining({ tag_rfid: 'BC614E' }),
      );
    });

    it.each([[''], [null]])('tag %p continua limpando a credencial', async (vazio) => {
      const svc = build();

      await svc.atualizarPessoa(1, 10, { tag_rfid: vazio });

      expect(svc.atualizarPessoaViaPessoasVisitas.mock.calls[0][2].tag_rfid).toBeNull();
    });

    it('sem tag no corpo, não mexe na credencial', async () => {
      const svc = build();

      await svc.atualizarPessoa(1, 10, { nome: 'Novo' });

      expect(svc.atualizarPessoaViaPessoasVisitas.mock.calls[0][2]).not.toHaveProperty('tag_rfid');
    });

    it('tag inválida é recusada', async () => {
      const svc = build();

      await expect(svc.atualizarPessoa(1, 10, { tag_rfid: 'TAG#1' })).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(svc.atualizarPessoaViaPessoasVisitas).not.toHaveBeenCalled();
    });
  });
});
