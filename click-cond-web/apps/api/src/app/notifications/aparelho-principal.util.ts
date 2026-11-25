/**
 * `Users.fcm_token` é o token que quase todo ponto de envio lê; nulo = o
 * envio desiste. Quando o token principal sai (logout daquele aparelho, ou o
 * FCM recusou), o aparelho mais recente que continua registrado em
 * `Users_Devices` assume o lugar, para os outros aparelhos logados não
 * ficarem mudos (F4).
 *
 * Só preenche quando `Users.fcm_token` está nulo: um registro concorrente
 * (update-fcm-token) que já gravou outro token vence.
 */
export async function promoverAparelhoMaisRecente(prisma: any, idUser: number): Promise<string | null> {
  if (!idUser || Number.isNaN(idUser)) return null;
  const restante = await prisma.users_Devices.findFirst({
    where: { id_user: idUser },
    orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
    select: { fcm_token: true },
  });
  if (!restante?.fcm_token) return null;
  await prisma.users.updateMany({
    where: { id: idUser, fcm_token: null },
    data: { fcm_token: restante.fcm_token },
  });
  return restante.fcm_token;
}
