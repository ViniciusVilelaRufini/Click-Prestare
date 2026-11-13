import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { AuthService } from './auth.service';

/**
 * Token de console com sub = Users.id (síndico na portaria-web, QR Code) valia pelo id_condominio que carrega:
 * funcionário removido seguia operando o console (e o relé da porta) até o token vencer, e condomínio
 * desativado no CRM seguia de pé — e ainda emitia sessões novas por QR.
 */
describe('Token de console com sub = Users.id — vínculo revalidado', () => {
  const validar = (s: JwtStrategy, p: any) => Promise.resolve().then(() => s.validate(p));
  const funcionarioQr = { sub: 6, nome: 'F', id_condominio: 7, turno: 'Porteiro (App)', typeAccess: 'Funcionario', iat: 1 };
  const sindicoConsole = { sub: 42, nome: 'S', id_condominio: 7, turno: 'Síndico', typeAccess: 'Sindico', iat: 1 };

  /** Banco simulado: com o condomínio desativado, a consulta que filtra condominio.ativo não acha o vínculo. */
  function prismaCom(v: { sindico?: boolean; funcionario?: boolean; condominioAtivo?: boolean }) {
    const ativo = v.condominioAtivo ?? true;
    const acha = (tem?: boolean) => async ({ where }: any) =>
      tem && (ativo || where.condominio?.ativo !== 1) ? { id: 1 } : null;
    return {
      isConnected: true,
      users: { findUnique: jest.fn(async () => ({ senha_alterada_em: null })) },
      sindicos_Condominios: { findFirst: jest.fn(acha(v.sindico)) },
      funcionarios: { findFirst: jest.fn(acha(v.funcionario)) },
      funcionarios_Portaria: { findFirst: jest.fn(async () => ({ id: 6 })) },
      condominios: { findUnique: jest.fn(async () => ({ nome: 'Edifício Teste' })) },
    } as any;
  }
  function strategy(prisma: any) {
    const s = new JwtStrategy(prisma);
    (s as any).logger = { warn: jest.fn() };
    return s;
  }

  describe('JwtStrategy', () => {
    it('recusa o token de QR de funcionário removido da equipe', async () => {
      const prisma = prismaCom({ funcionario: false });
      await expect(validar(strategy(prisma), funcionarioQr)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.funcionarios.findFirst).toHaveBeenCalledWith({
        where: { id_user: 6, id_condominio: 7, condominio: { ativo: 1 } },
        select: { id: true },
      });
    });

    it('recusa o token de síndico do console quando o condomínio foi desativado', async () => {
      const prisma = prismaCom({ sindico: true, condominioAtivo: false });
      await expect(validar(strategy(prisma), sindicoConsole)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('aceita síndico e funcionário com vínculo ativo', async () => {
      const prisma = prismaCom({ sindico: true, funcionario: true });
      const s = strategy(prisma);
      await expect(validar(s, sindicoConsole)).resolves.toBe(sindicoConsole);
      await expect(validar(s, funcionarioQr)).resolves.toBe(funcionarioQr);
    });

    it('resultado fica em cache: dois validates na janela consultam o banco uma vez só', async () => {
      const prisma = prismaCom({ sindico: true });
      const s = strategy(prisma);
      await validar(s, sindicoConsole);
      await validar(s, sindicoConsole);
      expect(prisma.sindicos_Condominios.findFirst).toHaveBeenCalledTimes(1);
    });

    it('erro na consulta segue aceitando (fail-open) e também fica em cache', async () => {
      const prisma = prismaCom({});
      prisma.sindicos_Condominios.findFirst.mockImplementation(async () => {
        throw new Error('Connection lost');
      });
      const s = strategy(prisma);
      await expect(validar(s, sindicoConsole)).resolves.toBe(sindicoConsole);
      await expect(validar(s, sindicoConsole)).resolves.toBe(sindicoConsole);
      expect(prisma.sindicos_Condominios.findFirst).toHaveBeenCalledTimes(1);
    });

    it('cache do porteiro não vale para o token de usuário com o mesmo número', async () => {
      const prisma = prismaCom({ funcionario: false });
      const s = strategy(prisma);
      // Porteiro 6 (Funcionarios_Portaria.id) ativo no condomínio 7 → chave "6:7" em cache como true.
      await validar(s, { sub: 6, nome: 'P', id_condominio: 7, tipo_sub: 'funcionario_portaria', iat: 1 });
      await expect(validar(s, funcionarioQr)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('token do app (sem id_condominio) não consulta vínculo', async () => {
      const prisma = prismaCom({});
      await expect(validar(strategy(prisma), { sub: 42, nome: 'S', typeAccess: 'Sindico', iat: 1 })).resolves.toBeTruthy();
      expect(prisma.sindicos_Condominios.findFirst).not.toHaveBeenCalled();
      expect(prisma.funcionarios.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('AuthService.authorizeQrSession', () => {
    it.each([
      ['Sindico', { sindico: true }],
      ['Funcionario', { funcionario: true }],
    ])('não emite sessão de console (%s) para condomínio desativado', async (papel, vinculo) => {
      const prisma = prismaCom({ ...vinculo, condominioAtivo: false });
      const jwt: any = { sign: jest.fn(() => 'token') };
      const qrStore: any = { get: jest.fn(async () => ({ status: 'pending' })), confirm: jest.fn(async () => true) };
      const svc = new AuthService(prisma, jwt, qrStore);
      await expect(svc.authorizeQrSession({ sub: 5, nome: 'X', typeAccess: papel } as any, 'qr', 7)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(jwt.sign).not.toHaveBeenCalled();
    });
  });
});
