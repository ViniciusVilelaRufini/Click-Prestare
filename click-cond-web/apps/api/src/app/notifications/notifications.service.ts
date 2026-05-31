import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private enabled = false;

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

  async sendPushNotification(
    token: string,
    title: string,
    body: string,
    data?: any,
  ) {
    if (!this.enabled) return null;
    try {
      const response = await admin.messaging().send({
        notification: { title, body },
        token,
        data: data || {},
      });
      return response;
    } catch (error) {
      this.logger.warn(`Falha ao enviar push: ${(error as any)?.message ?? error}`);
      return null;
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
