import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from './jwt-payload.interface';

/**
 * Autorização de tenant "mobile-aware".
 *
 * Diferente do helper `assertSameTenant` (tenant.util.ts), que se auto-desliga
 * quando o JWT não tem `id_condominio` — e por isso NÃO protege a superfície
 * mobile (síndico e morador não carregam id_condominio no token) — este
 * serviço resolve o vínculo de verdade, consultando o banco quando preciso:
 *
 *  - Porteiro / portaria-web: id_condominio fixo no JWT → compara direto.
 *  - Síndico mobile: valida via Sindicos_Condominios.
 *  - Morador mobile: valida via Apartamentos_Users (tem apto no condomínio).
 *
 * Use `assertCondominio` quando o condomínio-alvo já é conhecido (veio da URL
 * ou do body), e `assertEntidade` passando o id_condominio carregado da
 * entidade que se quer ler/escrever.
 */
@Injectable()
export class TenantAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Garante que o usuário autenticado tem vínculo com `idCondominio`.
   * Sem payload (uso interno/sistema) não bloqueia.
   */
  async assertCondominio(idCondominio: number, payload?: JwtPayload): Promise<void> {
    if (!payload) return;

    const condId = Number(idCondominio);
    if (!condId || Number.isNaN(condId)) {
      throw new ForbiddenException('Acesso negado: condomínio inválido.');
    }

    // Porteiro/portaria-web: condomínio fixo no token.
    if (payload.id_condominio) {
      if (payload.id_condominio !== condId) {
        throw new ForbiddenException('Acesso negado: condomínio inválido para esta sessão.');
      }
      return;
    }

    const userId = Number(payload.user?.id ?? payload.sub);
    if (!userId) {
      throw new ForbiddenException('Acesso negado: sessão sem usuário válido.');
    }

    // Banco indisponível: não dá pra confirmar vínculo → nega por segurança.
    if (!this.prisma.isConnected) {
      throw new ForbiddenException('Acesso negado: não foi possível validar o vínculo.');
    }

    const tipo = (payload.typeAccess ?? payload.user?.typeAccess ?? '').toString().toLowerCase();

    if (tipo === 'sindico') {
      const vinc = await this.prisma.sindicos_Condominios.findFirst({
        where: { id_user: userId, id_condominio: condId },
        select: { id: true },
      });
      if (!vinc) {
        throw new ForbiddenException('Acesso negado: você não administra este condomínio.');
      }
      return;
    }

    // Morador mobile: precisa ter ao menos um apartamento neste condomínio.
    const vinc = await this.prisma.apartamentos_Users.findFirst({
      where: { id_user: userId, apartamento: { id_condominio: condId } },
      select: { id_apto: true },
    });
    if (!vinc) {
      throw new ForbiddenException('Acesso negado: você não pertence a este condomínio.');
    }
  }

  /**
   * Atalho semântico para validar a posse de uma entidade já carregada:
   * passe o `id_condominio` da entidade (morador, encomenda, etc.).
   */
  async assertEntidade(
    entidadeCondId: number | null | undefined,
    payload?: JwtPayload,
    contexto = 'recurso',
  ): Promise<void> {
    if (entidadeCondId == null) {
      // Só barra se houver um usuário a quem responsabilizar.
      if (payload) throw new ForbiddenException(`Acesso negado: ${contexto} sem condomínio definido.`);
      return;
    }
    await this.assertCondominio(entidadeCondId, payload);
  }
}
