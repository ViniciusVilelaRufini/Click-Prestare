import {
  ModoAnexo,
  ResultadoSimples,
  TAXA_IMPLANTACAO,
  anexoPorFatorR,
  calcularSimples,
  precoMensalPorUnidades,
} from './simples-nacional';

export interface EntradaSimulacao {
  condominios: number;  // quantos condomínios novos
  unidades: number;     // unidades de cada condomínio
  rbt12Atual: number;   // receita real dos últimos 12 meses (0 sem faturas)
  modoAnexo: ModoAnexo;
  folhaMensal: number;  // folha + pró-labore por mês
}

export interface ResultadoSimulacao {
  mensalidade: number;           // preço de um condomínio (tabela do site)
  receitaMensal: number;         // mensalidade × condomínios
  rbt12: number;                 // receita atual + 12 meses da receita simulada
  fatorR: number | null;         // folha de 12 meses ÷ rbt12; null sem receita
  simples: ResultadoSimples;
  impostoPorCondominio: number;
  liquidoPorCondominio: number;
  dasMensal: number;             // imposto do mês sobre a receita simulada
  impostoImplantacao: number;
  liquidoImplantacao: number;
}

function arredondar(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

/** Quantidade digitada → inteiro não negativo (vazio, NaN ou negativo vira 0). */
function quantidade(v: number): number {
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/**
 * Simula a venda de N condomínios de U unidades: acha a faixa do Simples com a
 * receita de 12 meses (atual + simulada) e aplica a alíquota efetiva à
 * mensalidade e à implantação. Não depende de haver faturas.
 */
export function simularVenda(e: EntradaSimulacao): ResultadoSimulacao {
  const condominios = quantidade(e.condominios);
  const mensalidade = precoMensalPorUnidades(quantidade(e.unidades));
  const receitaMensal = arredondar(mensalidade * condominios);
  const rbt12 = arredondar(Math.max(0, Number(e.rbt12Atual) || 0) + receitaMensal * 12);
  const folha12 = Math.max(0, Number(e.folhaMensal) || 0) * 12;

  const anexo = e.modoAnexo === 'fator_r' ? anexoPorFatorR(folha12, rbt12) : e.modoAnexo;
  const simples = calcularSimples(rbt12, anexo);
  const aliquota = simples.aliquotaEfetiva;

  const impostoPorCondominio = arredondar(mensalidade * aliquota);
  const impostoImplantacao = arredondar(TAXA_IMPLANTACAO * aliquota);

  return {
    mensalidade,
    receitaMensal,
    rbt12,
    fatorR: rbt12 > 0 ? folha12 / rbt12 : null,
    simples,
    impostoPorCondominio,
    liquidoPorCondominio: arredondar(mensalidade - impostoPorCondominio),
    dasMensal: arredondar(receitaMensal * aliquota),
    impostoImplantacao,
    liquidoImplantacao: arredondar(TAXA_IMPLANTACAO - impostoImplantacao),
  };
}
