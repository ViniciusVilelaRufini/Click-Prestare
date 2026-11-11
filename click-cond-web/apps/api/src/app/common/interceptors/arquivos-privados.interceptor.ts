import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, from } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { StorageService } from '../storage/storage.service';

/** Só objetos literais e arrays são percorridos: Buffer, StreamableFile, Date, Decimal passam intactos. */
function objetoSimples(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

const PROFUNDIDADE_MAX = 12;

/**
 * Chaves cujo valor é arquivo do bucket e sai assinado. São as colunas de
 * arquivo do schema (Areas_Sociais.imagem, Assembleias.anexos,
 * Condominios.photo, Convites_Visita.foto_url, DeliveryEntregadores.foto,
 * Documentos.link_doc, Encomendas.foto_volume/retirado_foto/
 * retirado_assinatura, Financeiro.photo/url_boleto/url_comprovante,
 * Moradores/Pessoas/Prestadores_servico/Visitantes.foto_pessoa/
 * foto_documento, Ocorrencias.anexos, Users.photo/profile_image) e os nomes
 * que os mappers de resposta dão a elas (`photo`, `foto`, `fotoPessoa`,
 * `fotoDocumento`, `url` do upload de boleto/comprovante).
 *
 * Fora daqui NADA é assinado: antes, qualquer string do bucket em qualquer
 * chave virava link — gravar a URL guardada de um arquivo alheio na
 * `descricao` de uma ocorrência (ou no nome de um visitante) devolvia o link
 * assinado.
 */
const CHAVES_DE_ARQUIVO: ReadonlySet<string> = new Set([
  'photo',
  'profile_image',
  'foto',
  'foto_pessoa',
  'foto_documento',
  'fotoPessoa',
  'fotoDocumento',
  'foto_url',
  'imagem',
  'foto_volume',
  'retirado_foto',
  'retirado_assinatura',
  'link_doc',
  'url_boleto',
  'url_comprovante',
  'url',
  'anexos',
]);

/** Guardam vários arquivos numa string só, separados por ';'. */
const CHAVES_MULTIPLAS: ReadonlySet<string> = new Set(['anexos']);

/** Um aviso por chave fora da lista a cada hora (não inunda o log). */
const INTERVALO_AVISO_MS = 60 * 60 * 1000;

/**
 * O bucket de arquivos é privado. Este interceptor é a fronteira:
 *  - na SAÍDA, troca a URL do bucket por um link assinado temporário — só
 *    sob chave de arquivo (CHAVES_DE_ARQUIVO), em qualquer profundidade; item
 *    de array herda a chave do pai;
 *  - na ENTRADA, devolve à forma canônica as URLs assinadas que o cliente
 *    reenvia ao salvar um cadastro, para o banco não guardar um link que expira.
 *
 * Centralizado aqui para não depender de cada endpoint lembrar de assinar.
 */
@Injectable()
export class ArquivosPrivadosInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ArquivosPrivadosInterceptor.name);
  private readonly ultimoAviso = new Map<string, number>();

  constructor(private readonly storage: StorageService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest();
    if (req && req.body !== undefined) req.body = this.normalizar(req.body, 0);
    const rota = `${req?.method ?? ''} ${req?.route?.path ?? req?.path ?? ''}`.trim();

    return next.handle().pipe(mergeMap((corpo) => from(this.assinar(corpo, 0, null, rota))));
  }

  private normalizar(valor: unknown, nivel: number): unknown {
    if (typeof valor === 'string') return this.storage.normalizarUrl(valor);
    if (nivel > PROFUNDIDADE_MAX) return valor;
    if (Array.isArray(valor)) return valor.map((v) => this.normalizar(v, nivel + 1));
    if (objetoSimples(valor)) {
      for (const k of Object.keys(valor)) valor[k] = this.normalizar(valor[k], nivel + 1);
    }
    return valor;
  }

  /** `chave`: a chave do objeto onde o valor está (o item de array herda a do pai); null na raiz. */
  private async assinar(valor: unknown, nivel: number, chave: string | null, rota: string): Promise<unknown> {
    if (typeof valor === 'string') return this.assinarTexto(valor, chave, rota);
    if (nivel > PROFUNDIDADE_MAX) return valor;
    if (Array.isArray(valor)) return Promise.all(valor.map((v) => this.assinar(v, nivel + 1, chave, rota)));
    if (objetoSimples(valor)) {
      // Botão "Abrir boleto" do assistente: `valor` é o url_boleto do lançamento.
      const botaoDeLink = valor['efeito'] === 'abrir_url';
      const saida: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(valor)) {
        const chaveFilho = botaoDeLink && k === 'valor' ? 'url' : k;
        saida[k] = await this.assinar(v, nivel + 1, chaveFilho, rota);
      }
      return saida;
    }
    return valor;
  }

  private async assinarTexto(valor: string, chave: string | null, rota: string): Promise<string> {
    if (chave !== null && CHAVES_DE_ARQUIVO.has(chave)) {
      if (CHAVES_MULTIPLAS.has(chave) && valor.includes(';')) {
        const partes = await Promise.all(valor.split(';').map((p) => this.assinarUma(p)));
        return partes.join(';');
      }
      return this.assinarUma(valor);
    }
    if (/^https?:\/\//i.test(valor) && this.storage.ehArquivoDoBucket(valor)) this.avisar(chave ?? '(raiz)', rota);
    return valor;
  }

  private assinarUma(valor: string): Promise<string> | string {
    return /^https?:\/\//i.test(valor) ? this.storage.assinarUrl(valor) : valor;
  }

  /**
   * URL do bucket sob chave fora da lista: não assina (pode ser texto do
   * cliente) e avisa — se for arquivo legítimo, a chave entra na lista. Só o
   * nome da chave e a rota vão para o log, nunca a URL.
   */
  private avisar(chave: string, rota: string) {
    const agora = Date.now();
    const anterior = this.ultimoAviso.get(chave);
    if (anterior !== undefined && agora - anterior < INTERVALO_AVISO_MS) return;
    this.ultimoAviso.set(chave, agora);
    this.logger.warn(`URL do bucket sob a chave "${chave}" (fora da lista de arquivos) em ${rota}: não assinada.`);
  }
}
