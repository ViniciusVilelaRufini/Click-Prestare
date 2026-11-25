import type { Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { limitarConcorrencia } from '../common/limitar-concorrencia';

/**
 * Pushes em voo ao mesmo tempo (por instância, somando todos os avisos em
 * andamento). Antes era um await por morador: num condomínio de 500 unidades
 * levava minutos, e um deploy no meio deixava parte sem aviso. A fila é longa
 * de propósito: o aviso de um condomínio inteiro entra de uma vez.
 */
const limitarPushAvisos = limitarConcorrencia('push-avisos-condominio', 5, {
  filaMaxima: 20_000,
  esperaMaximaMs: 15 * 60 * 1000,
});

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
  aviso: {
    titulo: string;
    corpo: string;
    data: Record<string, string>;
    /** Users.id de quem publicou: não é avisado do que ele mesmo fez. */
    excluirUserId?: number | null;
  },
): Promise<void> {
  if (!deps.notifications) return;
  try {
    // Morador atual = vínculo com uma unidade do condomínio (Apartamentos_Users,
    // o mesmo critério do assertCondominio). A linha em Moradores sobrevive à
    // exclusão da unidade (só perde bloco/apto), e o ex-morador seguia avisado.
    const users = await deps.prisma.users.findMany({
      where: {
        notif_comunicados: 1,
        fcm_token: { not: null },
        apartamentosUsers: { some: { apartamento: { id_condominio: idCondominio } } },
        ...(aviso.excluirUserId ? { id: { not: aviso.excluirUserId } } : {}),
      },
      select: { fcm_token: true },
    });
    const notifications = deps.notifications;
    // id_condominio no data: o app abre o detalhe no condomínio certo quando
    // o push chega com o app fechado (ou noutro condomínio).
    const data = { ...aviso.data, id_condominio: String(idCondominio) };
    await Promise.all(
      users.map((u) =>
        limitarPushAvisos(() => notifications.sendPushNotification(u.fcm_token!, aviso.titulo, aviso.corpo, data)).catch(
          (e: any) => deps.logger.error(`[push.${aviso.data['type'] ?? 'aviso'}] ${e?.message ?? e}`),
        ),
      ),
    );
  } catch (e: any) {
    deps.logger.error(`[push.${aviso.data['type'] ?? 'aviso'}] ${e?.message ?? e}`);
  }
}
