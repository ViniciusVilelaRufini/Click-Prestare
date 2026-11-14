import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { createHash, createHmac } from 'crypto';
import { carimboCredencialPortaria } from './credencial-portaria.util';
import { resolveJwtSecret } from './jwt-secret';

/**
 * I-f1 (revisão final da rodada 2): trocar o e-mail ou re-credenciar um login de portaria mantém o mesmo
 * Funcionarios_Portaria.id, e o JwtStrategy só conferia id/ativo/condomínio — a sessão de console aberta com a
 * credencial antiga seguia valendo até 24 h. Sem schema: o token do porteiro carrega um carimbo da credencial
 * (hash de login + hash da senha) e o JwtStrategy o compara com a linha atual. Apagar e recriar a linha
 * quebraria a autoria de ocorrências e mensagens do porteiro.
 */
describe('Sessão do porteiro × credencial do login de portaria (I-f1)', () => {
  let hashAntigo: string;
  beforeAll(async () => {
    hashAntigo = await bcrypt.hash('senha-antiga', 4);
  });

  function build() {
    const fp: any = { id: 3, nome: 'Porteiro', login: 'p@x.com', email: 'p@x.com', password: hashAntigo, turno: 'Noite', id_condominio: 7, ativo: 1 };
    const prisma: any = {
      isConnected: true,
      funcionarios_Portaria: {
        findFirst: jest.fn(async ({ where }: any) => {
          if (where.login !== undefined) return where.login === fp.login ? { ...fp } : null;
          if (where.id !== fp.id || where.id_condominio !== fp.id_condominio || fp.ativo !== 1) return null;
          return { id: fp.id, login: fp.login, password: fp.password };
        }),
        findUnique: jest.fn(async () => ({ ...fp })),
        update: jest.fn(async ({ data }: any) => Object.assign(fp, data)),
      },
      condominios: { findUnique: jest.fn(async () => ({ nome: 'C7' })) },
      // O login não é de síndico.
      users: { findFirst: jest.fn(async () => null) },
    };
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
    const jwt = new JwtService({ secret: 'test' });
    const auth = new AuthService(prisma, jwt, { get: jest.fn(), confirm: jest.fn() } as any);
    (auth as any).isLocked = jest.fn(async () => false);
    (auth as any).limparFalhas = jest.fn(async () => undefined);
    const nova = () => new JwtStrategy(prisma);
    const validar = (s: JwtStrategy, token: string) => Promise.resolve().then(() => s.validate(jwt.verify(token)));
    return { fp, auth, nova, validar, jwt };
  }

  it('sessão aberta vale enquanto a credencial é a mesma (editar nome/turno não derruba)', async () => {
    const { fp, auth, nova, validar } = build();
    const { access_token } = (await auth.loginPortaria('p@x.com', 'senha-antiga')) as any;
    fp.nome = 'Outro nome';
    fp.turno = 'Manhã';
    await expect(validar(nova(), access_token)).resolves.toBeTruthy();
  });

  it('re-credenciar (senha nova no mesmo id) derruba a sessão já aberta', async () => {
    const { fp, auth, nova, validar } = build();
    const { access_token } = (await auth.loginPortaria('p@x.com', 'senha-antiga')) as any;
    fp.password = await bcrypt.hash('senha-nova', 4);
    await expect(validar(nova(), access_token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('trocar o e-mail (login) no mesmo id derruba a sessão já aberta', async () => {
    const { fp, auth, nova, validar } = build();
    const { access_token } = (await auth.loginPortaria('p@x.com', 'senha-antiga')) as any;
    fp.login = 'novo@x.com';
    await expect(validar(nova(), access_token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('o porteiro que troca a própria senha no console recebe um token novo que continua valendo', async () => {
    const { auth, nova, validar, jwt } = build();
    const { access_token } = (await auth.loginPortaria('p@x.com', 'senha-antiga')) as any;
    const sessao: any = jwt.verify(access_token);
    const res: any = await auth.changePassword(3, 'senha-antiga', 'senha-nova', undefined, sessao);
    expect(res.access_token).toEqual(expect.any(String));
    await expect(validar(nova(), res.access_token)).resolves.toBeTruthy();
    await expect(validar(nova(), access_token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('token de porteiro emitido antes do carimbo (sem `cred`) segue aceito até vencer', async () => {
    const { nova, jwt } = build();
    const legado = jwt.sign({ sub: 3, nome: 'P', id_condominio: 7, tipo_sub: 'funcionario_portaria' });
    await expect(Promise.resolve().then(() => nova().validate(jwt.verify(legado)))).resolves.toBeTruthy();
  });

  it('o carimbo é HMAC com o segredo do JWT (não é um sha256 que qualquer um recalcula)', () => {
    const fp = { login: 'p@x.com', password: '5f4dcc3b5aa765d61d8327deb882cf99' };
    const semSegredo = createHash('sha256').update(`p@x.com\n${fp.password}`).digest('base64url').slice(0, 22);
    const esperado = createHmac('sha256', resolveJwtSecret()).update(`p@x.com\n${fp.password}`).digest('base64url').slice(0, 22);
    expect(carimboCredencialPortaria(fp)).toBe(esperado);
    expect(carimboCredencialPortaria(fp)).not.toBe(semSegredo);
  });
});
