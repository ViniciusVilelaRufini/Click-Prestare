/**
 * `Users` é global (uma linha por pessoa, compartilhada entre condomínios e papéis).
 * Credenciais (e-mail/login/CPF/senha) dessa linha só podem ser alteradas por quem
 * administra TODOS os vínculos dela: se a pessoa também é síndico/morador/funcionário
 * em OUTRO condomínio, um operador deste condomínio não pode trocar o login nem a senha
 * (isso seria tomar a conta dela).
 */
type PrismaLike = {
  sindicos_Condominios: { count: (a: any) => Promise<number> };
  funcionarios: { count: (a: any) => Promise<number> };
  moradores: { count: (a: any) => Promise<number> };
  apartamentos_Users: { count: (a: any) => Promise<number> };
};

export async function usuarioTemVinculoEmOutroCondominio(
  prisma: PrismaLike,
  idUser: number,
  idCondominio: number,
): Promise<boolean> {
  const fora = { not: Number(idCondominio) };
  const [s, f, m, a] = await Promise.all([
    prisma.sindicos_Condominios.count({ where: { id_user: idUser, id_condominio: fora } }),
    prisma.funcionarios.count({ where: { id_user: idUser, id_condominio: fora } }),
    prisma.moradores.count({ where: { id_user: idUser, id_condominio: fora } }),
    prisma.apartamentos_Users.count({ where: { id_user: idUser, apartamento: { id_condominio: fora } } }),
  ]);
  return s + f + m + a > 0;
}

/** O usuário tem ALGUM vínculo (síndico, equipe ou morador) com este condomínio. */
export async function usuarioTemVinculoNoCondominio(
  prisma: PrismaLike,
  idUser: number,
  idCondominio: number,
): Promise<boolean> {
  const aqui = Number(idCondominio);
  const [s, f, m, a] = await Promise.all([
    prisma.sindicos_Condominios.count({ where: { id_user: idUser, id_condominio: aqui } }),
    prisma.funcionarios.count({ where: { id_user: idUser, id_condominio: aqui } }),
    prisma.moradores.count({ where: { id_user: idUser, id_condominio: aqui } }),
    prisma.apartamentos_Users.count({ where: { id_user: idUser, apartamento: { id_condominio: aqui } } }),
  ]);
  return s + f + m + a > 0;
}

/**
 * Recusa neutra de ligar a este condomínio uma conta que já é de outro (não diz qual nem onde). Não há fluxo
 * de o morador vincular a unidade sozinho: quem liga é o suporte (CRM).
 */
export const MSG_CONTA_DE_OUTRO_CONDOMINIO =
  'Não foi possível concluir o cadastro com este e-mail/CPF. Fale com o suporte para vincular a unidade.';

type PrismaLikeLista = {
  sindicos_Condominios: { findMany: (a: any) => Promise<Array<{ id_user: number | null }>> };
  funcionarios: { findMany: (a: any) => Promise<Array<{ id_user: number | null }>> };
  moradores: { findMany: (a: any) => Promise<Array<{ id_user: number | null }>> };
  apartamentos_Users: { findMany: (a: any) => Promise<Array<{ id_user: number | null }>> };
};

/**
 * Dos usuários informados, os que têm vínculo (síndico, equipe, morador ou unidade) em condomínio
 * diferente de `idCondominio`. Uma consulta por tabela para a lista inteira; sem ids, não consulta.
 */
export async function usuariosComVinculoEmOutroCondominio(
  prisma: PrismaLikeLista,
  idsUser: Array<number | null | undefined>,
  idCondominio: number,
): Promise<Set<number>> {
  const ids = [...new Set(idsUser.filter((v): v is number => v != null).map(Number))];
  if (ids.length === 0) return new Set();
  const fora = { not: Number(idCondominio) };
  const select = { id_user: true };
  const [s, f, m, a] = await Promise.all([
    prisma.sindicos_Condominios.findMany({ where: { id_user: { in: ids }, id_condominio: fora }, select }),
    prisma.funcionarios.findMany({ where: { id_user: { in: ids }, id_condominio: fora }, select }),
    prisma.moradores.findMany({ where: { id_user: { in: ids }, id_condominio: fora }, select }),
    prisma.apartamentos_Users.findMany({ where: { id_user: { in: ids }, apartamento: { id_condominio: fora } }, select }),
  ]);
  return new Set([...s, ...f, ...m, ...a].map((r) => r.id_user).filter((v): v is number => v != null));
}
