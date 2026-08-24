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
 *  - Funcionário mobile: valida via Funcionarios (é da equipe do condomínio).
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

    const tipo = (payload.typeAccess ?? payload.user?.typeAccess ?? (payload as any).role ?? '').toString().toLowerCase();

    if (
      tipo === 'admin' ||
      tipo === 'superadmin' ||
      tipo === 'administrador' ||
      (payload as any).role === 'admin' ||
      (payload.user as any)?.role === 'admin'
    ) {
      return;
    }

    if (tipo === 'sindico' || (payload as any).is_sindico === 1 || payload.user?.is_sindico === 1) {
      const vinc = await this.prisma.sindicos_Condominios.findFirst({
        where: { id_user: userId, id_condominio: condId },
        select: { id: true },
      });
      if (vinc) return;

      // Não há fallback pela tabela Sindicos: ela guarda os dados pessoais do
      // síndico (nome, CPF, telefone) e NÃO tem id_condominio — quem liga
      // síndico a condomínio é só Sindicos_Condominios. A consulta que existia
      // aqui era impossível por construção e o Prisma a rejeitaria em runtime,
      // devolvendo 500 no lugar do 403 desta linha.
      throw new ForbiddenException('Acesso negado: você não administra este condomínio.');
    }

    // Funcionário mobile: o vínculo dele é ser da EQUIPE do condomínio, não
    // morar nele. Sem este ramo ele caía na regra do morador abaixo e levava
    // 403 em tudo que passa por aqui — inclusive o módulo financeiro inteiro.
    // Em produção, 4 dos 6 funcionários não têm apartamento (só passavam os
    // que por acaso também eram morador ou síndico).
    if (
      tipo === 'funcionario' ||
      tipo === 'porteiro' ||
      tipo === 'prestador' ||
      (payload as any).is_funcionario === 1 ||
      payload.user?.is_funcionario === 1
    ) {
      if (payload.id_condominio === condId) return;

      const vincFunc = await this.prisma.funcionarios.findFirst({
        where: { id_user: userId, id_condominio: condId },
        select: { id: true },
      });
      if (vincFunc) return;

      const u = await this.prisma.users.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      if (u?.email) {
        const vincPort = await this.prisma.funcionarios_Portaria.findFirst({
          where: { email: u.email, id_condominio: condId },
          select: { id: true },
        });
        if (vincPort) return;
      }

      throw new ForbiddenException('Acesso negado: você não trabalha neste condomínio.');
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
   * Exige que o FUNCIONÁRIO tenha a permissão do módulo ligada.
   *
   * A tabela `Funcionarios` tem um flag por área (`cadastrar_visitante`,
   * `prestadores_servico`, `ocorrencias`, `areas_sociais`…). O app respeita
   * esses flags — `getUserPermission('prestadores_servico') == 1` decide se o
   * botão aparece — mas o servidor nunca os consultava: eles eram enviados no
   * login e checados só na tela. Ou seja, autorização de cliente, que não é
   * autorização: bastava chamar a rota direto para contornar.
   *
   * Em produção isso não era teórico — há funcionário com os dois flags em 0,
   * deliberadamente restringido pelo síndico, que mesmo assim conseguia
   * cadastrar visitante e mexer em prestador pela API.
   *
   * Só se aplica a token de funcionário do APP. Morador e síndico têm regras
   * próprias, e o operador do console (Funcionarios_Portaria) é outra
   * entidade — a portaria existe para fazer exatamente isso.
   */
  async assertPermissaoFuncionario(
    idCondominio: number,
    permissao: 'cadastrar_visitante' | 'prestadores_servico',
    payload?: JwtPayload,
  ): Promise<void> {
    if (!payload) return;

    const tipo = (payload.typeAccess ?? payload.user?.typeAccess ?? '').toString().toLowerCase();
    if (tipo !== 'funcionario') return;
    if (!this.prisma.isConnected) return;

    const userId = Number(payload.user?.id ?? payload.sub);
    if (!userId) throw new ForbiddenException('Acesso negado: sessão sem usuário válido.');

    const func = await this.prisma.funcionarios.findFirst({
      where: { id_user: userId, id_condominio: Number(idCondominio) },
      select: { cadastrar_visitante: true, prestadores_servico: true },
    });
    if (!func) {
      throw new ForbiddenException('Acesso negado: você não trabalha neste condomínio.');
    }
    if (Number(func[permissao] ?? 0) !== 1) {
      throw new ForbiddenException(
        'Acesso negado: seu perfil não tem permissão para esta área. Fale com o síndico.',
      );
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
