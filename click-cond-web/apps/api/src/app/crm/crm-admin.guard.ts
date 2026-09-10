import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Garante que o token pertence a um administrador do CRM (role 'crm_admin')
 * que AINDA está ativo.
 *
 * O JwtAuthGuard global já valida a assinatura/expiração do token; aqui
 * restringimos as rotas de dados do CRM para que um token de porteiro
 * (que não tem role) não consiga acessar a visão cross-condomínio.
 *
 * A checagem no banco não é redundante com o `ativo: 1` do login. O token do
 * CRM vale 365 dias (`crm-auth.service.ts`) e a role viaja dentro dele, então,
 * enquanto este guard olhava só o claim, **desativar um admin não tirava o
 * acesso dele** — o token continuava válido por até um ano. E este é o painel
 * que ativa condomínio na Superlógica e liga a escrita no ERP, ou seja, o único
 * lugar do sistema que grava no cadastro real da administradora.
 *
 * Uma consulta por requisição é barata aqui: o CRM é painel interno, de tráfego
 * baixo, e a alternativa (expiração curta) exigiria um fluxo de refresh que não
 * existe.
 */
@Injectable()
export class CrmAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user: JwtPayload | undefined = request.user;

    if (user?.role !== 'crm_admin') {
      throw new ForbiddenException('Acesso restrito ao painel do CRM.');
    }

    // Sem banco o projeto inteiro roda em modo mock (dev local). Exigir a
    // consulta aqui derrubaria o CRM em desenvolvimento sem ganho nenhum:
    // não há admin real para desativar.
    if (!this.prisma.isConnected) return true;

    const id = Number(user.sub);
    if (!Number.isFinite(id)) {
      throw new ForbiddenException('Acesso restrito ao painel do CRM.');
    }

    const admin = await this.prisma.crm_Admins.findFirst({
      where: { id, ativo: 1 },
      select: { id: true },
    });

    if (!admin) {
      // Mensagem própria: "restrito ao painel" mandaria o operador procurar
      // problema de permissão, quando o que houve foi desativação da conta.
      throw new ForbiddenException('Sua conta do CRM foi desativada.');
    }

    return true;
  }
}
