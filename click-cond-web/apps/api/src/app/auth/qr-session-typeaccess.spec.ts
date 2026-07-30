import { AuthService } from './auth.service';
import { assertStaff } from './tenant.util';
import type { JwtPayload } from './jwt-payload.interface';

/**
 * O login por QR Code da portaria-web troca o token do app por um token de
 * console (com id_condominio). Esse token saía SEM `typeAccess`, e o módulo
 * financeiro depende dele:
 *
 *   - `assertStaff` (lançar, editar, remover, dar baixa, fechar competência)
 *     exige Sindico/Funcionario → o síndico tomava 403 em tudo;
 *   - `getAll` decide pelo typeAccess se devolve os lançamentos em aberto →
 *     o livro caixa vinha só com o que já estava pago, sem aviso nenhum.
 *
 * Ou seja: entrar por senha funcionava e entrar por QR não. O papel gravado
 * no token vem do vínculo conferido no banco, nunca do token de origem.
 */
describe('AuthService.authorizeQrSession — papel no token de portaria', () => {
  function build(vinculos: { sindico?: boolean; funcionario?: boolean; portaria?: boolean }) {
    let assinado: JwtPayload | null = null;
    const prisma: any = {
      isConnected: true,
      condominios: { findUnique: jest.fn(async () => ({ nome: 'Edifício Demo' })) },
      sindicos_Condominios: { findFirst: jest.fn(async () => (vinculos.sindico ? { id: 1 } : null)) },
      funcionarios: { findFirst: jest.fn(async () => (vinculos.funcionario ? { id: 2 } : null)) },
      funcionarios_Portaria: { findFirst: jest.fn(async () => (vinculos.portaria ? { id: 3 } : null)) },
    };
    const jwt: any = {
      sign: jest.fn((p: JwtPayload) => {
        assinado = p;
        return 'token-assinado';
      }),
    };
    const qrStore: any = {
      get: jest.fn(() => ({ status: 'pending' })),
      confirm: jest.fn(),
    };
    const svc = new AuthService(prisma, jwt, qrStore);
    return { svc, tokenAssinado: () => assinado! };
  }

  it('síndico recebe typeAccess=Sindico e passa no assertStaff do financeiro', async () => {
    const { svc, tokenAssinado } = build({ sindico: true });
    await svc.authorizeQrSession({ sub: 5, nome: 'Ana', typeAccess: 'Sindico' }, 'qr', 1);

    const token = tokenAssinado();
    expect(token.typeAccess).toBe('Sindico');
    expect(token.id_condominio).toBe(1);
    expect(() => assertStaff(token, 'lançar movimento')).not.toThrow();
  });

  it('funcionário da equipe recebe typeAccess=Funcionario', async () => {
    const { svc, tokenAssinado } = build({ funcionario: true });
    await svc.authorizeQrSession({ sub: 6, nome: 'Beto', typeAccess: 'Funcionario' }, 'qr', 1);

    expect(tokenAssinado().typeAccess).toBe('Funcionario');
  });

  it('porteiro do console continua SEM typeAccess — sem alçada no financeiro', async () => {
    const { svc, tokenAssinado } = build({ portaria: true });
    await svc.authorizeQrSession({ sub: 7, nome: 'Carlos', typeAccess: 'Funcionario' }, 'qr', 1);

    const token = tokenAssinado();
    expect(token.typeAccess).toBeUndefined();
    expect(() => assertStaff(token, 'lançar movimento')).toThrow();
  });

  it('não confia no typeAccess do token de origem: quem não é síndico no banco não vira síndico', async () => {
    const { svc, tokenAssinado } = build({ funcionario: true });
    // Token diz "Sindico", mas não há vínculo em Sindicos_Condominios.
    await expect(
      svc.authorizeQrSession({ sub: 8, nome: 'Dani', typeAccess: 'Sindico' }, 'qr', 1),
    ).rejects.toThrow();
    expect(tokenAssinado).toBeDefined();
  });
});
