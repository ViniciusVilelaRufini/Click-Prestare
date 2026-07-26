import type { DeclaracaoFerramenta } from './gemini.client';
import type { ContextoFerramenta, PapelChat } from './chat-ia.tools';
import type { AcaoPendente, ItemResumo, TipoAcao } from './acao-pendente.store';

/**
 * Ferramentas de AÇÃO do Assistente IA.
 *
 * Diferença fundamental para as de leitura: elas NÃO executam. Validam,
 * resolvem os dados e registram uma PROPOSTA; quem executa é o endpoint
 * /chat-ia/confirmar, depois do usuário tocar em Confirmar no app.
 *
 * O motivo é o modelo errar interpretação: "reserva a churrasqueira sábado"
 * não diz qual sábado nem qual churrasqueira. Se executasse direto, o erro
 * viraria reserva de verdade — com taxa lançada — em vez de um card recusado.
 *
 * A autorização segue a mesma regra das ferramentas de leitura: catálogo
 * filtrado por papel + escopo vindo do JWT. E a validação acontece DUAS vezes,
 * aqui e de novo no momento de executar, porque entre propor e confirmar o
 * mundo muda (alguém pode reservar o mesmo horário nesse intervalo).
 */

export type NovaProposta = Omit<AcaoPendente, 'id' | 'criadaEm' | 'expiraEm'>;

export interface FerramentaAcao {
  nome: string;
  descricao: string;
  parametros?: DeclaracaoFerramenta['parameters'];
  papeis: PapelChat[];
  /** Valida e devolve a proposta, ou uma mensagem de erro para o modelo. */
  propor(
    args: Record<string, any>,
    ctx: ContextoFerramenta,
  ): Promise<{ proposta?: NovaProposta; erro?: string }>;
}

const TODOS: PapelChat[] = ['Sindico', 'Funcionario', 'Morador'];

const RE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_HORA = /^(\d{2}):(\d{2})$/;

/** "2026-08-01" -> { br: "01/08/2026", dia: Date UTC } ou null. */
function lerData(raw: unknown): { br: string; dia: Date } | null {
  const m = String(raw ?? '').trim().match(RE_DATA);
  if (!m) return null;
  const [, a, mes, d] = m;
  const dia = new Date(Date.UTC(Number(a), Number(mes) - 1, Number(d)));
  if (Number.isNaN(dia.getTime())) return null;
  return { br: `${d}/${mes}/${a}`, dia };
}

/** "14:30" -> minutos desde meia-noite, ou null. */
function lerHora(raw: unknown): number | null {
  const m = String(raw ?? '').trim().match(RE_HORA);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function hhmm(minutos: number): string {
  return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
}

export const FERRAMENTAS_ACAO: FerramentaAcao[] = [
  // -----------------------------------------------------------------------
  {
    nome: 'propor_reserva_area',
    descricao:
      'Prepara uma reserva de área social para o usuário confirmar. NÃO reserva sozinha: devolve uma proposta que aparece como card no app e só vira reserva depois que o usuário confirmar. Antes de chamar, use listar_areas_sociais para achar o id e reservas_da_area_na_data para conferir se está livre. Converta datas relativas ("sábado", "amanhã") para AAAA-MM-DD usando a data de hoje.',
    parametros: {
      type: 'object',
      properties: {
        id_area: { type: 'number', description: 'id da área social' },
        data: { type: 'string', description: 'Data no formato AAAA-MM-DD' },
        hora_de: { type: 'string', description: 'Hora de início, formato HH:MM' },
        hora_ate: { type: 'string', description: 'Hora de término, formato HH:MM' },
      },
      required: ['id_area', 'data', 'hora_de', 'hora_ate'],
    },
    papeis: TODOS,
    async propor(args, ctx) {
      const idArea = Number(args.id_area);
      if (!idArea || Number.isNaN(idArea)) return { erro: 'Informe qual área social.' };

      const data = lerData(args.data);
      if (!data) return { erro: 'Data inválida. Use o formato AAAA-MM-DD.' };

      const de = lerHora(args.hora_de);
      const ate = lerHora(args.hora_ate);
      if (de === null || ate === null) return { erro: 'Horário inválido. Use HH:MM.' };
      if (ate <= de) return { erro: 'A hora de término precisa ser depois da de início.' };

      // Não deixa reservar para trás. Comparação por dia em UTC, para o
      // fuso não transformar "hoje" em "ontem".
      const agora = new Date();
      const hojeUtc = Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate());
      if (data.dia.getTime() < hojeUtc) {
        return { erro: 'Essa data já passou. Peça uma data futura ao usuário.' };
      }

      // A área tem que ser deste condomínio — o modelo pode mandar id alheio.
      const area = await ctx.prisma.areas_Sociais.findFirst({
        where: { id: idArea, id_condominio: ctx.idCondominio },
        select: { id: true, nome: true, precisa_agendar: true, precisa_pagamento: true, precisa_autorizacao: true },
      });
      if (!area) return { erro: 'Área social não encontrada neste condomínio.' };

      if (ctx.aptos.length === 0) {
        return { erro: 'O usuário não tem apartamento vinculado neste condomínio, então não pode reservar.' };
      }

      // Conflito de horário. Reconferido no confirmar, porque entre propor e
      // confirmar alguém pode pegar o mesmo horário.
      const conflito = await ctx.prisma.areas_Sociais_Agendamentos.findMany({
        where: { id_area_social: area.id, data: data.dia, status: { in: ['pendente', 'aprovado'] } },
        select: { hora_de: true, hora_ate: true },
      });
      const bate = conflito.some((r) => {
        if (!r.hora_de || !r.hora_ate) return false;
        const rDe = new Date(r.hora_de).getUTCHours() * 60 + new Date(r.hora_de).getUTCMinutes();
        const rAte = new Date(r.hora_ate).getUTCHours() * 60 + new Date(r.hora_ate).getUTCMinutes();
        return de < rAte && ate > rDe;
      });
      if (bate) {
        return { erro: `${area.nome} já tem reserva nesse horário em ${data.br}. Sugira outro horário.` };
      }

      const itens: ItemResumo[] = [
        { rotulo: 'Área', valor: area.nome },
        { rotulo: 'Data', valor: data.br },
        { rotulo: 'Horário', valor: `${hhmm(de)} às ${hhmm(ate)}` },
      ];
      if (area.precisa_autorizacao === 1) {
        itens.push({ rotulo: 'Observação', valor: 'Fica pendente de aprovação do síndico' });
      }
      if (area.precisa_pagamento === 1) {
        itens.push({ rotulo: 'Atenção', valor: 'Esta área tem taxa de uso' });
      }

      return {
        proposta: {
          tipo: 'reserva_area' as TipoAcao,
          idUser: ctx.idUser,
          idCondominio: ctx.idCondominio,
          titulo: 'Confirmar reserva',
          itens,
          payload: {
            id_area_social: area.id,
            data: data.br, // insertAgendamento espera DD/MM/YYYY
            horaDe: hhmm(de),
            horaAte: hhmm(ate),
            id_apartamento: ctx.aptos[0],
          },
        },
      };
    },
  },

  // -----------------------------------------------------------------------
  {
    nome: 'propor_ocorrencia',
    descricao:
      'Prepara a abertura de uma ocorrência/chamado para o usuário confirmar. NÃO abre sozinha: devolve uma proposta que aparece como card no app. Use quando o usuário relatar um problema (vazamento, barulho, lâmpada queimada). Escreva a descrição de forma clara e completa a partir do que ele contou.',
    parametros: {
      type: 'object',
      properties: {
        descricao: {
          type: 'string',
          description: 'Descrição do problema, clara e completa',
        },
        categoria: {
          type: 'string',
          description: 'Nome da categoria, se o usuário indicar uma (ex: Manutenção, Barulho)',
        },
      },
      required: ['descricao'],
    },
    papeis: TODOS,
    async propor(args, ctx) {
      const descricao = String(args.descricao ?? '').trim();
      if (descricao.length < 10) {
        return { erro: 'Descrição muito curta. Pergunte mais detalhes ao usuário antes de propor.' };
      }

      const itens: ItemResumo[] = [{ rotulo: 'Descrição', valor: descricao }];

      // Categoria é opcional; se o nome não bater, segue sem categoria em vez
      // de falhar — melhor abrir o chamado do que travar por causa do rótulo.
      let idCategoria: number | null = null;
      const nomeCat = String(args.categoria ?? '').trim();
      if (nomeCat) {
        const cat = await ctx.prisma.ocorrencias_Categorias.findFirst({
          where: { nome: { contains: nomeCat } },
          select: { id: true, nome: true },
        });
        if (cat) {
          idCategoria = cat.id;
          itens.push({ rotulo: 'Categoria', valor: cat.nome });
        }
      }

      return {
        proposta: {
          tipo: 'ocorrencia' as TipoAcao,
          idUser: ctx.idUser,
          idCondominio: ctx.idCondominio,
          titulo: 'Confirmar abertura de ocorrência',
          itens,
          payload: { descricao, tipo: idCategoria },
        },
      };
    },
  },
];

// -----------------------------------------------------------------------
FERRAMENTAS_ACAO.push({
  nome: 'propor_visitante',
  descricao:
    'Prepara o cadastro de um visitante ou prestador para o apartamento do usuário, para ele confirmar. NÃO cadastra sozinha. Use quando ele disser que vai receber alguém. Se não souber a data, pergunte antes; se ele disser "hoje", converta para a data de hoje.',
  parametros: {
    type: 'object',
    properties: {
      nome: { type: 'string', description: 'Nome completo do visitante' },
      documento: { type: 'string', description: 'CPF ou RG, se o usuário informar' },
      data: { type: 'string', description: 'Data da visita, formato AAAA-MM-DD' },
      hora: { type: 'string', description: 'Hora prevista de chegada, formato HH:MM' },
      hora_fim: {
        type: 'string',
        description:
          'Hora limite da visita, formato HH:MM. Se o usuário não disser, omita: vale até o fim do dia.',
      },
      prestador: {
        type: 'boolean',
        description: 'true se for prestador de serviço (diarista, técnico), false se for visita comum',
      },
    },
    required: ['nome', 'data'],
  },
  papeis: TODOS,
  async propor(args, ctx) {
    const nome = String(args.nome ?? '').trim();
    if (nome.length < 3) return { erro: 'Pergunte o nome completo do visitante.' };

    const data = lerData(args.data);
    if (!data) return { erro: 'Data inválida. Pergunte a data e use o formato AAAA-MM-DD.' };

    const agora = new Date();
    const hojeUtc = Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate());
    if (data.dia.getTime() < hojeUtc) {
      return { erro: 'Essa data já passou. Confirme a data com o usuário.' };
    }

    if (ctx.aptos.length === 0) {
      return { erro: 'O usuário não tem apartamento vinculado neste condomínio.' };
    }

    // Hora é opcional; sem ela vale o começo do dia.
    const min = args.hora !== undefined ? lerHora(args.hora) : 0;
    if (min === null) return { erro: 'Horário inválido. Use HH:MM.' };

    /**
     * O término NÃO pode ficar nulo. O validarCodigo trata termino nulo como
     * `now`, e como ele ainda soma 15 min de tolerância, a comparação
     * `now > termino + 15min` nunca é verdadeira — o PIN passaria a valer para
     * sempre. Todo visitante criado pela tela do app tem término porque o
     * formulário exige; aqui o padrão é o fim do dia da visita.
     */
    const fim = args.hora_fim !== undefined ? lerHora(args.hora_fim) : 23 * 60 + 59;
    if (fim === null) return { erro: 'Hora limite inválida. Use HH:MM.' };
    if (fim <= min) {
      return { erro: 'A hora limite precisa ser depois da hora de chegada.' };
    }

    const prestador = args.prestador === true;
    const documento = String(args.documento ?? '').trim();
    const iso = data.br.split('/').reverse().join('-');

    const itens: ItemResumo[] = [
      { rotulo: prestador ? 'Prestador' : 'Visitante', valor: nome },
      { rotulo: 'Data', valor: data.br },
      // Mostra a janela no card: é o que define até quando o PIN funciona.
      { rotulo: 'Válido', valor: `${hhmm(min)} às ${hhmm(fim)}` },
    ];
    if (documento) itens.push({ rotulo: 'Documento', valor: documento });

    return {
      proposta: {
        tipo: 'visitante' as TipoAcao,
        idUser: ctx.idUser,
        idCondominio: ctx.idCondominio,
        titulo: prestador ? 'Confirmar prestador' : 'Confirmar visitante',
        itens,
        payload: {
          nome,
          doc_identificacao: documento || null,
          // O service espera data-hora local; monta a partir do dia + hora.
          data_hora_inicio: `${iso} ${hhmm(min)}:00`,
          data_hora_termino: `${iso} ${hhmm(fim)}:00`,
          is_visitante: prestador ? 0 : 1,
          is_prestador: prestador ? 1 : 0,
          id_apartamento: ctx.aptos[0],
        },
      },
    };
  },
});

export function acoesPara(papel: PapelChat): FerramentaAcao[] {
  return FERRAMENTAS_ACAO.filter((f) => f.papeis.includes(papel));
}

export function resolverAcao(nome: string, papel: PapelChat): FerramentaAcao | undefined {
  return acoesPara(papel).find((f) => f.nome === nome);
}
