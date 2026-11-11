import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { credenciaisContaPrestare } from '../aws-credenciais.util';
import { rastrearClienteAws } from '../xray';

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
 * Tipos aceitos no upload. O arquivo é servido por link assinado no domínio do
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
/** Teto do arquivo decodificado (o corpo de upload vai a 35 MB em base64, ver common/limite-corpo.ts). */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Pastas do bucket que o expurgo de cada dono pode apagar. O valor da foto
 * vem do cliente (URL não-data é guardada como veio), então o expurgo nunca
 * pode apagar fora da pasta onde o próprio fluxo grava.
 */
export const PREFIXOS_FOTO_CONVITE: readonly string[] = ['convites/'];
/** Foto de visitante nasce em visitantes/ ou é herdada do convite (convites/). */
export const PREFIXOS_FOTO_VISITANTE: readonly string[] = ['visitantes/', 'convites/'];
/** Foto de morador (rosto do facial) nasce em moradores/ (MoradoresService.resolveFoto e saveMorador). */
export const PREFIXOS_FOTO_MORADOR: readonly string[] = ['moradores/'];

/**
 * Links assinados de leitura (bucket privado). Validade fixa de 1 h, contada a
 * partir do início da janela de 15 min em que o link foi gerado: dentro da
 * janela o link é o mesmo (o cache de imagem do app e da web continua valendo)
 * e vale de 45 a 60 min. Com o role da instância as credenciais são
 * temporárias, então um link nunca dura mais que a sessão do role — validades
 * longas (os 7 dias do SigV4) não seriam respeitadas de qualquer forma. Quem
 * guarda a URL (avatar do app) precisa rebuscar o cadastro para ter link novo.
 */
const VALIDADE_LINK_S = 60 * 60;
const JANELA_ASSINATURA_MS = 15 * 60 * 1000;

/** Resposta de `exigirArquivoDoRegistro` — sem detalhe de qual arquivo nem por quê. */
export const MSG_ARQUIVO_INVALIDO = 'Arquivo inválido.';

/** O que já está gravado na entidade: a lista, ou uma função que a carrega sob demanda. */
export type Gravados = readonly unknown[] | (() => Promise<readonly unknown[]> | readonly unknown[]);

/** Carrega uma vez só (dois campos da mesma entidade conferem contra a mesma consulta). */
export function umaVez<T>(carregar: () => Promise<T>): () => Promise<T> {
  let promessa: Promise<T> | undefined;
  return () => {
    if (!promessa) promessa = carregar();
    return promessa;
  };
}

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

    // Sem chave no ambiente, o S3 da AWS usa o role da instância do EB, que o
    // bucket (conta 952520388262) libera por bucket policy. É o caminho
    // preferido: chave fixa já vazou uma vez (click_user em quarentena). O R2
    // continua exigindo chave.
    const usaRole = !accessKeyId && !secretAccessKey && !endpoint;
    if ((!usaRole && (!accessKeyId || !secretAccessKey)) || !this.bucket || !this.publicUrl) {
      this.client = null;
      this.enabled = false;
      this.logger.warn('StorageService desativado (S3/R2 envs incompletas). Uploads serão ignorados.');
      return;
    }

    this.client = rastrearClienteAws(
      new S3Client({
        region,
        ...(endpoint ? { endpoint } : {}),
        credentials: usaRole ? credenciaisContaPrestare() : { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
      }),
    );
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
      }));

      return `${this.publicUrl}/${key}`;
    } catch (err: any) {
      this.logger.error(`Falha ao subir para R2: ${err?.message ?? err}. Usando base64 fallback.`);
      return dataUrl;
    }
  }

  /**
   * Key do objeto quando a URL é do NOSSO bucket (forma canônica ou qualquer
   * host S3 do bucket, assinada ou não); null para o resto.
   */
  private keyDoBucket(url: unknown): string | null {
    if (typeof url !== 'string' || !this.bucket || !/^https?:\/\//i.test(url)) return null;
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    const base = this.publicUrl ? new URL(this.publicUrl) : null;
    // Hosts que o S3 usa para o bucket: bucket.s3.amazonaws.com e as variantes
    // regionais (bucket.s3.us-east-1.amazonaws.com, bucket.s3-us-east-1...).
    const host = u.host.toLowerCase();
    const bucket = this.bucket.toLowerCase();
    const hostDoBucket =
      (host.startsWith(`${bucket}.s3.`) || host.startsWith(`${bucket}.s3-`)) && host.endsWith('.amazonaws.com');
    const nosso = (base && host === base.host.toLowerCase()) || hostDoBucket;
    if (!nosso) return null;
    let key: string;
    try {
      key = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
    } catch {
      return null; // %-escape inválido
    }
    return key && !key.split('/').includes('..') ? key : null;
  }

  /**
   * Forma canônica (sem assinatura) de uma URL do bucket — é o que vai para o
   * banco. O cliente devolve a URL assinada que recebeu ao salvar um cadastro;
   * gravada assim, ela expiraria junto com o link.
   */
  normalizarUrl<T>(url: T): T {
    const key = this.keyDoBucket(url);
    return (key ? `${this.publicUrl}/${key}` : url) as T;
  }

  /** true quando o valor é URL do NOSSO bucket (canônica, assinada ou outro host S3 dele). */
  ehArquivoDoBucket(valor: unknown): boolean {
    return this.keyDoBucket(valor) !== null;
  }

  /**
   * Regra de todo campo de arquivo que recebe valor do cliente. A saída da API
   * assina QUALQUER URL do bucket (ArquivosPrivadosInterceptor), então gravar
   * uma URL do bucket qualquer era trocar uma URL guardada (de um ex-porteiro,
   * por exemplo) por link novo para sempre. O campo só aceita:
   *  (a) data URL nova — quem chama faz o upload;
   *  (b) a MESMA chave já gravada naquela entidade (o cliente reenvia o que
   *      recebeu, assinado ou não: a comparação é pela chave do objeto);
   *  (c) vazio.
   * Outra URL do bucket: 400. URL fora do bucket segue a regra de cada campo.
   *
   * `gravados` são os valores atuais da entidade; como função, só é carregada
   * quando o valor de fato é URL do bucket (o caso comum não consulta o banco).
   */
  async exigirArquivoDoRegistro(valor: unknown, gravados: Gravados): Promise<void> {
    const key = this.keyDoBucket(valor);
    if (!key) return;
    const atuais = typeof gravados === 'function' ? await gravados() : gravados;
    if ((atuais ?? []).some((g) => this.keyDoBucket(g) === key)) return;
    throw new BadRequestException(MSG_ARQUIVO_INVALIDO);
  }

  /**
   * Link temporário de leitura para um arquivo do bucket (privado). URL de
   * outro host, data URL ou storage desativado: devolve como está.
   */
  async assinarUrl(url: string): Promise<string> {
    if (!this.enabled || !this.client) return url;
    const key = this.keyDoBucket(url);
    if (!key) return url;
    const inicioDaJanela = new Date(Math.floor(Date.now() / JANELA_ASSINATURA_MS) * JANELA_ASSINATURA_MS);
    try {
      return await getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
        expiresIn: VALIDADE_LINK_S,
        signingDate: inicioDaJanela,
      });
    } catch (err: any) {
      // Sem credencial (IMDS fora do ar etc.): melhor a URL canônica (quebra só
      // a imagem) do que derrubar a resposta inteira.
      this.logger.warn(`assinarUrl: falha ao assinar (${err?.message ?? err}).`);
      return url;
    }
  }

  /**
   * Remove um arquivo do R2/S3 a partir de sua URL pública ou key (expurgo LGPD).
   * Só apaga se a key estiver dentro de um dos `prefixosPermitidos` (pasta do
   * dono — ver PREFIXOS_FOTO_*); lista vazia não apaga nada.
   */
  async deleteUrl(
    url: string | null | undefined,
    prefixosPermitidos: readonly string[],
  ): Promise<boolean> {
    if (!url || !this.enabled || !this.client) return false;
    if (this.isDataUrl(url)) return true; // base64 inline não fica no storage

    try {
      // Só apaga objetos do NOSSO storage. Antes, qualquer URL (de qualquer host)
      // tinha o pathname usado como key — um cliente que controla uma foto_url
      // fazia o expurgo apagar objetos arbitrários do bucket.
      // URL do bucket configurado (canônica, assinada ou outro host S3 do
      // mesmo bucket) vira key. URL de qualquer outro bucket — inclusive o
      // antigo storage-click-dev — nunca é apagada por aqui.
      let key: string;
      const doBucket = this.keyDoBucket(url);
      if (doBucket) {
        key = doBucket;
      } else if (this.publicUrl && url.startsWith(this.publicUrl + '/')) {
        key = url.slice(this.publicUrl.length).replace(/^\/+/, '');
      } else if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
        this.logger.warn('deleteUrl: URL fora do storage público, ignorada.');
        return false;
      } else {
        key = url.replace(/^\/+/, '');
      }
      key = key.split(/[?#]/)[0];

      if (!key || key.split('/').includes('..')) return false;
      if (!(prefixosPermitidos ?? []).some((p) => key.startsWith(p))) {
        this.logger.warn('deleteUrl: objeto fora da pasta do dono, ignorado.');
        return false;
      }

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
