import {
  proximaVerificacaoDoAgente,
  textoDaAtualizacaoDoAgente,
} from './terminais-faciais-page.component';

/**
 * O card do agente mostrava só o selo "Atualização disponível", sem dizer se
 * era preciso fazer algo. O agente confere a versão ao iniciar e depois a cada
 * 6 horas contadas da partida; a tela calcula a próxima conferência a partir do
 * `iniciado_em` da telemetria e explica o que vai acontecer.
 */
describe('atualização do agente: quando e o que fazer', () => {
  const inicio = '2026-11-11T12:59:07.000Z';
  const h = (horas: number) => new Date(inicio).getTime() + horas * 3600_000;

  describe('proximaVerificacaoDoAgente', () => {
    it('é a partida + 6 h enquanto não passaram 6 h', () => {
      expect(proximaVerificacaoDoAgente(inicio, h(1))?.toISOString()).toBe('2026-11-11T18:59:07.000Z');
    });

    it('depois de 6 h, é o próximo múltiplo de 6 h a partir da partida', () => {
      expect(proximaVerificacaoDoAgente(inicio, h(7))?.toISOString()).toBe('2026-11-12T00:59:07.000Z');
    });

    it('exatamente em cima de uma conferência, aponta para a seguinte', () => {
      expect(proximaVerificacaoDoAgente(inicio, h(6))?.toISOString()).toBe('2026-11-12T00:59:07.000Z');
    });

    it.each([[null], [undefined], [''], ['não é data']])('sem hora de início válida (%p) devolve null', (v) => {
      expect(proximaVerificacaoDoAgente(v as any, h(1))).toBeNull();
    });

    it('hora de início no futuro (relógio do PC adiantado) devolve null em vez de inventar horário', () => {
      expect(proximaVerificacaoDoAgente(inicio, h(-2))).toBeNull();
    });
  });

  describe('textoDaAtualizacaoDoAgente', () => {
    const base = { versao: '2026.09.25.1', versao_disponivel: '2026.11.11', iniciado_em: inicio };

    it('diz a versão nova, o horário e que não é preciso fazer nada', () => {
      const texto = textoDaAtualizacaoDoAgente(base, h(1), (d) => `HORA(${d.toISOString()})`);
      expect(texto).toContain('2026.11.11');
      expect(texto).toContain('HORA(2026-11-11T18:59:07.000Z)');
      expect(texto).toMatch(/sozinho/i);
      expect(texto).toMatch(/reinici/i);
    });

    it('sem hora de início, explica o intervalo sem inventar horário', () => {
      const texto = textoDaAtualizacaoDoAgente({ ...base, iniciado_em: null }, h(1), () => 'NUNCA');
      expect(texto).not.toContain('NUNCA');
      expect(texto).toMatch(/até 6 horas/i);
    });

    it('agente antigo demais para se atualizar sozinho manda reinstalar', () => {
      const texto = textoDaAtualizacaoDoAgente({ ...base, versao: '2026.09.23' }, h(1), () => 'X');
      expect(texto).toMatch(/não se atualiza sozinha/i);
      expect(texto).toMatch(/Reinstalar/);
    });

    it('sem atualização disponível não há texto', () => {
      expect(textoDaAtualizacaoDoAgente({ ...base, versao_disponivel: '2026.09.25.1' }, h(1))).toBeNull();
      expect(textoDaAtualizacaoDoAgente({ ...base, versao_disponivel: null }, h(1))).toBeNull();
      expect(textoDaAtualizacaoDoAgente(null, h(1))).toBeNull();
    });
  });
});
