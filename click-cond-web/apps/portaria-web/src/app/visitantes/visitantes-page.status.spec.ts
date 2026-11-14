import { VisitantesPageComponent } from './visitantes-page.component';
import * as statusUtil from '../core/status-visitante.util';

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

  // M1: liberado=1 com a janela encerrada não é "Liberado" (o facial recusa).
  it('liberado com a janela já encerrada não é "liberado"', () => {
    const v: any = {
      liberado: 1,
      data_hora_inicio: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
      data_hora_termino: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    };
    expect(tela.getStatusVisitante(v)).not.toBe('liberado');
    expect(tela.janelaEncerrada(v)).toBe(true);
  });

  // M4 / M2: prestador e visitante recorrente mantêm a liberação depois da saída.
  it('prestador que saiu e continua liberado é "liberado" (não "Saiu" + Solicitar)', () => {
    const v: any = { liberado: 1, is_prestador: 1, data_entrada: saidaAntiga, data_saida: saidaAntiga };
    expect(tela.getStatusVisitante(v)).toBe('liberado');
  });

  it('visitante recorrente que saiu e continua liberado é "liberado"', () => {
    const v: any = { liberado: 1, is_prestador: 0, dias_semana: 'seg,qua', data_entrada: saidaAntiga, data_saida: saidaAntiga };
    expect(tela.getStatusVisitante(v)).toBe('liberado');
  });

  it('visitante recorrente que saiu e PERDEU a liberação (sem término) é "saiu"', () => {
    const v: any = { liberado: 0, is_prestador: 0, dias_semana: 'seg,qua', data_entrada: saidaAntiga, data_saida: saidaAntiga };
    expect(tela.getStatusVisitante(v)).toBe('saiu');
  });

  // M3: "agendado" é pré-autorização; sem liberação, janela futura não agenda nada.
  it('janela futura sem liberação não é "agendado"', () => {
    const v: any = {
      liberado: 0,
      data_hora_inicio: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      data_hora_termino: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
    };
    expect(tela.getStatusVisitante(v)).not.toBe('agendado');
  });

  // M8: o status usa a hora do SERVIDOR, não a do PC da portaria.
  it('usa a hora do servidor (PC atrasado não vê "agendado" quem já pode entrar)', () => {
    const t = Object.create(VisitantesPageComponent.prototype) as any;
    t.relogio = { agora: () => new Date(Date.now() + 10 * 60 * 1000) }; // servidor 10 min à frente do PC
    const v: any = {
      liberado: 1,
      data_hora_inicio: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      data_hora_termino: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    };
    expect(t.getStatusVisitante(v)).toBe('liberado');
  });

  // Uma regra só: a tela e o painel "Na portaria agora" do dashboard usam
  // core/status-visitante.util.ts (antes havia duas cópias, e a da tela mudou).
  it('delega ao util compartilhado, com a hora do servidor', () => {
    const t = Object.create(VisitantesPageComponent.prototype) as any;
    const agora = new Date('2026-11-13T15:00:00Z');
    t.relogio = { agora: () => agora };
    const spyStatus = jest.spyOn(statusUtil, 'statusVisitante');
    const spyJanela = jest.spyOn(statusUtil, 'janelaEncerrada');
    const spyAuth = jest.spyOn(statusUtil, 'autorizacaoExpirada');
    const v: any = { liberado: 1, data_hora_termino: '2026-11-13T16:00:00Z' };
    t.getStatusVisitante(v);
    t.janelaEncerrada(v);
    t.autorizacaoExpirada(v);
    expect(spyStatus).toHaveBeenCalledWith(v, agora.getTime());
    expect(spyJanela).toHaveBeenCalledWith(v, agora.getTime());
    expect(spyAuth).toHaveBeenCalledWith(v, agora.getTime());
    jest.restoreAllMocks();
  });
});
