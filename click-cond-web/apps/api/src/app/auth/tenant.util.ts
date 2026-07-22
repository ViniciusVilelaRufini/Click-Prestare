import { ForbiddenException } from '@nestjs/common';
import { JwtPayload } from './jwt-payload.interface';

/**
 * Garante que a entidade pertence ao condomínio do usuário autenticado.
 *
 * Use nos services quando o endpoint não tem :idCondominio na URL — ex:
 * `GET /facial/devices/:id`, `PUT /moradores/:id`. Sem essa checagem, o
 * porteiro pode editar um morador de outro condomínio chutando IDs.
 *
 * @param entityCondId id_condominio da entidade carregada do banco
 * @param user JWT do usuário (do @ReqUser)
 * @param contexto descrição curta para a mensagem de erro
 */
export function assertSameTenant(
  entityCondId: number | null | undefined,
  user: JwtPayload | undefined,
  contexto = 'recurso',
): void {
  // Sem JWT (rota pública) ou JWT sem condomínio (síndico mobile): não bloqueia.
  // Síndico tem fluxo próprio que deve validar via Users x Condominios.
  if (!user?.id_condominio) return;

  if (entityCondId == null) {
    throw new ForbiddenException(
      `Acesso negado: ${contexto} sem condomínio definido`,
    );
  }
  if (entityCondId !== user.id_condominio) {
    throw new ForbiddenException(
      `Acesso negado: ${contexto} pertence a outro condomínio`,
    );
  }
}

/**
 * Exige que a sessão tenha um condomínio vinculado. Diferente de
 * assertSameTenant (que é leniente com token sem id_condominio para os fluxos
 * de síndico mobile), este BLOQUEIA quando não há id_condominio.
 *
 * Use em endpoints sensíveis e exclusivos do portal (gestão de dispositivos,
 * envio de fotos para o facial), onde nunca deve haver acesso sem condomínio.
 */
export function requireTenant(
  user: JwtPayload | undefined,
  contexto = 'recurso',
): void {
  if (!user?.id_condominio) {
    throw new ForbiddenException(
      `Acesso negado: ${contexto} exige uma sessão vinculada a um condomínio`,
    );
  }
}

/**
 * Versão ESTRITA do assertSameTenant: além de comparar o condomínio, recusa
 * sessões sem id_condominio. Fecha o caminho teórico de um token mobile
 * (sem condomínio) acionar ações de outro tenant.
 */
export function assertTenantStrict(
  entityCondId: number | null | undefined,
  user: JwtPayload | undefined,
  contexto = 'recurso',
): void {
  requireTenant(user, contexto);
  assertSameTenant(entityCondId, user, contexto);
}

/**
 * Garante que o usuário autenticado é Síndico ou Funcionário (staff).
 *
 * Use em ações administrativas do financeiro (lançar, editar, remover,
 * marcar como pago, fechar/reabrir competência, etc) que não fazem sentido
 * para um Morador — sem essa checagem, qualquer JWT válido (inclusive de
 * morador) pode acionar a rota.
 */
export function assertStaff(user: JwtPayload | undefined, contexto = 'ação'): void {
  const tipo = user?.typeAccess ?? user?.user?.typeAccess;
  if (tipo !== 'Sindico' && tipo !== 'Funcionario') {
    throw new ForbiddenException(`Acesso negado: ${contexto} exige síndico ou funcionário.`);
  }
}
