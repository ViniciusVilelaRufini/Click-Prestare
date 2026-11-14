import {
  CANCELA_SEM_RESPOSTA_MS,
  JANELA_ABERTURA_MS,
  PEDIDO_EXPIRA_MS,
  PRESENCA_MS,
  PedidoRegra,
  SAIDA_MS,
  SEM_RESPOSTA_MS,
  dentroDoHorario,
  estadoDoPedido,
  hashToken,
  horarioValido,
  novoToken,
} from './portao-regras';

const d = (iso: string) => new Date(iso);

describe('regras do pedido de portão', () => {
  it('prazos fixos do desenho', () => {
    expect(PEDIDO_EXPIRA_MS).toBe(5 * 60_000);
    expect(SEM_RESPOSTA_MS).toBe(60_000);
    expect(JANELA_ABERTURA_MS).toBe(3 * 60_000);
    expect(PRESENCA_MS).toBe(10_000);
    expect(SAIDA_MS).toBe(30 * 60_000);
    expect(CANCELA_SEM_RESPOSTA_MS).toBe(2 * 3_600_000);
  });

  it('horário comum, servidor em UTC', () => {
    expect(dentroDoHorario('07:00', '23:00', d('2026-11-14T09:59:00Z'))).toBe(false); // 06:59 BRT
    expect(dentroDoHorario('07:00', '23:00', d('2026-11-14T10:00:00Z'))).toBe(true); // 07:00 BRT
    expect(dentroDoHorario('07:00', '23:00', d('2026-11-15T01:59:00Z'))).toBe(true); // 22:59 BRT
    expect(dentroDoHorario('07:00', '23:00', d('2026-11-15T02:00:00Z'))).toBe(false); // 23:00 BRT (fim exclusivo)
  });

  it('horário que atravessa a meia-noite', () => {
    expect(dentroDoHorario('22:00', '06:00', d('2026-11-14T05:00:00Z'))).toBe(true); // 02:00 BRT
    expect(dentroDoHorario('22:00', '06:00', d('2026-11-15T01:00:00Z'))).toBe(true); // 22:00 BRT
    expect(dentroDoHorario('22:00', '06:00', d('2026-11-14T09:00:00Z'))).toBe(false); // 06:00 BRT
    expect(dentroDoHorario('22:00', '06:00', d('2026-11-14T15:00:00Z'))).toBe(false); // 12:00 BRT
  });

  it('sem horário, ou início igual ao fim, vale o dia inteiro', () => {
    expect(dentroDoHorario(null, null, d('2026-11-14T05:00:00Z'))).toBe(true);
    expect(dentroDoHorario('08:00', '08:00', d('2026-11-14T05:00:00Z'))).toBe(true);
  });

  it('horarioValido aceita só HH:MM de 00:00 a 23:59', () => {
    expect(horarioValido('00:00')).toBe(true);
    expect(horarioValido('23:59')).toBe(true);
    expect(horarioValido('07:30')).toBe(true);
    expect(horarioValido('24:00')).toBe(false);
    expect(horarioValido('25:00')).toBe(false);
    expect(horarioValido('7:30')).toBe(false);
    expect(horarioValido('07:60')).toBe(false);
    expect(horarioValido(null)).toBe(false);
    expect(horarioValido(730)).toBe(false);
  });

  describe('estadoDoPedido: cada linha da tabela', () => {
    const criado = d('2026-11-14T12:00:00Z');
    const base: PedidoRegra = {
      status: 'pendente',
      criado_em: criado,
      expira_em: new Date(criado.getTime() + PEDIDO_EXPIRA_MS),
      liberado_ate: null,
      aberto_em: null,
      saida_aberta_em: null,
    };
    const em = (ms: number) => new Date(criado.getTime() + ms);

    it('pendente vencido → expirado', () => {
      expect(estadoDoPedido(base, em(PEDIDO_EXPIRA_MS))).toEqual({
        situacao: 'expirado', pode_abrir: false, pode_sair: false, liberado_ate: null,
      });
    });

    it('pendente há 60 s → sem_resposta', () => {
      expect(estadoDoPedido(base, em(60_000)).situacao).toBe('sem_resposta');
      expect(estadoDoPedido(base, em(60_000)).pode_abrir).toBe(false);
    });

    it('pendente há 59 s → aguardando', () => {
      expect(estadoDoPedido(base, em(59_000))).toEqual({
        situacao: 'aguardando', pode_abrir: false, pode_sair: false, liberado_ate: null,
      });
    });

    it('liberado e aberto → aberto; pode sair até 30 min depois da entrada, uma vez', () => {
      const aberto = { ...base, status: 'liberado' as const, liberado_ate: em(180_000), aberto_em: em(60_000) };
      expect(estadoDoPedido(aberto, em(60_000 + SAIDA_MS))).toMatchObject({ situacao: 'aberto', pode_abrir: false, pode_sair: true });
      expect(estadoDoPedido(aberto, em(60_000 + SAIDA_MS + 1000)).pode_sair).toBe(false);
      expect(estadoDoPedido({ ...aberto, saida_aberta_em: em(120_000) }, em(130_000)).pode_sair).toBe(false);
    });

    it('liberado sem janela (pela portaria) → liberado_portaria', () => {
      expect(estadoDoPedido({ ...base, status: 'liberado' }, em(30_000))).toEqual({
        situacao: 'liberado_portaria', pode_abrir: false, pode_sair: false, liberado_ate: null,
      });
    });

    it('liberado dentro da janela → liberado, pode abrir, devolve o fim da janela', () => {
      const lib = { ...base, status: 'liberado' as const, liberado_ate: em(200_000) };
      expect(estadoDoPedido(lib, em(200_000))).toEqual({
        situacao: 'liberado', pode_abrir: true, pode_sair: false, liberado_ate: em(200_000).toISOString(),
      });
    });

    it('liberado depois da janela → expirado', () => {
      const lib = { ...base, status: 'liberado' as const, liberado_ate: em(200_000) };
      expect(estadoDoPedido(lib, em(200_001))).toMatchObject({ situacao: 'expirado', pode_abrir: false, pode_sair: false });
    });

    it('vou_buscar, recusado e expirado ficam como estão', () => {
      for (const status of ['vou_buscar', 'recusado', 'expirado'] as const) {
        expect(estadoDoPedido({ ...base, status }, em(10_000))).toEqual({
          situacao: status, pode_abrir: false, pode_sair: false, liberado_ate: null,
        });
      }
    });
  });

  it('hashToken é sha256 hex de 64 caracteres e novoToken tem 64 hex', () => {
    const t = novoToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(novoToken()).not.toBe(t);
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
  });
});
