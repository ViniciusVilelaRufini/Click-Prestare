import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class OpenPixService {
  private readonly logger = new Logger(OpenPixService.name);

  /**
   * Cria uma cobrança Pix dinâmica na OpenPix/Woovi.
   *
   * @param expiresAt vencimento da fatura — a charge expira 7 dias depois
   *                  (carência para pagamento em atraso). Sem vencimento,
   *                  usa o default da OpenPix.
   */
  async generateCharge(correlationId: string, valueInReais: number, comment: string, expiresAt?: Date | null) {
    const appId = process.env.OPENPIX_APP_ID;
    if (!appId) {
      this.logger.warn('OPENPIX_APP_ID missing. Skipping OpenPix charge creation.');
      return null;
    }

    const valueInCents = Math.round(valueInReais * 100);
    if (valueInCents <= 0) {
      this.logger.warn(`OpenPix: valor <= 0 para ${correlationId} — charge não criada.`);
      return null;
    }

    const payload: Record<string, unknown> = {
      correlationID: correlationId,
      value: valueInCents,
      comment: comment,
    };
    if (expiresAt) {
      const graceMs = 7 * 24 * 60 * 60 * 1000; // 7 dias de carência pós-vencimento
      const expiresIn = Math.floor((expiresAt.getTime() + graceMs - Date.now()) / 1000);
      // Só envia se sobrar pelo menos 1h de validade (charge no passado é rejeitada).
      if (expiresIn > 3600) {
        payload.expiresIn = expiresIn;
      }
    }

    try {
      const response = await fetch('https://api.openpix.com.br/v1/charge', {
        method: 'POST',
        headers: {
          'Authorization': appId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errText = await response.text();
        this.logger.error(`OpenPix API error para ${correlationId} (status ${response.status}): ${errText}`);
        return null;
      }

      const data = await response.json() as any;
      return {
        brCode: data.charge?.brCode,
        qrCodeImage: data.charge?.qrCodeImage,
        transactionID: data.charge?.transactionID,
      };
    } catch (error: any) {
      this.logger.error(`Failed to create OpenPix charge for ${correlationId}: ${error?.message ?? error}`);
      return null;
    }
  }
}
