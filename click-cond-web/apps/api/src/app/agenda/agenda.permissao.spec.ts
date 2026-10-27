import { ForbiddenException } from '@nestjs/common';
import { AgendaService } from './agenda.service';

/**
 * O app esconde "Manutenções Programadas" de quem tem a flag
 * `manutencoes_programadas` em 0 (list_agenda.dart), mas o servidor só
 * exigia `assertStaff` — "não é morador". O funcionário restringido pelo
 * síndico publicava, editava e apagava manutenção (com alerta aos moradores)
 * chamando a rota direto.
 */
describe('AgendaService — exige a permissão manutencoes_programadas', () => {
  function build() {
    const tenant = {
      assertCondominio: jest.fn(async () => undefined),
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async (_id: number, flag: string, payload: any) => {
        if (payload?.typeAccess?.toLowerCase() !== 'funcionario') return;
        if (payload.permissoes?.[flag] !== 1) {
          throw new ForbiddenException('Acesso negado: seu perfil não tem permissão para esta área.');
        }
      }),
    };
    const prisma: any = {
      isConnected: true,
      agenda: {
        findUnique: jest.fn(async () => ({ id_condominio: 2 })),
        create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
        update: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
        delete: jest.fn(async () => ({})),
      },
    };
    return { service: new AgendaService(prisma, tenant as any), prisma, tenant };
  }

  const semPermissao: any = { sub: 5, typeAccess: 'Funcionario', user: { id: 5 }, permissoes: { manutencoes_programadas: 0 } };
  const comPermissao: any = { sub: 6, typeAccess: 'Funcionario', user: { id: 6 }, permissoes: { manutencoes_programadas: 1 } };
  const sindico: any = { sub: 9, typeAccess: 'Sindico', user: { id: 9 } };
  const manutencao = { id: 1, titulo: 'Bomba', data_inicio: '2026-11-01' };

  it('NEGA funcionário sem a flag em create/update/remove e não grava nada', async () => {
    const { service, prisma } = build();
    await expect(service.create(2, manutencao, semPermissao)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.update(2, manutencao, semPermissao)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.remove(1, semPermissao)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.agenda.create).not.toHaveBeenCalled();
    expect(prisma.agenda.update).not.toHaveBeenCalled();
    expect(prisma.agenda.delete).not.toHaveBeenCalled();
  });

  it('PERMITE funcionário com a flag e o síndico', async () => {
    const { service, prisma } = build();
    await service.create(2, manutencao, comPermissao);
    await service.update(2, manutencao, sindico);
    await service.remove(1, comPermissao);
    expect(prisma.agenda.create).toHaveBeenCalled();
    expect(prisma.agenda.update).toHaveBeenCalled();
    expect(prisma.agenda.delete).toHaveBeenCalled();
  });

  it('em update/remove checa no condomínio da manutenção, não no id do cliente', async () => {
    const { service, tenant } = build();
    await service.update(999, manutencao, comPermissao);
    expect(tenant.assertPermissaoFuncionario).toHaveBeenCalledWith(2, 'manutencoes_programadas', comPermissao);
  });
});
