import type { Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';

/**
 * Push para os moradores do condomínio que deixaram ligada a preferência de
 * avisos do condomínio (`notif_comunicados`). É o mesmo envio do "Novo
 * comunicado", usado também ao convocar assembleia, abrir enquete e publicar
 * ATA.
 *
 * Nunca lança: o chamador grava primeiro e chama isto depois, sem esperar
 * (`void`). Falha no FCM ou na consulta só vai para o log — a gravação fica.
 */
export async function avisarMoradoresDoCondominio(
  deps: { prisma: PrismaService; notifications?: NotificationsService | null; logger: Logger },
  idCondominio: number,
  aviso: { titulo: string; corpo: string; data: Record<string, string> },
): Promise<void> {
  if (!deps.notifications) return;
  try {
    const users = await deps.prisma.users.findMany({
      where: { notif_comunicados: 1, fcm_token: { not: null }, moradores: { some: { id_condominio: idCondominio } } },
      select: { fcm_token: true },
    });
    for (const u of users) {
      try {
        await deps.notifications.sendPushNotification(u.fcm_token!, aviso.titulo, aviso.corpo, aviso.data);
      } catch (e: any) {
        deps.logger.error(`[push.${aviso.data['type'] ?? 'aviso'}] ${e?.message ?? e}`);
      }
    }
  } catch (e: any) {
    deps.logger.error(`[push.${aviso.data['type'] ?? 'aviso'}] ${e?.message ?? e}`);
  }
}
