import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

const UPLOAD_TYPES = {
  'image/jpeg': { extension: 'jpg', maxBytes: 5 * 1024 * 1024 },
  'image/png': { extension: 'png', maxBytes: 5 * 1024 * 1024 },
  'image/webp': { extension: 'webp', maxBytes: 5 * 1024 * 1024 },
  'application/pdf': { extension: 'pdf', maxBytes: 10 * 1024 * 1024 },
} as const;

type UploadMime = keyof typeof UPLOAD_TYPES;

interface ParsedUploadDataUrl {
  contentType: UploadMime;
  buffer: Buffer;
}

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
    const accessKeyId =
      process.env.R2_ACCESS_KEY_ID ||
      process.env.AWS_ACCESS_KEY ||
      process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey =
      process.env.R2_SECRET_ACCESS_KEY ||
      process.env.AWS_SECRET_KEY ||
      process.env.AWS_SECRET_ACCESS_KEY;
    const endpoint = process.env.R2_ENDPOINT;
    const region =
      process.env.AWS_S3_BUCKET_REGION || (endpoint ? 'auto' : 'us-east-1');
    this.bucket =
      process.env.R2_BUCKET || process.env.AWS_S3_BUCKET_NAME || '';
    const baseS3Url =
      process.env.R2_PUBLIC_URL ||
      process.env.AWS_S3_BASE_URL ||
      (this.bucket ? `https://${this.bucket}.s3.amazonaws.com` : '');
    this.publicUrl = baseS3Url.replace(/\/+$/, '');

    if (!accessKeyId || !secretAccessKey || !this.bucket || !this.publicUrl) {
      this.client = null;
      this.enabled = false;
      this.logger.warn('StorageService desativado (S3/R2 envs incompletas). Uploads serão ignorados.');
      return;
    }

    this.client = new S3Client({
      region,
      ...(endpoint ? { endpoint } : {}),
      credentials: { accessKeyId, secretAccessKey },
    });
    this.enabled = true;
    this.logger.log(`StorageService pronto (bucket=${this.bucket}, provider=${endpoint ? 'R2' : 'AWS S3'}).`);
  }

  /**
   * Detecta se a string é um data URL base64. Aceita:
   *   data:image/jpeg;base64,/9j/4AAQ...
   *   data:application/pdf;base64,JVBERi0...
   */
  /**
   * Era declarado como `value is string` — um type predicate. Mas o que ele
   * testa é CONTEÚDO (se a string é um data URL), não tipo. Quando o valor já
   * é `string`, o TypeScript narrowava o ramo negativo para `never`, e
   * qualquer uso depois do `if` virava erro ("Property 'length' does not
   * exist on type 'never'"). Como `boolean`, diz a verdade sobre o que faz.
   */
  isDataUrl(value: unknown): boolean {
    return typeof value === 'string' && value.startsWith('data:') && value.includes('base64,');
  }

  /** Keeps legacy public-URL reads scoped to the configured storage origin. */
  isTrustedPublicUrl(value: unknown): boolean {
    if (typeof value !== 'string' || !this.publicUrl) return false;

    try {
      const configured = new URL(this.publicUrl);
      const candidate = new URL(value);
      const basePath = configured.pathname.replace(/\/+$/, '');
      const expectedPrefix = `${basePath}/`;

      return candidate.protocol === configured.protocol &&
        candidate.host === configured.host &&
        (candidate.pathname === basePath || candidate.pathname.startsWith(expectedPrefix));
    } catch {
      return false;
    }
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
    const { contentType, buffer } = this.parseUploadDataUrl(dataUrl);

    // Se o S3 não está configurado, retorna o base64 original como fallback
    if (!this.enabled || !this.client) return dataUrl;

    try {
      const ext = (hint ?? this.extFromMime(contentType)).replace(/^\.+/, '');
      const safePrefix = prefix.replace(/[^a-z0-9_\-\/]/gi, '').replace(/\/+/g, '/').replace(/^\/|\/$/g, '').slice(0, 60) || 'arquivo';
      const key = `${safePrefix}/${Date.now()}-${randomUUID()}.${ext}`;

      await this.client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        ACL: undefined,
      }));

      return `${this.publicUrl}/${key}`;
    } catch (err: any) {
      this.logger.error(`Falha ao subir para R2: ${err?.message ?? err}. Usando base64 fallback.`);
      return dataUrl;
    }
  }

  private parseUploadDataUrl(dataUrl: string): ParsedUploadDataUrl {
    const separator = dataUrl.indexOf(',');
    const header = separator >= 0 ? dataUrl.slice(0, separator) : '';
    const match = /^data:([^;,]+);base64$/i.exec(header);
    if (!match || separator < 0) {
      throw new BadRequestException('Upload must be a valid base64 data URL.');
    }

    const contentType = match[1].toLowerCase() as UploadMime;
    const policy = UPLOAD_TYPES[contentType];
    if (!policy) {
      throw new BadRequestException('File type is not allowed for upload.');
    }

    const rawBase64 = dataUrl.slice(separator + 1);
    const paddingBytes = rawBase64.endsWith('==') ? 2 : rawBase64.endsWith('=') ? 1 : 0;
    const decodedLength = (rawBase64.length / 4) * 3 - paddingBytes;
    if (decodedLength > policy.maxBytes) {
      throw new BadRequestException(`File exceeds the ${policy.maxBytes}-byte limit for ${contentType}.`);
    }

    if (!this.isStrictBase64(rawBase64)) {
      throw new BadRequestException('Invalid base64 content.');
    }

    const buffer = Buffer.from(rawBase64, 'base64');
    if (!buffer.length || buffer.length > policy.maxBytes) {
      throw new BadRequestException(`File exceeds the ${policy.maxBytes}-byte limit for ${contentType}.`);
    }

    return { contentType, buffer };
  }

  private isStrictBase64(value: string): boolean {
    if (!value || value.length % 4 !== 0) return false;

    const paddingBytes = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
    const contentLength = value.length - paddingBytes;
    if ((paddingBytes === 1 && contentLength % 4 !== 3) ||
      (paddingBytes === 2 && contentLength % 4 !== 2)) {
      return false;
    }

    for (let index = 0; index < contentLength; index += 1) {
      const code = value.charCodeAt(index);
      const isBase64Character =
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        (code >= 48 && code <= 57) ||
        code === 43 || code === 47;
      if (!isBase64Character) return false;
    }

    for (let index = contentLength; index < value.length; index += 1) {
      if (value[index] !== '=') return false;
    }

    return true;
  }

  /**
   * Remove um arquivo do R2/S3 a partir de sua URL pública ou key (expurgo LGPD).
   */
  async deleteUrl(url: string | null | undefined): Promise<boolean> {
    if (!url || !this.enabled || !this.client) return false;
    if (this.isDataUrl(url)) return true; // base64 inline não fica no storage

    try {
      let key = url;
      if (this.publicUrl && url.startsWith(this.publicUrl)) {
        key = url.slice(this.publicUrl.length).replace(/^\/+/, '');
      } else {
        try {
          const parsed = new URL(url);
          key = parsed.pathname.replace(/^\/+/, '');
        } catch {
          // Já é uma key relativa
        }
      }

      if (!key) return false;

      await this.client.send(new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }));

      return true;
    } catch (err: any) {
      this.logger.warn(`Falha ao remover arquivo do R2 (${url}): ${err?.message ?? err}`);
      return false;
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
