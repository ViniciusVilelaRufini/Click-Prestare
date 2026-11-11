import * as bcrypt from 'bcrypt';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { SKIP_AUDIT_KEY } from '../common/interceptors/skip-audit.decorator';
import type { JwtPayload } from './jwt-payload.interface';

/**
 * O login no console da portaria não deixava rastro em audit_logs: nem a sessão
 * emitida, nem a tentativa com senha errada. Agora cada sessão EMITIDA para um
 * condomínio grava uma linha LOGIN (uma por sessão, não por etapa do MFA) e a
 * senha/código errado de conta que existe grava LOGIN_FALHA no(s) condomínio(s)
 * da conta. Conta inexistente não tem condomínio e fica fora. O registro não
 * bloqueia a resposta (não pode virar oráculo de conta existente).
 */
describe('AuthService — login do console no log de auditoria', () => {
  const SENHA = 'senha-certa';
  let hash: string;
  beforeAll(async () => {
    hash = await bcrypt.hash(SENHA, 4);
  });

  const desafio = { mfa_required: true as const, mfa_token: 'mfa-1', email_masked: 'si****@demo.com', expires_in_seconds: 600 };

  /** O registro é disparado sem await: espera a fila de microtarefas/IO esvaziar. */
  const assentar = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  };

  function build(opts: {
    porteiro?: boolean;
    sindico?: boolean;
    confiavel?: boolean;
    condominiosSindico?: number[];
    codigoErrado?: boolean;
    registrar?: jest.Mock;
  }) {
    const usuario = {
      id: 42,
      login: 'conta@demo.com',
      email: 'sindico@demo.com',
      password: hash,
      sindicos: [{ name: 'Sindica', email: 'sindico@demo.com' }],
      sindicosCondominios: (opts.condominiosSindico ?? [7]).map((id, i) => ({
        id: i + 1,
        id_condominio: id,
        condominio: { nome: `C${id}` },
      })),
    };
    const prisma: any = {
      isConnected: true,
      funcionarios_Portaria: {
        findFirst: jest.fn(async () =>
          opts.porteiro
            ? { id: 3, nome: 'Porteiro Zé', login: 'conta@demo.com', password: hash, turno: 'Noite', id_condominio: 7, ativo: 1 }
            : null,
        ),
        update: jest.fn(),
      },
      condominios: { findUnique: jest.fn(async () => ({ nome: 'C7' })) },
      users: {
        findFirst: jest.fn(async () => (opts.sindico ? usuario : null)),
        findUnique: jest.fn(async () => usuario),
        update: jest.fn(),
      },
    };
    const jwt: any = { sign: jest.fn(() => 'token-portaria') };
    const mfa: any = {
      isDeviceTrusted: jest.fn(async () => !!opts.confiavel),
      createChallenge: jest.fn(async () => desafio),
      verifyChallenge: jest.fn(async () => {
        if (opts.codigoErrado) throw new UnauthorizedException('Código incorreto. Restam 4 tentativa(s).');
        return { token: 'token-app-descartado', user: { id: 42 }, device_token: 'dev-1' };
      }),
    };
    const registrar = opts.registrar ?? jest.fn(async () => undefined);
    const auditoria: any = { registrar };
    const svc = new AuthService(prisma, jwt, { get: jest.fn(), confirm: jest.fn() } as any, undefined, mfa, auditoria);
    const linhas = () => registrar.mock.calls.map((c) => c[0]);
    return { svc, registrar, linhas };
  }

  describe('sessão emitida', () => {
    it('porteiro com senha certa: uma linha LOGIN no condomínio dele, autor em Funcionarios_Portaria', async () => {
      const { svc, linhas } = build({ porteiro: true });
      await svc.loginPortaria('conta@demo.com', SENHA);
      await assentar();

      expect(linhas()).toEqual([
        expect.objectContaining({
          id_condominio: 7,
          acao: 'LOGIN',
          modulo: 'auth',
          usuario_nome: 'Porteiro Zé',
          autor_id: 3,
          autor_tipo: 'funcionario_portaria',
          detalhes: { metodo: 'senha', login: 'conta@demo.com' },
        }),
      ]);
    });

    it('síndico que entra pelo registro de portaria: autor é o Users.id', async () => {
      const { svc, linhas } = build({ porteiro: true, sindico: true, confiavel: true });
      await svc.loginPortaria('conta@demo.com', SENHA, 'dev-1');
      await assentar();

      expect(linhas()).toEqual([
        expect.objectContaining({ id_condominio: 7, acao: 'LOGIN', usuario_nome: 'Sindica', autor_id: 42, autor_tipo: 'user' }),
      ]);
    });

    it('síndico sem registro de portaria (fallback), aparelho confiável: uma linha LOGIN por senha', async () => {
      const { svc, linhas } = build({ sindico: true, confiavel: true, condominiosSindico: [7, 8] });
      await svc.loginPortaria('conta@demo.com', SENHA, 'dev-1');
      await assentar();

      // A sessão sai para o primeiro vínculo; o 8 só ganha linha quando for selecionado.
      expect(linhas()).toEqual([
        expect.objectContaining({
          id_condominio: 7,
          acao: 'LOGIN',
          autor_id: 42,
          autor_tipo: 'user',
          detalhes: { metodo: 'senha', login: 'conta@demo.com' },
        }),
      ]);
    });

    it.each([[true], [false]])(
      'MFA: nada na 1ª etapa, UMA linha quando o código confere (registro de portaria: %s)',
      async (porteiro) => {
        const { svc, linhas } = build({ porteiro, sindico: true });
        await svc.loginPortaria('conta@demo.com', SENHA);
        await assentar();
        expect(linhas()).toEqual([]);

        await svc.verificarMfaPortaria('mfa-1', '123456', false);
        await assentar();
        expect(linhas()).toEqual([
          expect.objectContaining({
            id_condominio: 7,
            acao: 'LOGIN',
            modulo: 'auth',
            usuario_nome: 'Sindica',
            autor_id: 42,
            autor_tipo: 'user',
            detalhes: { metodo: 'mfa', login: 'conta@demo.com' },
          }),
        ]);
      },
    );

    it('senha do registro de portaria errada, mas a do síndico certa: é login, não falha', async () => {
      const { svc, linhas } = build({ porteiro: true, sindico: true, confiavel: true });
      // O registro de portaria tem outra senha; o fallback de síndico confere.
      (svc as any).prisma.funcionarios_Portaria.findFirst.mockResolvedValue({
        id: 3, nome: 'Porteiro Zé', login: 'conta@demo.com', password: await bcrypt.hash('outra', 4), turno: 'Noite', id_condominio: 7, ativo: 1,
      });
      const res: any = await svc.loginPortaria('conta@demo.com', SENHA, 'dev-1');
      await assentar();

      expect(res.access_token).toBe('token-portaria');
      expect(linhas().map((l) => l.acao)).toEqual(['LOGIN']);
    });
  });

  describe('tentativa falha', () => {
    it('porteiro com senha errada: LOGIN_FALHA no condomínio dele, sem a senha nos detalhes', async () => {
      const { svc, linhas } = build({ porteiro: true });
      await expect(svc.loginPortaria('conta@demo.com', 'senha-ERRADA-xyz')).rejects.toBeInstanceOf(UnauthorizedException);
      await assentar();

      expect(linhas()).toEqual([
        expect.objectContaining({
          id_condominio: 7,
          acao: 'LOGIN_FALHA',
          modulo: 'auth',
          usuario_nome: 'Porteiro Zé',
          autor_id: 3,
          autor_tipo: 'funcionario_portaria',
          detalhes: { metodo: 'senha', login: 'conta@demo.com' },
        }),
      ]);
      expect(JSON.stringify(linhas())).not.toContain('senha-ERRADA-xyz');
    });

    it('síndico com senha errada: uma linha em cada condomínio ativo que ele administra', async () => {
      const { svc, linhas } = build({ sindico: true, condominiosSindico: [7, 8] });
      await expect(svc.loginPortaria('conta@demo.com', 'errada')).rejects.toBeInstanceOf(UnauthorizedException);
      await assentar();

      expect(linhas()).toEqual([
        expect.objectContaining({ id_condominio: 7, acao: 'LOGIN_FALHA', autor_id: 42, autor_tipo: 'user' }),
        expect.objectContaining({ id_condominio: 8, acao: 'LOGIN_FALHA', autor_id: 42, autor_tipo: 'user' }),
      ]);
    });

    it('porteiro e síndico no mesmo login e condomínio, senha errada: uma linha só por condomínio', async () => {
      const { svc, linhas } = build({ porteiro: true, sindico: true, condominiosSindico: [7, 8] });
      await expect(svc.loginPortaria('conta@demo.com', 'errada')).rejects.toBeInstanceOf(UnauthorizedException);
      await assentar();

      expect(linhas().map((l) => [l.id_condominio, l.acao, l.autor_tipo])).toEqual([
        [7, 'LOGIN_FALHA', 'funcionario_portaria'],
        [8, 'LOGIN_FALHA', 'user'],
      ]);
    });

    it('conta inexistente: não há condomínio, nada é gravado', async () => {
      const { svc, registrar } = build({});
      await expect(svc.loginPortaria('ninguem@demo.com', 'x')).rejects.toBeInstanceOf(UnauthorizedException);
      await assentar();
      expect(registrar).not.toHaveBeenCalled();
    });

    it('código de MFA errado: LOGIN_FALHA sem o código nem o mfa_token, e o erro original segue', async () => {
      const { svc, linhas } = build({ sindico: true, codigoErrado: true, condominiosSindico: [7, 8] });
      await svc.loginPortaria('conta@demo.com', SENHA);
      await expect(svc.verificarMfaPortaria('mfa-1', '987654', false)).rejects.toThrow('Código incorreto');
      await assentar();

      expect(linhas()).toEqual([
        expect.objectContaining({
          id_condominio: 7,
          acao: 'LOGIN_FALHA',
          autor_id: 42,
          autor_tipo: 'user',
          detalhes: { metodo: 'mfa', login: 'conta@demo.com' },
        }),
        expect.objectContaining({ id_condominio: 8, acao: 'LOGIN_FALHA' }),
      ]);
      const texto = JSON.stringify(linhas());
      expect(texto).not.toContain('987654');
      expect(texto).not.toContain('mfa-1');
    });

    it('mfa_token desconhecido: sem conta, sem linha', async () => {
      const { svc, registrar } = build({ sindico: true });
      await expect(svc.verificarMfaPortaria('nao-existe', '123456', false)).rejects.toBeInstanceOf(UnauthorizedException);
      await assentar();
      expect(registrar).not.toHaveBeenCalled();
    });
  });

  describe('não vira oráculo nem derruba o login', () => {
    it('a resposta de senha errada não espera a gravação do log', async () => {
      const registrar = jest.fn(() => new Promise<void>(() => undefined)); // nunca resolve
      const { svc } = build({ porteiro: true, registrar });
      await expect(svc.loginPortaria('conta@demo.com', 'errada')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(registrar).toHaveBeenCalledTimes(1);
    });

    it('falha ao gravar o log não impede a sessão', async () => {
      const registrar = jest.fn(async () => {
        throw new Error('banco fora');
      });
      const { svc } = build({ porteiro: true, registrar });
      const res: any = await svc.loginPortaria('conta@demo.com', SENHA);
      await assentar();
      expect(res.access_token).toBe('token-portaria');
    });

    it('sem AuditoriaService injetado (specs antigos) o login segue igual', async () => {
      const { svc } = build({ porteiro: true });
      (svc as any).auditoria = undefined;
      const res: any = await svc.loginPortaria('conta@demo.com', SENHA);
      expect(res.access_token).toBe('token-portaria');
    });
  });

  describe('outras portas de emissão de sessão', () => {
    function buildTroca() {
      const prisma: any = {
        isConnected: true,
        sindicos_Condominios: {
          findFirst: jest.fn(async ({ where }: any) =>
            where.id_user === 42 && [7, 8].includes(where.id_condominio)
              ? { id: 1, id_condominio: where.id_condominio, condominio: { nome: `C${where.id_condominio}` } }
              : null,
          ),
        },
        condominios: { findUnique: jest.fn(async () => ({ nome: 'C8' })) },
        funcionarios: { findFirst: jest.fn(async () => null) },
      };
      const jwt: any = { sign: jest.fn(() => 'token-novo'), decode: jest.fn(() => ({ exp: 1 })) };
      const qrStore: any = { get: jest.fn(async () => ({ status: 'pending' })), confirm: jest.fn(async () => undefined) };
      const registrar = jest.fn(async () => undefined);
      const svc = new AuthService(prisma, jwt, qrStore, undefined, undefined, { registrar } as any);
      return { svc, registrar, qrStore, linhas: () => registrar.mock.calls.map((c: any[]) => c[0]) };
    }

    it('selecionar-condominio: LOGIN no condomínio escolhido, com o de origem nos detalhes', async () => {
      const { svc, linhas } = buildTroca();
      const sindico: JwtPayload = { sub: 42, nome: 'Sindica', id_condominio: 7, turno: 'Síndico', typeAccess: 'Sindico' };
      await svc.selecionarCondominio(sindico, 8);
      await assentar();

      expect(linhas()).toEqual([
        expect.objectContaining({
          id_condominio: 8,
          acao: 'LOGIN',
          modulo: 'auth',
          usuario_nome: 'Sindica',
          autor_id: 42,
          autor_tipo: 'user',
          detalhes: { metodo: 'troca_condominio', id_condominio_origem: 7 },
        }),
      ]);
    });

    it('selecionar-condominio recusado não grava nada', async () => {
      const { svc, registrar } = buildTroca();
      const sindico: JwtPayload = { sub: 42, nome: 'Sindica', id_condominio: 7, turno: 'Síndico', typeAccess: 'Sindico' };
      await expect(svc.selecionarCondominio(sindico, 99)).rejects.toBeInstanceOf(UnauthorizedException);
      await assentar();
      expect(registrar).not.toHaveBeenCalled();
    });

    it('QR autorizado: LOGIN por qr no condomínio autorizado, sem o qrToken', async () => {
      const { svc, linhas } = buildTroca();
      await svc.authorizeQrSession({ sub: 42, nome: 'Sindica', typeAccess: 'Sindico' }, 'qr-secreto', 8);
      await assentar();

      expect(linhas()).toEqual([
        expect.objectContaining({
          id_condominio: 8,
          acao: 'LOGIN',
          modulo: 'auth',
          usuario_nome: 'Sindica',
          autor_id: 42,
          autor_tipo: 'user',
          detalhes: { metodo: 'qr' },
        }),
      ]);
      expect(JSON.stringify(linhas())).not.toContain('qr-secreto');
    });

    it('QR que outra confirmação levou antes: nenhuma sessão, nenhuma linha', async () => {
      const { svc, registrar, qrStore } = buildTroca();
      qrStore.confirm.mockResolvedValue(false);
      await expect(
        svc.authorizeQrSession({ sub: 42, nome: 'Sindica', typeAccess: 'Sindico' }, 'qr', 8),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      await assentar();
      expect(registrar).not.toHaveBeenCalled();
    });

    it('as duas rotas autenticadas saem do log automático (o service já grava a linha de LOGIN)', () => {
      expect(Reflect.getMetadata(SKIP_AUDIT_KEY, AuthController.prototype.selecionarCondominio)).toBe(true);
      expect(Reflect.getMetadata(SKIP_AUDIT_KEY, AuthController.prototype.authorizeQrSession)).toBe(true);
      // Troca de senha continua no log automático.
      expect(Reflect.getMetadata(SKIP_AUDIT_KEY, AuthController.prototype.changePassword)).toBeUndefined();
    });
  });
});
