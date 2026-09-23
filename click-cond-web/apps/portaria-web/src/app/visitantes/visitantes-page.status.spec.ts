import { VisitantesPageComponent } from './visitantes-page.component';

/**
 * O status da linha decide os botões: "presente" mostra "Dar Baixa";
 * "liberado"/"autorizado" mostram "Liberar entrada". A regra usava também
 * `ultSaida` — a última saída de QUALQUER visita antiga — então quem já tinha
 * saído uma vez ficava "Saiu" para sempre, mesmo liberado de novo ou dentro.
 */
describe('VisitantesPageComponent.getStatusVisitante', () => {
  const tela = Object.create(VisitantesPageComponent.prototype) as VisitantesPageComponent;
  const saidaAntiga = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

  it('liberado de novo depois de uma visita antiga continua "liberado"', () => {
    const v: any = { liberado: 1, data_entrada: null, data_saida: null, ultSaida: saidaAntiga };
    expect(tela.getStatusVisitante(v)).toBe('liberado');
  });

  it('dentro agora por uma visita nova é "presente"', () => {
    const v: any = {
      liberado: 1,
      data_entrada: new Date().toISOString(),
      data_saida: null,
      ultSaida: saidaAntiga,
    };
    expect(tela.getStatusVisitante(v)).toBe('presente');
  });

  it('saída da visita atual continua "saiu"', () => {
    const v: any = { liberado: 0, data_entrada: saidaAntiga, data_saida: saidaAntiga, ultSaida: saidaAntiga };
    expect(tela.getStatusVisitante(v)).toBe('saiu');
  });
});
