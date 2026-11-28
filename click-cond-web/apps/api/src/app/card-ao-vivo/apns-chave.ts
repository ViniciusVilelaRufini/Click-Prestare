import type { StorageService } from '../common/storage/storage.service';

/** Onde a chave .p8 do APNs fica no S3 privado (variáveis do EB no limite). */
export const CHAVE_APNS_S3 = 'config/apns/AuthKey.p8';

/**
 * Carrega a chave .p8 do APNs: env `APNS_KEY_P8_BASE64` (dev) ou o objeto do
 * S3. Usada pelo card ao vivo (Live Activity) e pelo interfone (VoIP) — é a
 * mesma chave da conta Apple.
 */
export async function carregarChaveApns(storage?: Pick<StorageService, 'lerObjetoTexto'> | null): Promise<string | null> {
  const b64 = process.env['APNS_KEY_P8_BASE64'];
  if (b64) return Buffer.from(b64, 'base64').toString('utf-8');
  return (await storage?.lerObjetoTexto(CHAVE_APNS_S3)) ?? null;
}
