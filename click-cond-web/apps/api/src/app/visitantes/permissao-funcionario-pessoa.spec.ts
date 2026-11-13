import { ForbiddenException } from '@nestjs/common';
import { VisitantesService } from './visitantes.service';
import { VisitantesController } from './visitantes.controller';
import { PessoasController } from '../pessoas/pessoas.controller';
import { AreasSociaisService } from '../areas-sociais/areas-sociais.service';
import { TenantAccessService } from '../auth/tenant-access.service';

/**
 * O funcionário do app com a flag desligada pelo síndico seguia editando/removendo o cadastro inteiro
 * de uma pessoa (inclusive desbloqueando), criando pessoas e confirmando a reserva de outro morador.
 */
describe('Flag do funcionário do app — pessoa, POST /pessoas e confirmar reserva', () => {
  const ENV = process.env['PESSOAS_MIGRATION_ENABLED'];
  afterEach(() => {
    if (ENV === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = ENV;
  });

  const funcionario: any = { sub: 9, nome: 'Zelador', typeAccess: 'Funcionario', user: { id: 9 } };

  /** Vínculo do funcionário com o condomínio e as flags saem da mesma linha (como em permissao-cadastrar-visitante). */
  function prismaCom(flags: Record<string, number>, extra: any = {}) {
    return { isConnected: true, funcionarios: { findFirst: jest.fn(async () => ({ id: 1, ...flags })) }, ...extra };
  }

  describe.each([['legado', 'false'], ['Pessoas/Visitas', 'true']])('editar/remover pessoa (%s)', (_n, flag) => {
    beforeEach(() => { process.env['PESSOAS_MIGRATION_ENABLED'] = flag; });

    function build(cadastrar_visitante: number) {
      const prisma: any = prismaCom({ cadastrar_visitante }, {
        visitantes: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(async () => []), updateMany: jest.fn(), deleteMany: jest.fn() },
        visitas: { findUnique: jest.fn(), findMany: jest.fn(async () => []), updateMany: jest.fn(), deleteMany: jest.fn() },
        pessoas: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
      });
      const svc = new VisitantesService(prisma, {} as any, {} as any, {} as any, { registrar: jest.fn() } as any, new TenantAccessService(prisma));
      return { svc, prisma };
    }

    it('sem cadastrar_visitante: 403 antes de qualquer leitura/escrita da pessoa', async () => {
      const { svc, prisma } = build(0);
      await expect(svc.atualizarPessoa(1, 500, { tag_rfid: 'ABC123', bloqueado: 0 } as any, funcionario)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.removerPessoa(1, 500, funcionario)).rejects.toBeInstanceOf(ForbiddenException);
      for (const t of ['visitantes', 'visitas', 'pessoas']) {
        for (const m of Object.keys(prisma[t])) expect(prisma[t][m]).not.toHaveBeenCalled();
      }
    });
  });

  it('VisitantesController repassa o payload para o service', async () => {
    const service: any = { atualizarPessoa: jest.fn(async () => ({})), removerPessoa: jest.fn(async () => ({ ok: true })) };
    const ctrl = new VisitantesController(service);
    const porteiro: any = { sub: 3, nome: 'Portaria', id_condominio: 1, turno: 'Manha' };
    await ctrl.atualizarPessoa(1, 5, { nome: 'Novo' }, porteiro);
    await ctrl.removerPessoa(1, 5, porteiro);
    expect(service.atualizarPessoa).toHaveBeenCalledWith(1, 5, { nome: 'Novo' }, porteiro);
    expect(service.removerPessoa).toHaveBeenCalledWith(1, 5, porteiro);
  });

  it('POST /pessoas sem cadastrar_visitante: 403 e nada gravado', async () => {
    const prisma: any = prismaCom({ cadastrar_visitante: 0 });
    const service: any = { obterOuCriar: jest.fn(async () => ({ id: 1 })), fotosDaPessoaExistente: jest.fn(async () => []) };
    const ctrl = new PessoasController(service, { exigirArquivoDoRegistro: jest.fn(async () => undefined) } as any, new TenantAccessService(prisma));
    await expect(ctrl.criar(1, { nome: 'Fulano', doc_identificacao: '52998224725' } as any, funcionario)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.obterOuCriar).not.toHaveBeenCalled();
  });

  describe('confirmar reserva', () => {
    function build(areas_sociais: number, idDono: number) {
      const prisma: any = prismaCom({ areas_sociais }, {
        areas_Sociais_Agendamentos: {
          findUnique: jest.fn(async () => ({ id: 1, id_user: idDono, status: 'aprovado', confirmada_em: null, area: { id_condominio: 2 } })),
          update: jest.fn(async () => ({})),
        },
      });
      return { svc: new AreasSociaisService(prisma, {} as any, {} as any, {} as any, new TenantAccessService(prisma)), prisma };
    }

    it('reserva de outro morador sem areas_sociais: 403, nada gravado', async () => {
      const { svc, prisma } = build(0, 20);
      await expect(svc.confirmarAgendamento(1, 9, 'Funcionario', funcionario)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.areas_Sociais_Agendamentos.update).not.toHaveBeenCalled();
    });

    it('com a flag, ou a própria reserva, continua confirmando', async () => {
      const comFlag = build(1, 20);
      await comFlag.svc.confirmarAgendamento(1, 9, 'Funcionario', funcionario);
      expect(comFlag.prisma.areas_Sociais_Agendamentos.update).toHaveBeenCalled();
      const propria = build(0, 9);
      await propria.svc.confirmarAgendamento(1, 9, 'Funcionario', funcionario);
      expect(propria.prisma.areas_Sociais_Agendamentos.update).toHaveBeenCalled();
    });
  });
});
