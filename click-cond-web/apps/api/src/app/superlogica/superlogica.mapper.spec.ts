import { SuperlogicaService } from './superlogica.service';
import { SuperlogicaClient } from './superlogica.client';
import type { SuperlogicaCobranca } from './superlogica.types';

/**
 * Tradução de cobrança do ERP para `Financeiro`.
 *
 * O ponto sensível é o campo `nome`: o Financeiro do Clique descobre de qual
 * morador é a cobrança PARSEANDO esse texto (`nomeFaturaDeApto`). Formato
 * errado = cobrança invisível, ou visível para o morador errado.
 */
/**
 * O ERP devolve a MESMA unidade em mais de uma linha quando ela tem mais de um
 * contato. Observado em produção (condomínio de teste 43, unidade 05, depois de
 * ganhar o segundo contato): vieram 6 linhas para 5 unidades, uma delas com
 * `contatos: []` e outra com os dois.
 */
describe('SuperlogicaService — consolidação de unidades repetidas', () => {
  const linha = (id: string, contatos: any[]) => ({
    id_unidade_uni: id,
    id_condominio_cond: '43',
    st_unidade_uni: '05',
    st_bloco_uni: 'a',
    contatos,
  }) as any;

  it('junta as linhas da mesma unidade numa só', () => {
    const r = SuperlogicaService.consolidarUnidades([
      linha('1905', []),
      linha('1905', [{ id_contato_con: '4593' }, { id_contato_con: '4594' }]),
    ]);

    expect(r).toHaveLength(1);
    expect(r[0].contatos).toHaveLength(2);
  });

  it('não deixa a versão vazia vencer', () => {
    // É o caso perigoso: montar o payload de envio a partir da linha vazia
    // mandaria a unidade sem os contatos existentes.
    const r = SuperlogicaService.consolidarUnidades([
      linha('1905', [{ id_contato_con: '4593' }]),
      linha('1905', []),
    ]);

    expect(r[0].contatos).toHaveLength(1);
  });

  it('não duplica contato que aparece nas duas linhas', () => {
    const r = SuperlogicaService.consolidarUnidades([
      linha('1905', [{ id_contato_con: '4593' }]),
      linha('1905', [{ id_contato_con: '4593' }, { id_contato_con: '4594' }]),
    ]);

    expect(r[0].contatos?.map((c) => c.id_contato_con)).toEqual(['4593', '4594']);
  });

  it('preserva unidades distintas', () => {
    const r = SuperlogicaService.consolidarUnidades([
      linha('1901', [{ id_contato_con: '4589' }]),
      linha('1905', [{ id_contato_con: '4593' }]),
    ]);

    expect(r).toHaveLength(2);
  });
});

describe('SuperlogicaService — mapeamento de cobrança', () => {
  const service = new SuperlogicaService(new SuperlogicaClient());

  const cobrancaPendente: SuperlogicaCobranca = {
    id_recebimento_recb: '91515',
    id_condominio_cond: '24',
    id_unidade_uni: '837',
    st_unidade_uni: '000408',
    st_bloco_uni: '04',
    st_documento_recb: '001/00499387345',
    dt_vencimento_recb: '08/10/2026 00:00:00',
    dt_liquidacao_recb: '',
    vl_total_recb: '350.00',
    fl_status_recb: '0',
    st_pixqrcode_recb: '00020101021226990014br.gov.bcb.pix...',
    link_segundavia: 'https://prestare.superlogica.net/clients/areadocondomino/publico/cobranca/x',
  };

  it('monta o nome no padrão que o Financeiro sabe ler', () => {
    const lancamento = service.mapearCobranca(cobrancaPendente, 3, '408', '04');

    expect(lancamento?.nome).toBe('Apto 408 Bloco 04 - Ref. 08/2026');
  });

  it('usa o apto do Clique, não o da Superlógica', () => {
    // O ERP manda "000408" com zeros à esquerda. Se isso vazasse para o nome,
    // o regex `\bApto 408\b` do Financeiro não casaria e o morador não veria
    // a própria cobrança.
    const lancamento = service.mapearCobranca(cobrancaPendente, 3, '408', '04');

    expect(lancamento?.nome).not.toContain('000408');
  });

  it('omite o bloco quando o condomínio não tem', () => {
    const lancamento = service.mapearCobranca(cobrancaPendente, 3, '12', null);

    expect(lancamento?.nome).toBe('Apto 12 - Ref. 08/2026');
  });

  it('marca como pendente quando fl_status_recb = 0', () => {
    const lancamento = service.mapearCobranca(cobrancaPendente, 3, '408', '04');

    expect(lancamento?.pago).toBe(0);
    expect(lancamento?.status).toBe('pendente');
  });

  it('marca como pago quando fl_status_recb = 3', () => {
    const paga: SuperlogicaCobranca = {
      ...cobrancaPendente,
      fl_status_recb: '3',
      dt_liquidacao_recb: '08/05/2026 00:00:00',
    };

    const lancamento = service.mapearCobranca(paga, 3, '408', '04');

    expect(lancamento?.pago).toBe(1);
    expect(lancamento?.status).toBe('pago');
    expect(lancamento?.data.getMonth()).toBe(7); // data do pagamento
    expect(lancamento?.data.getDate()).toBe(5);
  });

  it('carrega Pix e boleto para a tela do morador', () => {
    const lancamento = service.mapearCobranca(cobrancaPendente, 3, '408', '04');

    expect(lancamento?.pix_copia_cola).toContain('br.gov.bcb.pix');
    expect(lancamento?.url_boleto).toContain('superlogica.net');
  });

  it('grava a chave de deduplicação', () => {
    // O índice único (origem, id_externo) é o que impede o cron de duplicar
    // lançamento ao reprocessar o mesmo mês.
    const lancamento = service.mapearCobranca(cobrancaPendente, 3, '408', '04');

    expect(lancamento?.origem).toBe('superlogica');
    expect(lancamento?.id_externo).toBe('91515');
  });

  it('descarta cobrança sem vencimento em vez de gravar data inválida', () => {
    const semVencimento = { ...cobrancaPendente, dt_vencimento_recb: '' };

    expect(service.mapearCobranca(semVencimento, 3, '408', '04')).toBeNull();
  });

  it.each(['', '   ', '0', '0000'])(
    'descarta cobrança de unidade não identificável (%p)',
    (apto) => {
      // "Apto  - Ref. 08/2026" é texto que o casamento por regex do Financeiro
      // pode encaixar em mais de um morador. Melhor não existir.
      expect(service.mapearCobranca(cobrancaPendente, 3, apto, '04')).toBeNull();
    },
  );

  it('descarta cobrança com valor ilegível', () => {
    const valorQuebrado = { ...cobrancaPendente, vl_total_recb: 'R$ 350,00' };

    // Number('R$ 350,00') é NaN; gravar isso quebraria a tela do morador.
    expect(service.mapearCobranca(valorQuebrado, 3, '408', '04')).toBeNull();
  });

  it('não vaza cobrança entre condomínios pela chave de deduplicação', () => {
    // Dois condomínios podem, em tese, ter o mesmo id_recebimento_recb — a
    // Superlógica não garante unicidade global. O que separa os lançamentos é
    // o id_condominio, que entra na chave única junto com (origem, id_externo).
    const noCondominio3 = service.mapearCobranca(cobrancaPendente, 3, '408', '04');
    const noCondominio9 = service.mapearCobranca(cobrancaPendente, 9, '408', '04');

    expect(noCondominio3?.id_externo).toBe(noCondominio9?.id_externo);
    expect(noCondominio3?.id_condominio).not.toBe(noCondominio9?.id_condominio);
  });

  it('converte valor de string para número', () => {
    const lancamento = service.mapearCobranca(cobrancaPendente, 3, '408', '04');

    expect(lancamento?.valor).toBe(350);
  });
});
