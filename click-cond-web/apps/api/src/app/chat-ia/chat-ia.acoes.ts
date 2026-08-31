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

// -----------------------------------------------------------------------
/**
 * Categorias que o morador pode lançar para si.
 *
 * Espelha o kCategoriasPessoais do app (utils/financeiro_constants.dart).
 * "Condomínio"/"Taxa Condominial" ficam DE FORA: essas cobranças são geradas
 * pelo síndico, e deixar o morador criá-las permitiria forjar a própria taxa.
 */
export const CATEGORIAS_CONTA_MORADOR = ['Aluguel', 'Água', 'Luz', 'Internet', 'Outros'];

/** Normaliza para comparar sem acento/caixa. */
function chaveCategoria(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

const CATEGORIAS_BLOQUEADAS = ['condominio', 'taxa condominial'];

FERRAMENTAS_ACAO.push({
  nome: 'propor_conta_morador',
  descricao:
    `Prepara o lançamento de uma conta pessoal do morador (água, luz, internet, aluguel e afins) para ele confirmar. NÃO lança sozinha. Categorias: ${CATEGORIAS_CONTA_MORADOR.join(', ')}. NÃO serve para a taxa de condomínio, que é lançada pelo síndico. Se o usuário disser que já pagou, marque ja_paga.`,
  parametros: {
    type: 'object',
    properties: {
      categoria: {
        type: 'string',
        description: `Uma de: ${CATEGORIAS_CONTA_MORADOR.join(', ')}`,
      },
      valor: { type: 'number', description: 'Valor em reais, ex: 130.50' },
      nome: {
        type: 'string',
        description: 'Descrição da conta, ex: "Conta de Água - Julho". Se o usuário não der, omita.',
      },
      data_vencimento: {
        type: 'string',
        description:
          'Vencimento no formato AAAA-MM-DD. Se o usuário não disser, omita: assume hoje.',
      },
      ja_paga: { type: 'boolean', description: 'true se a conta já foi paga' },
      linha_digitavel: {
        type: 'string',
        description: 'Linha digitável ou código de barras se visível no documento (apenas dígitos)',
      },
      codigo_pix: {
        type: 'string',
        description: 'Código Pix Copia e Cola / BR Code se visível no documento',
      },
    },
    required: ['categoria', 'valor'],
  },
  papeis: TODOS,
  async propor(args, ctx) {
    const bruta = String(args.categoria ?? '').trim();
    const chave = chaveCategoria(bruta);

    if (CATEGORIAS_BLOQUEADAS.includes(chave)) {
      return {
        erro:
          'A taxa de condomínio é lançada pelo síndico, o morador não pode criar. ' +
          'Se ele quer registrar outra despesa, use uma das categorias pessoais.',
      };
    }

    const categoria = CATEGORIAS_CONTA_MORADOR.find((c) => chaveCategoria(c) === chave);
    if (!categoria) {
      return {
        erro: `Categoria inválida. Use uma de: ${CATEGORIAS_CONTA_MORADOR.join(', ')}.`,
      };
    }

    const valor = Number(args.valor);
    if (!Number.isFinite(valor) || valor <= 0) {
      return { erro: 'Pergunte o valor da conta.' };
    }
    // Mesmo teto do insertMoradorConta — recusar aqui dá mensagem melhor do
    // que deixar estourar só na confirmação.
    if (valor > 9999999) {
      return { erro: 'Valor acima do limite permitido.' };
    }

    // Sem vencimento informado vale hoje: mantém a conta no mês corrente, que
    // é onde a tela do financeiro a mostra.
    let venc: { br: string };
    if (args.data_vencimento !== undefined) {
      const d = lerData(args.data_vencimento);
      if (!d) return { erro: 'Data de vencimento inválida. Use AAAA-MM-DD.' };
      venc = d;
    } else {
      const hoje = new Date();
      venc = {
        br: `${String(hoje.getDate()).padStart(2, '0')}/${String(hoje.getMonth() + 1).padStart(2, '0')}/${hoje.getFullYear()}`,
      };
    }

    const jaPaga = args.ja_paga === true;
    const nome = String(args.nome ?? '').trim() || `Conta de ${categoria}`;
    const valorBR = valor.toFixed(2).replace('.', ',');
    const linhaDigitavel = args.linha_digitavel ? String(args.linha_digitavel).trim() : undefined;
    const codigoPix = args.codigo_pix ? String(args.codigo_pix).trim() : undefined;

    const itens: ItemResumo[] = [
      { rotulo: 'Conta', valor: nome },
      { rotulo: 'Categoria', valor: categoria },
      { rotulo: 'Valor', valor: `R$ ${valorBR}` },
      { rotulo: 'Vencimento', valor: venc.br },
      { rotulo: 'Situação', valor: jaPaga ? 'Já paga' : 'Em aberto' },
      ...(linhaDigitavel ? [{ rotulo: 'Linha Digitável', valor: linhaDigitavel }] : []),
      ...(codigoPix ? [{ rotulo: 'PIX Copia e Cola', valor: 'Disponível' }] : []),
    ];

    return {
      proposta: {
        tipo: 'conta_morador' as TipoAcao,
        idUser: ctx.idUser,
        idCondominio: ctx.idCondominio,
        titulo: 'Confirmar lançamento',
        itens,
        payload: {
          nome,
          categoria,
          valor,
          data_vencimento: venc.br, // insertMoradorConta espera DD/MM/AAAA
          pago: jaPaga ? 1 : 0,
          ...(linhaDigitavel ? { linha_digitavel: linhaDigitavel } : {}),
          ...(codigoPix ? { pix_copia_cola: codigoPix } : {}),
        },
      },
    };
  },
});

// -----------------------------------------------------------------------
FERRAMENTAS_ACAO.push({
  nome: 'propor_mudanca',
  descricao:
    'Prepara o agendamento de uma mudança (entrada ou saída de móveis) para o apartamento do usuário, para ele confirmar. NÃO agenda sozinha. O agendamento fica PENDENTE até o síndico aprovar — deixe isso claro na resposta. Se não souber a data, pergunte antes; se ele disser "amanhã", converta para a data real.',
  parametros: {
    type: 'object',
    properties: {
      data: { type: 'string', description: 'Data da mudança, formato AAAA-MM-DD' },
      hora: {
        type: 'string',
        description:
          'Hora prevista de início, formato HH:MM. Se o usuário não disser, omita.',
      },
    },
    required: ['data'],
  },
  papeis: TODOS,
  async propor(args, ctx) {
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

    // Hora é opcional no formulário da tela, então também é aqui.
    let hora: number | null = null;
    if (args.hora !== undefined) {
      hora = lerHora(args.hora);
      if (hora === null) return { erro: 'Horário inválido. Use HH:MM.' };
    }

    const itens: ItemResumo[] = [
      { rotulo: 'Data', valor: data.br },
      { rotulo: 'Horário', valor: hora === null ? 'A combinar' : hhmm(hora) },
      // A aprovação do síndico é parte do fluxo, não detalhe: quem confirma
      // precisa saber que ainda não está garantido.
      { rotulo: 'Situação', valor: 'Aguarda aprovação do síndico' },
    ];

    return {
      proposta: {
        tipo: 'mudanca' as TipoAcao,
        idUser: ctx.idUser,
        idCondominio: ctx.idCondominio,
        titulo: 'Confirmar agendamento de mudança',
        itens,
        payload: {
          // O service espera AAAA-MM-DD e HH:MM.
          data: args.data,
          hora_inicio: hora === null ? null : hhmm(hora),
          id_apartamento: ctx.aptos[0],
        },
      },
    };
  },
});

FERRAMENTAS_ACAO.push({
  nome: 'propor_comunicado',
  descricao:
    'Prepara a publicação de um comunicado oficial do condomínio para o síndico ou funcionário confirmar. NÃO publica sozinho: devolve uma proposta que aparece como card com o título e texto para confirmação. Use quando o usuário pedir para criar, redigir ou publicar um aviso/comunicado/comunicação para o condomínio.',
  parametros: {
    type: 'OBJECT',
    properties: {
      titulo: {
        type: 'STRING',
        description: 'Título claro e objetivo do comunicado (ex: "Manutenção da Academia", "Dedetização do Bloco A")',
      },
      descricao: {
        type: 'STRING',
        description: 'Texto completo do comunicado a ser publicado para todos os moradores.',
      },
    },
    required: ['titulo', 'descricao'],
  },
  papeis: ['Sindico', 'Funcionario'],
  async propor(args, ctx) {
    const titulo = String(args.titulo ?? '').trim();
    const descricao = String(args.descricao ?? '').trim();
    if (!titulo) return { erro: 'Informe o título do comunicado.' };
    if (descricao.length < 5) {
      return { erro: 'O texto do comunicado é muito curto. Redija uma mensagem mais detalhada.' };
    }

    return {
      proposta: {
        tipo: 'comunicado' as TipoAcao,
        idUser: ctx.idUser,
        idCondominio: ctx.idCondominio,
        titulo: 'Confirmar publicação de comunicado',
        itens: [
          { rotulo: 'Título', valor: titulo },
          { rotulo: 'Mensagem', valor: descricao },
          { rotulo: 'Destinatários', valor: 'Todos os moradores' },
        ],
        payload: {
          titulo,
          descricao,
        },
      },
    };
  },
});

FERRAMENTAS_ACAO.push({
  nome: 'propor_manutencao_programada',
  descricao:
    'Prepara o agendamento de uma manutenção programada do condomínio (ex: limpeza da caixa d\'água, manutenção de elevadores, dedetização, corte de grama, reforma) para o síndico ou funcionário confirmar. NÃO cadastra sozinha: devolve uma proposta que aparece como card com os detalhes para confirmação. Converta datas relativas para AAAA-MM-DD e horários para HH:MM.',
  parametros: {
    type: 'OBJECT',
    properties: {
      titulo: {
        type: 'STRING',
        description: 'Título da manutenção (ex: "Manutenção Preventiva do Elevador Social", "Limpeza da Caixa d\'Água")',
      },
      descricao: {
        type: 'STRING',
        description: 'Descrição ou detalhes da manutenção programada',
      },
      data_inicio: {
        type: 'STRING',
        description: 'Data de início no formato AAAA-MM-DD',
      },
      data_termino: {
        type: 'STRING',
        description: 'Data de término no formato AAAA-MM-DD (opcional, pode ser igual à data de início)',
      },
      hora_inicio: {
        type: 'STRING',
        description: 'Horário de início no formato HH:MM (ex: "08:00")',
      },
      hora_termino: {
        type: 'STRING',
        description: 'Horário de término no formato HH:MM (ex: "12:00")',
      },
      alertar_moradores: {
        type: 'BOOLEAN',
        description: 'Se verdadeiro, notifica os moradores sobre a manutenção programada',
      },
    },
    required: ['titulo', 'data_inicio'],
  },
  papeis: ['Sindico', 'Funcionario'],
  async propor(args, ctx) {
    const titulo = String(args.titulo ?? '').trim();
    if (!titulo) return { erro: 'Informe o título da manutenção programada.' };

    const dataIni = lerData(args.data_inicio);
    if (!dataIni) return { erro: 'Data de início inválida. Use o formato AAAA-MM-DD.' };

    const dataFim = args.data_termino ? lerData(args.data_termino) : dataIni;
    const horaIni = args.hora_inicio ? lerHora(args.hora_inicio) : null;
    const horaFim = args.hora_termino ? lerHora(args.hora_termino) : null;

    const itens: ItemResumo[] = [
      { rotulo: 'Manutenção', valor: titulo },
      { rotulo: 'Data', valor: dataIni.br + (dataFim && dataFim.br !== dataIni.br ? ` até ${dataFim.br}` : '') },
    ];

    if (horaIni !== null) {
      itens.push({
        rotulo: 'Horário',
        valor: hhmm(horaIni) + (horaFim !== null ? ` às ${hhmm(horaFim)}` : ''),
      });
    }

    const descricao = String(args.descricao ?? '').trim();
    if (descricao) {
      itens.push({ rotulo: 'Detalhes', valor: descricao });
    }

    if (args.alertar_moradores) {
      itens.push({ rotulo: 'Aviso', valor: 'Notificar moradores' });
    }

    return {
      proposta: {
        tipo: 'manutencao_programada' as TipoAcao,
        idUser: ctx.idUser,
        idCondominio: ctx.idCondominio,
        titulo: 'Confirmar agendamento de manutenção',
        itens,
        payload: {
          titulo,
          descricao: descricao || null,
          data_inicio: dataIni.br, // O service espera DD/MM/AAAA ou ISO
          data_termino: dataFim ? dataFim.br : dataIni.br,
          hora_inicio: horaIni !== null ? hhmm(horaIni) : null,
          hora_termino: horaFim !== null ? hhmm(horaFim) : null,
          alertar_moradores: !!args.alertar_moradores,
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
