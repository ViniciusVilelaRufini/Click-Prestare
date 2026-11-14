import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

/**
 * O filter global reconstrói o body de TODA resposta de erro da API. Um teste
 * que olha só para `exception.getResponse()` não prova nada sobre o que sai na
 * rede — foi assim que um `ConflictException({ conflitos, total })` chegou em
 * produção virando `{"message":"Conflict Exception"}` e matando o fluxo de
 * confirmação da manutenção de área social.
 *
 * Aqui o assert é sobre o body REALMENTE entregue ao httpAdapter.reply().
 */
describe('AllExceptionsFilter — body entregue na rede', () => {
  function build(opts: { origin?: string; url?: string } = {}) {
    const reply = jest.fn();
    const url = opts.url ?? '/areas-sociais/manutencao/insert';
    const filter = new AllExceptionsFilter({
      httpAdapter: { reply, getRequestUrl: () => url },
    } as any);

    const response = { setHeader: jest.fn() };
    const headers = opts.origin ? { origin: opts.origin } : {};
    const host: any = {
      switchToHttp: () => ({
        getRequest: () => ({ headers, originalUrl: url }),
        getResponse: () => response,
      }),
    };

    // Silencia o logger de erro (o filter loga todo erro que passa por ele).
    jest.spyOn((filter as any).logger, 'error').mockImplementation(() => undefined);

    const capturar = (exception: unknown) => {
      filter.catch(exception, host);
      const [, body, status] = reply.mock.calls[reply.mock.calls.length - 1];
      return { body, status };
    };

    return { capturar, reply, response };
  }

  it('payload de objeto: as chaves próprias sobrevivem ao lado de statusCode/timestamp/path', () => {
    const { capturar } = build();
    const conflitos = [
      { id: 1, data: '10/06/2026', hora_de: '10:00', hora_ate: '14:00', bloco: 'A', apto: '101' },
    ];

    const { body, status } = capturar(
      new ConflictException({ conflitos, total: 1, message: 'existem reservas nesta janela' }),
    );

    expect(status).toBe(409);
    expect(body.conflitos).toEqual(conflitos);
    expect(body.total).toBe(1);
    expect(body.message).toBe('existem reservas nesta janela');
    expect(body.statusCode).toBe(409);
    expect(body.path).toBe('/areas-sociais/manutencao/insert');

    // E o body é serializável como veio (nada de perder as chaves no JSON).
    expect(JSON.parse(JSON.stringify(body))).toEqual(
      expect.objectContaining({ conflitos, total: 1 }),
    );
  });

  it('payload de objeto SEM message: ainda assim entrega as chaves próprias', () => {
    const { capturar } = build();
    const { body } = capturar(new ConflictException({ conflitos: [], total: 0 }));
    expect(body.total).toBe(0);
    expect(body.conflitos).toEqual([]);
  });

  it('string continua produzindo exatamente o body de hoje (sem campos novos)', () => {
    const { capturar } = build();
    const { body, status } = capturar(new BadRequestException('texto'));

    expect(status).toBe(400);
    expect(body.message).toBe('texto');
    // Nenhum campo extra: `error: 'Bad Request'` que o Nest injeta ao receber
    // uma string continua fora do body, como sempre esteve.
    expect(Object.keys(body).sort()).toEqual(['message', 'path', 'statusCode', 'timestamp']);
  });

  it('NotFoundException com string mantém a mensagem', () => {
    const { capturar } = build();
    const { body, status } = capturar(new NotFoundException('Área social não encontrada'));
    expect(status).toBe(404);
    expect(body.message).toBe('Área social não encontrada');
    expect(Object.keys(body).sort()).toEqual(['message', 'path', 'statusCode', 'timestamp']);
  });

  it('erro de validação (message array) continua chegando como array', () => {
    const { capturar } = build();
    const { body } = capturar(new BadRequestException({ message: ['nome inválido', 'data inválida'] }));
    expect(body.message).toEqual(['nome inválido', 'data inválida']);
  });

  it('erro não-HTTP vira 500 sanitizado', () => {
    const { capturar } = build();
    const { body, status } = capturar(new TypeError('Cannot read properties of undefined'));
    expect(status).toBe(500);
    expect(body.message).toBe('Erro interno do servidor. Tente novamente.');
  });

  // Erro que não é HttpException é falha interna: o texto original pode trazer
  // a query do Prisma (com valores), a resposta crua de um serviço externo ou
  // caminho de arquivo. Fica no log; o cliente recebe só a mensagem genérica.
  it('erro não-HTTP (Error comum) não devolve a mensagem interna', () => {
    const { capturar } = build();
    const { body, status } = capturar(new Error('[Gemini] HTTP 500: {"detalhe":"interno"}'));
    expect(status).toBe(500);
    expect(body.message).toBe('Erro interno do servidor. Tente novamente.');
  });

  it('erro do Prisma não devolve a query', () => {
    const { capturar } = build();
    const e = new Error('Invalid `prisma.users.findFirst()` invocation: { where: { email: "x@y.z" } }');
    e.name = 'PrismaClientValidationError';
    expect(capturar(e).body.message).toBe('Erro interno do servidor. Tente novamente.');
  });

  it('erro HTTP mantém a mensagem de negócio', () => {
    const { capturar } = build();
    expect(capturar(new BadRequestException('CPF inválido')).body.message).toBe('CPF inválido');
  });
});

describe('AllExceptionsFilter — CORS na resposta de erro', () => {
  function build(opts: { origin?: string; url?: string } = {}) {
    const reply = jest.fn();
    const url = opts.url ?? '/api/moradores';
    const filter = new AllExceptionsFilter({
      httpAdapter: { reply, getRequestUrl: () => url },
    } as any);
    const response = { setHeader: jest.fn() };
    const host: any = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: opts.origin ? { origin: opts.origin } : {}, originalUrl: url }),
        getResponse: () => response,
      }),
    };
    jest.spyOn((filter as any).logger, 'error').mockImplementation(() => undefined);
    filter.catch(new BadRequestException('x'), host);
    return response.setHeader;
  }

  it('origem desconhecida não recebe Access-Control-Allow-Origin', () => {
    const setHeader = build({ origin: 'https://atacante.example' });
    expect(setHeader).not.toHaveBeenCalledWith('Access-Control-Allow-Origin', expect.anything());
  });

  it('origem confiável continua recebendo CORS com credenciais', () => {
    const setHeader = build({ origin: 'https://www.prestarecondominios.com.br' });
    expect(setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://www.prestarecondominios.com.br');
    expect(setHeader).toHaveBeenCalledWith('Access-Control-Allow-Credentials', 'true');
  });

  it('rota de hardware recebe CORS de qualquer origem, sem credenciais', () => {
    const setHeader = build({ origin: 'http://192.168.0.50', url: '/api/facial/webhook/abc' });
    expect(setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'http://192.168.0.50');
    expect(setHeader).not.toHaveBeenCalledWith('Access-Control-Allow-Credentials', 'true');
  });
});

describe('AllExceptionsFilter — path sem query string (pentest P-08)', () => {
  it('não ecoa a query (ex.: ?token=<jwt>) no path do corpo nem no log', () => {
    const reply = jest.fn();
    const url = '/api/condominios/1/moradores?token=eyJsegredo';
    const filter = new AllExceptionsFilter({ httpAdapter: { reply, getRequestUrl: () => url } } as any);
    const log = jest.spyOn((filter as any).logger, 'error').mockImplementation(() => undefined);
    const host: any = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: {}, originalUrl: url }),
        getResponse: () => ({ setHeader: jest.fn() }),
      }),
    };
    filter.catch(new BadRequestException('x'), host);
    const [, body] = reply.mock.calls[0];
    expect(body.path).toBe('/api/condominios/1/moradores');
    expect(JSON.stringify(log.mock.calls)).not.toContain('eyJsegredo');
  });
});
