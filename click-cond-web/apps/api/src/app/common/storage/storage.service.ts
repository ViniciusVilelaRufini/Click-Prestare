import { Injectable, Logger } from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

/**
 * Storage service usando Cloudflare R2 (compatível com S3 API).
 *
 * Variáveis de ambiente necessárias:
 *  - R2_ACCESS_KEY_ID
 *  - R2_SECRET_ACCESS_KEY
 *  - R2_ENDPOINT          (https://<accountId>.r2.cloudflarestorage.com)
 *  - R2_BUCKET            (nome do bucket)
 *  - R2_PUBLIC_URL        (https://pub-xxxxx.r2.dev — usada para gerar a URL final)
 *
 * Se as variáveis não estiverem setadas, o upload é desativado e o método
 * retorna a string original (compatibilidade com ambiente de dev).
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client | null;
  private readonly bucket: string;
  private readonly publicUrl: string;
  readonly enabled: boolean;

  constructor() {
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const endpoint = process.env.R2_ENDPOINT;
    this.bucket = process.env.R2_BUCKET ?? '';
    this.publicUrl = (process.env.R2_PUBLIC_URL ?? '').replace(/\/+$/, '');

    if (!accessKeyId || !secretAccessKey || !endpoint || !this.bucket || !this.publicUrl) {
      this.client = null;
      this.enabled = false;
      this.logger.warn('StorageService desativado (R2 envs incompletas). Uploads serão ignorados.');
      return;
    }

    this.client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    });
    this.enabled = true;
    this.logger.log(`StorageService pronto (bucket=${this.bucket}).`);
  }

  /**
   * Detecta se a string é um data URL base64. Aceita:
   *   data:image/jpeg;base64,/9j/4AAQ...
   *   data:application/pdf;base64,JVBERi0...
   */
  isDataUrl(value: unknown): value is string {
    return typeof value === 'string' && value.startsWith('data:') && value.includes('base64,');
  }

  /**
   * Faz upload de um data URL base64 para o bucket R2.
   * - prefix: pasta lógica no bucket (ex.: "documentos", "comprovantes", "visitantes")
   * - hint: extensão preferida (ex.: "pdf"). Se vier vazia, infere do mime type.
   *
   * Retorna a URL pública do arquivo, ou null se o storage estiver desativado / falhar.
   */
  async uploadDataUrl(
    dataUrl: string,
    prefix: string,
    hint?: string,
  ): Promise<string | null> {
    // Se o S3 não está configurado, retorna o base64 original como fallback
    if (!this.enabled || !this.client) return dataUrl;

    try {
      const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
      if (!match) {
        this.logger.warn('uploadDataUrl: data URL inválida.');
        return null;
      }
      const contentType = match[1] || 'application/octet-stream';
      const buffer = Buffer.from(match[2], 'base64');
      const ext = (hint ?? this.extFromMime(contentType)).replace(/^\.+/, '');
      const safePrefix = prefix.replace(/[^a-z0-9_\-]/gi, '').slice(0, 40) || 'arquivo';
      const key = `${safePrefix}/${Date.now()}-${randomUUID()}.${ext}`;

      await this.client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }));

      return `${this.publicUrl}/${key}`;
    } catch (err: any) {
      this.logger.error(`Falha ao subir para R2: ${err?.message ?? err}`);
      return null;
    }
  }

  private extFromMime(mime: string): string {
    const m = mime.toLowerCase();
    if (m.includes('pdf')) return 'pdf';
    if (m.includes('png')) return 'png';
    if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
    if (m.includes('webp')) return 'webp';
    if (m.includes('gif')) return 'gif';
    if (m.includes('svg')) return 'svg';
    if (m.includes('sheet') || m.includes('excel')) return 'xlsx';
    if (m.includes('csv')) return 'csv';
    return 'bin';
  }
}
