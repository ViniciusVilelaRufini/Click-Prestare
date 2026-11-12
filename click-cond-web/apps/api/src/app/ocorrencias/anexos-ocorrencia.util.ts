import { Logger } from '@nestjs/common';
import type { StorageService } from '../common/storage/storage.service';

/** O app deixa anexar até 3 fotos; a API segura o mesmo teto. */
export const MAX_ANEXOS_OCORRENCIA = 3;

/** Só imagem: o app e a portaria exibem os anexos da ocorrência como foto. */
const DATA_URL_IMAGEM = /^data:image\/(jpeg|jpg|png|webp|gif|heic|heif);base64,/i;

const logger = new Logger('AnexosOcorrencia');

/**
 * Sobe as fotos novas (`docs`, data URLs base64 do app) e devolve as URLs
 * separadas por ';' — o formato de `Ocorrencias.anexos` que o app, a portaria
 * e o ArquivosPrivadosInterceptor (assinatura na saída) leem.
 *
 * Devolve null quando não há anexo novo a gravar: o chamador mantém os
 * anexos atuais. Só data URL de imagem entra; URL no lugar do arquivo é
 * ignorada (a saída assina toda URL do bucket, e aceitar uma qualquer daria
 * link para o arquivo de outra pessoa).
 *
 * Storage desligado (devolve o próprio data URL) ou falha (null): o arquivo
 * fica de fora e a ocorrência é salva assim mesmo, como nos outros cadastros
 * do app — o data URL não vai para o banco, e o ';' dele quebraria a lista.
 */
export async function subirAnexosOcorrencia(storage: StorageService, docs: unknown): Promise<string | null> {
  if (!Array.isArray(docs)) return null;
  const imagens = docs
    .filter((d): d is string => typeof d === 'string' && DATA_URL_IMAGEM.test(d))
    .slice(0, MAX_ANEXOS_OCORRENCIA);

  const urls: string[] = [];
  for (const imagem of imagens) {
    try {
      const url = await storage.uploadDataUrl(imagem, 'ocorrencias');
      if (!url || storage.isDataUrl(url)) {
        logger.warn('anexo da ocorrência não enviado ao storage; salvando sem ele.');
        continue;
      }
      urls.push(url);
    } catch (e: any) {
      logger.warn(`anexo da ocorrência falhou no storage (${e?.message ?? e}); salvando sem ele.`);
    }
  }
  return urls.length > 0 ? urls.join(';') : null;
}
