import {
  estadoDaAtualizacaoDoAgente,
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

    it('agente que entende o pedido é orientado a usar o botão; o mais antigo, a reiniciar', () => {
      expect(textoDaAtualizacaoDoAgente({ ...base, versao: '2026.11.11.1', versao_disponivel: '2026.11.12' }, h(1), () => 'H')).toContain(
        'Para adiantar, use "Atualizar agora".',
      );
      expect(textoDaAtualizacaoDoAgente(base, h(1), () => 'H')).toContain('Para adiantar, reinicie o computador da portaria.');
    });

    it('sem atualização disponível não há texto', () => {
      expect(textoDaAtualizacaoDoAgente({ ...base, versao_disponivel: '2026.09.25.1' }, h(1))).toBeNull();
      expect(textoDaAtualizacaoDoAgente({ ...base, versao_disponivel: null }, h(1))).toBeNull();
      expect(textoDaAtualizacaoDoAgente(null, h(1))).toBeNull();
    });
  });

  /**
   * Agente a partir de 2026.11.11.1 reporta em que pé está a atualização
   * (`atualizacao` na telemetria): o card passa a dizer o que está acontecendo
   * agora, em vez de só prever a próxima conferência.
   */
  describe('estado da atualização reportado pelo agente', () => {
    const agora = h(1);
    const base = { versao: '2026.11.11.1', versao_disponivel: '2026.11.12', iniciado_em: inicio };
    const haMin = (min: number) => new Date(agora - min * 60_000).toISOString();
    const com = (estado: string, extra: Record<string, unknown> = {}, telemetria: Record<string, unknown> = {}) => ({
      ...base,
      // Carimbado pela API na chegada da telemetria (relógio do servidor).
      recebido_em: haMin(0) as string | null,
      ...telemetria,
      atualizacao: { estado, versao_alvo: '2026.11.12', erro: null, em: haMin(1), ...extra } as any,
    });

    it.each([
      ['verificando', 'Conferindo se há versão nova…'],
      ['baixando', 'Baixando a versão 2026.11.12…'],
      ['instalando', 'Instalando a versão 2026.11.12. O agente reinicia sozinho em instantes.'],
    ])('%s: diz o que o agente está fazendo, sem alerta, e conta como em andamento', (estado, texto) => {
      expect(estadoDaAtualizacaoDoAgente(com(estado), agora)).toEqual({ estado, texto, alerta: false, emAndamento: true });
      expect(textoDaAtualizacaoDoAgente(com(estado), agora)).toBe(texto);
    });

    it('falhou: diz o erro e que o agente segue funcionando, com alerta', () => {
      const r = estadoDaAtualizacaoDoAgente(com('falhou', { erro: 'SHA-256 não confere' }), agora);
      expect(r).toEqual({
        estado: 'falhou',
        texto:
          'A atualização para a versão 2026.11.12 falhou: SHA-256 não confere. O agente continua funcionando na versão atual e tenta de novo no próximo ciclo.',
        alerta: true,
        emAndamento: false,
      });
    });

    it('falhou sem erro informado não deixa ": null" nem pontuação solta', () => {
      const r = estadoDaAtualizacaoDoAgente(com('falhou'), agora);
      expect(r?.texto).toBe(
        'A atualização para a versão 2026.11.12 falhou. O agente continua funcionando na versão atual e tenta de novo no próximo ciclo.',
      );
    });

    it('erro que já termina em ponto não vira ".."', () => {
      const r = estadoDaAtualizacaoDoAgente(com('falhou', { erro: 'Sem espaço em disco.' }), agora);
      expect(r?.texto).toContain('falhou: Sem espaço em disco. O agente continua');
    });

    it('indisponivel: explica o motivo e manda reinstalar', () => {
      const r = estadoDaAtualizacaoDoAgente(com('indisponivel', { erro: 'executado fora do serviço' }), agora);
      expect(r).toEqual({
        estado: 'indisponivel',
        texto: 'Este agente não consegue se atualizar sozinho: executado fora do serviço. Use "Reinstalar ou configurar".',
        alerta: false,
        emAndamento: false,
      });
    });

    it('sem versao_alvo usa a versão disponível; sem nenhuma, fala em "versão nova"', () => {
      expect(estadoDaAtualizacaoDoAgente(com('baixando', { versao_alvo: null }), agora)?.texto).toBe('Baixando a versão 2026.11.12…');
      expect(
        estadoDaAtualizacaoDoAgente({ ...com('baixando', { versao_alvo: null }), versao_disponivel: null }, agora)?.texto,
      ).toBe('Baixando a versão nova…');
    });

    it.each(['em_dia', 'ocioso'])('%s mantém o comportamento atual (texto da próxima conferência)', (estado) => {
      expect(estadoDaAtualizacaoDoAgente(com(estado), agora)).toBeNull();
      expect(textoDaAtualizacaoDoAgente(com(estado), agora, () => 'HORA')).toContain('por volta das HORA');
      expect(textoDaAtualizacaoDoAgente({ ...com(estado), versao_disponivel: null }, agora)).toBeNull();
    });

    it.each(['verificando', 'baixando', 'instalando'])(
      '%s há mais de 10 minutos não fica preso na tela: volta ao texto padrão',
      (estado) => {
        expect(estadoDaAtualizacaoDoAgente(com(estado, { em: haMin(9) }), agora)).not.toBeNull();
        expect(estadoDaAtualizacaoDoAgente(com(estado, { em: haMin(11) }), agora)).toBeNull();
        expect(textoDaAtualizacaoDoAgente(com(estado, { em: haMin(11) }), agora, () => 'HORA')).toContain('por volta das HORA');
      },
    );

    it.each([[''], ['não é data'], [null], [undefined]])(
      'em andamento com `em` ilegível (%p) é tratado como desconhecido',
      (em) => {
        expect(estadoDaAtualizacaoDoAgente(com('baixando', { em }), agora)).toBeNull();
      },
    );

    it('falhou (com alvo ainda à frente) e indisponivel não vencem com o tempo', () => {
      expect(estadoDaAtualizacaoDoAgente(com('falhou', { em: haMin(300) }), agora)?.estado).toBe('falhou');
      expect(estadoDaAtualizacaoDoAgente(com('indisponivel', { em: haMin(300) }), agora)?.estado).toBe('indisponivel');
    });

    it.each([
      ['já está na versão alvo', '2026.11.12'],
      ['já passou da versão alvo', '2026.11.13'],
    ])('falhou de agente que %s não é mais alerta: volta ao texto padrão', (_caso, versao) => {
      const t = com('falhou', { erro: 'SHA-256 não confere' }, { versao, versao_disponivel: '2026.11.14' });
      expect(estadoDaAtualizacaoDoAgente(t, agora)).toBeNull();
      expect(textoDaAtualizacaoDoAgente(t, agora, () => 'HORA')).toContain('por volta das HORA');
    });

    it.each([[null], [undefined], ['']])('falhou sem versao_alvo (%p) não é alerta, mesmo com versão disponível', (versao_alvo) => {
      const t = com('falhou', { versao_alvo, erro: 'SHA-256 não confere' });
      expect(estadoDaAtualizacaoDoAgente(t, agora)).toBeNull();
      expect(textoDaAtualizacaoDoAgente(t, agora, () => 'HORA')).toContain('por volta das HORA');
    });

    it.each(['verificando', 'baixando', 'instalando'])(
      '%s só vale com telemetria recente (recebido_em da API, até 3 min): agente morto não fica "baixando"',
      (estado) => {
        // `em` recente pelo relógio do PC da portaria, mas a telemetria parou de chegar.
        expect(estadoDaAtualizacaoDoAgente(com(estado, {}, { recebido_em: haMin(2) }), agora)).not.toBeNull();
        expect(estadoDaAtualizacaoDoAgente(com(estado, {}, { recebido_em: haMin(4) }), agora)).toBeNull();
        expect(textoDaAtualizacaoDoAgente(com(estado, {}, { recebido_em: haMin(4) }), agora, () => 'HORA')).toContain(
          'por volta das HORA',
        );
      },
    );

    it.each([[null], [undefined], [''], ['não é data']])(
      'em andamento sem recebido_em legível (%p) é tratado como desconhecido',
      (recebido_em) => {
        expect(estadoDaAtualizacaoDoAgente(com('baixando', {}, { recebido_em }), agora)).toBeNull();
      },
    );

    it('`em` no futuro (relógio do PC adiantado) vale quando a telemetria é recente', () => {
      expect(estadoDaAtualizacaoDoAgente(com('baixando', { em: haMin(-45) }), agora)?.estado).toBe('baixando');
      expect(estadoDaAtualizacaoDoAgente(com('baixando', { em: haMin(-45) }, { recebido_em: haMin(4) }), agora)).toBeNull();
    });

    it('falhou e indisponivel não dependem de telemetria recente', () => {
      expect(estadoDaAtualizacaoDoAgente(com('falhou', {}, { recebido_em: haMin(30) }), agora)?.estado).toBe('falhou');
      expect(estadoDaAtualizacaoDoAgente(com('indisponivel', {}, { recebido_em: null }), agora)?.estado).toBe('indisponivel');
    });

    it.each([[null], [undefined], [{ estado: 'explodindo', versao_alvo: null, erro: null, em: haMin(1) }]])(
      'sem estado conhecido (%p) não há texto de estado',
      (atualizacao) => {
        expect(estadoDaAtualizacaoDoAgente({ ...base, atualizacao: atualizacao as any }, agora)).toBeNull();
      },
    );

    it('verificando aparece mesmo sem atualização disponível (conferência de rotina)', () => {
      expect(textoDaAtualizacaoDoAgente({ ...com('verificando'), versao_disponivel: null }, agora)).toBe(
        'Conferindo se há versão nova…',
      );
    });
  });
});
