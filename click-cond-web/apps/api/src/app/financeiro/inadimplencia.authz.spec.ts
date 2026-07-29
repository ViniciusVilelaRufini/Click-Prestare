import { ForbiddenException } from '@nestjs/common';
import { FinanceiroController } from './financeiro.controller';
import { assertOperador } from '../auth/tenant.util';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * A área de inadimplência é administrativa: mostra a situação financeira de
 * TODOS os apartamentos (valor devido, PIX, comprovante) e recebe apto/bloco
 * por parâmetro, sem relação com quem fez o pedido.
 *
 * Antes desta correção essas rotas só chamavam assertCondominio no service —
 * que confirma que a pessoa pertence ao condomínio, e MORADOR pertence. Então
 * qualquer morador autenticado lia a dívida dos vizinhos (inclusive o
 * pix_copia_cola) e disparava push/e-mail de cobrança para qualquer
 * apartamento. Nenhuma das cinco rotas checava papel.
 */
describe('assertOperador', () => {
  const morador: JwtPayload = { sub: 5, nome: 'Morador X', typeAccess: 'Morador' };
  const sindicoApp: JwtPayload = { sub: 5, nome: 'Síndico', typeAccess: 'Sindico' };
  const funcionarioApp: JwtPayload = { sub: 5, nome: 'Porteiro', typeAccess: 'Funcionario' };
  // Login da portaria-web: { sub, nome, id_condominio, turno } — SEM typeAccess.
  const operadorPortaria: JwtPayload = { sub: 9, nome: 'Portaria', id_condominio: 2 };

  it('NEGA morador', () => {
    expect(() => assertOperador(morador, 'ver inadimplentes')).toThrow(ForbiddenException);
  });

  it('PERMITE síndico do app', () => {
    expect(() => assertOperador(sindicoApp)).not.toThrow();
  });

  it('PERMITE funcionário do app', () => {
    expect(() => assertOperador(funcionarioApp)).not.toThrow();
  });

  /**
   * O motivo de existir assertOperador em vez de reusar assertStaff: o token da
   * portaria-web não carrega typeAccess, e assertStaff barraria justamente quem
   * usa a aba Inadimplência do console.
   */
  it('PERMITE operador da portaria-web (token sem typeAccess)', () => {
    expect(() => assertOperador(operadorPortaria)).not.toThrow();
  });

  it('NEGA payload sem typeAccess e sem id_condominio', () => {
    expect(() => assertOperador({ sub: 1, nome: 'Desconhecido' } as JwtPayload)).toThrow(
      ForbiddenException,
    );
  });
});

describe('FinanceiroController — rotas de inadimplência bloqueiam morador', () => {
  function buildController() {
    const service: any = {
      getAllMoradores: jest.fn(),
      getAllInadimplentes: jest.fn(),
      getInadimplenciaDashboard: jest.fn(),
      getInadimplenteDetail: jest.fn(),
      notifyInadimplente: jest.fn(),
    };
    const fechamento: any = {};
    return { controller: new FinanceiroController(service, fechamento), service };
  }

  const morador: JwtPayload = { sub: 7, nome: 'Morador do 101', typeAccess: 'Morador' };
  const sindico: JwtPayload = { sub: 1, nome: 'Síndico', typeAccess: 'Sindico' };
  const portaria: JwtPayload = { sub: 9, nome: 'Portaria', id_condominio: 1 };

  it('NEGA morador em moradores/get-all (situação de pagamento de todos os aptos)', () => {
    const { controller, service } = buildController();
    expect(() => controller.getAllMoradores('1', '07', '2026', morador)).toThrow(ForbiddenException);
    expect(service.getAllMoradores).not.toHaveBeenCalled();
  });

  it('NEGA morador em inadimplentes/get-all', () => {
    const { controller, service } = buildController();
    expect(() => controller.getAllInadimplentes('1', morador)).toThrow(ForbiddenException);
    expect(service.getAllInadimplentes).not.toHaveBeenCalled();
  });

  it('NEGA morador no dashboard de inadimplência', () => {
    const { controller, service } = buildController();
    expect(() => controller.inadimplenciaDashboard('1', '07', '2026', morador)).toThrow(
      ForbiddenException,
    );
    expect(service.getInadimplenciaDashboard).not.toHaveBeenCalled();
  });

  /**
   * O caso mais grave: apto/bloco vêm por query, então o morador do 101 pedia
   * o detalhe do 204 e recebia a dívida do vizinho com o PIX para pagamento.
   */
  it('NEGA morador ao consultar a dívida de OUTRO apartamento', () => {
    const { controller, service } = buildController();
    expect(() => controller.getInadimplenteDetail('1', '204', 'A', morador)).toThrow(
      ForbiddenException,
    );
    expect(service.getInadimplenteDetail).not.toHaveBeenCalled();
  });

  it('NEGA morador ao disparar cobrança para um apartamento', () => {
    const { controller, service } = buildController();
    expect(() => controller.notifyInadimplente(1, '204', 'A', morador)).toThrow(ForbiddenException);
    expect(service.notifyInadimplente).not.toHaveBeenCalled();
  });

  it('PERMITE síndico nas cinco rotas', () => {
    const { controller, service } = buildController();
    controller.getAllMoradores('1', '07', '2026', sindico);
    controller.getAllInadimplentes('1', sindico);
    controller.inadimplenciaDashboard('1', '07', '2026', sindico);
    controller.getInadimplenteDetail('1', '204', 'A', sindico);
    controller.notifyInadimplente(1, '204', 'A', sindico);

    expect(service.getAllMoradores).toHaveBeenCalled();
    expect(service.getAllInadimplentes).toHaveBeenCalled();
    expect(service.getInadimplenciaDashboard).toHaveBeenCalled();
    expect(service.getInadimplenteDetail).toHaveBeenCalled();
    expect(service.notifyInadimplente).toHaveBeenCalled();
  });

  // A aba Inadimplência da portaria-web consome 3 destas rotas; se o
  // assertOperador virasse assertStaff, essa tela quebraria com 403.
  it('PERMITE operador da portaria-web nas rotas que o console usa', () => {
    const { controller, service } = buildController();
    controller.getAllInadimplentes('1', portaria);
    controller.getInadimplenteDetail('1', '204', 'A', portaria);
    controller.notifyInadimplente(1, '204', 'A', portaria);

    expect(service.getAllInadimplentes).toHaveBeenCalled();
    expect(service.getInadimplenteDetail).toHaveBeenCalled();
    expect(service.notifyInadimplente).toHaveBeenCalled();
  });
});
