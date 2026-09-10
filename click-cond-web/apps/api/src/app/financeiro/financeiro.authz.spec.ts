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

/**
 * O financeiro do condomínio virou somente leitura: quem escreve é o ERP
 * Superlógica (e os webhooks de pagamento), não mais o síndico pelo app ou
 * pela portaria-web. Antes disso, estas rotas aceitavam síndico e
 * funcionário via `assertStaff`.
 *
 * O caso que estes testes protegem é o síndico, não o morador: morador já
 * era barrado. O síndico é quem tinha o botão na tela — e é o app já
 * instalado no celular dele que vai continuar chamando estas rotas depois
 * do deploy, até ele atualizar. Se a trava vivesse só na tela, essas
 * chamadas passariam.
 */
describe('FinanceiroController — financeiro do condomínio é somente leitura', () => {
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

  // Cada rota de mutação, o método que a atende e o mock que NÃO pode ser
  // chamado. Tabela em vez de um `it` por rota para que acrescentar uma
  // mutação nova ao controller sem trancá-la fique visível aqui.
  const rotasDeEscrita: Array<[string, (c: FinanceiroController) => unknown, (m: any) => jest.Mock]> = [
    ['POST insert', (c) => c.insert(), (m) => m.service.insert],
    ['POST update', (c) => c.update(), (m) => m.service.update],
    ['POST remove', (c) => c.remove(), (m) => m.service.remove],
    ['POST update-status', (c) => c.updateStatus(), (m) => m.service.updateStatus],
    ['POST rateio', (c) => c.createRateio(), (m) => m.service.createRateio],
    ['POST inadimplente/acordo', (c) => c.createAcordoInadimplente(), (m) => m.service.createAcordoInadimplente],
    ['POST conciliacao/importar', (c) => c.importarOfx(), (m) => m.service.parseOfxContent],
    ['POST conciliacao/confirmar', (c) => c.confirmarConciliacao(), (m) => m.service.confirmarConciliacao],
    ['POST config-auto', (c) => c.updateConfigAuto(), (m) => m.service.updateConfigAuto],
    ['POST apartamento-recorrencia', (c) => c.updateApartamentoRecorrencia(), (m) => m.service.updateApartamentoRecorrencia],
    ['POST fechamentos/fechar', (c) => c.fecharMes(), (m) => m.fechamento.fechar],
    ['POST fechamentos/reabrir', (c) => c.reabrirMes(), (m) => m.fechamento.reabrir],
  ];

  it.each(rotasDeEscrita)('%s recusa e não toca no service', (_rota, chamar, mockAlvo) => {
    const mocks = buildController();
    expect(() => chamar(mocks.controller)).toThrow(ForbiddenException);
    expect(mockAlvo(mocks)).not.toHaveBeenCalled();
  });

  it('a recusa explica que a origem dos lançamentos é o ERP', () => {
    const { controller } = buildController();
    expect(() => controller.insert()).toThrow(/somente leitura/i);
    expect(() => controller.insert()).toThrow(/Superlógica/);
  });

  // A leitura não pode ter ido junto: o síndico continua abrindo o livro
  // caixa, o gráfico e a inadimplência. É o ponto inteiro da mudança —
  // tirar a escrita, manter a visualização.
  it('as leituras do síndico continuam de pé', () => {
    const { controller, service } = buildController();
    const sindico: JwtPayload = { sub: 1, nome: 'Síndico', typeAccess: 'Sindico' };
    controller.getAll('2', '7', '2026', sindico);
    expect(service.getAll).toHaveBeenCalled();
    controller.get('2', '10', sindico);
    expect(service.get).toHaveBeenCalled();
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
