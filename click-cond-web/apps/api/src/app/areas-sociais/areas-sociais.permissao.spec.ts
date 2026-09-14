import { ForbiddenException } from '@nestjs/common';
import { AreasSociaisService } from './areas-sociais.service';

/**
 * Duas flags moram neste serviço: `areas_sociais` (as áreas em si e a decisão
 * sobre reservas) e `manutencoes_programadas` (bloquear a área para
 * manutenção). O app respeitava as duas — list_areas_sociais.dart:58,75 e
 * area_social_detail.dart:136,539 escondem os botões —, o serviço exigia
 * apenas `assertOperador`, que só distingue operador de morador.
 *
 * Escopo deliberado: a checagem NÃO entra no agendamento comum de morador.
 * `insertAgendamento` é a rota que o morador usa para reservar, e um
 * funcionário que também mora no condomínio continua reservando como qualquer
 * outro. A flag é cobrada onde a ação é de operação: criar/editar/remover
 * área, decidir reserva alheia, e a manutenção.
 */
describe('AreasSociaisService — flags areas_sociais e manutencoes_programadas', () => {
  function build() {
    const tenant = {
      assertCondominio: jest.fn(async () => undefined),
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async (_id: number, flag: string, payload: any) => {
        if ((payload?.typeAccess ?? '').toLowerCase() !== 'funcionario') return;
        if (payload.permissoes?.[flag] !== 1) {
          throw new ForbiddenException('Acesso negado: seu perfil não tem permissão para esta área.');
        }
      }),
    };
    const prisma: any = {
      isConnected: true,
      areas_Sociais: {
        create: jest.fn(async () => ({ id: 4, nome: 'Salão', id_condominio: 2 })),
        update: jest.fn(async () => ({ id: 4 })),
        delete: jest.fn(async () => ({ id: 4 })),
        findUnique: jest.fn(async () => ({ id: 4, nome: 'Salão', id_condominio: 2 })),
      },
      areas_Sociais_Manutencoes: {
        create: jest.fn(async () => ({ id: 8 })),
        update: jest.fn(async () => ({ id: 8 })),
        delete: jest.fn(async () => ({ id: 8 })),
        findUnique: jest.fn(async () => ({ id: 8, area: { id_condominio: 2, nome: 'Salão' } })),
        findMany: jest.fn(async () => []),
      },
      areas_Sociais_Agendamentos: {
        findUnique: jest.fn(async () => ({ id: 20, area: { id_condominio: 2 } })),
        findMany: jest.fn(async () => []),
        update: jest.fn(async () => ({ id: 20 })),
      },
    };
    const service = new AreasSociaisService(
      prisma,
      { enviarParaUsuario: jest.fn() } as any,
      // storage: o caminho de sucesso passa por isDataUrl ao salvar a foto da area.
      { isDataUrl: jest.fn(() => false), uploadDataUrl: jest.fn(async () => null) } as any,
      {} as any,
      tenant as any,
    );
    return { service, prisma, tenant };
  }

  function func(flags: Record<string, number>): any {
    return { sub: 5, typeAccess: 'Funcionario', user: { id: 5 }, permissoes: flags };
  }

  const semNada = func({ areas_sociais: 0, manutencoes_programadas: 0 });
  const comAreas = func({ areas_sociais: 1, manutencoes_programadas: 0 });
  const comManutencao = func({ areas_sociais: 0, manutencoes_programadas: 1 });
  const sindico: any = { sub: 9, typeAccess: 'Sindico', user: { id: 9 } };

  const area: any = { nome: 'Salão', id: 4 };

  describe('areas_sociais', () => {
    it('NEGA criar área sem a flag', async () => {
      const { service, prisma } = build();
      await expect(service.insert(2, area, semNada)).rejects.toThrow(ForbiddenException);
      expect(prisma.areas_Sociais.create).not.toHaveBeenCalled();
    });

    it('NEGA editar área sem a flag', async () => {
      const { service, prisma } = build();
      await expect(service.update(2, area, semNada)).rejects.toThrow(ForbiddenException);
      expect(prisma.areas_Sociais.update).not.toHaveBeenCalled();
    });

    it('NEGA remover área sem a flag', async () => {
      const { service, prisma } = build();
      await expect(service.remove(4, semNada)).rejects.toThrow(ForbiddenException);
      expect(prisma.areas_Sociais.delete).not.toHaveBeenCalled();
    });

    it('PERMITE quem tem a flag', async () => {
      const { service, prisma } = build();
      await service.insert(2, area, comAreas);
      expect(prisma.areas_Sociais.create).toHaveBeenCalled();
    });

    it('PERMITE o síndico', async () => {
      const { service, prisma } = build();
      await service.insert(2, area, sindico);
      expect(prisma.areas_Sociais.create).toHaveBeenCalled();
    });

    it('a flag de manutenção não substitui a de áreas', async () => {
      const { service } = build();
      await expect(service.insert(2, area, comManutencao)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('manutencoes_programadas', () => {
    const manutencao: any = { id: 8, id_area_social: 4, data_inicio: '01/10/2026', data_fim: '02/10/2026' };

    it('NEGA agendar manutenção sem a flag', async () => {
      const { service, prisma } = build();
      await expect(service.insertManutencao(manutencao, semNada)).rejects.toThrow(ForbiddenException);
      expect(prisma.areas_Sociais_Manutencoes.create).not.toHaveBeenCalled();
    });

    it('NEGA remover manutenção sem a flag', async () => {
      const { service, prisma } = build();
      await expect(service.removeManutencao(8, semNada)).rejects.toThrow(ForbiddenException);
      expect(prisma.areas_Sociais_Manutencoes.delete).not.toHaveBeenCalled();
    });

    it('a flag de áreas não substitui a de manutenção', async () => {
      const { service } = build();
      await expect(service.insertManutencao(manutencao, comAreas)).rejects.toThrow(ForbiddenException);
    });
  });
});
