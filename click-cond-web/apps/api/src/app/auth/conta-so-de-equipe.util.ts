type PrismaContagem = {
  sindicos: { count: (a: any) => Promise<number> };
  sindicos_Condominios: { count: (a: any) => Promise<number> };
  moradores: { count: (a: any) => Promise<number> };
  apartamentos_Users: { count: (a: any) => Promise<number> };
  funcionarios: { count: (a: any) => Promise<number> };
};

/**
 * A conta existe só como equipe deste condomínio: nenhum perfil de síndico, nenhum vínculo de síndico, morador ou
 * unidade e nenhum vínculo de equipe em outro prédio. Só então quem gerencia a equipe daqui administra a conta
 * inteira (definir a senha pelo cadastro do porteiro, apagar ou inutilizar a conta ao tirá-la da equipe).
 *
 * Critério único do app (mobile-auth: loginFuncionario, redefinição, removeFuncionario) e do cadastro de
 * prestadores (lápide e re-credenciamento). As flags is_sindico/is_morador ficam a cargo de quem chama: o
 * cadastro de morador liga conta existente sem marcar a flag, por isso a contagem é a prova. `db` pode ser o
 * cliente de uma transação.
 */
export async function contaSoDaEquipeDoCondominio(db: PrismaContagem, idUser: number, idCondominio: number): Promise<boolean> {
  const [perfisSindico, sindicoEm, moradorEm, unidades, equipeFora] = await Promise.all([
    db.sindicos.count({ where: { id_user: idUser } }),
    db.sindicos_Condominios.count({ where: { id_user: idUser } }),
    db.moradores.count({ where: { id_user: idUser } }),
    db.apartamentos_Users.count({ where: { id_user: idUser } }),
    db.funcionarios.count({ where: { id_user: idUser, id_condominio: { not: Number(idCondominio) } } }),
  ]);
  return perfisSindico + sindicoEm + moradorEm + unidades + equipeFora === 0;
}
