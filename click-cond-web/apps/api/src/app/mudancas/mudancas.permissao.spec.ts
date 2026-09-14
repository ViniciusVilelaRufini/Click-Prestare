import { ForbiddenException } from '@nestjs/common';
import { MudancasService } from './mudancas.service';

/**
 * Aprovar ou recusar uma mudança é a ação que de fato libera o elevador e a
 * portaria. `updateStatus` exigia apenas `assertStaff` — ou seja, "não é
 * morador" —, então qualquer funcionário logado decidia, inclusive um com a
 * flag `agendar_mudanca` desligada de propósito pelo síndico.
 *
 * O app tinha a mesma falha em espelho: o botão "+" de agendar checava a
 * permissão (list_mudancas.dart:59), mas a decisão checava só
 * `getUserType() != 'morador'`.
 */
describe('updateStatus — exige a permissão agendar_mudanca', () => {
  function build() {
    const tenant = {
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async (_id: number, _flag: string, payload: any) => {
        if (payload?.typeAccess?.toLowerCase() !== 'funcionario') return;
        if (payload.permissoes?.agendar_mudanca !== 1) {
          throw new ForbiddenException('Acesso negado: seu perfil não tem permissão para esta área.');
        }
      }),
    };
    const prisma: any = {
      isConnected: true,
      mudancas: {
        findUnique: jest.fn(async () => ({ id: 3, id_condominio: 2 })),
        update: jest.fn(async () => ({ id: 3, status: 'aprovada' })),
      },
    };
    return { service: new MudancasService(prisma, tenant as any), prisma, tenant };
  }

  const semPermissao: any = {
    sub: 5,
    typeAccess: 'Funcionario',
    user: { id: 5 },
    permissoes: { agendar_mudanca: 0 },
  };
  const comPermissao: any = {
    sub: 6,
    typeAccess: 'Funcionario',
    user: { id: 6 },
    permissoes: { agendar_mudanca: 1 },
  };
  const sindico: any = { sub: 9, typeAccess: 'Sindico', user: { id: 9 } };

  it('NEGA funcionário sem a permissão', async () => {
    const { service } = build();
    await expect(service.updateStatus(3, true, '', semPermissao)).rejects.toThrow(ForbiddenException);
  });

  it('não grava nada quando nega', async () => {
    const { service, prisma } = build();
    await expect(service.updateStatus(3, true, '', semPermissao)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.mudancas.update).not.toHaveBeenCalled();
  });

  it('PERMITE funcionário com a permissão', async () => {
    const { service, prisma } = build();
    await service.updateStatus(3, true, '', comPermissao);
    expect(prisma.mudancas.update).toHaveBeenCalled();
  });

  it('PERMITE o síndico', async () => {
    const { service, prisma } = build();
    await service.updateStatus(3, false, 'elevador em manutenção', sindico);
    expect(prisma.mudancas.update).toHaveBeenCalled();
  });

  it('checa a permissão no condomínio da mudança, não num id do cliente', async () => {
    const { service, tenant } = build();
    await service.updateStatus(3, true, '', comPermissao);
    expect(tenant.assertPermissaoFuncionario).toHaveBeenCalledWith(2, 'agendar_mudanca', comPermissao);
  });
});
