import { ForbiddenException } from '@nestjs/common';
import { FinanceiroController } from './financeiro.controller';

/**
 * As rotas de "minhas contas" (get-by-user, morador/*) usavam `payload.sub`
 * como Users.id. No token da portaria-web, `sub` é o id do operador em
 * Funcionarios_Portaria — outra tabela, outra numeração. O porteiro do
 * condomínio que chamasse /financeiro/get-by-user lia as contas pessoais e
 * cobranças do MORADOR cujo Users.id coincide com o id dele na portaria (e
 * morador/insert gravava conta em nome desse morador).
 */
describe('Financeiro — contas do morador com token da portaria', () => {
  function montar() {
    const service: any = {
      getByUser: jest.fn(async () => []),
      insertMoradorConta: jest.fn(async () => ({})),
      updateMoradorConta: jest.fn(async () => ({})),
      removeMoradorConta: jest.fn(async () => ({})),
      anexarCodigoMorador: jest.fn(async () => ({})),
    };
    return { service, ctrl: new FinanceiroController(service) };
  }

  const porteiro = { sub: 7, nome: 'QA_SECURITY_20260923 porteiro', id_condominio: 1, turno: 'Diurno' } as any;
  const morador = { sub: 50, nome: 'QA morador', typeAccess: 'Morador' } as any;

  it('porteiro não lê extrato pessoal de ninguém', async () => {
    const { ctrl, service } = montar();
    expect(() => ctrl.getByUser('', '1', porteiro)).toThrow(ForbiddenException);
    expect(service.getByUser).not.toHaveBeenCalled();
  });

  it.each([
    ['insertMoradorConta', (c: FinanceiroController) => c.insertMoradorConta(porteiro, { id_condominio: 1, data: {} })],
    ['updateMoradorConta', (c: FinanceiroController) => c.updateMoradorConta(porteiro, { id_condominio: 1, data: {} })],
    ['removeMoradorConta', (c: FinanceiroController) => c.removeMoradorConta(porteiro, { id: 1 })],
    ['anexarCodigoMorador', (c: FinanceiroController) => c.anexarCodigo({ id: 1 }, porteiro)],
  ])('porteiro não mexe em conta pessoal (%s)', async (metodo, chamar) => {
    const { ctrl, service } = montar();
    expect(() => chamar(ctrl)).toThrow(ForbiddenException);
    expect(service[metodo]).not.toHaveBeenCalled();
  });

  it('morador continua lendo o próprio extrato', async () => {
    const { ctrl, service } = montar();
    await ctrl.getByUser('999', '1', morador);
    expect(service.getByUser).toHaveBeenCalledWith(50, 1, morador);
  });
});
