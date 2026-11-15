import { VisitantesPageComponent } from './visitantes-page.component';

/**
 * Achado no teste em produção (15/11): o computador da portaria estava 131 s
 * adiantado e o formulário propunha o início da visita pela hora do
 * computador. "Cadastrar e liberar" criava a visita no futuro e o PIN/rosto
 * não abriam até o servidor alcançar. O início padrão usa a hora do servidor.
 */
describe('VisitantesPageComponent — início padrão da visita pela hora do servidor', () => {
  it('com o relógio local 10 min adiantado, propõe o início na hora do servidor', () => {
    const servidor = new Date(2026, 10, 15, 20, 30, 0);
    const tela = Object.create(VisitantesPageComponent.prototype) as any;
    tela.relogio = { agora: () => servidor };
    tela.modo = () => 'visitante';
    const real = Date.now;
    Date.now = () => servidor.getTime() + 10 * 60_000;
    try {
      const novo = tela.estadoInicial();
      expect(novo.data_hora_inicio).toBe('2026-11-15T20:30');
      expect(novo.data_hora_termino).toBe('2026-11-16T00:30');
    } finally {
      Date.now = real;
    }
  });
});
