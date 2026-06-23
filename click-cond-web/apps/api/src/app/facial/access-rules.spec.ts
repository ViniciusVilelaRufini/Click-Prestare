import {
  algumaRegraPermite,
  bloqueadoPorRegrasAcesso,
  CategoriaPessoa,
  RegraAcessoLike,
} from './access-rules.util';

/** Helper: cria uma regra com defaults (tudo permitido, sem horário). */
function regra(over: Partial<RegraAcessoLike> = {}): RegraAcessoLike {
  return {
    sentido: 'ambos',
    hora_inicio: null,
    hora_fim: null,
    permitir_morador: 1,
    permitir_visitante: 1,
    permitir_prestador: 1,
    permitir_funcionario: 1,
    ...over,
  };
}

const CATEGORIAS: CategoriaPessoa[] = [
  'morador',
  'visitante',
  'prestador',
  'funcionario',
];

describe('Regras de Acesso (engine whitelist)', () => {
  describe('terminal sem regras', () => {
    it('não bloqueia ninguém (terminal liberado)', () => {
      for (const cat of CATEGORIAS) {
        expect(bloqueadoPorRegrasAcesso([], 'entrada', cat, '12:00')).toBe(
          false,
        );
        expect(bloqueadoPorRegrasAcesso([], 'saida', cat, '03:00')).toBe(false);
      }
    });
  });

  describe('categoria', () => {
    it('permite só a categoria marcada e bloqueia as demais', () => {
      for (const permitida of CATEGORIAS) {
        const r = regra({
          permitir_morador: permitida === 'morador' ? 1 : 0,
          permitir_visitante: permitida === 'visitante' ? 1 : 0,
          permitir_prestador: permitida === 'prestador' ? 1 : 0,
          permitir_funcionario: permitida === 'funcionario' ? 1 : 0,
        });
        for (const cat of CATEGORIAS) {
          const bloqueado = bloqueadoPorRegrasAcesso(
            [r],
            'entrada',
            cat,
            '12:00',
          );
          expect(bloqueado).toBe(cat !== permitida);
        }
      }
    });
  });

  describe('sentido', () => {
    it('regra "entrada" libera entrada e bloqueia saída', () => {
      const r = regra({ sentido: 'entrada' });
      expect(bloqueadoPorRegrasAcesso([r], 'entrada', 'morador', '12:00')).toBe(
        false,
      );
      expect(bloqueadoPorRegrasAcesso([r], 'saida', 'morador', '12:00')).toBe(
        true,
      );
    });
    it('regra "saida" libera saída e bloqueia entrada', () => {
      const r = regra({ sentido: 'saida' });
      expect(bloqueadoPorRegrasAcesso([r], 'saida', 'morador', '12:00')).toBe(
        false,
      );
      expect(bloqueadoPorRegrasAcesso([r], 'entrada', 'morador', '12:00')).toBe(
        true,
      );
    });
    it('regra "ambos" libera os dois sentidos', () => {
      const r = regra({ sentido: 'ambos' });
      expect(bloqueadoPorRegrasAcesso([r], 'entrada', 'morador', '12:00')).toBe(
        false,
      );
      expect(bloqueadoPorRegrasAcesso([r], 'saida', 'morador', '12:00')).toBe(
        false,
      );
    });
  });

  describe('horário normal (08:00–18:00)', () => {
    const r = regra({ hora_inicio: '08:00', hora_fim: '18:00' });
    it.each([
      ['07:59', true],
      ['08:00', false], // borda inicial inclusiva
      ['12:00', false],
      ['18:00', false], // borda final inclusiva
      ['18:01', true],
      ['23:00', true],
    ])('%s -> bloqueado=%s', (hora, esperado) => {
      expect(
        bloqueadoPorRegrasAcesso([r], 'entrada', 'morador', hora as string),
      ).toBe(esperado as boolean);
    });
  });

  describe('horário que cruza a meia-noite (22:00–06:00)', () => {
    const r = regra({ hora_inicio: '22:00', hora_fim: '06:00' });
    it.each([
      ['22:00', false],
      ['23:30', false],
      ['00:00', false],
      ['05:59', false],
      ['06:00', false],
      ['06:01', true],
      ['12:00', true],
      ['21:59', true],
    ])('%s -> bloqueado=%s', (hora, esperado) => {
      expect(
        bloqueadoPorRegrasAcesso([r], 'entrada', 'morador', hora as string),
      ).toBe(esperado as boolean);
    });
  });

  describe('sem horário definido', () => {
    it('libera em qualquer hora', () => {
      const r = regra({ hora_inicio: null, hora_fim: null });
      for (const h of ['00:00', '06:30', '12:00', '23:59']) {
        expect(bloqueadoPorRegrasAcesso([r], 'entrada', 'morador', h)).toBe(
          false,
        );
      }
    });
  });

  describe('combinações categoria × sentido', () => {
    const r = regra({
      sentido: 'entrada',
      permitir_morador: 1,
      permitir_visitante: 0,
      permitir_prestador: 0,
      permitir_funcionario: 0,
    });
    it('categoria certa + sentido errado -> bloqueia', () => {
      expect(bloqueadoPorRegrasAcesso([r], 'saida', 'morador', '12:00')).toBe(
        true,
      );
    });
    it('sentido certo + categoria errada -> bloqueia', () => {
      expect(
        bloqueadoPorRegrasAcesso([r], 'entrada', 'visitante', '12:00'),
      ).toBe(true);
    });
    it('categoria certa + sentido certo -> libera', () => {
      expect(bloqueadoPorRegrasAcesso([r], 'entrada', 'morador', '12:00')).toBe(
        false,
      );
    });
  });

  describe('múltiplas regras no mesmo terminal', () => {
    // Regra 1: moradores entrando; Regra 2: visitantes saindo
    const regras = [
      regra({
        sentido: 'entrada',
        permitir_morador: 1,
        permitir_visitante: 0,
        permitir_prestador: 0,
        permitir_funcionario: 0,
      }),
      regra({
        sentido: 'saida',
        permitir_morador: 0,
        permitir_visitante: 1,
        permitir_prestador: 0,
        permitir_funcionario: 0,
      }),
    ];
    it('morador entrando -> libera (regra 1)', () => {
      expect(
        bloqueadoPorRegrasAcesso(regras, 'entrada', 'morador', '12:00'),
      ).toBe(false);
    });
    it('visitante saindo -> libera (regra 2)', () => {
      expect(
        bloqueadoPorRegrasAcesso(regras, 'saida', 'visitante', '12:00'),
      ).toBe(false);
    });
    it('visitante entrando -> bloqueia (nenhuma cobre)', () => {
      expect(
        bloqueadoPorRegrasAcesso(regras, 'entrada', 'visitante', '12:00'),
      ).toBe(true);
    });
    it('morador saindo -> bloqueia (nenhuma cobre)', () => {
      expect(
        bloqueadoPorRegrasAcesso(regras, 'saida', 'morador', '12:00'),
      ).toBe(true);
    });
  });

  describe('combinação completa: categoria + sentido + horário', () => {
    // Visitante, só entrada, só comercial 08:00–18:00
    const r = regra({
      sentido: 'entrada',
      hora_inicio: '08:00',
      hora_fim: '18:00',
      permitir_morador: 0,
      permitir_visitante: 1,
      permitir_prestador: 0,
      permitir_funcionario: 0,
    });
    it('visitante entrando às 10:00 -> libera', () => {
      expect(
        bloqueadoPorRegrasAcesso([r], 'entrada', 'visitante', '10:00'),
      ).toBe(false);
    });
    it('visitante entrando às 20:00 -> bloqueia (horário)', () => {
      expect(
        bloqueadoPorRegrasAcesso([r], 'entrada', 'visitante', '20:00'),
      ).toBe(true);
    });
    it('visitante saindo às 10:00 -> bloqueia (sentido)', () => {
      expect(bloqueadoPorRegrasAcesso([r], 'saida', 'visitante', '10:00')).toBe(
        true,
      );
    });
    it('morador entrando às 10:00 -> bloqueia (categoria)', () => {
      expect(bloqueadoPorRegrasAcesso([r], 'entrada', 'morador', '10:00')).toBe(
        true,
      );
    });
  });

  describe('algumaRegraPermite (função auxiliar)', () => {
    it('é o inverso de bloqueado quando há regras', () => {
      const r = regra({ sentido: 'entrada' });
      expect(algumaRegraPermite([r], 'entrada', 'morador', '12:00')).toBe(true);
      expect(algumaRegraPermite([r], 'saida', 'morador', '12:00')).toBe(false);
    });
  });
});
