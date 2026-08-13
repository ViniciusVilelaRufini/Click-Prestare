import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private enabled = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    try {
      // 1) Tenta credenciais via env (FIREBASE_SERVICE_ACCOUNT_JSON em base64 ou JSON puro).
      const envCred = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      if (envCred && envCred.trim().length > 0) {
        let parsed: admin.ServiceAccount;
        try {
          const raw = envCred.trim().startsWith('{')
            ? envCred
            : Buffer.from(envCred, 'base64').toString('utf-8');
          parsed = JSON.parse(raw);
        } catch {
          this.logger.warn('FIREBASE_SERVICE_ACCOUNT_JSON inválido. Notificações push desativadas.');
          return;
        }
        admin.initializeApp({ credential: admin.credential.cert(parsed) });
        this.enabled = true;
        this.logger.log('Firebase Admin SDK inicializado (env credentials).');
        return;
      }

      // 2) Tenta arquivo local.
      const serviceAccountPath = path.resolve(
        __dirname,
        'assets/firebase-service-account.json',
      );
      if (!fs.existsSync(serviceAccountPath)) {
        this.logger.warn('Notificações push desativadas (firebase-service-account.json ausente).');
        return;
      }

      admin.initializeApp({ credential: admin.credential.cert(serviceAccountPath) });
      this.enabled = true;
      this.logger.log('Firebase Admin SDK inicializado (file credentials).');
    } catch (error: any) {
      this.logger.warn(`Notificações push desativadas: ${error?.message ?? error}`);
    }
  }

  /**
   * Envia para TODOS os aparelhos do dono deste token, não só para ele.
   *
   * Os pontos de envio espalhados pelo sistema passam o `Users.fcm_token`, que
   * guarda um token só — quem tinha dois celulares na mesma conta recebia
   * apenas no último que abriu o app. Em vez de mudar os ~20 chamadores, o
   * fan-out acontece aqui: o token recebido identifica o usuário em
   * `Users_Devices` e a notificação sai para todos os aparelhos dele.
   *
   * Se o token não estiver na tabela (aparelho que ainda não reabriu o app
   * desde a migração), envia só para ele — nunca menos do que o comportamento
   * anterior.
   */
  async sendPushNotification(
    token: string,
    title: string,
    body: string,
    data?: any,
  ) {
    if (!this.enabled) return null;
    if (!token) return null;

    const destinos = await this.tokensDoMesmoDono(token);
    const resultados = await Promise.all(
      destinos.map((t) => this.enviarParaToken(t, title, body, data)),
    );
    // Devolve o primeiro envio bem-sucedido: o contrato antigo era "string do
    // message id ou null", e há chamadores que só checam se deu certo.
    return resultados.find((r) => r !== null) ?? null;
  }

  /**
   * Envia um push e devolve o ERRO do FCM em vez de engoli-lo.
   *
   * O caminho normal registra a falha no log e segue — o que é certo para o
   * uso real, e péssimo para diagnóstico: "não chegou a notificação" pode ser
   * credencial, token morto, APNs não configurado ou app errado no Firebase, e
   * todos são silenciosos do lado de fora. Aqui a resposta volta ao chamador.
   */
  async enviarDiagnostico(token: string, title: string, body: string) {
    if (!this.enabled) {
      return { ok: false, etapa: 'firebase', erro: 'Firebase Admin desativado (credencial ausente ou inválida)' };
    }
    try {
      const id = await admin.messaging().send({
        notification: { title, body },
        token,
        apns: {
          headers: { 'apns-priority': '10', 'apns-push-type': 'alert' },
          payload: { aps: { sound: 'default' } },
        },
        android: { priority: 'high', notification: { sound: 'default' } },
      });
      return { ok: true, messageId: id };
    } catch (error: any) {
      return {
        ok: false,
        etapa: 'envio',
        codigo: error?.errorInfo?.code ?? error?.code ?? null,
        erro: error?.message ?? String(error),
      };
    }
  }

  private async tokensDoMesmoDono(token: string): Promise<string[]> {
    if (!this.prisma?.isConnected) return [token];
    try {
      const device = await this.prisma.users_Devices.findUnique({
        where: { fcm_token: token },
        select: { id_user: true },
      });
      if (!device) return [token];

      // Só envia se o usuário estiver logado (Users.fcm_token != null)
      const user = await this.prisma.users.findUnique({
        where: { id: device.id_user },
        select: { fcm_token: true },
      });
      if (!user || !user.fcm_token) {
        // Usuário deslogado: remove da tabela de dispositivos para não vazar push
        await this.prisma.users_Devices.deleteMany({
          where: { id_user: device.id_user },
        }).catch(() => {});
        return [];
      }

      // Retorna apenas o token ativo do usuário e dispositivos registrados
      const todos = await this.prisma.users_Devices.findMany({
        where: { id_user: device.id_user },
        select: { fcm_token: true },
      });
      const lista = todos.map((d) => d.fcm_token).filter(Boolean);
      if (user.fcm_token && !lista.includes(user.fcm_token)) {
        lista.push(user.fcm_token);
      }
      return lista.length > 0 ? lista : (user.fcm_token ? [user.fcm_token] : []);
    } catch (e) {
      this.logger.warn(`Não foi possível listar aparelhos: ${(e as any)?.message ?? e}`);
      return [token];
    }
  }

  private async enviarParaToken(
    token: string,
    title: string,
    body: string,
    data?: any,
  ): Promise<string | null> {
    try {
      return await admin.messaging().send({
        notification: { title, body },
        token,
        data: data || {},
        // Sem estes blocos o FCM manda o padrão: no iOS, alerta sem som e
        // sujeito a ser adiado pelo sistema; no Android, prioridade normal,
        // que o Doze segura enquanto a tela está apagada. Um aviso de visita
        // na portaria não pode chegar meia hora depois.
        apns: {
          headers: { 'apns-priority': '10', 'apns-push-type': 'alert' },
          payload: { aps: { sound: 'default' } },
        },
        android: {
          priority: 'high',
          notification: { sound: 'default' },
        },
      });
    } catch (error) {
      const code = (error as any)?.errorInfo?.code ?? '';
      // Token que o FCM já não reconhece (app desinstalado, token expirado):
      // sai da tabela, senão fica sujando toda tentativa futura de envio.
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token'
      ) {
        await this.esquecerToken(token);
        return null;
      }
      this.logger.warn(`Falha ao enviar push: ${(error as any)?.message ?? error}`);
      return null;
    }
  }

  private async esquecerToken(token: string) {
    if (!this.prisma?.isConnected) return;
    try {
      await this.prisma.users_Devices.deleteMany({ where: { fcm_token: token } });
      await this.prisma.users.updateMany({
        where: { fcm_token: token },
        data: { fcm_token: null },
      });
      this.logger.log('Token de push inválido removido.');
    } catch (e) {
      this.logger.warn(`Não foi possível remover token inválido: ${(e as any)?.message ?? e}`);
    }
  }

  async sendToTopic(topic: string, title: string, body: string, data?: any) {
    if (!this.enabled) return null;
    try {
      const response = await admin.messaging().send({
        notification: { title, body },
        topic,
        data: data || {},
      });
      return response;
    } catch (error) {
      this.logger.warn(`Falha ao enviar push para tópico ${topic}: ${(error as any)?.message ?? error}`);
      return null;
    }
  }

  async sendWhatsApp(phone: string, text: string) {
    const instanceId = process.env.Z_API_INSTANCE_ID;
    const token = process.env.Z_API_TOKEN;
    const clientToken = process.env.Z_API_CLIENT_TOKEN;

    if (!instanceId || !token) {
      this.logger.warn('Z-API credentials (Z_API_INSTANCE_ID / Z_API_TOKEN) missing. WhatsApp notification skipped.');
      return null;
    }

    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length > 0 && !cleanPhone.startsWith('55') && cleanPhone.length <= 11) {
      cleanPhone = '55' + cleanPhone;
    }

    if (cleanPhone.length < 10) {
      this.logger.warn(`Invalid phone number format for WhatsApp: ${phone}`);
      return null;
    }

    try {
      const url = `https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(clientToken ? { 'Client-Token': clientToken } : {}),
        },
        body: JSON.stringify({
          phone: cleanPhone,
          message: text,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.warn(`Z-API WhatsApp send error status ${response.status}: ${errorText}`);
        return null;
      }

      const resData = await response.json();
      this.logger.log(`WhatsApp notification sent to ${cleanPhone} successfully.`);
      return resData;
    } catch (error: any) {
      this.logger.error(`Failed to send WhatsApp message via Z-API: ${error?.message ?? error}`);
      return null;
    }
  }
}
