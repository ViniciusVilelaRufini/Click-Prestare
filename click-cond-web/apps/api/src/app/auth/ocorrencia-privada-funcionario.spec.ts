import { ForbiddenException } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';

/**
 * Ocorrência marcada como NÃO pública é o canal onde o morador relata briga de
 * vizinho, problema de saúde, dívida, assédio. `getOcorrenciaById` tratava
 * qualquer `Funcionario` como privilegiado e entregava o conteúdo inteiro —
 * ignorando a flag `ocorrencias`, que o síndico usa justamente para definir
 * quem da equipe pode ver isso.
 */
describe('getOcorrenciaById — ocorrência privada e a flag ocorrencias', () => {
  function build(publica: boolean) {
    const tenant = {
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async (_id: number, _flag: string, payload: any) => {
        if ((payload?.typeAccess ?? '').toLowerCase() !== 'funcionario') return;
        if (payload.permissoes?.ocorrencias !== 1) {
          throw new ForbiddenException('Acesso negado: seu perfil não tem permissão para esta área.');
        }
      }),
    };
    const prisma: any = {
      isConnected: true,
      ocorrencias: {
        findUnique: jest.fn(async () => ({
          id: 7,
          id_condominio: 2,
          user: 100,
          publica,
          titulo: 'Vizinho do 302 me ameaçou',
          descricao: 'Detalhes sensíveis',
          categoria: { nome: 'Segurança' },
          criadoPor: { name: 'Morador' },
          id_responsavel: null,
        })),
      },
      users: { findUnique: jest.fn(async () => null) },
    };
    const service = new MobileAuthService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      tenant as any,
      {} as any,
    );
    return { service, prisma, tenant };
  }

  const funcSemFlag: any = {
    sub: 5,
    typeAccess: 'Funcionario',
    user: { id: 5 },
    permissoes: { ocorrencias: 0 },
  };
  const funcComFlag: any = {
    sub: 6,
    typeAccess: 'Funcionario',
    user: { id: 6 },
    permissoes: { ocorrencias: 1 },
  };
  const sindico: any = { sub: 9, typeAccess: 'Sindico', user: { id: 9 } };
  const autor: any = { sub: 100, typeAccess: 'Morador', user: { id: 100 } };
  const outroMorador: any = { sub: 200, typeAccess: 'Morador', user: { id: 200 } };

  it('NEGA funcionário sem a flag ocorrencias numa ocorrência privada', async () => {
    const { service } = build(false);
    await expect(service.getOcorrenciaById(7, funcSemFlag)).rejects.toThrow(ForbiddenException);
  });

  it('PERMITE funcionário com a flag', async () => {
    const { service } = build(false);
    const r = await service.getOcorrenciaById(7, funcComFlag);
    expect(r).not.toBeNull();
  });

  it('PERMITE o síndico', async () => {
    const { service } = build(false);
    expect(await service.getOcorrenciaById(7, sindico)).not.toBeNull();
  });

  it('o autor continua vendo a própria ocorrência', async () => {
    const { service } = build(false);
    expect(await service.getOcorrenciaById(7, autor)).not.toBeNull();
  });

  it('outro morador continua barrado', async () => {
    const { service } = build(false);
    await expect(service.getOcorrenciaById(7, outroMorador)).rejects.toThrow(ForbiddenException);
  });

  /**
   * Ocorrência pública é mural do condomínio: a flag não deve transformá-la
   * em conteúdo restrito para quem já podia ler.
   */
  it('ocorrência pública segue visível para funcionário sem a flag', async () => {
    const { service } = build(true);
    expect(await service.getOcorrenciaById(7, funcSemFlag)).not.toBeNull();
  });
});
