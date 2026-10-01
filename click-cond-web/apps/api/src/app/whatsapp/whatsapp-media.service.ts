import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { ArquivoWhatsapp } from './whatsapp-graph.client';
import { TipoMidiaSaida, validarMidiaSaida } from './whatsapp-media.validation';

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
    const corpo = await this.lerAteLimite(await this.graph.baixarMidia(mediaId));
    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: chave,
      Body: corpo,
      ContentType: mime,
      ContentLength: corpo.length,
      Metadata: metadados.nome ? { nome: this.nomeSeguro(metadados.nome) } : undefined,
    }));
    return { chave, mime, nome: metadados.nome ? this.nomeSeguro(metadados.nome) : null, tamanho: corpo.length, status: 'armazenada' };
  }

  async guardarSaida({ referencia, tipo, arquivo }: { referencia: string; tipo: TipoMidiaSaida; arquivo: ArquivoWhatsapp }): Promise<MidiaWhatsApp> {
    validarMidiaSaida({ tipo, ...arquivo });
    if (!this.s3) return { chave: null, mime: null, nome: null, tamanho: null, status: 'indisponivel' };
    const chave = `whatsapp/${this.segmentoSeguro(referencia)}/${randomUUID()}`;
    const nome = this.nomeSeguro(arquivo.originalname);
    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket, Key: chave, Body: arquivo.buffer, ContentType: arquivo.mimetype,
      ContentLength: arquivo.buffer.length, Metadata: { nome },
    }));
    return { chave, mime: arquivo.mimetype, nome, tamanho: arquivo.buffer.length, status: 'armazenada' };
  }

  async abrir(chave: string, intervalo?: { inicio: number; fim: number }): Promise<{ stream: Readable; mime: string; nome: string | null; tamanho: number; total: number; inicio: number; fim: number }> {
    if (!/^whatsapp\/[A-Za-z0-9._-]+\/[0-9a-f-]{36}$/.test(chave)) throw new Error('Chave de mídia inválida');
    if (!this.s3) throw new Error('Armazenamento de mídia indisponível');
    const objeto = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: chave, ...(intervalo ? { Range: `bytes=${intervalo.inicio}-${intervalo.fim}` } : {}) }));
    if (!objeto.Body || typeof (objeto.Body as any).pipe !== 'function') throw new Error('Mídia não encontrada');
    const tamanho = Number(objeto.ContentLength ?? 0);
    const contentRange = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(String(objeto.ContentRange ?? ''));
    const inicio = contentRange ? Number(contentRange[1]) : intervalo?.inicio ?? 0;
    const fim = contentRange ? Number(contentRange[2]) : intervalo?.fim ?? Math.max(0, tamanho - 1);
    const total = contentRange ? Number(contentRange[3]) : tamanho;
    return {
      stream: objeto.Body as Readable,
      mime: this.mimePermitido(objeto.ContentType ?? '') ?? 'application/octet-stream',
      nome: objeto.Metadata?.nome ?? null,
      tamanho, total, inicio, fim,
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

  private async lerAteLimite(stream: Readable): Promise<Buffer> {
    let total = 0;
    const partes: Buffer[] = [];
    for await (const chunk of stream) {
      const parte = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += parte.length;
      if (total > this.maxBytes) {
        stream.destroy();
        throw new Error('Mídia excede o limite permitido');
      }
      partes.push(parte);
    }
    return Buffer.concat(partes, total);
  }

  private segmentoSeguro(valor: string): string {
    if (!/^[A-Za-z0-9._-]+$/.test(valor)) throw new Error('wamid inválido');
    return valor;
  }

  private nomeSeguro(valor: string): string {
    return valor.replace(/[\\/:*?"<>|\x00-\x1F]/g, '_').slice(0, 255);
  }
}
