/**
 * Cálculo do imposto (DAS do Simples Nacional) do mês, total, por tributo e por cliente.
 * Função pura, sem dependência de Angular.
 */
import type { ConfigImposto } from '../crm.models';
import { ApuracaoReceita, FaturaReceita, apurarReceita, indiceMes } from './apuracao-receita';
import { ModoAnexo, ResultadoSimples, anexoPorFatorR, calcularSimples } from './simples-nacional';

export interface ImpostoCliente { clienteId: number; nome: string; mensalidade: number; imposto: number; liquido: number }

export interface ImpostoMes {
  apuracao: ApuracaoReceita;
  simples: ResultadoSimples;
  fatorR: number | null;           // folha12 / rbt12; null quando rbt12 = 0
  folhaNaoInformada: boolean;      // modo fator_r e folha 0
  semDados: boolean;               // sem faturas e sem MRR: nada a estimar
  receitaMes: number;
  receitaMesPeloMrr: boolean;
  das: number;                     // receitaMes × aliquotaEfetiva
  porTributo: { tributo: string; valor: number; reforma: string }[];
  porCliente: ImpostoCliente[];    // ordenado por mensalidade desc
  faturasPodemEstarCortadas: boolean;
  faturasEstimadas: number;        // faturas com valor estimado na janela de 12 meses ou no mês
}

export interface EntradaImpostoMes {
  faturas: FaturaReceita[];
  totalFaturasCarregadas: number;
  clientes: { id: number; nome: string; mrr: number; ativo: boolean }[];
  mrrTotal: number;
  config: ConfigImposto;
  mesApuracao: string;
}

/** Quantidade de faturas a partir da qual a listagem pode ter sido truncada pela API. */
const LIMITE_FATURAS = 500;

const arredondar = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;

export function calcularImpostoMes(e: EntradaImpostoMes): ImpostoMes {
  const apuracao = apurarReceita(e.faturas, e.mesApuracao, e.config.inicioAtividade);
  const folha12 = e.config.folhaMensal * 12;
  const anexo = e.config.modoAnexo === 'fator_r' ? anexoPorFatorR(folha12, apuracao.rbt12) : e.config.modoAnexo;
  const simples = calcularSimples(apuracao.rbt12, anexo);

  const receitaMesPeloMrr = apuracao.receitaMes === 0 && e.mrrTotal > 0;
  const receitaMes = receitaMesPeloMrr ? e.mrrTotal : apuracao.receitaMes;
  const alvo = indiceMes(e.mesApuracao);
  const faturasEstimadas = alvo === null ? 0 : e.faturas.filter((f) => {
    const i = indiceMes(f.referencia);
    return f.estimada === true && i !== null && i >= alvo - 12 && i <= alvo;
  }).length;
  const das = arredondar(receitaMes * simples.aliquotaEfetiva);

  const pt = simples.partilha;
  const parte = (fracao: number) => arredondar(das * fracao);
  const porTributo = [
    { tributo: 'CPP (INSS patronal)', valor: parte(pt.cpp), reforma: 'continua' },
    { tributo: 'ISS', valor: parte(pt.iss), reforma: 'vira IBS (2029–2033)' },
    { tributo: 'PIS', valor: parte(pt.pis), reforma: 'vira CBS (2027)' },
    { tributo: 'Cofins', valor: parte(pt.cofins), reforma: 'vira CBS (2027)' },
    { tributo: 'IRPJ', valor: parte(pt.irpj), reforma: 'continua' },
    { tributo: 'CSLL', valor: parte(pt.csll), reforma: 'continua' },
  ];

  const porCliente = e.clientes
    .filter((c) => c.ativo)
    .map((c) => {
      const imposto = arredondar(c.mrr * simples.aliquotaEfetiva);
      return { clienteId: c.id, nome: c.nome, mensalidade: c.mrr, imposto, liquido: arredondar(c.mrr - imposto) };
    })
    .sort((a, b) => b.mensalidade - a.mensalidade);

  return {
    apuracao,
    simples,
    fatorR: apuracao.rbt12 > 0 ? folha12 / apuracao.rbt12 : null,
    folhaNaoInformada: e.config.modoAnexo === 'fator_r' && e.config.folhaMensal <= 0,
    semDados: apuracao.semDados && e.mrrTotal <= 0,
    receitaMes,
    receitaMesPeloMrr,
    das,
    porTributo,
    porCliente,
    faturasPodemEstarCortadas: e.totalFaturasCarregadas >= LIMITE_FATURAS,
    faturasEstimadas,
  };
}

/** Lê as chaves imposto_* da config do CRM, tolerando valores ausentes ou inválidos. */
export function lerConfigImposto(cfg: Record<string, string>): ConfigImposto {
  const anexo = cfg['imposto_anexo'];
  const modoAnexo: ModoAnexo = anexo === 'III' || anexo === 'V' ? anexo : 'fator_r';
  const folha = Number(cfg['imposto_folha_mensal']);
  const folhaMensal = cfg['imposto_folha_mensal'] && Number.isFinite(folha) && folha > 0 ? folha : 0;
  const inicio = cfg['imposto_inicio_atividade'] ?? '';
  const inicioAtividade = /^(0[1-9]|1[0-2])\/\d{4}$/.test(inicio) ? inicio : null;
  return { modoAnexo, folhaMensal, inicioAtividade };
}
