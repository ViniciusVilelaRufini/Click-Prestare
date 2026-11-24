import { MobileAuthService } from './mobile-auth.service';
import * as bcrypt from 'bcrypt';

/**
 * D3 (varredura 24/11): validarCodigoRedefinicao lia `tentativas`, rodava o bcrypt e só depois
 * incrementava. Uma rajada paralela lia o mesmo contador (0) e TODAS testavam um código: o limite
 * de 5 não valia e o código de 6 dígitos podia ser adivinhado em paralelo. Agora cada chamada
 * reserva a tentativa num updateMany condicional antes do bcrypt (padrão do MFA).
 */
describe('validarCodigoRedefinicao — rajada paralela', () => {
  const CODIGO = '424242';

  function montar() {
    // Banco falso com o mesmo efeito do MySQL: cada updateMany confere o where e grava de uma vez.
    const linha: any = {
      id: 7,
      ticket_id: 'tk',
      codigo_hash: bcrypt.hashSync(CODIGO, 4),
      tentativas: 0,
      usado_em: null as Date | null,
      verificado_em: null as Date | null,
      reset_token_hash: null as string | null,
      expira_em: new Date(Date.now() + 10 * 60 * 1000),
    };
    const casa = (w: any) =>
      (w.id === undefined || w.id === linha.id) &&
      (!('usado_em' in w) || (w.usado_em === null ? linha.usado_em === null : true)) &&
      (w.tentativas?.lt === undefined || linha.tentativas < w.tentativas.lt) &&
      (w.expira_em?.gt === undefined || linha.expira_em > w.expira_em.gt);
    const aplica = (data: any) => {
      for (const [k, v] of Object.entries<any>(data)) {
        if (v && typeof v === 'object' && 'increment' in v) linha[k] += v.increment;
        else linha[k] = v;
      }
    };
    const prisma: any = {
      redefinicoes_Senha: {
        findFirst: jest.fn(async ({ where }: any) => {
          await new Promise((r) => setImmediate(r));
          return casa({ usado_em: where.usado_em, expira_em: where.expira_em }) ? { ...linha } : null;
        }),
        update: jest.fn(async ({ data }: any) => {
          aplica(data);
          return { ...linha };
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (!casa(where)) return { count: 0 };
          aplica(data);
          return { count: 1 };
        }),
      },
    };
    const svc = new MobileAuthService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    const compare = jest.spyOn(bcrypt, 'compare');
    return { svc, linha, compare };
  }

  afterEach(() => jest.restoreAllMocks());

  it('20 códigos ao mesmo tempo: no máximo 5 são conferidos e o certo, fora das 5 vagas, não passa', async () => {
    const { svc, linha, compare } = montar();
    // 20 palpites diferentes; o código certo vai na 11ª posição (fora das 5 primeiras vagas).
    const palpites = Array.from({ length: 20 }, (_, i) => (i === 10 ? CODIGO : String(100000 + i)));

    const resultados = await Promise.allSettled(palpites.map((c) => svc.validarCodigoRedefinicao('tk', c)));

    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(0);
    expect(compare.mock.calls.length).toBeLessThanOrEqual(5);
    expect(linha.tentativas).toBe(5);
    expect(linha.reset_token_hash).toBeNull();
    // Sem vaga, o ticket foi invalidado.
    expect(linha.usado_em).not.toBeNull();
  });

  it('código certo dentro das vagas continua validando', async () => {
    const { svc, linha } = montar();
    const r = await svc.validarCodigoRedefinicao('tk', CODIGO);
    expect(r.success).toBe(true);
    expect(linha.tentativas).toBe(1);
    expect(linha.reset_token_hash).not.toBeNull();
    expect(linha.usado_em).toBeNull();
  });

  it('ticket invalidado entre a reserva e a gravação não emite reset_token', async () => {
    const { svc, linha, compare } = montar();
    compare.mockImplementation(async () => {
      linha.usado_em = new Date(); // pedido de código novo invalidou este no meio do bcrypt
      return true as any;
    });
    await expect(svc.validarCodigoRedefinicao('tk', CODIGO)).rejects.toThrow(
      'Código incorreto ou expirado. Confira o código ou solicite um novo.',
    );
    expect(linha.reset_token_hash).toBeNull();
  });
});
