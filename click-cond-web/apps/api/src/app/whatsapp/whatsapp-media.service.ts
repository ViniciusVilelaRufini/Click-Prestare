import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';

export interface MidiaEntradaWhatsApp {
  wamid: string;
  tipo: string;
  mediaId: string;
}

export interface MidiaWhatsAppArmazenada {
  chave: string;
  mime: string;
  nome: string | null;
  tamanho: number;
  status: 'armazenada';
}

export interface MidiaWhatsAppIndisponivel {
  chave: null;
  mime: null;
  nome: null;
  tamanho: null;
  status: 'indisponivel';
}

export type MidiaWhatsApp = MidiaWhatsAppArmazenada | MidiaWhatsAppIndisponivel;

interface GraphMidia {
  obterMidia(mediaId: string): Promise<{ mime: string; nome?: string; tamanho: number }>;
  baixarMidia(mediaId: string): Promise<Readable>;
}

interface StorageConfig {
  bucket?: string;
  maxBytes?: number;
}

const MIME_PERMITIDOS = new Set([
  'audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg',
  'image/jpeg', 'image/png', 'image/webp',
  'video/3gpp', 'video/mp4',
  'application/pdf', 'text/plain',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);
const CATEGORIAS_PERMITIDAS = new Set(['audio', 'image', 'video', 'document']);
const LIMITE_PADRAO = 16 * 1024 * 1024;

@Injectable()
export class WhatsappMediaService {
  private readonly bucket: string;
  private readonly maxBytes: number;
  private readonly s3: S3Client | null;

  constructor(
    private readonly graph: GraphMidia,
    s3?: S3Client,
    config?: StorageConfig,
  ) {
    const endpoint = process.env.WA_MEDIA_S3_ENDPOINT;
    const accessKeyId = process.env.WA_MEDIA_S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.WA_MEDIA_S3_SECRET_ACCESS_KEY;
    this.bucket = config?.bucket ?? process.env.WA_MEDIA_S3_BUCKET ?? '';
    this.maxBytes = config?.maxBytes ?? Number(process.env.WA_MEDIA_MAX_BYTES || LIMITE_PADRAO);
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes <= 0) throw new Error('WA_MEDIA_MAX_BYTES inválido');
    this.s3 = this.bucket ? s3 ?? new S3Client({
      region: process.env.WA_MEDIA_S3_REGION || (endpoint ? 'auto' : 'us-east-1'),
      ...(endpoint ? { endpoint } : {}),
      ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    }) : null;
  }

  async guardarEntrada({ wamid, tipo, mediaId }: MidiaEntradaWhatsApp): Promise<MidiaWhatsApp> {
    if (!CATEGORIAS_PERMITIDAS.has(tipo)) throw new Error('Tipo de mídia não permitido');
    if (!wamid || !mediaId) throw new Error('wamid e mediaId são obrigatórios');
    if (!this.s3) return { chave: null, mime: null, nome: null, tamanho: null, status: 'indisponivel' };

    const metadados = await this.graph.obterMidia(mediaId);
    const mime = this.mimePermitido(metadados.mime);
    if (!mime || !this.mimeDaCategoria(tipo, mime)) {
      throw new Error('Tipo de mídia não permitido');
    }
    if (!Number.isSafeInteger(metadados.tamanho) || metadados.tamanho < 0 || metadados.tamanho > this.maxBytes) {
      throw new Error('Mídia excede o limite permitido');
    }

    const chave = `whatsapp/${this.segmentoSeguro(wamid)}/${randomUUID()}`;
    const controleUpload = new AbortController();
    const limite = this.limitarStream(await this.graph.baixarMidia(mediaId), () => controleUpload.abort());
    const envio = this.s3.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: chave,
      Body: limite.stream,
      ContentType: mime,
      ContentLength: metadados.tamanho,
      Metadata: metadados.nome ? { nome: this.nomeSeguro(metadados.nome) } : undefined,
    }), { abortSignal: controleUpload.signal });
    await Promise.race([envio, limite.excedeu]);
    return { chave, mime, nome: metadados.nome ? this.nomeSeguro(metadados.nome) : null, tamanho: metadados.tamanho, status: 'armazenada' };
  }

  async abrir(chave: string): Promise<{ stream: Readable; mime: string; nome: string | null; tamanho: number }> {
    if (!/^whatsapp\/[A-Za-z0-9._-]+\/[0-9a-f-]{36}$/.test(chave)) throw new Error('Chave de mídia inválida');
    if (!this.s3) throw new Error('Armazenamento de mídia indisponível');
    const objeto = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: chave }));
    if (!objeto.Body || typeof (objeto.Body as any).pipe !== 'function') throw new Error('Mídia não encontrada');
    return {
      stream: objeto.Body as Readable,
      mime: this.mimePermitido(objeto.ContentType ?? '') ?? 'application/octet-stream',
      nome: objeto.Metadata?.nome ?? null,
      tamanho: Number(objeto.ContentLength ?? 0),
    };
  }

  private mimePermitido(valor: string): string | null {
    const mime = valor.split(';', 1)[0].trim().toLowerCase();
    return MIME_PERMITIDOS.has(mime) ? mime : null;
  }

  private mimeDaCategoria(tipo: string, mime: string): boolean {
    if (tipo === 'document') return mime.startsWith('application/') || mime === 'text/plain';
    return mime.startsWith(`${tipo}/`);
  }

  private limitarStream(stream: Readable, aoExceder: () => void): { stream: Transform; excedeu: Promise<never> } {
    let total = 0;
    const limite = this.maxBytes;
    let rejeitarExcesso!: (erro: Error) => void;
    const excedeu = new Promise<never>((_resolve, reject) => { rejeitarExcesso = reject; });
    const transform = new Transform({
      transform(chunk, _encoding, callback) {
        total += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
        if (total > limite) {
          const erro = new Error('Mídia excede o limite permitido');
          rejeitarExcesso(erro);
          aoExceder();
          return callback(erro);
        }
        callback(null, chunk);
      },
    });
    return { stream: stream.pipe(transform), excedeu };
  }

  private segmentoSeguro(valor: string): string {
    if (!/^[A-Za-z0-9._-]+$/.test(valor)) throw new Error('wamid inválido');
    return valor;
  }

  private nomeSeguro(valor: string): string {
    return valor.replace(/[\\/:*?"<>|\x00-\x1F]/g, '_').slice(0, 255);
  }
}
