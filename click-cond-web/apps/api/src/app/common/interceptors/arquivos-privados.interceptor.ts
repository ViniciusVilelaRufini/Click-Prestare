import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
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
 * O bucket de arquivos é privado. Este interceptor é a fronteira:
 *  - na SAÍDA, troca toda URL do bucket por um link assinado temporário
 *    (fotos de rosto, documentos e comprovantes não ficam mais abertos para
 *    quem tiver a URL);
 *  - na ENTRADA, devolve à forma canônica as URLs assinadas que o cliente
 *    reenvia ao salvar um cadastro, para o banco não guardar um link que expira.
 *
 * Centralizado aqui para não depender de cada endpoint lembrar de assinar.
 */
@Injectable()
export class ArquivosPrivadosInterceptor implements NestInterceptor {
  constructor(private readonly storage: StorageService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest();
    if (req && req.body !== undefined) req.body = this.normalizar(req.body, 0);

    return next.handle().pipe(mergeMap((corpo) => from(this.assinar(corpo, 0))));
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

  private async assinar(valor: unknown, nivel: number): Promise<unknown> {
    if (typeof valor === 'string') return /^https?:\/\//i.test(valor) ? this.storage.assinarUrl(valor) : valor;
    if (nivel > PROFUNDIDADE_MAX) return valor;
    if (Array.isArray(valor)) return Promise.all(valor.map((v) => this.assinar(v, nivel + 1)));
    if (objetoSimples(valor)) {
      const saida: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(valor)) saida[k] = await this.assinar(v, nivel + 1);
      return saida;
    }
    return valor;
  }
}
