import { signal } from '@angular/core';
import { of } from 'rxjs';
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
