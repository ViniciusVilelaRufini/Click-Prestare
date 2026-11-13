import { ForbiddenException } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';
import { TenantAccessService } from './tenant-access.service';

/**
 * /sindico/signup é público e /condominio/register criava um condomínio ATIVO com o chamador como
 * síndico: bastava isso para cadastrar morador e ligar contas de outros prédios. Agora nasce pendente
 * (ativo 0) até o CRM reativar; os gates de condomínio.ativo existentes já barram as rotas de dados.
 */
describe('POST /condominio/register — condomínio autocadastrado nasce pendente', () => {
  it('cria com ativo 0 e o vínculo do síndico', async () => {
    const prisma: any = {
      isConnected: true,
      endereco: { create: jest.fn(async () => ({ id: 3 })) },
      condominios: { create: jest.fn(async ({ data }: any) => ({ id: 77, nome: data.nome })) },
      sindicos_Condominios: { create: jest.fn(async () => ({})) },
    };
    const svc = new MobileAuthService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
    await svc.registerCondominio({ condominio: { nome: 'Edifício Teste' }, address: { cep: '15800000' } }, 5);
    expect(prisma.condominios.create.mock.calls[0][0].data.ativo).toBe(0);
    expect(prisma.sindicos_Condominios.create).toHaveBeenCalledWith({ data: { id_user: 5, id_condominio: 77 } });
  });

  it('(verificação) enquanto pendente, o síndico não cadastra nem lista moradores', async () => {
    const prisma: any = {
      isConnected: true,
      // O vínculo existe, mas a consulta com condominio.ativo = 1 não o acha (condomínio pendente).
      sindicos_Condominios: { findFirst: jest.fn(async ({ where }: any) => (where?.condominio?.ativo === 1 ? null : { id: 1 })) },
      apartamentos: { findUnique: jest.fn(async () => ({ id: 11, id_condominio: 77, bloco: 'A', apto: '101' })) },
      moradores: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
    };
    const svc = new MobileAuthService(prisma, {} as any, {} as any, {} as any, {} as any, new TenantAccessService(prisma));
    const sindico = { sub: 5, nome: 'S', typeAccess: 'Sindico' } as any;
    await expect(
      svc.saveMorador({ id_condominio: 77, morador: { id_apto: 11, nome: 'M', data_nascimento: '01/01/1990' } }, false, sindico),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.getAllMoradores(77, sindico)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.moradores.findFirst).not.toHaveBeenCalled();
    expect(prisma.moradores.findMany).not.toHaveBeenCalled();
  });
});
