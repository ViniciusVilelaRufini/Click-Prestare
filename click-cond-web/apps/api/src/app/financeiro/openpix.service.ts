import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class OpenPixService {
  private readonly logger = new Logger(OpenPixService.name);

  async generateCharge(correlationId: string, valueInReais: number, comment: string) {
    const appId = process.env.OPENPIX_APP_ID;
    if (!appId) {
      this.logger.warn('OPENPIX_APP_ID missing. Skipping OpenPix charge creation.');
      return null;
    }

    const valueInCents = Math.round(valueInReais * 100);

    try {
      const response = await fetch('https://api.openpix.com.br/v1/charge', {
        method: 'POST',
        headers: {
          'Authorization': appId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          correlationID: correlationId,
          value: valueInCents,
          comment: comment,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        this.logger.error(`OpenPix API error (status ${response.status}): ${errText}`);
        return null;
      }

      const data = await response.json() as any;
      return {
        brCode: data.charge?.brCode,
        qrCodeImage: data.charge?.qrCodeImage,
        transactionID: data.charge?.transactionID,
      };
    } catch (error: any) {
      this.logger.error(`Failed to create OpenPix charge: ${error?.message ?? error}`);
      return null;
    }
  }
}
