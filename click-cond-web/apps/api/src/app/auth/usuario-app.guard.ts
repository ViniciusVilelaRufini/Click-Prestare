import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { JwtPayload } from './jwt-payload.interface';

const PAPEIS_DO_APP = new Set(['sindico', 'morador', 'funcionario']);

/**
 * O `sub` só é um Users.id em token de usuário do app (síndico, morador,
 * funcionário) — inclusive o do síndico logado na portaria-web, que carrega
 * typeAccess 'Sindico' e sub = Users.id.
 *
 * Os outros tokens usam outro espaço de ids: o porteiro da portaria-web tem
 * `sub = Funcionarios_Portaria.id` e nenhum typeAccess; o admin do CRM tem
 * `sub = crm_admins.id` e role 'crm_admin'. Tratá-los como Users.id fazia a
 * API agir como o usuário de mesmo número.
 */
export function ehTokenDeUsuarioApp(payload: JwtPayload | undefined): boolean {
  if (!payload || payload.role === 'crm_admin') return false;
  const tipo = (payload.typeAccess ?? payload.user?.typeAccess ?? '').toString().toLowerCase();
  return PAPEIS_DO_APP.has(tipo);
}

/** Users.id do token, recusando tokens cujo `sub` pertence a outra tabela. */
export function idUsuarioApp(payload: JwtPayload | undefined): number {
  if (!ehTokenDeUsuarioApp(payload)) {
    throw new ForbiddenException('Acesso negado: esta rota é exclusiva do aplicativo.');
  }
  const id = Number(payload?.user?.id ?? payload?.sub);
  if (!id) throw new ForbiddenException('Acesso negado: sessão sem usuário válido.');
  return id;
}

/**
 * Papel do usuário do app como o token o declara. Usado quando a resposta
 * emite um token novo (troca de senha): o papel vem de quem chamou, nunca do
 * nome da rota.
 */
export function papelUsuarioApp(payload: JwtPayload | undefined): 'Sindico' | 'Morador' | 'Funcionario' {
  idUsuarioApp(payload);
  const tipo = (payload?.typeAccess ?? payload?.user?.typeAccess ?? '').toString().toLowerCase();
  return tipo === 'sindico' ? 'Sindico' : tipo === 'funcionario' ? 'Funcionario' : 'Morador';
}

/**
 * Aplicado nos controllers do app (mobile-auth.controller.ts), que resolvem o
 * usuário por `payload.user?.id ?? payload.sub`. Rotas @Public (login,
 * cadastro, recuperação) passam: não há token a conferir.
 */
@Injectable()
export class UsuarioAppGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const publica = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (publica) return true;

    const user: JwtPayload | undefined = context.switchToHttp().getRequest()?.user;
    idUsuarioApp(user);
    return true;
  }
}
