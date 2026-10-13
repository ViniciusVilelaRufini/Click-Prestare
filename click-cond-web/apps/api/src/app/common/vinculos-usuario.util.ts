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
