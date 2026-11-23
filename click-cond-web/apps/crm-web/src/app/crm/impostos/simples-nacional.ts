/**
 * Tabelas do Simples Nacional (LC 123/2006, Anexos III e V, redação da LC 155/2016)
 * e preço mensal por unidades. Funções puras, sem dependência de Angular.
 * Percentuais guardados como frações (6,00% -> 0.06).
 */

export type Anexo = 'III' | 'V';
export type ModoAnexo = 'fator_r' | 'III' | 'V';

/** Repartição do DAS por tributo, em frações que somam 1. */
export interface Partilha { irpj: number; csll: number; cofins: number; pis: number; cpp: number; iss: number }

export interface ResultadoSimples {
  anexo: Anexo;
  faixa: number;              // 1..6
  rbt12: number;
  aliquotaEfetiva: number;    // fração (0.06 = 6%)
  partilha: Partilha;
  limiteFaixa: number;        // teto da faixa atual (180000, 360000…)
  acimaDeUmPontoOitoMi: boolean; // rbt12 > 1.800.000 -> aviso
}

export const TAXA_IMPLANTACAO = 490;
export const FATOR_R_MINIMO = 0.28;

interface FaixaSimples {
  limite: number;     // teto da receita bruta em 12 meses
  nominal: number;    // alíquota nominal (fração)
  deduzir: number;    // parcela a deduzir (R$)
  partilha: Partilha;
}

/** Monta a partilha a partir dos percentuais na ordem IRPJ/CSLL/Cofins/PIS/CPP/ISS. */
function p(irpj: number, csll: number, cofins: number, pis: number, cpp: number, iss: number): Partilha {
  const f = (v: number) => v / 100;
  return { irpj: f(irpj), csll: f(csll), cofins: f(cofins), pis: f(pis), cpp: f(cpp), iss: f(iss) };
}

const LIMITES = [180000, 360000, 720000, 1800000, 3600000, 4800000];

const ANEXO_III: FaixaSimples[] = [
  { limite: LIMITES[0], nominal: 0.06, deduzir: 0, partilha: p(4, 3.5, 12.82, 2.78, 43.4, 33.5) },
  { limite: LIMITES[1], nominal: 0.112, deduzir: 9360, partilha: p(4, 3.5, 14.05, 3.05, 43.4, 32) },
  { limite: LIMITES[2], nominal: 0.135, deduzir: 17640, partilha: p(4, 3.5, 13.64, 2.96, 43.4, 32.5) },
  { limite: LIMITES[3], nominal: 0.16, deduzir: 35640, partilha: p(4, 3.5, 13.64, 2.96, 43.4, 32.5) },
  { limite: LIMITES[4], nominal: 0.21, deduzir: 125640, partilha: p(4, 3.5, 12.82, 2.78, 43.4, 33.5) },
  { limite: LIMITES[5], nominal: 0.33, deduzir: 648000, partilha: p(35, 15, 16.03, 3.47, 30.5, 0) },
];

const ANEXO_V: FaixaSimples[] = [
  { limite: LIMITES[0], nominal: 0.155, deduzir: 0, partilha: p(25, 15, 14.1, 3.05, 28.85, 14) },
  { limite: LIMITES[1], nominal: 0.18, deduzir: 4500, partilha: p(23, 15, 14.1, 3.05, 27.85, 17) },
  { limite: LIMITES[2], nominal: 0.195, deduzir: 9900, partilha: p(24, 15, 14.92, 3.23, 23.85, 19) },
  { limite: LIMITES[3], nominal: 0.205, deduzir: 17100, partilha: p(21, 15, 15.74, 3.41, 23.85, 21) },
  { limite: LIMITES[4], nominal: 0.23, deduzir: 62100, partilha: p(23, 12.5, 14.1, 3.05, 23.85, 23.5) },
  { limite: LIMITES[5], nominal: 0.305, deduzir: 540000, partilha: p(35, 15.5, 16.44, 3.56, 29.5, 0) },
];

/** Fator R = folha de 12 meses ÷ RBT12; >= 28% -> Anexo III, abaixo -> Anexo V. */
export function anexoPorFatorR(folha12: number, rbt12: number): Anexo {
  if (rbt12 <= 0) return 'III'; // sem receita não há imposto; escolha neutra
  return folha12 / rbt12 >= FATOR_R_MINIMO ? 'III' : 'V';
}

/** Alíquota efetiva = (RBT12 × nominal − parcela a deduzir) ÷ RBT12. Acima de 4,8 mi usa a faixa 6. */
export function calcularSimples(rbt12: number, anexo: Anexo): ResultadoSimples {
  const tabela = anexo === 'III' ? ANEXO_III : ANEXO_V;
  const idx = tabela.findIndex((f) => rbt12 <= f.limite);
  const i = idx === -1 ? tabela.length - 1 : idx;
  const f = tabela[i];
  const aliquotaEfetiva = rbt12 > 0 ? (rbt12 * f.nominal - f.deduzir) / rbt12 : f.nominal;
  return {
    anexo,
    faixa: i + 1,
    rbt12,
    aliquotaEfetiva,
    partilha: f.partilha,
    limiteFaixa: f.limite,
    acimaDeUmPontoOitoMi: rbt12 > 1800000,
  };
}

/**
 * Mensalidade pela tabela do site (/precos/, 09/11/2026): R$ 298 fixos até 30 unidades;
 * + R$ 9,90/un. de 31 a 60; + R$ 8,90/un. de 61 a 120; + R$ 11,90/un. acima de 120.
 */
export function precoMensalPorUnidades(unidades: number): number {
  if (unidades <= 0) return 0;
  const ate = (a: number, b: number) => Math.max(0, Math.min(unidades, b) - a);
  const total = 298 + ate(30, 60) * 9.9 + ate(60, 120) * 8.9 + ate(120, Infinity) * 11.9;
  return Math.round(total * 100) / 100;
}
