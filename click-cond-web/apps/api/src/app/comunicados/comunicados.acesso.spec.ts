import { ForbiddenException } from '@nestjs/common';
import { ComunicadosService } from './comunicados.service';
import { ComunicadosController } from './comunicados.controller';

/**
 * Rodada 4 — `GET condominios/:id/comunicados/acesso` → `{ gerenciar }`, no
 * padrão de `GET ocorrencias/acesso`: a mesma regra das rotas de escrita
 * (assertStaff + flag `comunicados` do funcionário do app), para o console
 * esconder Novo/Editar/Excluir de quem tomaria 403.
 */
describe('ComunicadosService.acesso', () => {
  function build(opts: { tenantFalha?: Error } = {}) {
    const tenant = {
      assertCondominio: jest.fn(async (_id: number, user: any) => {
        if (user?.outroCondominio) throw new ForbiddenException('Acesso negado: condomínio');
      }),
      assertPermissaoFuncionario: jest.fn(async (_id: number, _flag: string, payload: any) => {
        if (opts.tenantFalha) throw opts.tenantFalha;
        if ((payload?.typeAccess ?? '').toLowerCase() !== 'funcionario') return;
        if (payload.permissoes?.comunicados !== 1) {
          throw new ForbiddenException('Acesso negado: seu perfil não tem permissão para esta área.');
        }
      }),
    };
    const service = new ComunicadosService({ isConnected: true } as any, {} as any, tenant as any, {} as any);
    return { service, tenant };
  }

  const sindico: any = { sub: 9, typeAccess: 'Sindico', id_condominio: 2, user: { id: 9 } };
  const comFlag: any = { sub: 6, typeAccess: 'Funcionario', id_condominio: 2, user: { id: 6 }, permissoes: { comunicados: 1 } };
  const semFlag: any = { sub: 5, typeAccess: 'Funcionario', id_condominio: 2, user: { id: 5 }, permissoes: { comunicados: 0 } };
  // Login/senha da portaria-web: token sem typeAccess.
  const porteiro: any = { sub: 3, nome: 'Porteiro', id_condominio: 2, turno: 'Noite' };

  it('síndico gerencia', async () => {
    await expect(build().service.acesso(2, sindico)).resolves.toEqual({ gerenciar: true });
  });

  it('funcionário do app com a flag gerencia; sem a flag, não', async () => {
    const { service, tenant } = build();
    await expect(service.acesso(2, comFlag)).resolves.toEqual({ gerenciar: true });
    await expect(service.acesso(2, semFlag)).resolves.toEqual({ gerenciar: false });
    expect(tenant.assertPermissaoFuncionario).toHaveBeenCalledWith(2, 'comunicados', semFlag);
  });

  it('porteiro continua só leitura', async () => {
    const { service, tenant } = build();
    await expect(service.acesso(2, porteiro)).resolves.toEqual({ gerenciar: false });
    expect(tenant.assertPermissaoFuncionario).not.toHaveBeenCalled();
  });

  it('isolamento: sessão de outro condomínio é recusada', async () => {
    await expect(build().service.acesso(2, { ...sindico, outroCondominio: true })).rejects.toThrow(ForbiddenException);
  });

  it('erro que não é de permissão sobe (não vira "sem acesso")', async () => {
    const { service } = build({ tenantFalha: new Error('banco fora') });
    await expect(service.acesso(2, comFlag)).rejects.toThrow('banco fora');
  });

  it('controller: rota declarada antes de :id e repassa condomínio e sessão', async () => {
    const service: any = { acesso: jest.fn(async () => ({ gerenciar: true })) };
    const ctrl = new ComunicadosController(service);
    await expect((ctrl as any).acesso(2, sindico)).resolves.toEqual({ gerenciar: true });
    expect(service.acesso).toHaveBeenCalledWith(2, sindico);
    const metodos = Object.getOwnPropertyNames(ComunicadosController.prototype);
    expect(metodos.indexOf('acesso')).toBeLessThan(metodos.indexOf('get'));
  });
});
