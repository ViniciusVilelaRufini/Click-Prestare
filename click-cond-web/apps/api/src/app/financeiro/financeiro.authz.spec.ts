import { ForbiddenException } from '@nestjs/common';
import { FinanceiroController } from './financeiro.controller';
import { assertStaff } from '../auth/tenant.util';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Antes desta correção, NENHUMA rota de mutação do financeiro (exceto a
 * limpeza administrativa) checava o papel do usuário — um Morador
 * autenticado no app conseguia remover lançamentos, marcar dívidas como
 * pagas, fechar competência, etc. de qualquer condomínio (ver
 * financeiro.tenant.spec.ts para o vazamento cross-tenant que acompanhava
 * isso). Estes testes provam que a checagem de papel (assertStaff) agora
 * bloqueia Morador nessas rotas, sem depender do isolamento de tenant.
 */
describe('assertStaff', () => {
  const morador: JwtPayload = { sub: 5, nome: 'Morador X', typeAccess: 'Morador' };
  const sindicoMobile: JwtPayload = { sub: 5, nome: 'Síndico X', typeAccess: 'Sindico' };
  const funcionarioMobile: JwtPayload = { sub: 5, nome: 'Porteiro', typeAccess: 'Funcionario' };
  const sindicoWeb: JwtPayload = { sub: 5, nome: 'Síndico Web', id_condominio: 2, typeAccess: 'Sindico' };

  it('NEGA morador (mobile, sem id_condominio)', () => {
    expect(() => assertStaff(morador, 'remover lançamento')).toThrow(ForbiddenException);
  });

  it('PERMITE síndico mobile', () => {
    expect(() => assertStaff(sindicoMobile)).not.toThrow();
  });

  it('PERMITE funcionário mobile', () => {
    expect(() => assertStaff(funcionarioMobile)).not.toThrow();
  });

  it('PERMITE síndico web (typeAccess no topo do payload)', () => {
    expect(() => assertStaff(sindicoWeb)).not.toThrow();
  });

  it('NEGA payload sem typeAccess reconhecido', () => {
    expect(() => assertStaff({ sub: 1, nome: 'Desconhecido' } as JwtPayload)).toThrow(ForbiddenException);
  });
});

describe('FinanceiroController — rotas administrativas exigem síndico/funcionário', () => {
  function buildController() {
    const service: any = {
      insert: jest.fn(), update: jest.fn(), remove: jest.fn(), updateStatus: jest.fn(),
      createRateio: jest.fn(), createAcordoInadimplente: jest.fn(), updateConfigAuto: jest.fn(),
      updateApartamentoRecorrencia: jest.fn(), parseOfxContent: jest.fn(), confirmarConciliacao: jest.fn(),
      getAll: jest.fn(), get: jest.fn(),
    };
    const fechamento: any = { fechar: jest.fn(), reabrir: jest.fn(), listar: jest.fn() };
    const controller = new FinanceiroController(service, fechamento);
    return { controller, service, fechamento };
  }

  const morador: JwtPayload = { sub: 1, nome: 'Morador', typeAccess: 'Morador' };

  it('remove(): bloqueia morador antes de chamar o service', () => {
    const { controller, service } = buildController();
    expect(() => controller.remove({ id: 10 }, morador)).toThrow(ForbiddenException);
    expect(service.remove).not.toHaveBeenCalled();
  });

  it('updateStatus(): bloqueia morador marcar lançamento como pago', () => {
    const { controller, service } = buildController();
    expect(() => controller.updateStatus({ id: 10, status: '1' }, morador)).toThrow(ForbiddenException);
    expect(service.updateStatus).not.toHaveBeenCalled();
  });

  it('insert(): bloqueia morador lançar movimento', () => {
    const { controller, service } = buildController();
    expect(() => controller.insert({ id_condominio: 2, financeiro: {} }, morador)).toThrow(ForbiddenException);
    expect(service.insert).not.toHaveBeenCalled();
  });

  it('fecharMes(): bloqueia morador fechar competência', () => {
    const { controller, fechamento } = buildController();
    expect(() => controller.fecharMes({ id_condominio: 2, mes: 1, ano: 2026 }, morador)).toThrow(ForbiddenException);
    expect(fechamento.fechar).not.toHaveBeenCalled();
  });

  it('confirmarConciliacao(): bloqueia morador confirmar conciliação bancária', () => {
    const { controller, service } = buildController();
    expect(() => controller.confirmarConciliacao({ id_condominio: 2, reconciliations: [] }, morador)).toThrow(
      ForbiddenException,
    );
    expect(service.confirmarConciliacao).not.toHaveBeenCalled();
  });
});

describe('FinanceiroController.getAll — reconhece síndico independente do formato do JWT', () => {
  function buildController() {
    const service: any = { getAll: jest.fn() };
    const controller = new FinanceiroController(service, {} as any);
    return { controller, service };
  }

  it('isSindico=true para token com typeAccess no topo (formato usado em todo login mobile e web)', () => {
    const { controller, service } = buildController();
    const payload: JwtPayload = { sub: 1, nome: 'Síndico', typeAccess: 'Sindico' };
    controller.getAll('2', '7', '2026', payload);
    expect(service.getAll).toHaveBeenCalledWith(2, '7', '2026', true, payload, false);
  });

  it('isSindico=false para morador', () => {
    const { controller, service } = buildController();
    const payload: JwtPayload = { sub: 1, nome: 'Morador', typeAccess: 'Morador' };
    controller.getAll('2', '7', '2026', payload);
    expect(service.getAll).toHaveBeenCalledWith(2, '7', '2026', false, payload, false);
  });

  // O livro caixa não soma as taxas condominiais por padrão; quem quer o
  // total com elas pede explicitamente. Como o valor chega pela query string,
  // só a string 'true' liga — qualquer outra coisa mantém o padrão.
  it('incluirTaxasCondominiais só liga com a string "true"', () => {
    const { controller, service } = buildController();
    const payload: JwtPayload = { sub: 1, nome: 'Síndico', typeAccess: 'Sindico' };
    controller.getAll('2', '7', '2026', payload, 'true');
    expect(service.getAll).toHaveBeenCalledWith(2, '7', '2026', true, payload, true);

    controller.getAll('2', '7', '2026', payload, '1');
    expect(service.getAll).toHaveBeenLastCalledWith(2, '7', '2026', true, payload, false);
  });
});
