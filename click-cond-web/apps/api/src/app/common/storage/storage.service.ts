import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { MAX_IMAGE_BYTES, MAX_PDF_BYTES } from './upload-limits';

const UPLOAD_TYPES = {
  'image/jpeg': { extension: 'jpg', maxBytes: MAX_IMAGE_BYTES },
  'image/png': { extension: 'png', maxBytes: MAX_IMAGE_BYTES },
  'image/webp': { extension: 'webp', maxBytes: MAX_IMAGE_BYTES },
  'application/pdf': { extension: 'pdf', maxBytes: MAX_PDF_BYTES },
} as const;

type UploadMime = keyof typeof UPLOAD_TYPES;

interface ParsedUploadDataUrl {
  contentType: UploadMime;
  buffer: Buffer;
  extension: string;
}

/**
 * Storage service usando Cloudflare R2 (compatível com S3 API).
 *
 * Variáveis de ambiente necessárias:
 *  - R2_ACCESS_KEY_ID
 *  - R2_SECRET_ACCESS_KEY
 *  - R2_ENDPOINT          (https://<accountId>.r2.cloudflarestorage.com)
 *  - R2_BUCKET            (nome do bucket)
 *  - R2_PUBLIC_URL        (URL legada, usada somente para reconhecer objetos antigos)
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

    if (!accessKeyId || !secretAccessKey || !this.bucket) {
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
   * - hint: mantido por compatibilidade; a extensão deriva do MIME validado.
   *
   * Retorna a chave privada do arquivo, ou null se o storage estiver desativado / falhar.
   */
  async uploadDataUrl(
    dataUrl: string,
    prefix: string,
    _hint?: string,
  ): Promise<string | null> {
    const { contentType, buffer, extension } = this.parseUploadDataUrl(dataUrl);

    // Se o S3 não está configurado, retorna o base64 original como fallback
    if (!this.enabled || !this.client) return dataUrl;

    try {
      const ext = extension;
      const safePrefix = prefix.replace(/[^a-z0-9_\-\/]/gi, '').replace(/\/+/g, '/').replace(/^\/|\/$/g, '').slice(0, 60) || 'arquivo';
      const key = `${safePrefix}/${Date.now()}-${randomUUID()}.${ext}`;

      await this.client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        ACL: undefined,
      }));

      return key;
    } catch (err: any) {
      this.logger.error(`Falha ao subir para R2: ${err?.message ?? err}. Usando base64 fallback.`);
      return dataUrl;
    }
  }

  /**
   * Busca um objeto privado por sua chave opaca. A autoriza\u00e7\u00e3o de tenant fica
   * na rota chamadora, antes desta opera\u00e7\u00e3o de storage ser alcan\u00e7ada.
   */
  async getPrivateObject(key: string) {
    if (!this.isPrivateObjectKey(key)) {
      throw new BadRequestException('Invalid private object key.');
    }
    if (!this.enabled || !this.client) {
      throw new ServiceUnavailableException('Private storage is not configured.');
    }

    return this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
  }

  private isPrivateObjectKey(key: unknown): key is string {
    return typeof key === 'string' &&
      /^[a-z0-9][a-z0-9._\-/]*$/i.test(key) &&
      !key.split('/').includes('..');
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

    if (!this.hasExpectedSignature(contentType, buffer)) {
      throw new BadRequestException('File content does not match its declared type.');
    }

    return { contentType, buffer, extension: policy.extension };
  }

  private hasExpectedSignature(contentType: UploadMime, buffer: Buffer): boolean {
    if (contentType === 'image/jpeg') {
      return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    }
    if (contentType === 'image/png') {
      return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
    if (contentType === 'image/webp') {
      return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    }
    return buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-';
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

}
