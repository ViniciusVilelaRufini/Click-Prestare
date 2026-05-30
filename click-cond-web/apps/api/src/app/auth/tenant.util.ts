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
    throw new ForbiddenException(`Acesso negado: ${contexto} sem condomínio definido`);
  }
  if (entityCondId !== user.id_condominio) {
    throw new ForbiddenException(`Acesso negado: ${contexto} pertence a outro condomínio`);
  }
}
