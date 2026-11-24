/**
 * Credenciais de morador (QR do app, origem `app`, e passes da carteira, `wallet_*`) nos eventos de vida da
 * conta: unidade tirada, unidade apagada, troca ou redefinição de senha, "perdeu o celular", adoção de conta.
 *
 * Duas camadas, de propósito:
 * - revogação no evento (estas funções), que também deixa o passe da carteira anulado no aparelho;
 * - conferência na leitura (`motivoCredencialMoradorInvalida`), no leitor e no serviço da Apple: vale para todo
 *   caminho que tira a unidade ou grava `senha_alterada_em`, inclusive os que não revogam.
 *
 * Só depende do Prisma: é usada pela validação (fora do ciclo Facial/Visitantes), pela carteira, pelos
 * cadastros e pela adoção de conta.
 */

type PrismaRevogacao = { credenciais_Acesso: { updateMany: (a: any) => Promise<any> } };
type PrismaLinhas = PrismaRevogacao & { moradores: { findMany: (a: any) => Promise<Array<{ id: number }>> } };

/** Revoga as credenciais de morador ativas (app e carteira) das linhas de Moradores dadas. Devolve quantas. */
export async function revogarCredenciaisDeMoradores(
  tx: PrismaRevogacao,
  idsMoradores: number[],
  agora: Date = new Date(),
): Promise<number> {
  const r = await tx.credenciais_Acesso.updateMany({
    where: { tipo_pessoa: 'morador', id_pessoa: { in: idsMoradores }, revogada_em: null },
    data: { revogada_em: agora },
  });
  return Number(r?.count ?? 0);
}

/**
 * Revoga as credenciais de morador de todas as linhas de Moradores da conta (só as do condomínio, quando ele é
 * dado). Devolve os ids das linhas.
 */
export async function revogarCredenciaisDaConta(
  tx: PrismaLinhas,
  idUser: number,
  agora: Date = new Date(),
  idCondominio?: number,
): Promise<number[]> {
  const linhas = await tx.moradores.findMany({
    where: idCondominio != null ? { id_user: idUser, id_condominio: idCondominio } : { id_user: idUser },
    select: { id: true },
  });
  const ids = linhas.map((l) => l.id);
  await revogarCredenciaisDeMoradores(tx, ids, agora);
  return ids;
}

type PrismaVinculo = { apartamentos_Users: { findFirst: (a: any) => Promise<unknown> } };

/** Vínculo atual da conta no condomínio: o mesmo critério do morador no `assertCondominio` (tenant-access). */
export async function contaTemUnidadeNoCondominio(
  prisma: PrismaVinculo,
  idUser: number,
  idCondominio: number,
): Promise<boolean> {
  const vinc = await prisma.apartamentos_Users.findFirst({
    where: { id_user: idUser, apartamento: { id_condominio: idCondominio, condominio: { ativo: 1 } } },
    select: { id_apto: true },
  });
  return !!vinc;
}

/**
 * Linhas de Moradores, no condomínio, das contas dadas que ficaram sem unidade nenhuma nele (a unidade foi
 * tirada ou apagada). São as linhas cujas credenciais caem; quem segue morando em outra unidade dali mantém o QR.
 */
export async function moradoresSemUnidadeNoCondominio(
  prisma: PrismaVinculo & { moradores: { findMany: (a: any) => Promise<Array<{ id: number }>> } },
  idsUsers: number[],
  idCondominio: number,
): Promise<number[]> {
  const sem: number[] = [];
  for (const idUser of [...new Set(idsUsers)]) {
    if (await contaTemUnidadeNoCondominio(prisma, idUser, idCondominio)) continue;
    const linhas = await prisma.moradores.findMany({
      where: { id_user: idUser, id_condominio: idCondominio },
      select: { id: true },
    });
    sem.push(...linhas.map((l) => l.id));
  }
  return sem;
}

type PrismaVigencia = PrismaVinculo & { users: { findUnique: (a: any) => Promise<any> } };

/**
 * Por que a credencial de morador não vale mais, ou null quando vale:
 * - `sem_unidade`: a conta não tem mais unidade no condomínio (ex-morador com o QR guardado);
 * - `senha_trocada`: a credencial é anterior à última troca ou redefinição de senha da conta.
 * Linha de Moradores sem conta (id_user nulo) não tem como provar vínculo: `sem_unidade`.
 */
export async function motivoCredencialMoradorInvalida(
  prisma: PrismaVigencia,
  cred: { criado_em?: Date | string | null },
  idUser: number | null | undefined,
  idCondominio: number,
): Promise<'sem_unidade' | 'senha_trocada' | null> {
  if (!idUser) return 'sem_unidade';
  if (!(await contaTemUnidadeNoCondominio(prisma, idUser, idCondominio))) return 'sem_unidade';
  if (await credencialAnteriorATrocaDeSenha(prisma, cred, idUser)) return 'senha_trocada';
  return null;
}

/** A credencial foi criada antes da última troca de senha da conta (`Users.senha_alterada_em`). */
export async function credencialAnteriorATrocaDeSenha(
  prisma: { users: { findUnique: (a: any) => Promise<any> } },
  cred: { criado_em?: Date | string | null },
  idUser: number,
): Promise<boolean> {
  const conta = await prisma.users.findUnique({ where: { id: idUser }, select: { senha_alterada_em: true } });
  const troca = conta?.senha_alterada_em ? new Date(conta.senha_alterada_em).getTime() : null;
  if (troca == null) return false;
  // Sem data de criação não há como provar que a credencial é posterior à troca.
  if (!cred.criado_em) return true;
  return new Date(cred.criado_em).getTime() < troca;
}

/**
 * Unidade tirada ou apagada: as contas que ficaram sem unidade nenhuma no condomínio perdem o QR do app e os
 * passes da carteira. Com a carteira (WalletService), os passes também são avisados no aparelho; sem ela, só
 * revoga. Roda depois da gravação do evento e nunca lança: a leitura já nega pela conferência de vínculo.
 */
export async function revogarCredenciaisSemUnidade(
  prisma: PrismaVinculo & PrismaLinhas,
  carteira: { revogarCredenciaisDosMoradores: (ids: number[]) => Promise<void> } | null | undefined,
  idsUsers: number[],
  idCondominio: number,
  log?: { warn: (m: string) => void },
): Promise<void> {
  try {
    const ids = await moradoresSemUnidadeNoCondominio(prisma, idsUsers, idCondominio);
    if (!ids.length) return;
    if (carteira) await carteira.revogarCredenciaisDosMoradores(ids);
    else await revogarCredenciaisDeMoradores(prisma, ids);
  } catch (e: any) {
    log?.warn(`Credenciais de quem ficou sem unidade no condomínio ${idCondominio} não foram revogadas: ${e?.message ?? e}`);
  }
}
