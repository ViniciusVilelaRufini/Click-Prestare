import { ForbiddenException } from '@nestjs/common';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * `id_apartamento` que vem do corpo (prestador, mudança) é chave estrangeira
 * escolhida pelo cliente. Antes de gravar:
 *  - o apartamento tem de ser do condomínio da entidade (a FK só aponta para
 *    Apartamentos.id e aceitaria apto de outro prédio);
 *  - morador do app só grava apartamento DELE, e nunca "sem unidade" (null é
 *    o diretório do prédio, da administração).
 * Mesma regra do `assertApartamentoDoMorador` do delivery.
 */
type PrismaApartamentos = {
  apartamentos: { findUnique: (a: any) => Promise<{ id_condominio: number } | null> };
  apartamentos_Users: { findFirst: (a: any) => Promise<unknown | null> };
};

/** Morador do app: token sem id_condominio (não é console) e papel que não é síndico/funcionário. */
export function ehMoradorMobile(payload?: JwtPayload): boolean {
  if (!payload) return false;
  const tipo = (payload.typeAccess ?? payload.user?.typeAccess ?? '').toString().toLowerCase();
  return !payload.id_condominio && tipo !== 'sindico' && tipo !== 'funcionario';
}

export async function assertApartamentoGravavel(
  prisma: PrismaApartamentos,
  idApartamento: number | null,
  idCondominio: number,
  payload?: JwtPayload,
): Promise<void> {
  if (idApartamento != null) {
    const apto = await prisma.apartamentos.findUnique({
      where: { id: Number(idApartamento) },
      select: { id_condominio: true },
    });
    if (!apto || Number(apto.id_condominio) !== Number(idCondominio)) {
      throw new ForbiddenException('Apartamento não pertence a este condomínio.');
    }
  }

  if (!ehMoradorMobile(payload)) return;

  if (idApartamento == null) {
    throw new ForbiddenException('Acesso negado: informe um apartamento seu.');
  }
  const userId = Number(payload!.user?.id ?? payload!.sub);
  if (!userId) throw new ForbiddenException('Acesso negado: sessão sem usuário válido.');
  const vinculo = await prisma.apartamentos_Users.findFirst({
    where: { id_user: userId, id_apto: Number(idApartamento) },
    select: { id_apto: true },
  });
  if (!vinculo) {
    throw new ForbiddenException('Acesso negado: este apartamento não é seu.');
  }
}
