import { BadRequestException } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';
import { ehEmailReservado } from '../common/email-reservado.util';

/**
 * A revogação de acesso à portaria grava no login/e-mail da conta revogada uma lápide em `conta-revogada.invalid`
 * (PrestadoresService). O signup público não validava formato: o próprio prestador se cadastrava com a lápide
 * prevista da conta dele, a revogação batia no @unique e o acesso ficava de pé. Nenhum ponto que grava e-mail ou
 * login de Users aceita esse domínio — 400 neutro, antes de qualquer consulta.
 */
describe('mobile-auth — e-mail no domínio das lápides é recusado', () => {
  function montar() {
    // Qualquer acesso ao banco falha o teste: a recusa tem de vir antes.
    const prisma: any = new Proxy(
      { isConnected: true },
      {
        get: (alvo, prop) => {
          if (prop in alvo) return (alvo as any)[prop];
          if (typeof prop === 'symbol' || prop === 'then') return undefined;
          return new Proxy({}, { get: (_a, metodo) => () => { throw new Error(`banco consultado: ${String(prop)}.${String(metodo)}`); } });
        },
      },
    );
    const storage: any = { isDataUrl: () => false };
    return new MobileAuthService(prisma, { sign: () => 'tok' } as any, {} as any, storage, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  }

  const sindico = { sub: 51, nome: 'Síndico', typeAccess: 'Sindico' } as any;
  const funcionario = { sub: 20, nome: 'Func', typeAccess: 'Funcionario', user: { id: 20 } } as any;
  const lapides = ['revogado-5-abc@conta-revogada.invalid', '  REVOGADO-5@Conta-Revogada.INVALID  ', 'x@sub.conta-revogada.invalid'];

  it.each(lapides)('signup público com %p → 400', async (email) => {
    await expect(montar().signupSindico({ nome: 'X', email, password: 'Senha#123' })).rejects.toThrow(
      new BadRequestException('E-mail inválido.'),
    );
  });

  it('cadastro e edição de porteiro (e-mail ou login) → 400', async () => {
    const svc = montar();
    for (const funcionarioDto of [{ email: lapides[0] }, { login: lapides[1] }]) {
      await expect(svc.saveFuncionario({ id_condominio: 1, funcionario: funcionarioDto }, false, sindico)).rejects.toThrow('E-mail inválido.');
    }
  });

  it('cadastro de morador → 400', async () => {
    await expect(montar().saveMorador({ morador: { nome: 'M', email: lapides[0] } }, false, sindico)).rejects.toThrow('E-mail inválido.');
  });

  it('funcionário trocando o próprio e-mail → 400', async () => {
    await expect(montar().updateInfosFuncionario({ funcionario: { email: lapides[0] } }, funcionario)).rejects.toThrow('E-mail inválido.');
  });

  it('e-mails comuns não são tocados pela regra', () => {
    for (const ok of ['ana@x.com', 'revogado@conta-revogada.com', 'conta-revogada.invalid@x.com', null, undefined, 123]) {
      expect(ehEmailReservado(ok)).toBe(false);
    }
  });
});
