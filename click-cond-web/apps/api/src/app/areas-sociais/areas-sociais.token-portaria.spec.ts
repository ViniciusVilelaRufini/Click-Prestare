import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AreasSociaisController } from './areas-sociais.controller';
import { AreasSociaisService } from './areas-sociais.service';

describe('Áreas sociais — token do porteiro não vira morador de mesmo número', () => {
  const porteiro = { sub: 7, nome: 'Portaria', id_condominio: 1, turno: 'Manha', tipo_sub: 'funcionario_portaria' } as any;
  const morador = { sub: 6, nome: 'Morador', typeAccess: 'Morador', user: { id: 6 } } as any;
  const ag = { id_area_social: 30, id_apartamento: 100, data: '10/06/2027', horaDe: '10:00', horaAte: '11:00' };

  describe('controller', () => {
    function ctrl() {
      const service: any = {
        insertAgendamento: jest.fn(async () => ({ success: true })),
        removeAgendamento: jest.fn(async () => ({ success: true })),
        confirmarAgendamento: jest.fn(async () => ({ success: true })),
        getAllMeusAgendamentos: jest.fn(async () => []),
      };
      return { c: new AreasSociaisController(service), service };
    }

    it('porteiro: sem Users.id e papel de operador (não "Morador")', async () => {
      const { c, service } = ctrl();
      await c.insertAgendamento({ agendamento: ag }, porteiro);
      await c.removeAgendamento({ id: 5 }, porteiro);
      await c.confirmarAgendamento({ id: 5 }, porteiro);
      expect(service.insertAgendamento).toHaveBeenCalledWith(ag, null, 'Operador', porteiro);
      expect(service.removeAgendamento).toHaveBeenCalledWith(5, null, 'Operador', porteiro);
      expect(service.confirmarAgendamento).toHaveBeenCalledWith(5, null, 'Operador', porteiro);
    });

    it('morador do app: Users.id e papel do token', async () => {
      const { c, service } = ctrl();
      await c.insertAgendamento({ agendamento: ag }, morador);
      expect(service.insertAgendamento).toHaveBeenCalledWith(ag, 6, 'Morador', morador);
    });

    it('token sem papel e sem condomínio (ex.: CRM) é recusado', async () => {
      const { c, service } = ctrl();
      expect(() => c.insertAgendamento({ agendamento: ag }, { sub: 9, role: 'crm_admin' } as any)).toThrow(ForbiddenException);
      expect(service.insertAgendamento).not.toHaveBeenCalled();
    });

    it('"minhas reservas" do porteiro: 403 em vez das reservas do Users de mesmo número', () => {
      const { c, service } = ctrl();
      expect(() => c.getAllMeusAgendamentos('1', undefined, porteiro)).toThrow(ForbiddenException);
      expect(service.getAllMeusAgendamentos).not.toHaveBeenCalled();
    });
  });

  describe('service.insertAgendamento', () => {
    function build(aptosDoUsuario: Array<{ id_apto: number; id_condominio: number }>) {
      const prisma: any = {
        isConnected: true,
        areas_Sociais: { findUnique: jest.fn(async () => ({ id: 30, id_condominio: 2, precisa_autorizacao: 0 })) },
        apartamentos_Users: {
          findMany: jest.fn(async ({ where }: any) =>
            aptosDoUsuario
              .filter((a) => where.apartamento?.id_condominio === undefined || a.id_condominio === where.apartamento.id_condominio)
              .map((a) => ({ id_apto: a.id_apto })),
          ),
        },
        areas_Sociais_Agendamentos: { create: jest.fn(async () => ({ id: 1 })) },
      };
      const tenant: any = { assertEntidade: jest.fn(async () => undefined), assertPermissaoFuncionario: jest.fn(async () => undefined) };
      return { svc: new AreasSociaisService(prisma, {} as any, {} as any, {} as any, tenant), prisma };
    }

    it('operador sem Users.id e sem "reservar em nome do apartamento": recusa, não cria reserva sem dono', async () => {
      const { svc, prisma } = build([]);
      await expect(svc.insertAgendamento({ ...ag }, null, 'Operador', porteiro)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.areas_Sociais_Agendamentos.create).not.toHaveBeenCalled();
    });

    it('morador: o apartamento tem de ser do condomínio da área', async () => {
      // apto 100 é do morador, mas no condomínio 3; a área é do condomínio 2.
      const { svc, prisma } = build([{ id_apto: 100, id_condominio: 3 }]);
      await expect(svc.insertAgendamento({ ...ag }, 6, 'Morador', morador)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.apartamentos_Users.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id_user: 6, apartamento: { id_condominio: 2 } } }),
      );
      expect(prisma.areas_Sociais_Agendamentos.create).not.toHaveBeenCalled();
    });
  });
});
