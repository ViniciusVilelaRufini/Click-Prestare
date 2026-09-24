import { Test } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule, ThrottlerException } from '@nestjs/throttler';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { THROTTLERS } from './throttlers';
import { AuthController } from '../../auth/auth.controller';
import { AgentController } from '../../facial/agent.controller';
import {
  FuncionariosMobileController,
  MoradoresMobileController,
  SindicoMobileController,
} from '../../auth/mobile-auth.controller';

/**
 * O ThrottlerGuard lê o override de cada rota pelo NOME do throttler
 * (`THROTTLER:LIMIT` + nome). Os throttlers globais se chamam `short` e
 * `medium`; um `@Throttle({ default: ... })` grava metadado que ninguém lê, e
 * a rota fica só com o limite global (600/min). Foi o que aconteceu com o
 * login da portaria, o login do CRM, a validação de PIN e o chat.
 */
function contexto(handler: Function, classe: Function, ip: string): ExecutionContext {
  const req = { ip, ips: [], headers: {} };
  const res = { header: jest.fn(), setHeader: jest.fn() };
  return {
    getHandler: () => handler,
    getClass: () => classe,
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
}

async function guard(): Promise<ThrottlerGuard> {
  const mod = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot(THROTTLERS)],
    providers: [ThrottlerGuard],
  }).compile();
  const g = mod.get(ThrottlerGuard);
  await g.onModuleInit();
  return g;
}

describe('throttlers — overrides por rota', () => {
  it('login da portaria bloqueia a 6ª tentativa no mesmo minuto', async () => {
    const g = await guard();
    const handler = AuthController.prototype.login;
    for (let i = 0; i < 5; i++) {
      await expect(g.canActivate(contexto(handler, AuthController, '198.51.100.1'))).resolves.toBe(true);
    }
    await expect(g.canActivate(contexto(handler, AuthController, '198.51.100.1'))).rejects.toBeInstanceOf(
      ThrottlerException,
    );
  });

  it('agente facial não é limitado (poll frequente de vários terminais)', async () => {
    const g = await guard();
    const handler = AgentController.prototype.poll;
    for (let i = 0; i < 50; i++) {
      await expect(g.canActivate(contexto(handler, AgentController, '198.51.100.2'))).resolves.toBe(true);
    }
  });

  it('rotas públicas de credencial do app têm limite estrito por minuto', () => {
    // Sem isto, login/recuperação/cadastro do app ficavam só no global
    // (600/min/IP): força-bruta de senha sem nenhum bloqueio de conta.
    const rotas: Array<[Function, string]> = [
      [SindicoMobileController, 'login'],
      [SindicoMobileController, 'signup'],
      [SindicoMobileController, 'recoveryPassword'],
      [MoradoresMobileController, 'login'],
      [MoradoresMobileController, 'recoveryPassword'],
      [FuncionariosMobileController, 'login'],
      [FuncionariosMobileController, 'recoveryPassword'],
    ];
    const frouxas = rotas
      .map(([classe, metodo]) => {
        const limite = Reflect.getMetadata('THROTTLER:LIMITmedium', classe.prototype[metodo]);
        return { rota: `${classe.name}.${metodo}`, limite };
      })
      .filter(({ limite }) => !(typeof limite === 'number' && limite <= 10));
    expect(frouxas).toEqual([]);
  });

  it('nenhum @Throttle/@SkipThrottle referencia throttler inexistente', () => {
    const nomes = new Set(THROTTLERS.map((t) => t.name));
    const raiz = join(__dirname, '..', '..');
    const errados: string[] = [];
    const varrer = (dir: string) => {
      for (const nome of readdirSync(dir)) {
        const caminho = join(dir, nome);
        if (statSync(caminho).isDirectory()) {
          if (nome !== 'generated') varrer(caminho);
          continue;
        }
        if (!nome.endsWith('.ts') || nome.endsWith('.spec.ts')) continue;
        const fonteBruta = readFileSync(caminho, 'utf8');
        const fonte = fonteBruta.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
        for (const m of fonte.matchAll(/@(?:Throttle|SkipThrottle)\(\s*(\{[^)]*\})?\s*\)/g)) {
          const chaves = m[1] ? [...m[1].matchAll(/(\w+)\s*:\s*[{t]/g)].map((c) => c[1]) : ['default'];
          for (const chave of chaves) {
            if (!nomes.has(chave)) errados.push(`${caminho.slice(raiz.length)}: ${chave}`);
          }
        }
      }
    };
    varrer(raiz);
    expect(errados).toEqual([]);
  });
});
