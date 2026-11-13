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

  it('liberado com janela ainda não iniciada é "agendado"', () => {
    const inicio = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    const fim = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
    const v: any = { liberado: 1, data_entrada: null, data_saida: null, data_hora_inicio: inicio, data_hora_termino: fim };
    expect(tela.getStatusVisitante(v)).toBe('agendado');
  });

  describe('sem liberação (liberado=0), a janela da visita não autoriza nada', () => {
    const inicio = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const fim = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

    it('morador negou: não é "autorizado"', () => {
      const v: any = { liberado: 0, auth_status: 'negado', data_hora_inicio: inicio, data_hora_termino: fim };
      expect(tela.getStatusVisitante(v)).not.toBe('autorizado');
    });

    it('pedido venceu sem resposta: não é "autorizado"', () => {
      const v: any = { liberado: 0, auth_status: null, pedido_expirado: true, data_hora_inicio: inicio, data_hora_termino: fim };
      expect(tela.getStatusVisitante(v)).not.toBe('autorizado');
    });
  });

  it('saída da visita atual continua "saiu"', () => {
    const v: any = { liberado: 0, data_entrada: saidaAntiga, data_saida: saidaAntiga, ultSaida: saidaAntiga };
    expect(tela.getStatusVisitante(v)).toBe('saiu');
  });
});
