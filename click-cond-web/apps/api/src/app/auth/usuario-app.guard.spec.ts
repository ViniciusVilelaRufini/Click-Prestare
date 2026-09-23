import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import * as mobile from './mobile-auth.controller';
import { UsuarioAppGuard, idUsuarioApp } from './usuario-app.guard';
import type { JwtPayload } from './jwt-payload.interface';
import { ChatIaController } from '../chat-ia/chat-ia.controller';

/**
 * As rotas do app tratam `payload.user?.id ?? payload.sub` como Users.id.
 * Isso só é verdade em token de usuário do app. O porteiro da portaria-web
 * recebe `sub = Funcionarios_Portaria.id` e o admin do CRM `sub = crm_admins.id`
 * — espaços de id diferentes. Com esses tokens a API agia como o Users de
 * mesmo número: `/sindico/update` trocava login/e-mail desse usuário, sem
 * senha, e devolvia um token de 365 dias dele.
 */
const porteiroPortaria: JwtPayload = { sub: 7, nome: 'QA_SECURITY_20260923_porteiro', id_condominio: 3, turno: 'Diurno' };
const crmAdmin: JwtPayload = { sub: 7, nome: 'QA_SECURITY_20260923_crm', role: 'crm_admin' };
const sindicoApp: JwtPayload = { sub: 7, nome: 'QA', typeAccess: 'Sindico', user: { id: 7 } };
const moradorApp: JwtPayload = { sub: 8, nome: 'QA', typeAccess: 'Morador', user: { id: 8 } };
const funcionarioApp: JwtPayload = { sub: 9, nome: 'QA', typeAccess: 'Funcionario', user: { id: 9 } };
const sindicoPortaria: JwtPayload = { sub: 7, nome: 'QA', id_condominio: 3, turno: 'Síndico', typeAccess: 'Sindico' };

function ctx(user: JwtPayload | undefined, publica = false): ExecutionContext {
  const handler = () => undefined;
  if (publica) Reflect.defineMetadata('isPublic', true, handler);
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('UsuarioAppGuard', () => {
  const guard = new UsuarioAppGuard(new Reflector());

  it.each([
    ['porteiro da portaria-web', porteiroPortaria],
    ['admin do CRM', crmAdmin],
  ])('recusa token de %s nas rotas do app', (_n, user) => {
    expect(() => guard.canActivate(ctx(user))).toThrow(ForbiddenException);
  });

  it.each([
    ['síndico do app', sindicoApp],
    ['morador do app', moradorApp],
    ['funcionário do app', funcionarioApp],
    ['síndico na portaria-web (sub = Users.id)', sindicoPortaria],
  ])('aceita token de %s', (_n, user) => {
    expect(guard.canActivate(ctx(user))).toBe(true);
  });

  it('não interfere em rota pública (login, signup, recuperação)', () => {
    expect(guard.canActivate(ctx(undefined, true))).toBe(true);
  });

  it('todo controller do app aplica o guard', () => {
    const controllers = Object.entries(mobile).filter(([nome]) => nome.endsWith('Controller'));
    expect(controllers.length).toBeGreaterThan(5);
    const semGuard = controllers
      .filter(([, classe]) => !(Reflect.getMetadata(GUARDS_METADATA, classe) ?? []).includes(UsuarioAppGuard))
      .map(([nome]) => nome);
    expect(semGuard).toEqual([]);
  });

  it('o chat-IA (só o app usa; histórico indexado por Users.id) aplica o guard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ChatIaController) ?? []).toContain(UsuarioAppGuard);
  });
});

describe('idUsuarioApp', () => {
  it('devolve o Users.id de token do app', () => {
    expect(idUsuarioApp(moradorApp)).toBe(8);
    expect(idUsuarioApp(sindicoPortaria)).toBe(7);
  });

  it('recusa token cujo sub não é Users.id', () => {
    expect(() => idUsuarioApp(porteiroPortaria)).toThrow(ForbiddenException);
    expect(() => idUsuarioApp(crmAdmin)).toThrow(ForbiddenException);
  });
});
