import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;

    const ctx = host.switchToHttp();
    const request = ctx.getRequest();
    const response = ctx.getResponse();

    const httpStatus =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    // Extrai mensagem do HttpException corretamente — quando o objeto de resposta
    // tem `message` (BadRequestException, etc.), prefere esse valor.
    let message: string | string[] = 'Erro interno do servidor';

    // Campos EXTRAS do payload do exception, preservados no body final.
    //
    // Por que isto existe: quando alguém lança `new ConflictException({...})`
    // com um payload estruturado (ex.: a lista de reservas atingidas por uma
    // manutenção), este filter global reconstruía o body do zero e o payload
    // sumia na rede — o cliente recebia só `{statusCode, message}` e o fluxo
    // que depende desses campos ficava morto em produção. Agora as chaves
    // próprias do payload sobrevivem ao lado de statusCode/timestamp/path.
    //
    // As chaves reservadas ficam de fora de propósito:
    //  - `statusCode` vem de getStatus();
    //  - `message` é resolvido/sanitizado logo abaixo;
    //  - `error` é o rótulo padrão que o Nest injeta ao receber uma STRING
    //    (`new BadRequestException('texto')` vira `{statusCode, message, error}`).
    //    Ignorá-lo mantém o body de todo o resto da API byte a byte igual ao
    //    de hoje — só payloads de objeto ganham campos.
    const RESERVADAS = new Set(['statusCode', 'message', 'error']);
    const extras: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      const resp = exception.getResponse();
      if (typeof resp === 'string') {
        message = resp;
      } else if (resp && typeof resp === 'object') {
        const m = (resp as any).message;
        if (m) message = m;
        else message = exception.message;
        for (const [chave, valor] of Object.entries(resp as Record<string, unknown>)) {
          if (!RESERVADAS.has(chave)) extras[chave] = valor;
        }
      } else {
        message = exception.message;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    // Sanitiza: nao vaza mensagens de erro de runtime JS engine pro cliente.
    // Essas mensagens (TypeError, RangeError do V8, "Must call super constructor",
    // "Cannot read prop") sao incomprensiveis pro usuario e expoem internos.
    // Substitui por mensagem generica e mantem o erro real nos logs.
    const sanitizeRuntimeError = (m: string | string[]): string | string[] => {
      const check = (s: string) =>
        s.includes('super constructor') ||
        s.includes('Cannot read prop') ||
        s.includes('Cannot read properties') ||
        /^TypeError:/.test(s) ||
        /^RangeError:/.test(s) ||
        /^ReferenceError:/.test(s);
      if (Array.isArray(m)) {
        return m.map((s) => (check(s) ? 'Erro interno do servidor. Tente novamente.' : s));
      }
      return check(m) ? 'Erro interno do servidor. Tente novamente.' : m;
    };
    message = sanitizeRuntimeError(message);

    const responseBody = {
      ...extras,
      statusCode: httpStatus,
      timestamp: new Date().toISOString(),
      path: httpAdapter.getRequestUrl(request),
      message,
    };

    this.logger.error(
      `Http Status: ${httpStatus} Error: ${JSON.stringify(responseBody)}`,
      exception instanceof Error ? exception.stack : '',
    );

    // Em erros 500 (não-HttpException), inclui o stack truncado no body
    // de DEBUG_500 só pra dev — facilita diagnostico remoto sem precisar
    // ver os logs do Railway. Em produção real isso seria removido, mas
    // dado que estamos depurando o erro "Must call super constructor..."
    // sem ter acesso aos logs do Railway, é a única forma rápida.
    if (
      process.env.INCLUDE_500_STACK === 'true' &&
      httpStatus >= 500 &&
      exception instanceof Error &&
      exception.stack
    ) {
      (responseBody as any).debugStack = exception.stack.split('\n').slice(0, 10).join('\n');
    }

    // Garante headers CORS na resposta de erro (Express bypassa o cors middleware
    // quando o filter responde direto via httpAdapter.reply).
    const origin = request?.headers?.origin;
    if (origin && response?.setHeader) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Access-Control-Allow-Credentials', 'true');
      response.setHeader('Vary', 'Origin');
    }

    httpAdapter.reply(response, responseBody, httpStatus);
  }
}
