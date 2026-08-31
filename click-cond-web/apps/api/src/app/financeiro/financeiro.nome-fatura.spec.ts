import { FinanceiroService } from './financeiro.service';

/**
 * `nomeFaturaDeApto` é o filtro que decide se um lançamento (com pix_copia_cola
 * e url_boleto) aparece na tela de um morador. Antes desta correção ele usava
 * `\b` como fronteira final do número do apto/bloco: `\b` barra dígito colado
 * ("Apto 101" não casa apto "10"), mas pontuação colada tem `\b` logo depois
 * do número igual a um espaço — "Apto 10.1", "Apto 10-A" e "Apto 10/2" casavam
 * com apto "10" e vazavam o boleto do vizinho. Este arquivo cobre o defeito e
 * a correção (fronteira por lookahead `(?=\s|$)` em vez de `\b`).
 *
 * O método é `private`; testamos via cast `as any` (opção que o brief permite)
 * para não mexer nos ~14 call sites que já existem no service.
 */
describe('FinanceiroService — nomeFaturaDeApto (vazamento entre apartamentos)', () => {
  // Só o regex é exercitado — nenhuma dependência do construtor é usada
  // pelo método, então stubs vazios bastam.
  const svc: any = new FinanceiroService(
    {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
  );
  const match = (nome: string, apto: string, bloco?: string | null) =>
    svc.nomeFaturaDeApto(nome, apto, bloco ?? null);

  describe('pontuação colada no número — vazamento comprovado no brief', () => {
    it('apto "10" NÃO casa "Apto 10.1 - Ref. 08/2026"', () => {
      expect(match('Apto 10.1 - Ref. 08/2026', '10')).toBe(false);
    });

    it('apto "10" NÃO casa "Apto 10-A - Ref. 08/2026"', () => {
      expect(match('Apto 10-A - Ref. 08/2026', '10')).toBe(false);
    });

    it('apto "10" NÃO casa "Apto 10/2 - Ref. 08/2026"', () => {
      expect(match('Apto 10/2 - Ref. 08/2026', '10')).toBe(false);
    });

    it('apto "10" continua NÃO casando "Apto 101 - Ref. 08/2026" (caso que o \\b antigo já pegava)', () => {
      expect(match('Apto 101 - Ref. 08/2026', '10')).toBe(false);
    });
  });

  describe('casamento correto — não pode regredir', () => {
    it('apto "10" casa "Apto 10 - Ref. 08/2026" (sem bloco)', () => {
      expect(match('Apto 10 - Ref. 08/2026', '10')).toBe(true);
    });

    it('apto "10" bloco "A" casa "Apto 10 Bloco A - Ref. 08/2026"', () => {
      expect(match('Apto 10 Bloco A - Ref. 08/2026', '10', 'A')).toBe(true);
    });
  });

  describe('bloco: mesma fronteira final vale para o token de bloco', () => {
    it('bloco "A" NÃO casa "Apto 10 Bloco AB - Ref..." (bloco AB != A)', () => {
      expect(match('Apto 10 Bloco AB - Ref. 08/2026', '10', 'A')).toBe(false);
    });
  });

  /**
   * Segunda rodada do mesmo vazamento: exigir só `(?=\s|$)` acertou o
   * SEPARADOR mas errou o VALOR. Espaço separa os campos do nome, mas não é
   * proibido dentro do apto — `assertAptoValido` (apartamentos.service.ts:31)
   * só recusa vazio e só-zeros, e `normalizarUnidade`
   * (superlogica-sync.service.ts:64) devolve identificação não numérica
   * verbatim. Logo "10 A", "101 B" e "Casa 1" entram tanto pelo cadastro
   * quanto pelo ERP, e o apto "10" voltava a ver o Pix do vizinho "10 A".
   * A fronteira agora é o próximo campo de verdade (" Bloco " ou o " - ").
   */
  describe('espaço DENTRO do valor do apto/bloco — segundo vazamento', () => {
    it('apto "10" NÃO casa "Apto 10 A - Ref. 08/2026" (o lançamento é do apto "10 A")', () => {
      expect(match('Apto 10 A - Ref. 08/2026', '10')).toBe(false);
    });

    it('apto "10" bloco "A" NÃO casa "Apto 10 A Bloco A - Ref. 08/2026"', () => {
      expect(match('Apto 10 A Bloco A - Ref. 08/2026', '10', 'A')).toBe(false);
    });

    it('bloco "A" NÃO casa "Apto 10 Bloco A B - Ref..." (mesmo defeito, no bloco)', () => {
      expect(match('Apto 10 Bloco A B - Ref. 08/2026', '10', 'A')).toBe(false);
    });

    it('o dono legítimo do apto com espaço continua vendo a própria cobrança', () => {
      expect(match('Apto 10 A - Ref. 08/2026', '10 A')).toBe(true);
      expect(match('Apto 10 A Bloco B 1 - Ref. 08/2026', '10 A', 'B 1')).toBe(true);
    });
  });

  /**
   * A fronteira nova é ancorada nos formatos dos três produtores reais de
   * nome; se algum deles mudar de forma, é aqui que quebra — de propósito.
   */
  describe('os três produtores reais de nome continuam casando', () => {
    it('montarNomeLancamento (superlogica.service.ts), com e sem bloco', () => {
      expect(match('Apto 101 Bloco A - Ref. 08/2026', '101', 'A')).toBe(true);
      expect(match('Apto 101 - Ref. 08/2026', '101')).toBe(true);
    });

    it('rateio ("- Rateio: ...", financeiro.service.ts:~2296)', () => {
      expect(match('Apto 101 Bloco A - Rateio: Portão novo', '101', 'A')).toBe(true);
      expect(match('Apto 10 A Bloco B - Rateio: Portão novo', '10 A', 'B')).toBe(true);
    });

    it('acordo ("- Acordo Parc. i/n", financeiro.service.ts:~2417)', () => {
      expect(match('Apto 101 Bloco A - Acordo Parc. 1/3', '101', 'A')).toBe(true);
      expect(match('Apto 10 A Bloco B - Acordo Parc. 2/6', '10 A', 'B')).toBe(true);
    });
  });

  describe('regra de morador sem bloco (linha ~190-192)', () => {
    it('morador sem bloco NÃO casa lançamento que tem bloco no nome', () => {
      expect(match('Apto 10 Bloco A - Ref. 08/2026', '10', null)).toBe(false);
    });
  });

  describe('caractere regex-especial no número do apto', () => {
    it('apto "1+2" não quebra o regex e casa exatamente', () => {
      expect(match('Apto 1+2 - Ref. 08/2026', '1+2')).toBe(true);
      // "+" é regex-especial: sem o escape() defensivo isso lançaria
      // SyntaxError ao construir o RegExp, ou casaria errado (quantificador).
      expect(match('Apto 12 - Ref. 08/2026', '1+2')).toBe(false);
    });
  });

  describe('fail-closed deliberado (ruling do controller — não "consertar")', () => {
    it('lançamento legado com pontuação colada some da tela do morador em vez de casar frouxo', () => {
      // Cenário: algum lançamento antigo no banco tem "Apto 10." colado (sem
      // espaço antes do hífen). O fix não tenta tolerar esse formato — a
      // escolha deliberada é fail-closed: não mostrar essa cobrança específica
      // é recuperável (o morador pode pedir pra reemitir/corrigir o nome no
      // ERP), mas mostrar o pix_copia_cola/url_boleto do vizinho não é.
      expect(match('Apto 10. - Ref. 08/2026', '10')).toBe(false);
    });
  });
});
