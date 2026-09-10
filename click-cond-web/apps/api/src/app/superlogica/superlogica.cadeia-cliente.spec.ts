import { FinanceiroService } from '../financeiro/financeiro.service';
import { SuperlogicaClient } from './superlogica.client';
import { SuperlogicaService } from './superlogica.service';
import { SuperlogicaSyncService } from './superlogica-sync.service';

/**
 * A corrente inteira, do ERP até a tela do morador — no formato REAL do
 * condomínio de teste "Teste Prestare Api" (id 43 na licença, lido em
 * 27/08/2026): bloco "a" minúsculo, unidades "01".."05".
 *
 * Os testes existentes cobrem cada elo isolado (normalização, mapper, regex de
 * nome). Nenhum atravessava os três de ponta a ponta, e é exatamente na junção
 * que a cobrança some da tela ou aparece para o morador errado: o mapper monta
 * o `nome` a partir do apartamento normalizado, e o Financeiro reencontra o
 * dono PARSEANDO esse mesmo texto. Se as duas pontas discordarem, ninguém
 * acusa erro — a taxa simplesmente não aparece para ninguém.
 *
 * Nenhuma rede é tocada: o cliente HTTP só é instanciado para o mapper poder
 * usar os helpers estáticos de data.
 */
describe('Superlógica → Financeiro — cadeia completa no condomínio de teste', () => {
  const superlogica = new SuperlogicaService(new SuperlogicaClient());

  // Só o regex do Financeiro é exercitado; o construtor não é usado por ele.
  const financeiro: any = new FinanceiroService(
    {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
  );

  /** Payload real de uma unidade do ERP: zeros à esquerda, bloco minúsculo. */
  const unidadeErp = { st_bloco_uni: 'a', st_unidade_uni: '01' };

  /** Cobrança como o ERP devolve em cobranca/index. */
  const cobrancaErp = {
    id_recebimento_recb: '91515',
    id_condominio_cond: '43',
    id_unidade_uni: '1901',
    st_documento_recb: '001/00499387345',
    dt_vencimento_recb: '08/10/2026 00:00:00', // MM/DD/AAAA → 10/ago/2026
    dt_liquidacao_recb: '',
    vl_total_recb: '9.00',
    fl_status_recb: '0',
    st_pixqrcode_recb: '00020101021226990014br.gov.bcb.pix2577...',
    link_segundavia: 'https://prestare.superlogica.net/areadocliente/segundavia/x',
  };

  /** Reproduz a importação: é ela que define o apto/bloco gravados no Clique. */
  function apartamentoImportado(u: { st_bloco_uni: string; st_unidade_uni: string }) {
    return {
      apto: SuperlogicaSyncService.normalizarUnidade(u.st_unidade_uni),
      bloco: SuperlogicaSyncService.normalizarUnidade(u.st_bloco_uni) || null,
    };
  }

  it('a unidade "01" do bloco "a" vira apto 1 bloco a', () => {
    expect(apartamentoImportado(unidadeErp)).toEqual({ apto: '1', bloco: 'a' });
  });

  it('a cobrança vira um lançamento com o que o app precisa para pagar', () => {
    const apto = apartamentoImportado(unidadeErp);
    const lanc = superlogica.mapearCobranca(cobrancaErp as any, 7, apto.apto, apto.bloco);

    expect(lanc).not.toBeNull();
    // Sem estes três campos a tela do morador mostra dívida sem forma de pagar.
    expect(lanc!.pix_copia_cola).toContain('br.gov.bcb.pix');
    expect(lanc!.url_boleto).toContain('segundavia');
    expect(lanc!.valor).toBe(9);
    // 'C' é o que faz o lançamento ser cobrança do condomínio, e não conta
    // pessoal do morador — o filtro de getByUser depende disso.
    expect(lanc!.tipo).toBe('C');
    expect(lanc!.pago).toBe(0);
    // MM/DD/AAAA: se fosse lido como dd/mm, o vencimento cairia em outubro.
    expect(lanc!.data_vencimento.getMonth()).toBe(7); // agosto
    expect(lanc!.data_vencimento.getDate()).toBe(10);
  });

  it('o morador do apto 1 bloco a enxerga a própria taxa', () => {
    const apto = apartamentoImportado(unidadeErp);
    const lanc = superlogica.mapearCobranca(cobrancaErp as any, 7, apto.apto, apto.bloco);

    // `Moradores.bloco`/`apartamento` são copiados verbatim do Apartamentos no
    // cadastro (moradores.service.ts), então é este par que chega ao filtro.
    expect(financeiro.nomeFaturaDeApto(lanc!.nome, '1', 'a')).toBe(true);
  });

  it('os vizinhos NÃO enxergam a taxa do apto 1', () => {
    const apto = apartamentoImportado(unidadeErp);
    const lanc = superlogica.mapearCobranca(cobrancaErp as any, 7, apto.apto, apto.bloco);

    for (const vizinho of ['2', '3', '4', '5']) {
      expect(financeiro.nomeFaturaDeApto(lanc!.nome, vizinho, 'a')).toBe(false);
    }
  });

  it('cada uma das cinco unidades casa só com o próprio morador', () => {
    // A matriz inteira do condomínio de teste: 5 cobranças x 5 moradores.
    // Só a diagonal pode casar — qualquer outro `true` é boleto na tela errada.
    const unidades = ['01', '02', '03', '04', '05'].map((u) =>
      apartamentoImportado({ st_bloco_uni: 'a', st_unidade_uni: u }),
    );

    const nomes = unidades.map(
      (a) => superlogica.mapearCobranca(cobrancaErp as any, 7, a.apto, a.bloco)!.nome,
    );

    nomes.forEach((nome, i) => {
      unidades.forEach((morador, j) => {
        expect(financeiro.nomeFaturaDeApto(nome, morador.apto, morador.bloco)).toBe(i === j);
      });
    });
  });

  it('o bloco do ERP é case-insensitive no reencontro', () => {
    // O ERP manda "a"; o cadastro manual do Clique costuma ter "A". As duas
    // grafias precisam achar a mesma cobrança, ou o morador cadastrado à mão
    // deixa de ver a taxa depois que o condomínio é ativado.
    const apto = apartamentoImportado(unidadeErp);
    const lanc = superlogica.mapearCobranca(cobrancaErp as any, 7, apto.apto, apto.bloco);

    expect(financeiro.nomeFaturaDeApto(lanc!.nome, '1', 'A')).toBe(true);
  });

  it('cobrança da unidade fantasma do condomínio não vira lançamento', () => {
    // "0000" é o lançamento do próprio condomínio no ERP. Vira "Apto  - Ref.",
    // texto que o regex do Financeiro pode encaixar em mais de um morador.
    const fantasma = apartamentoImportado({ st_bloco_uni: '', st_unidade_uni: '0000' });
    const lanc = superlogica.mapearCobranca(cobrancaErp as any, 7, fantasma.apto, fantasma.bloco);

    expect(lanc).toBeNull();
  });

  it('quando o ERP confirma o pagamento, o lançamento vira pago com a data da baixa', () => {
    const apto = apartamentoImportado(unidadeErp);
    const paga = {
      ...cobrancaErp,
      fl_status_recb: '3',
      dt_liquidacao_recb: '08/12/2026 00:00:00', // 12/ago/2026
    };

    const lanc = superlogica.mapearCobranca(paga as any, 7, apto.apto, apto.bloco);

    expect(lanc!.pago).toBe(1);
    expect(lanc!.status).toBe('pago');
    expect(lanc!.data.getMonth()).toBe(7);
    expect(lanc!.data.getDate()).toBe(12);
  });
});
