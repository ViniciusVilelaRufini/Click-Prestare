import type { PrismaService } from '../prisma/prisma.service';
import type { DeclaracaoFerramenta } from './gemini.client';

/**
 * Ferramentas de LEITURA do Assistente IA.
 *
 * ================== REGRA DE OURO ==================
 * O modelo é entrada NÃO CONFIÁVEL. Um morador pode escrever "liste todos os
 * moradores do prédio" e o modelo vai tentar chamar a ferramenta. Por isso a
 * autorização acontece em DUAS camadas, nenhuma delas no prompt:
 *
 *   1. CATÁLOGO — `ferramentasPara(papel)` só declara ao modelo o que aquele
 *      papel pode usar. O que não é declarado, o modelo não sabe que existe.
 *   2. ESCOPO — cada `executar` recebe o ContextoFerramenta montado a partir
 *      do JWT e filtra por id_condominio / id_user / apartamentos do usuário.
 *      NUNCA por um id que tenha vindo nos `args` do modelo.
 *
 * Consequência prática: os `args` só carregam intenção (nome a buscar, data a
 * consultar). Identidade e tenant vêm sempre do contexto.
 * ===================================================
 *
 * Tudo aqui é somente leitura. Ações de escrita (reservar, abrir ocorrência)
 * virão numa etapa separada, com confirmação no app antes de executar.
 */

export type PapelChat = 'Sindico' | 'Funcionario' | 'Morador';

export interface ContextoFerramenta {
  idCondominio: number;
  idUser: number;
  papel: PapelChat;
  staff: boolean;
  /** Apartamentos do usuário NESTE condomínio. Vazio = morador sem vínculo. */
  aptos: number[];
  prisma: PrismaService;
}

export interface FerramentaLeitura {
  nome: string;
  descricao: string;
  /**
   * OMITIR quando a ferramenta não recebe argumento.
   *
   * O Gemini valida que todo schema OBJECT tenha `properties` não-vazio e
   * responde 400 com "function_declarations[N].parameters.properties: should
   * be non-empty for OBJECT type". E a recusa derruba a REQUISIÇÃO INTEIRA,
   * não só aquela ferramenta — foi o que quebrou o assistente inteiro.
   */
  parametros?: DeclaracaoFerramenta['parameters'];
  /** Papéis que enxergam esta ferramenta no catálogo. */
  papeis: PapelChat[];
  executar(args: Record<string, any>, ctx: ContextoFerramenta): Promise<unknown>;
}

const TODOS: PapelChat[] = ['Sindico', 'Funcionario', 'Morador'];
const STAFF: PapelChat[] = ['Sindico', 'Funcionario'];

/** Corta listas grandes para não estourar o contexto do modelo. */
const LIMITE_LISTA = 25;

function dataBR(d: Date | null | undefined): string | null {
  return d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : null;
}
function horaHM(d: Date | null | undefined): string | null {
  return d ? new Date(d).toISOString().substring(11, 16) : null;
}
function dataHoraBR(d: Date | null | undefined): string | null {
  return d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : null;
}

/**
 * Normaliza o `tipo` do morador.
 *
 * A coluna tem valor legado sujo ('morador', 'Proprietário', 'dependente',
 * null, ''), e o groupBy cru vazava isso para o usuário: a resposta saiu como
 * "Moradores: 24, Proprietários: 10, Dependentes: 1", como se "Morador" fosse
 * um tipo de vínculo. Mesmo mapeamento do normalizeTipo do MobileAuthService.
 */
function normalizarTipo(raw: string | null | undefined): string {
  const t = String(raw ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
  if (t === 'inquilino') return 'inquilino';
  if (t === 'membro' || t === 'dependente') return 'membro';
  return 'proprietario';
}

/** Cadastro do morador logado neste condomínio (para achar bloco/apto). */
async function meuCadastro(ctx: ContextoFerramenta) {
  return ctx.prisma.moradores.findFirst({
    where: { id_user: ctx.idUser, id_condominio: ctx.idCondominio },
    select: { nome: true, bloco: true, apartamento: true, tipo: true },
  });
}

export const FERRAMENTAS_LEITURA: FerramentaLeitura[] = [
  // -----------------------------------------------------------------------
  // Agregados — número não identifica ninguém, então liberado para todos.
  // É o que faltava: antes o morador não conseguia nem saber quantos
  // moradores o condomínio tem, porque a lista inteira era staff-only.
  // -----------------------------------------------------------------------
  {
    nome: 'contar_moradores',
    descricao:
      'Retorna quantos moradores estão cadastrados no condomínio, com a quebra por tipo (proprietário, inquilino, membro). Use para perguntas de quantidade, nunca para listar nomes.',
    papeis: TODOS,
    async executar(_args, ctx) {
      const [total, porTipo] = await Promise.all([
        ctx.prisma.moradores.count({ where: { id_condominio: ctx.idCondominio } }),
        ctx.prisma.moradores.groupBy({
          by: ['tipo'],
          where: { id_condominio: ctx.idCondominio },
          _count: { id: true },
        }),
      ]);
      // Agrupa os valores legados nos três tipos reais antes de responder.
      const consolidado = new Map<string, number>();
      for (const t of porTipo) {
        const chave = normalizarTipo(t.tipo);
        consolidado.set(chave, (consolidado.get(chave) ?? 0) + t._count.id);
      }
      return {
        total,
        por_tipo: [...consolidado].map(([tipo, qtd]) => ({ tipo, total: qtd })),
      };
    },
  },

  {
    nome: 'resumo_do_condominio',
    descricao:
      'Números gerais do condomínio: total de apartamentos, blocos, moradores, áreas sociais e encomendas aguardando retirada. Use para perguntas panorâmicas.',
    papeis: TODOS,
    async executar(_args, ctx) {
      const where = { id_condominio: ctx.idCondominio };
      const [aptos, moradores, areas, encomendas, blocos] = await Promise.all([
        ctx.prisma.apartamentos.count({ where }),
        ctx.prisma.moradores.count({ where }),
        ctx.prisma.areas_Sociais.count({ where }),
        ctx.prisma.encomendas.count({ where: { ...where, status: 'Aguardando' } }),
        ctx.prisma.apartamentos.groupBy({ by: ['bloco'], where, _count: { id: true } }),
      ]);
      return {
        apartamentos: aptos,
        blocos: blocos.filter((b) => b.bloco).length,
        moradores,
        areas_sociais: areas,
        encomendas_aguardando_retirada: encomendas,
      };
    },
  },

  // -----------------------------------------------------------------------
  // Dados de pessoa — só staff.
  // -----------------------------------------------------------------------
  {
    nome: 'buscar_morador',
    descricao:
      'Busca moradores do condomínio por parte do nome ou por apartamento. Retorna nome, apartamento e tipo de vínculo. Disponível apenas para síndico e funcionário.',
    parametros: {
      type: 'object',
      properties: {
        nome: { type: 'string', description: 'Parte do nome a procurar' },
        apartamento: { type: 'string', description: 'Número do apartamento, ex: 101' },
      },
    },
    papeis: STAFF,
    async executar(args, ctx) {
      const nome = typeof args.nome === 'string' ? args.nome.trim() : '';
      const apto = typeof args.apartamento === 'string' ? args.apartamento.trim() : '';
      if (!nome && !apto) {
        return { erro: 'Informe ao menos parte do nome ou o apartamento.' };
      }
      const lista = await ctx.prisma.moradores.findMany({
        where: {
          id_condominio: ctx.idCondominio,
          ...(nome && { nome: { contains: nome } }),
          ...(apto && { apartamento: apto }),
        },
        select: { nome: true, bloco: true, apartamento: true, tipo: true, telefone: true },
        take: LIMITE_LISTA,
        orderBy: { nome: 'asc' },
      });
      return { encontrados: lista.length, moradores: lista };
    },
  },

  // -----------------------------------------------------------------------
  // Financeiro do próprio morador.
  // -----------------------------------------------------------------------
  {
    nome: 'meus_boletos',
    descricao:
      'Cobranças do usuário logado neste condomínio: valor, vencimento, se está paga e se há link de boleto/pix. Use para perguntas sobre boleto, taxa, segunda via ou pendência financeira.',
    parametros: {
      type: 'object',
      properties: {
        apenas_em_aberto: {
          type: 'boolean',
          description: 'true para trazer somente as não pagas. Padrão: true.',
        },
      },
    },
    papeis: TODOS,
    async executar(args, ctx) {
      const apenasAberto = args.apenas_em_aberto !== false;
      const lista = await ctx.prisma.financeiro.findMany({
        where: {
          id_condominio: ctx.idCondominio,
          id_usuario: ctx.idUser, // sempre do JWT, nunca dos args
          ...(apenasAberto && { pago: 0 }),
        },
        select: {
          id: true,
          nome: true,
          valor: true,
          data_vencimento: true,
          pago: true,
          status: true,
          url_boleto: true,
          pix_copia_cola: true,
          linha_digitavel: true,
        },
        orderBy: { data_vencimento: 'asc' },
        take: LIMITE_LISTA,
      });
      const hoje = new Date();
      return {
        total: lista.length,
        cobrancas: lista.map((f) => ({
          id: f.id,
          descricao: f.nome,
          valor: f.valor ? Number(f.valor) : null,
          vencimento: dataBR(f.data_vencimento),
          pago: f.pago === 1,
          vencida:
            f.pago !== 1 && !!f.data_vencimento && new Date(f.data_vencimento) < hoje,
          status: f.status,
          tem_boleto: !!f.url_boleto,
          tem_pix: !!f.pix_copia_cola,
        })),
      };
    },
  },

  // -----------------------------------------------------------------------
  // Encomendas.
  // -----------------------------------------------------------------------
  {
    nome: 'encomendas_pendentes',
    descricao:
      'Encomendas aguardando retirada. Para morador traz apenas as do apartamento dele; para síndico e funcionário traz as do condomínio inteiro.',
    papeis: TODOS,
    async executar(_args, ctx) {
      const where: any = { id_condominio: ctx.idCondominio, status: 'Aguardando' };

      if (!ctx.staff) {
        const cad = await meuCadastro(ctx);
        if (!cad?.apartamento) {
          return { total: 0, encomendas: [], observacao: 'Usuário sem apartamento vinculado.' };
        }
        where.destinatario_apto = cad.apartamento;
        if (cad.bloco) where.destinatario_bloco = cad.bloco;
      }

      const lista = await ctx.prisma.encomendas.findMany({
        where,
        select: {
          descricao: true,
          destinatario_apto: true,
          destinatario_bloco: true,
          recebido_de: true,
          recebido_em: true,
        },
        orderBy: { recebido_em: 'desc' },
        take: LIMITE_LISTA,
      });
      return {
        total: lista.length,
        encomendas: lista.map((e) => ({
          descricao: e.descricao,
          apartamento: `${e.destinatario_bloco ? e.destinatario_bloco + '-' : ''}${e.destinatario_apto}`,
          remetente: e.recebido_de,
          recebida_em: dataHoraBR(e.recebido_em),
        })),
      };
    },
  },

  // -----------------------------------------------------------------------
  // Áreas sociais.
  // -----------------------------------------------------------------------
  {
    nome: 'listar_areas_sociais',
    descricao:
      'Lista as áreas sociais do condomínio (churrasqueira, salão de festas, etc) com capacidade, horários e se exigem reserva, autorização ou pagamento.',
    papeis: TODOS,
    async executar(_args, ctx) {
      const areas = await ctx.prisma.areas_Sociais.findMany({
        where: { id_condominio: ctx.idCondominio },
        select: {
          id: true,
          nome: true,
          capacidade: true,
          horarios: true,
          precisa_agendar: true,
          precisa_autorizacao: true,
          precisa_pagamento: true,
        },
        orderBy: { nome: 'asc' },
      });
      return {
        total: areas.length,
        areas: areas.map((a) => ({
          id: a.id,
          nome: a.nome,
          capacidade: a.capacidade,
          horarios: a.horarios,
          precisa_reserva: a.precisa_agendar === 1,
          precisa_autorizacao: a.precisa_autorizacao === 1,
          precisa_pagamento: a.precisa_pagamento === 1,
        })),
      };
    },
  },

  {
    nome: 'reservas_da_area_na_data',
    descricao:
      'Mostra as reservas já existentes de uma área social numa data, para saber se está livre. A data deve estar no formato AAAA-MM-DD.',
    parametros: {
      type: 'object',
      properties: {
        id_area: { type: 'number', description: 'id da área social (use listar_areas_sociais antes)' },
        data: { type: 'string', description: 'Data no formato AAAA-MM-DD' },
      },
      required: ['id_area', 'data'],
    },
    papeis: TODOS,
    async executar(args, ctx) {
      const idArea = Number(args.id_area);
      const m = String(args.data ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!idArea || Number.isNaN(idArea) || !m) {
        return { erro: 'Informe id_area e data no formato AAAA-MM-DD.' };
      }

      // A área precisa ser DESTE condomínio — o modelo poderia mandar o id de
      // uma área de outro condomínio.
      const area = await ctx.prisma.areas_Sociais.findFirst({
        where: { id: idArea, id_condominio: ctx.idCondominio },
        select: { id: true, nome: true },
      });
      if (!area) return { erro: 'Área social não encontrada neste condomínio.' };

      const dia = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
      const reservas = await ctx.prisma.areas_Sociais_Agendamentos.findMany({
        where: { id_area_social: area.id, data: dia, status: { not: 'recusado' } },
        select: { hora_de: true, hora_ate: true, status: true },
        orderBy: { hora_de: 'asc' },
      });
      return {
        area: area.nome,
        data: `${m[3]}/${m[2]}/${m[1]}`,
        reservas: reservas.map((r) => ({
          de: horaHM(r.hora_de),
          ate: horaHM(r.hora_ate),
          status: r.status,
        })),
        livre: reservas.length === 0,
      };
    },
  },

  {
    nome: 'minhas_reservas',
    descricao:
      'Reservas de área social feitas pelo usuário logado, com data, horário e status (pendente, aprovado, recusado).',
    papeis: TODOS,
    async executar(_args, ctx) {
      const lista = await ctx.prisma.areas_Sociais_Agendamentos.findMany({
        where: {
          id_user: ctx.idUser, // sempre do JWT
          area: { id_condominio: ctx.idCondominio },
        },
        select: {
          data: true,
          hora_de: true,
          hora_ate: true,
          status: true,
          area: { select: { nome: true } },
        },
        orderBy: { data: 'desc' },
        take: LIMITE_LISTA,
      });
      return {
        total: lista.length,
        reservas: lista.map((r) => ({
          area: r.area?.nome,
          data: dataBR(r.data),
          de: horaHM(r.hora_de),
          ate: horaHM(r.hora_ate),
          status: r.status,
        })),
      };
    },
  },

  // -----------------------------------------------------------------------
  // Ocorrências.
  // -----------------------------------------------------------------------
  {
    nome: 'minhas_ocorrencias',
    descricao:
      'Ocorrências/chamados abertos pelo usuário logado, com status e resposta do síndico. Para síndico e funcionário traz as do condomínio inteiro.',
    papeis: TODOS,
    async executar(_args, ctx) {
      const lista = await ctx.prisma.ocorrencias.findMany({
        where: {
          id_condominio: ctx.idCondominio,
          ...(ctx.staff ? {} : { user: ctx.idUser }),
        },
        select: {
          id: true,
          descricao: true,
          status: true,
          resposta: true,
          created_at: true,
          categoria: { select: { nome: true } },
        },
        orderBy: { created_at: 'desc' },
        take: LIMITE_LISTA,
      });
      return {
        total: lista.length,
        escopo: ctx.staff ? 'condominio' : 'proprias',
        ocorrencias: lista.map((o) => ({
          id: o.id,
          categoria: o.categoria?.nome ?? null,
          descricao: (o.descricao ?? '').slice(0, 200),
          status: o.status,
          respondida: !!o.resposta,
          aberta_em: dataHoraBR(o.created_at),
        })),
      };
    },
  },

  // -----------------------------------------------------------------------
  // Visitantes do próprio apartamento.
  // -----------------------------------------------------------------------
  {
    nome: 'visitas_do_meu_apartamento',
    descricao:
      'Visitantes e prestadores vinculados ao apartamento do usuário logado, com data agendada, entrada e saída. Use para "quem veio me visitar", "minhas visitas agendadas".',
    papeis: TODOS,
    async executar(_args, ctx) {
      if (ctx.aptos.length === 0) {
        return { total: 0, visitas: [], observacao: 'Usuário sem apartamento vinculado neste condomínio.' };
      }
      const lista = await ctx.prisma.visitantes.findMany({
        where: {
          id_condominio: ctx.idCondominio,
          id_apartamento: { in: ctx.aptos }, // vínculo real, não args
        },
        select: {
          nome: true,
          is_prestador: true,
          data_hora_inicio: true,
          data_entrada: true,
          data_saida: true,
          auth_status: true,
        },
        orderBy: { created_at: 'desc' },
        take: LIMITE_LISTA,
      });
      return {
        total: lista.length,
        visitas: lista.map((v) => ({
          nome: v.nome,
          prestador: v.is_prestador === 1,
          agendada_para: dataHoraBR(v.data_hora_inicio),
          entrada: dataHoraBR(v.data_entrada),
          saida: dataHoraBR(v.data_saida),
          autorizacao: v.auth_status,
        })),
      };
    },
  },
];

/** Catálogo visível para um papel. Camada 1 da autorização. */
export function ferramentasPara(papel: PapelChat): FerramentaLeitura[] {
  return FERRAMENTAS_LEITURA.filter((f) => f.papeis.includes(papel));
}

/**
 * Converte para o formato functionDeclarations do Gemini.
 *
 * Só emite `parameters` quando há propriedade de verdade. Um OBJECT com
 * `properties` vazio faz o Gemini recusar a requisição inteira com 400, então
 * a checagem fica aqui — no único ponto por onde toda declaração passa —
 * em vez de depender de cada ferramenta lembrar de omitir.
 */
export function declaracoesPara(papel: PapelChat): DeclaracaoFerramenta[] {
  return ferramentasPara(papel).map((f) => {
    const temPropriedades =
      !!f.parametros && Object.keys(f.parametros.properties ?? {}).length > 0;
    return {
      name: f.nome,
      description: f.descricao,
      ...(temPropriedades && { parameters: f.parametros }),
    };
  });
}

/**
 * Resolve uma ferramenta pelo nome RESPEITANDO o papel.
 * Devolve undefined se o papel não pode usá-la — camada 2, caso o modelo
 * invente ou lembre de uma ferramenta que não foi declarada para ele.
 */
export function resolverFerramenta(
  nome: string,
  papel: PapelChat,
): FerramentaLeitura | undefined {
  return ferramentasPara(papel).find((f) => f.nome === nome);
}
