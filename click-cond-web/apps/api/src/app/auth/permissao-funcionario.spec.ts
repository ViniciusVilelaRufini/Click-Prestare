import { ForbiddenException } from '@nestjs/common';
import { TenantAccessService } from './tenant-access.service';
import type { JwtPayload } from './jwt-payload.interface';

/**
 * A tabela `Funcionarios` tem um flag por área (`cadastrar_visitante`,
 * `prestadores_servico`, …) e o app os respeita: `getUserPermission(...) == 1`
 * decide se o botão aparece. Só que o servidor nunca os consultava — eram
 * enviados no login e checados apenas na tela.
 *
 * Autorização de cliente não é autorização: bastava chamar a rota direto.
 * E em produção não era hipótese — havia funcionário com os dois flags em 0,
 * deliberadamente restringido pelo síndico, que mesmo assim conseguia
 * cadastrar visitante e mexer em prestador pela API.
 */
describe('TenantAccessService.assertPermissaoFuncionario', () => {
  function build(func: { cadastrar_visitante: number; prestadores_servico: number } | null) {
    const prisma: any = {
      isConnected: true,
      funcionarios: { findFirst: jest.fn(async () => func) },
    };
    return new TenantAccessService(prisma);
  }

  const funcionario: JwtPayload = { sub: 20, nome: 'Bruno', typeAccess: 'Funcionario' };
  const morador: JwtPayload = { sub: 21, nome: 'Morador', typeAccess: 'Morador' };
  const sindico: JwtPayload = { sub: 22, nome: 'Síndico', typeAccess: 'Sindico' };
  const consoleOp: JwtPayload = { sub: 23, nome: 'Porteiro', id_condominio: 1 };

  it('NEGA funcionário sem o flag de visitante', async () => {
    const svc = build({ cadastrar_visitante: 0, prestadores_servico: 1 });
    await expect(svc.assertPermissaoFuncionario(1, 'cadastrar_visitante', funcionario))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('NEGA funcionário sem o flag de prestadores', async () => {
    const svc = build({ cadastrar_visitante: 1, prestadores_servico: 0 });
    await expect(svc.assertPermissaoFuncionario(1, 'prestadores_servico', funcionario))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('PERMITE funcionário com o flag ligado', async () => {
    const svc = build({ cadastrar_visitante: 1, prestadores_servico: 1 });
    await expect(svc.assertPermissaoFuncionario(1, 'cadastrar_visitante', funcionario))
      .resolves.toBeUndefined();
  });

  it('NEGA funcionário sem ficha neste condomínio', async () => {
    const svc = build(null);
    await expect(svc.assertPermissaoFuncionario(1, 'cadastrar_visitante', funcionario))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  describe('não se aplica a quem tem regra própria', () => {
    it.each([
      ['morador', morador],
      ['síndico', sindico],
      ['operador do console', consoleOp],
    ])('%s passa sem consultar a tabela de funcionários', async (_label, payload) => {
      const svc = build(null); // se consultasse, daria Forbidden
      await expect(svc.assertPermissaoFuncionario(1, 'cadastrar_visitante', payload))
        .resolves.toBeUndefined();
    });

    it('chamada interna (sem payload) não é bloqueada', async () => {
      const svc = build(null);
      await expect(svc.assertPermissaoFuncionario(1, 'prestadores_servico', undefined))
        .resolves.toBeUndefined();
    });
  });
});
