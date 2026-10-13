import { Injectable, Logger } from '@nestjs/common';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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
/**
 * Tipos aceitos no upload. O arquivo é público (public-read) no domínio do
 * storage: HTML/SVG/JS ali seriam XSS armazenado, então o Content-Type NUNCA
 * vem do cliente — só estes tipos passam, com extensão derivada do tipo.
 */
const TIPOS_PERMITIDOS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'text/plain': 'txt',
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};
/** Teto do arquivo decodificado (a API aceita 100 MB de JSON; o storage não deve). */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

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
    _hint?: string,
  ): Promise<string | null> {
    // Se o S3 não está configurado, retorna o base64 original como fallback
    if (!this.enabled || !this.client) return dataUrl;

    try {
      const base64Index = dataUrl.indexOf(';base64,');
      if (base64Index === -1 || !dataUrl.startsWith('data:')) {
        this.logger.warn('uploadDataUrl: data URL inválida.');
        return null;
      }
      const contentType = dataUrl.slice(5, base64Index).split(';')[0].trim().toLowerCase();
      const ext = TIPOS_PERMITIDOS[contentType];
      if (!ext) {
        this.logger.warn(`uploadDataUrl: tipo não permitido (${contentType.slice(0, 60)}).`);
        return null;
      }
      const rawBase64 = dataUrl.slice(base64Index + 8).replace(/\s+/g, '');
      if (Math.floor((rawBase64.length * 3) / 4) > MAX_UPLOAD_BYTES) {
        this.logger.warn('uploadDataUrl: arquivo acima do limite.');
        return null;
      }
      const buffer = Buffer.from(rawBase64, 'base64');
      const safePrefix = prefix.replace(/[^a-z0-9_\-\/]/gi, '').replace(/\/+/g, '/').replace(/^\/|\/$/g, '').slice(0, 60) || 'arquivo';
      const key = `${safePrefix}/${Date.now()}-${randomUUID()}.${ext}`;

      await this.client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        ACL: 'public-read',
      }));

      return `${this.publicUrl}/${key}`;
    } catch (err: any) {
      this.logger.error(`Falha ao subir para R2: ${err?.message ?? err}. Usando base64 fallback.`);
      return dataUrl;
    }
  }

  /**
   * Remove um arquivo do R2/S3 a partir de sua URL pública ou key (expurgo LGPD).
   */
  async deleteUrl(url: string | null | undefined): Promise<boolean> {
    if (!url || !this.enabled || !this.client) return false;
    if (this.isDataUrl(url)) return true; // base64 inline não fica no storage

    try {
      // Só apaga objetos do NOSSO storage. Antes, qualquer URL (de qualquer host)
      // tinha o pathname usado como key — um cliente que controla uma foto_url
      // fazia o expurgo apagar objetos arbitrários do bucket.
      let key: string;
      if (this.publicUrl && url.startsWith(this.publicUrl + '/')) {
        key = url.slice(this.publicUrl.length).replace(/^\/+/, '');
      } else if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
        this.logger.warn('deleteUrl: URL fora do storage público, ignorada.');
        return false;
      } else {
        key = url.replace(/^\/+/, '');
      }
      key = key.split(/[?#]/)[0];

      if (!key || key.split('/').includes('..')) return false;

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
