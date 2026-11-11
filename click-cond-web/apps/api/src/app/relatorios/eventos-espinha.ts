import { Prisma } from '../prisma/generated';

/**
 * "Espinha" do Log de Eventos: a página da linha do tempo resolvida no banco,
 * devolvendo só (fonte, id, data). O serviço hidrata depois apenas esses ids.
 *
 * Por que SQL cru: a linha do tempo junta 6 fontes em tabelas diferentes e a
 * ordenação/paginação precisa ser global. O Prisma não faz UNION; buscar N
 * linhas de cada fonte e ordenar em memória custava o histórico inteiro a
 * cada troca de página e cortava o que passasse do teto.
 *
 * Tudo que vem do usuário (datas, busca, paginação) entra como PARÂMETRO do
 * `Prisma.sql` — nunca concatenado no texto.
 */

export type FonteEvento =
  | 'visita_entrada'
  | 'visita_saida'
  | 'encomenda'
  | 'ocorrencia'
  | 'dispositivo'
  | 'facial';

export interface LinhaEspinha {
  fonte: FonteEvento;
  id: number;
}

export interface FiltroEspinha {
  idCondominio: number;
  /** Início inclusivo; null = sem limite inferior. */
  inicio: Date | null;
  /** Fim EXCLUSIVO (00:00 do dia seguinte ao último dia); null = sem limite. */
  fimExclusivo: Date | null;
  /** Termo de busca cru (sem curingas); vazio/undefined = sem busca. */
  search?: string;
  /** true = tabelas `visitas`+`pessoas`; false = tabela legada `Visitantes`. */
  migrado: boolean;
  limit: number;
  offset: number;
}

export interface PeriodoEventos {
  /** `AAAA-MM-DD` (dia de calendário em -03:00) ou null se aberto. */
  dataInicio: string | null;
  dataFim: string | null;
  /** true quando o usuário não escolheu datas e valeu o padrão. */
  padrao: boolean;
  inicio: Date | null;
  fimExclusivo: Date | null;
}

export const DIAS_PERIODO_PADRAO_EVENTOS = 30;

/** Janela (para cada lado) em que um evento facial "substitui" o manual. */
export const JANELA_DEDUP_FACIAL_SEGUNDOS = 15;

const FUSO = '-03:00';
const DIA_MS = 24 * 60 * 60 * 1000;

const inicioDoDia = (dia: string) => new Date(`${dia}T00:00:00.000${FUSO}`);

/**
 * Período efetivamente aplicado. Sem nenhuma data: últimos 30 dias (de hoje-30
 * até hoje, dias de calendário em -03:00). Com qualquer data informada vale o
 * informado — o lado omitido fica aberto.
 */
export function resolverPeriodoEventos(
  dataInicio: string | undefined,
  dataFim: string | undefined,
  agora: Date = new Date(),
): PeriodoEventos {
  let ini = dataInicio || null;
  let fim = dataFim || null;
  const padrao = !ini && !fim;
  if (padrao) {
    // "Hoje" no fuso -03:00, não no fuso do servidor (UTC em produção).
    const hojeMs = agora.getTime() - 3 * 60 * 60 * 1000;
    fim = new Date(hojeMs).toISOString().slice(0, 10);
    ini = new Date(hojeMs - DIAS_PERIODO_PADRAO_EVENTOS * DIA_MS).toISOString().slice(0, 10);
  }
  return {
    dataInicio: ini,
    dataFim: fim,
    padrao,
    inicio: ini ? inicioDoDia(ini) : null,
    // As colunas são DATETIME(0): "< 00:00 do dia seguinte" equivale ao antigo
    // "<= 23:59:59.999" sem depender de como o banco compara frações.
    fimExclusivo: fim ? new Date(inicioDoDia(fim).getTime() + DIA_MS) : null,
  };
}

/** Escapa os curingas do LIKE; o caractere de escape é `!` (ver ESCAPE '!'). */
export function padraoLike(search: string | undefined): string | null {
  const s = (search ?? '').trim();
  if (!s) return null;
  return `%${s.replace(/[!%_]/g, (c) => `!${c}`)}%`;
}

const E = Prisma.empty;
// Constantes do código (nunca dado do usuário) entram como literal.
const JANELA = Prisma.raw(String(JANELA_DEDUP_FACIAL_SEGUNDOS));

function faixa(coluna: Prisma.Sql, f: FiltroEspinha): Prisma.Sql {
  return Prisma.sql`${f.inicio ? Prisma.sql` AND ${coluna} >= ${f.inicio}` : E}${
    f.fimExclusivo ? Prisma.sql` AND ${coluna} < ${f.fimExclusivo}` : E
  }`;
}

/**
 * Deduplicação manual x facial. A entrada/saída manual some quando existe um
 * evento facial da MESMA pessoa, do mesmo tipo (entrada/saida), a até 15 s de
 * distância — o facial é o registro que fica na lista.
 *
 * O facial só "substitui" se ele próprio aparece no resultado: por isso o
 * subselect repete o período e a busca aplicados à fonte facial. Sem isso um
 * evento poderia sumir da lista por completo (manual descartado e facial fora
 * do filtro).
 *
 * `idsPessoa`: no caminho migrado `Acessos_Facial.id_pessoa` grava ora o id
 * da Visita, ora o da Pessoa (ver acesso-facial-visitante-lookup.util.ts) —
 * os dois espaços são conferidos.
 */
function semFacialEquivalente(
  f: FiltroEspinha,
  like: string | null,
  evento: 'entrada' | 'saida',
  coluna: Prisma.Sql,
  idsPessoa: Prisma.Sql,
): Prisma.Sql {
  return Prisma.sql`
      AND NOT EXISTS (
        SELECT 1
        FROM Acessos_Facial af
        WHERE af.id_condominio = ${f.idCondominio}
          AND af.id_pessoa IN (${idsPessoa})
          AND af.tipo_pessoa IN ('visitante', 'prestador')
          AND af.evento = ${evento}
          AND af.timestamp >= (${coluna} - INTERVAL ${JANELA} SECOND)
          AND af.timestamp <= (${coluna} + INTERVAL ${JANELA} SECOND)${faixa(Prisma.sql`af.timestamp`, f)}${
            like ? Prisma.sql` AND af.nome_pessoa LIKE ${like} ESCAPE '!'` : E
          }
      )`;
}

interface Ramo {
  fonte: FonteEvento;
  /** Desempate entre fontes quando a data é idêntica. */
  ord: number;
  id: Prisma.Sql;
  quando: Prisma.Sql;
  /** `FROM ... WHERE ...` — usado igual na espinha e na contagem. */
  corpo: Prisma.Sql;
}

function ramos(f: FiltroEspinha): Ramo[] {
  const like = padraoLike(f.search);

  const visita = (evento: 'entrada' | 'saida'): Ramo => {
    const coluna = evento === 'entrada' ? Prisma.sql`v.data_entrada` : Prisma.sql`v.data_saida`;
    const corpo = f.migrado
      ? Prisma.sql`
      FROM visitas v${like ? Prisma.sql`
      JOIN pessoas p ON p.id = v.id_pessoa` : E}
      WHERE v.id_condominio = ${f.idCondominio}
        AND ${coluna} IS NOT NULL${faixa(coluna, f)}${
          like
            ? Prisma.sql` AND (p.nome LIKE ${like} ESCAPE '!' OR p.doc_identificacao LIKE ${like} ESCAPE '!')`
            : E
        }${semFacialEquivalente(f, like, evento, coluna, Prisma.sql`v.id, v.id_pessoa`)}`
      : Prisma.sql`
      FROM Visitantes v
      WHERE v.id_condominio = ${f.idCondominio}
        AND ${coluna} IS NOT NULL${faixa(coluna, f)}${
          like
            ? Prisma.sql` AND (v.nome LIKE ${like} ESCAPE '!' OR v.doc_identificacao LIKE ${like} ESCAPE '!')`
            : E
        }${semFacialEquivalente(f, like, evento, coluna, Prisma.sql`v.id`)}`;
    return {
      fonte: evento === 'entrada' ? 'visita_entrada' : 'visita_saida',
      ord: evento === 'entrada' ? 1 : 2,
      id: Prisma.sql`v.id`,
      quando: coluna,
      corpo,
    };
  };

  return [
    visita('entrada'),
    visita('saida'),
    {
      fonte: 'encomenda',
      ord: 3,
      id: Prisma.sql`e.id`,
      quando: Prisma.sql`e.recebido_em`,
      corpo: Prisma.sql`
      FROM Encomendas e
      WHERE e.id_condominio = ${f.idCondominio}${faixa(Prisma.sql`e.recebido_em`, f)}${
        like
          ? Prisma.sql` AND (e.descricao LIKE ${like} ESCAPE '!' OR e.destinatario_apto LIKE ${like} ESCAPE '!' OR e.recebido_de LIKE ${like} ESCAPE '!')`
          : E
      }`,
    },
    {
      fonte: 'ocorrencia',
      ord: 4,
      id: Prisma.sql`o.id`,
      quando: Prisma.sql`o.created_at`,
      corpo: Prisma.sql`
      FROM Ocorrencias o
      WHERE o.id_condominio = ${f.idCondominio}${faixa(Prisma.sql`o.created_at`, f)}${
        like ? Prisma.sql` AND o.descricao LIKE ${like} ESCAPE '!'` : E
      }`,
    },
    {
      fonte: 'dispositivo',
      ord: 5,
      id: Prisma.sql`a.id`,
      quando: Prisma.sql`a.created_at`,
      corpo: Prisma.sql`
      FROM audit_logs a
      WHERE a.id_condominio = ${f.idCondominio}
        AND a.modulo = 'dispositivos'${faixa(Prisma.sql`a.created_at`, f)}${
          like ? Prisma.sql` AND a.descricao LIKE ${like} ESCAPE '!'` : E
        }`,
    },
    {
      fonte: 'facial',
      ord: 6,
      id: Prisma.sql`af.id`,
      quando: Prisma.sql`af.timestamp`,
      corpo: Prisma.sql`
      FROM Acessos_Facial af
      WHERE af.id_condominio = ${f.idCondominio}${faixa(Prisma.sql`af.timestamp`, f)}${
        like ? Prisma.sql` AND af.nome_pessoa LIKE ${like} ESCAPE '!'` : E
      }`,
    },
  ];
}

/**
 * Página da linha do tempo. Cada fonte entrega no máximo `offset + limit`
 * linhas já ordenadas (o suficiente para compor qualquer página até essa
 * profundidade); a ordenação final e o corte são feitos sobre essa união.
 *
 * Ordem total e determinística: data desc, fonte (`ord`) asc, id desc. Como a
 * ordem dentro de cada fonte (data desc, id desc) é a restrição da ordem
 * global àquela fonte, o topo de cada fonte contém tudo que pode cair na
 * página pedida.
 */
export function montarSqlEspinha(f: FiltroEspinha): Prisma.Sql {
  const teto = f.offset + f.limit;
  const partes = ramos(f).map(
    (r, i) => Prisma.sql`
    SELECT * FROM (
      SELECT ${Prisma.raw(`'${r.fonte}'`)} AS fonte, ${Prisma.raw(String(r.ord))} AS ord, ${r.id} AS id, ${r.quando} AS quando${r.corpo}
      ORDER BY ${r.quando} DESC, ${r.id} DESC
      LIMIT ${teto}
    ) AS ${Prisma.raw(`r${i + 1}`)}`,
  );
  return Prisma.sql`
  SELECT u.fonte AS fonte, u.id AS id, u.quando AS quando
  FROM (${Prisma.join(partes, '\n    UNION ALL')}
  ) AS u
  ORDER BY u.quando DESC, u.ord ASC, u.id DESC
  LIMIT ${f.limit} OFFSET ${f.offset}`;
}

/** Uma linha por fonte com a contagem — mesmos predicados da espinha. */
export function montarSqlTotal(f: FiltroEspinha): Prisma.Sql {
  const partes = ramos(f).map(
    (r) => Prisma.sql`
  SELECT ${Prisma.raw(`'${r.fonte}'`)} AS fonte, COUNT(*) AS n${r.corpo}`,
  );
  return Prisma.join(partes, '\n  UNION ALL');
}
