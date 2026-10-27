import { Injectable, Logger, Optional, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { JwtPayload } from './jwt-payload.interface';
import { resolveJwtSecret } from './jwt-secret';
import { PrismaService } from '../prisma/prisma.service';
import { ehTokenDeUsuarioApp } from './usuario-app.guard';
import { tokenAnteriorATrocaDeSenha } from './senha-alterada.util';

/** Por quanto tempo a data da última troca de senha fica em cache por usuário. */
const CACHE_TROCA_SENHA_MS = 30_000;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);
  private readonly trocaSenhaCache = new Map<number, { valor: Date | null; expira: number }>();

  constructor(@Optional() private readonly prisma?: PrismaService) {
    super({
      jwtFromRequest: (req: any) => {
        if (!req) return null;
        if (req.headers && req.headers['authorization']) {
          const authHeader = req.headers['authorization'];
          if (authHeader) {
            return authHeader.startsWith('Bearer ')
              ? authHeader.substring(7)
              : authHeader;
          }
        }
        if (req.query && req.query.token) {
          return req.query.token;
        }
        return null;
      },
      ignoreExpiration: false,
      secretOrKey: resolveJwtSecret(),
    });
  }

  /**
   * Token de usuário do app (e de síndico no console, que também tem sub = Users.id) emitido antes da
   * última troca/redefinição de senha é recusado: sem isto, um token de 365 dias sobrevivia à
   * redefinição feita justamente para tirar o acesso de quem o roubou. Token do porteiro do console
   * (sub = Funcionarios_Portaria.id) e do CRM não passam por aqui.
   *
   * Banco indisponível ou erro na consulta: segue aceitando (o app trata 401 como fim de sessão, e uma
   * queda do banco deslogaria todo mundo). A revogação pode atrasar até CACHE_TROCA_SENHA_MS.
   */
  async validate(payload: JwtPayload & { iat?: number }) {
    if (!this.prisma?.isConnected || !ehTokenDeUsuarioApp(payload)) return payload;
    const idUser = Number(payload.user?.id ?? payload.sub);
    if (!idUser) return payload;

    if (tokenAnteriorATrocaDeSenha(payload.iat, await this.senhaAlteradaEm(idUser))) {
      throw new UnauthorizedException('Sessão encerrada porque a senha foi alterada. Entre novamente.');
    }
    return payload;
  }

  private async senhaAlteradaEm(idUser: number): Promise<Date | null> {
    const agora = Date.now();
    const cache = this.trocaSenhaCache.get(idUser);
    if (cache && cache.expira > agora) return cache.valor;
    try {
      const u = await this.prisma!.users.findUnique({
        where: { id: idUser },
        select: { senha_alterada_em: true },
      });
      const valor = u?.senha_alterada_em ?? null;
      if (this.trocaSenhaCache.size > 10_000) this.trocaSenhaCache.clear();
      this.trocaSenhaCache.set(idUser, { valor, expira: agora + CACHE_TROCA_SENHA_MS });
      return valor;
    } catch (e: any) {
      this.logger.warn(`Não foi possível conferir a troca de senha do usuário ${idUser}: ${e?.message ?? e}`);
      // A falha também fica em cache: sem a coluna (SQL não aplicado) ou com o banco instável, não refaz
      // a consulta nem o aviso a cada requisição. Segue aceitando (fail-open).
      if (this.trocaSenhaCache.size > 10_000) this.trocaSenhaCache.clear();
      this.trocaSenhaCache.set(idUser, { valor: null, expira: agora + CACHE_TROCA_SENHA_MS });
      return null;
    }
  }
}