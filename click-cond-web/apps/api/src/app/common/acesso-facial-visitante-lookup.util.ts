/**
 * Resolve nome/foto/documento/apartamento de visitantes/prestadores a
 * partir de `Acessos_Facial.id_pessoa`, usado para enriquecer listagens de
 * eventos (dashboard, relatórios).
 *
 * `Acessos_Facial.id_pessoa` NÃO tem um único espaço de id consistente no
 * caminho migrado: alguns tipos de evento gravam o id de `Visita`, outros o
 * de `Pessoa` (ver facial.service.ts, não alterado nesta rodada — é uma
 * limitação conhecida; a correção definitiva exige mudança de schema e está
 * rastreada separadamente, não sendo improvisada aqui). Por isso essa
 * resolução consulta as duas tabelas para o mesmo conjunto de ids e faz o
 * merge por quem realmente encontrou a linha — cada id, na prática, só deve
 * bater numa das duas (produção mantém `pessoas` e `visitas` em faixas de
 * autoincrement disjuntas hoje como rede de segurança operacional, mas isso
 * NÃO é uma garantia de schema — só o motivo de essa degradação ser segura
 * na produção atual. Qualquer banco novo/dev/staging, criado sem essa
 * mesma janela de wipe, não tem essa separação, por isso o merge é
 * necessário e não opcional). Se um id não bater em nenhuma das duas, o
 * evento aparece sem nome/foto — degradação aceitável para um recurso de
 * exibição.
 *
 * Extraído de `RelatoriosService` (onde foi introduzido primeiro) pra ser
 * reaproveitado por qualquer leitura que precise da mesma resolução —
 * hoje `RelatoriosService.getEventos` e `DashboardService.summary`.
 */
export async function resolverInfoVisitantesPorIdAcessoFacial(
  prisma: any,
  ids: number[],
): Promise<
  Map<
    number,
    {
      id: number;
      foto_pessoa: string | null;
      doc_identificacao: string | null;
      tipo_pessoa: string | null;
      apartamento: { bloco: string | null; apto: string | null } | null;
    }
  >
> {
  const map = new Map<
    number,
    {
      id: number;
      foto_pessoa: string | null;
      doc_identificacao: string | null;
      tipo_pessoa: string | null;
      apartamento: { bloco: string | null; apto: string | null } | null;
    }
  >();
  if (ids.length === 0) return map;

  const [pessoasFound, visitasFound] = await Promise.all([
    prisma.pessoas.findMany({
      where: { id: { in: ids } },
      select: { id: true, foto_pessoa: true, doc_identificacao: true, tipo_pessoa: true },
    }),
    prisma.visitas.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        apartamento: { select: { bloco: true, apto: true } },
        pessoa: { select: { foto_pessoa: true, doc_identificacao: true, tipo_pessoa: true } },
      },
    }),
  ]);

  for (const p of pessoasFound) {
    map.set(p.id, {
      id: p.id,
      foto_pessoa: p.foto_pessoa,
      doc_identificacao: p.doc_identificacao,
      tipo_pessoa: p.tipo_pessoa,
      apartamento: null,
    });
  }
  // Visita "vence" se o id bater nas duas (não deveria acontecer em
  // produção hoje, ver comentário acima) — ela carrega apartamento, mais
  // informação útil pra exibição.
  for (const v of visitasFound) {
    map.set(v.id, {
      id: v.id,
      foto_pessoa: v.pessoa?.foto_pessoa ?? null,
      doc_identificacao: v.pessoa?.doc_identificacao ?? null,
      tipo_pessoa: v.pessoa?.tipo_pessoa ?? null,
      apartamento: v.apartamento,
    });
  }
  return map;
}
