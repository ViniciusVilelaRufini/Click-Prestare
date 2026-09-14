import { ForbiddenException } from '@nestjs/common';
import { ComunicadosService } from './comunicados.service';

/**
 * A flag `comunicados` decide, na tela de permissões, se o funcionário pode
 * publicar no mural do condomínio. O app respeitava
 * (list_comunicados.dart:44 escondia o botão), mas o servico so exigia
 * `assertStaff` — "nao e morador". Bastava chamar a rota direto.
 *
 * Publicar comunicado é comunicação oficial para todos os moradores, em nome
 * do condomínio: não é o tipo de coisa que qualquer funcionário deve poder
 * fazer só por estar logado.
 */
describe('ComunicadosService — exige a flag comunicados', () => {
  function build() {
    const tenant = {
      assertCondominio: jest.fn(async () => undefined),
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async (_id: number, _flag: string, payload: any) => {
        if ((payload?.typeAccess ?? '').toLowerCase() !== 'funcionario') return;
        if (payload.permissoes?.comunicados !== 1) {
          throw new ForbiddenException('Acesso negado: seu perfil não tem permissão para esta área.');
        }
      }),
    };
    const prisma: any = {
      isConnected: true,
      comunicados: {
        create: jest.fn(async () => ({ id: 11, titulo: 'Aviso', id_condominio: 2 })),
        findUnique: jest.fn(async () => ({ id: 11, titulo: 'Aviso', id_condominio: 2 })),
        update: jest.fn(async () => ({ id: 11, titulo: 'Aviso editado', id_condominio: 2 })),
        delete: jest.fn(async () => ({ id: 11 })),
      },
    };
    const auditoria = { registrar: jest.fn(async () => undefined) };
    const service = new ComunicadosService(prisma, auditoria as any, tenant as any);
    return { service, prisma, tenant };
  }

  const semFlag: any = {
    sub: 5,
    typeAccess: 'Funcionario',
    user: { id: 5 },
    permissoes: { comunicados: 0 },
  };
  const comFlag: any = {
    sub: 6,
    typeAccess: 'Funcionario',
    user: { id: 6 },
    permissoes: { comunicados: 1 },
  };
  const sindico: any = { sub: 9, typeAccess: 'Sindico', user: { id: 9 } };

  const dto: any = { titulo: 'Aviso', descricao: 'corpo', id_condominio: 2 };

  it('NEGA publicar sem a flag', async () => {
    const { service, prisma } = build();
    await expect(service.create(dto, semFlag)).rejects.toThrow(ForbiddenException);
    expect(prisma.comunicados.create).not.toHaveBeenCalled();
  });

  it('NEGA editar sem a flag', async () => {
    const { service, prisma } = build();
    await expect(service.update(11, { titulo: 'x' }, semFlag)).rejects.toThrow(ForbiddenException);
    expect(prisma.comunicados.update).not.toHaveBeenCalled();
  });

  it('NEGA remover sem a flag', async () => {
    const { service, prisma } = build();
    await expect(service.remove(11, semFlag)).rejects.toThrow(ForbiddenException);
    expect(prisma.comunicados.delete).not.toHaveBeenCalled();
  });

  it('PERMITE funcionário com a flag', async () => {
    const { service, prisma } = build();
    await service.create(dto, comFlag);
    expect(prisma.comunicados.create).toHaveBeenCalled();
  });

  it('PERMITE o síndico', async () => {
    const { service, prisma } = build();
    await service.create(dto, sindico);
    expect(prisma.comunicados.create).toHaveBeenCalled();
  });

  it('na edição, checa a permissão no condomínio do comunicado, não num id do cliente', async () => {
    const { service, tenant } = build();
    await service.update(11, { titulo: 'x' }, comFlag);
    expect(tenant.assertPermissaoFuncionario).toHaveBeenCalledWith(2, 'comunicados', comFlag);
  });
});
