import { ForbiddenException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import type { JwtPayload } from '../auth/jwt-payload.interface';

export const PAPEL_OPERADOR_CENTRAL = 'operador_central' as const;

/**
 * Token do operador da central: `papel: 'operador_central'`, `sub = Central_Operadores.id` (outra
 * numeração que Users e Funcionarios_Portaria) e nenhum condomínio fixo. Só o CentralAuthService
 * assina esse papel.
 */
export function ehTokenDeOperadorCentral(payload: JwtPayload | null | undefined): boolean {
  return !!payload && payload.papel === PAPEL_OPERADOR_CENTRAL;
}

/**
 * O papel de operador nunca vem junto com as marcas dos outros tokens. Um token assim não foi emitido
 * pelo login da central e não é tratado como de ninguém.
 */
export function tokenDeOperadorBemFormado(payload: JwtPayload): boolean {
  const p: any = payload;
  return (
    ehTokenDeOperadorCentral(payload) &&
    !p.id_condominio &&
    !p.tipo_sub &&
    !p.typeAccess &&
    !p.user?.typeAccess &&
    !p.role
  );
}

/**
 * Operador da central logado. Qualquer outro token (porteiro, síndico, morador, CRM) → 403: o `sub`
 * dele mora em outra tabela.
 *
 * Token com `trocar_senha` (senha temporária ainda não trocada) → 403 `{ motivo: 'trocar_senha' }`:
 * só a rota de troca (`permitirTrocaDeSenha`) aceita, e ela devolve um token sem a marca.
 */
export function operadorDoToken(
  user: JwtPayload | null | undefined,
  opcoes: { permitirTrocaDeSenha?: boolean } = {},
): { uid: number; nome: string } {
  if (!user || !tokenDeOperadorBemFormado(user)) {
    throw new ForbiddenException('Acesso negado: esta área é exclusiva dos operadores da central.');
  }
  const uid = Number(user.sub);
  if (!Number.isInteger(uid) || uid <= 0) {
    throw new ForbiddenException('Acesso negado: sessão da central sem operador válido.');
  }
  if (user.trocar_senha && !opcoes.permitirTrocaDeSenha) {
    throw new ForbiddenException({
      statusCode: 403,
      motivo: 'trocar_senha',
      message: 'Troque a senha temporária antes de usar a central.',
    });
  }
  return { uid, nome: String(user.nome ?? '').trim() };
}

/**
 * O controller é da central (`@Controller('central')` ou `@Controller('central/...')`). Lido da
 * metadata do Nest, não da URL: a sessão do operador só vale nesses controllers (TenantGuard).
 */
export function controllerDaCentral(controller: unknown): boolean {
  if (typeof controller !== 'function') return false;
  const meta = Reflect.getMetadata(PATH_METADATA, controller);
  const caminhos: unknown[] = Array.isArray(meta) ? meta : [meta];
  return caminhos.some((c) => {
    if (typeof c !== 'string') return false;
    const limpo = c.replace(/^\/+|\/+$/g, '');
    return limpo === 'central' || limpo.startsWith('central/');
  });
}
