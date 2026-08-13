import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { assertStaff } from './tenant.util';
import type { JwtPayload } from './jwt-payload.interface';

/**
 * Mesmo bug do login por QR ([[qr-session-typeaccess.spec.ts]]), no login por
 * SENHA: o síndico quase sempre tem também um registro em
 * Funcionarios_Portaria com o mesmo login, e `loginPortaria` acha esse
 * registro primeiro. O token emitido por esse caminho saía sem `typeAccess`.
 *
 * Como o console decide o menu pelo `turno` — que no registro do síndico já
 * vinha 'Síndico' — ele entrava, via Financeiro/Relatórios, as telas
 * carregavam (assertOperador aceita qualquer token com id_condominio) e
 * QUALQUER escrita voltava 403 do assertStaff: "alterar status de pagamento
 * exige síndico ou funcionário".
 *
 * O papel gravado no token vem do vínculo conferido no banco, e o `sub` do
 * síndico é o Users.id — `selecionarCondominio` e `changePassword` resolvem o
 * usuário por ele, e `Visitantes.user` é FK para Users.
 */
describe('AuthService.loginPortaria — papel real no token', () => {
  const SENHA = 'senha-certa';
  let hashFuncionario: string;

  beforeAll(async () => {
    hashFuncionario = await bcrypt.hash(SENHA, 4);
  });

  /**
   * @param sindicoEm condomínios que o dono do login administra ([] = não é
   *   síndico). O registro de funcionário é sempre do condomínio 7.
   */
  function build(sindicoEm: number[]) {
    let assinado: JwtPayload | null = null;

    const vinculos = sindicoEm.map((idCond, i) => ({
      id: i + 1,
      id_condominio: idCond,
      condominio: { nome: `Condomínio ${idCond}` },
    }));

    const prisma: any = {
      isConnected: true,
      funcionarios_Portaria: {
        findFirst: jest.fn(async () => ({
          id: 3,
          nome: 'Porteiro Cadastrado',
          login: 'sindico@demo.com',
          password: hashFuncionario,
          turno: 'Síndico',
          id_condominio: 7,
          ativo: 1,
        })),
        update: jest.fn(),
      },
      condominios: { findUnique: jest.fn(async () => ({ nome: 'Edifício Demo' })) },
      sindicos_Condominios: { findMany: jest.fn(async () => []) },
      users: {
        // Uma única mock serve os dois consumidores (sindicoDoLoginNoCondominio
        // e condominiosDoSindicoPorLogin); o filtro por condomínio só existe no
        // primeiro, então respeita o `where` do include como o Prisma faria.
        findFirst: jest.fn(async (args: any) => {
          if (sindicoEm.length === 0) return null;
          const filtro = args?.include?.sindicosCondominios?.where?.id_condominio;
          return {
            id: 42,
            login: 'sindico@demo.com',
            sindicos: [{ name: 'Sindico Railway' }],
            sindicosCondominios:
              filtro === undefined
                ? vinculos
                : vinculos.filter((v) => v.id_condominio === filtro),
          };
        }),
      },
    };

    const jwt: any = {
      sign: jest.fn((p: JwtPayload) => {
        assinado = p;
        return 'token-assinado';
      }),
    };

    const svc = new AuthService(prisma, jwt, { get: jest.fn(), confirm: jest.fn() } as any);
    return { svc, tokenAssinado: () => assinado! };
  }

  it('síndico que também é funcionário recebe typeAccess=Sindico e passa no assertStaff', async () => {
    const { svc, tokenAssinado } = build([7]);
    const res = await svc.loginPortaria('sindico@demo.com', SENHA);

    const token = tokenAssinado();
    expect(token.typeAccess).toBe('Sindico');
    // sub = Users.id, não Funcionarios_Portaria.id (3).
    expect(token.sub).toBe(42);
    expect(token.id_condominio).toBe(7);
    expect(() => assertStaff(token, 'alterar status de pagamento')).not.toThrow();

    expect(res.turno).toBe('Síndico');
    expect(res.nome).toBe('Sindico Railway');
    expect(res.id).toBe(42);
  });

  it('porteiro comum continua SEM typeAccess — sem alçada no financeiro', async () => {
    const { svc, tokenAssinado } = build([]);
    const res = await svc.loginPortaria('porteiro@demo.com', SENHA);

    const token = tokenAssinado();
    expect(token.typeAccess).toBeUndefined();
    expect(token.sub).toBe(3);
    expect(() => assertStaff(token, 'alterar status de pagamento')).toThrow();
    expect(res.condominios).toEqual([]);
  });

  it('síndico de OUTRO condomínio não ganha alçada no condomínio onde é só funcionário', async () => {
    // Administra o 99; o registro de funcionário é do 7.
    const { svc, tokenAssinado } = build([99]);
    await svc.loginPortaria('sindico@demo.com', SENHA);

    const token = tokenAssinado();
    expect(token.typeAccess).toBeUndefined();
    expect(token.id_condominio).toBe(7);
    expect(() => assertStaff(token, 'alterar status de pagamento')).toThrow();
  });
});
