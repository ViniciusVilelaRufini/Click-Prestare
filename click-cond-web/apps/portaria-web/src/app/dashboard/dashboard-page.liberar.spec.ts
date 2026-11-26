import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { DashboardPageComponent } from './dashboard-page.component';

/**
 * "Liberar acesso" do dashboard mandava `p.id` para /pessoa/:idRef/nova-visita.
 * Na lista de pessoas, `id` é o da VISITA principal (contrato do app); o da
 * pessoa é `id_pessoa`. A API procurava a Pessoa 1000004 (um id de visita) e
 * respondia "Pessoa 1000004 não encontrada". A tela de Visitantes já usava
 * `id_pessoa ?? id` (chavePessoa); o dashboard tinha ficado de fora.
 */
describe('Dashboard — liberar acesso usa o id da pessoa', () => {
  it('envia id_pessoa, não o id da visita', () => {
    const tela = Object.create(DashboardPageComponent.prototype) as any;
    const service = {
      novaVisitaPessoa: jest.fn(() => of({ id: 1000010 })),
      liberar: jest.fn(() => of({})),
    };
    Object.assign(tela, {
      pessoaSelecionada: signal({ id: 1000004, id_pessoa: 2000001, nome: 'QA_SECURITY_20260923' }),
      idApartamentoSelecionado: signal(106),
      liberarInicio: signal(''),
      liberarTermino: signal(''),
      liberandoVisitante: signal(false),
      erroLiberar: signal(null),
      sucessoLiberar: signal(null),
      visitantesService: service,
      load: jest.fn(),
      fecharModalLiberar: jest.fn(),
      network: { getFriendlyErrorMessage: (_e: any, p: string) => p },
    });
    jest.useFakeTimers();
    tela.confirmarLiberacao();
    jest.useRealTimers();
    expect(service.novaVisitaPessoa.mock.calls[0][0]).toBe(2000001);
    expect(service.liberar).toHaveBeenCalledWith(1000010);
  });
});

describe('Dashboard — liberação rápida: unidade e prazo', () => {
  const nova = () => {
    const tela = Object.create(DashboardPageComponent.prototype) as any;
    Object.assign(tela, {
      pessoaSelecionada: signal(null),
      idApartamentoSelecionado: signal(null),
      aptoAmbiguo: signal(false),
      erroLiberar: signal(null),
      visitaCriadaParaRetry: null,
    });
    return tela;
  };

  it('com mais de uma unidade, não escolhe o apartamento pelo operador', () => {
    const tela = nova();
    tela.selecionarPessoa({ id: 1, nome: 'A', id_apartamento: 10, apartamentosVisitados: [{ id: 10 }, { id: 11 }] });
    expect(tela.idApartamentoSelecionado()).toBeNull();
    expect(tela.aptoAmbiguo()).toBe(true);
  });

  it('com uma única unidade, pré-seleciona', () => {
    const tela = nova();
    tela.selecionarPessoa({ id: 1, nome: 'A', id_apartamento: 10, apartamentosVisitados: [{ id: 10 }] });
    expect(tela.idApartamentoSelecionado()).toBe(10);
    expect(tela.aptoAmbiguo()).toBe(false);
  });

  it('repetir o clique após falha em liberar não cria outra visita', () => {
    const tela = nova();
    const service = {
      novaVisitaPessoa: jest.fn(() => of({ id: 77 })),
      liberar: jest.fn()
        .mockReturnValueOnce(throwError(() => new Error('x')))
        .mockReturnValueOnce(of({})),
    };
    Object.assign(tela, {
      pessoaSelecionada: signal({ id: 1, id_pessoa: 5, nome: 'A' }),
      idApartamentoSelecionado: signal(10),
      liberarInicio: signal(''), liberarTermino: signal(''),
      liberandoVisitante: signal(false), sucessoLiberar: signal(null),
      visitantesService: service, load: jest.fn(), fecharModalLiberar: jest.fn(),
      network: { getFriendlyErrorMessage: (_e: any, p: string) => p },
    });
    jest.useFakeTimers();
    tela.confirmarLiberacao();
    tela.confirmarLiberacao();
    jest.useRealTimers();
    expect(service.novaVisitaPessoa).toHaveBeenCalledTimes(1);
    expect(service.liberar).toHaveBeenCalledTimes(2);
  });

  it('M3: mudou a janela depois da falha → é outra visita (não libera a antiga com a janela velha)', () => {
    const tela = nova();
    const service = {
      novaVisitaPessoa: jest.fn(() => of({ id: 77 })),
      liberar: jest.fn().mockReturnValueOnce(throwError(() => new Error('x'))).mockReturnValueOnce(of({})),
    };
    const inicio = signal('2026-11-26T10:00');
    Object.assign(tela, {
      pessoaSelecionada: signal({ id: 1, id_pessoa: 5, nome: 'A' }),
      idApartamentoSelecionado: signal(10),
      liberarInicio: inicio, liberarTermino: signal('2026-11-26T14:00'),
      liberandoVisitante: signal(false), sucessoLiberar: signal(null),
      visitantesService: service, load: jest.fn(), fecharModalLiberar: jest.fn(),
      network: { getFriendlyErrorMessage: (_e: any, p: string) => p },
    });
    jest.useFakeTimers();
    tela.confirmarLiberacao();
    inicio.set('2026-11-27T10:00');
    tela.confirmarLiberacao();
    jest.useRealTimers();
    expect(service.novaVisitaPessoa).toHaveBeenCalledTimes(2);
  });
});
