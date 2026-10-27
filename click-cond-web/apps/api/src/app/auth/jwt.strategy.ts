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
/** Por quanto tempo o "porteiro segue ativo na equipe" fica em cache por token. */
const CACHE_PORTEIRO_MS = 30_000;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);
  private readonly trocaSenhaCache = new Map<number, { valor: Date | null; expira: number }>();
  private readonly porteiroCache = new Map<string, { valor: boolean; expira: number }>();

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
   * redefinição feita justamente para tirar o acesso de quem o roubou.
   *
   * Token do porteiro do console (tipo_sub 'funcionario_portaria', sub = Funcionarios_Portaria.id) é
   * recusado quando o porteiro foi removido ou desativado, ou quando o condomínio do token foi desligado.
   * É o mesmo critério do loginPortaria. Sem isto, quem saiu da equipe seguia operando a portaria (e
   * abrindo a porta) até o token vencer. Token do CRM não passa por aqui. Tokens de porteiro emitidos
   * antes de existir tipo_sub (commit ced8f6b4) não são cobertos e vencem sozinhos em até 24h.
   *
   * Banco indisponível ou erro na consulta: segue aceitando (o app trata 401 como fim de sessão, e uma
   * queda do banco deslogaria todo mundo). A revogação pode atrasar até CACHE_TROCA_SENHA_MS /
   * CACHE_PORTEIRO_MS.
   */
  async validate(payload: JwtPayload & { iat?: number }) {
    if (!this.prisma?.isConnected) return payload;

    if (payload.tipo_sub === 'funcionario_portaria') {
      if (!(await this.porteiroAtivo(Number(payload.sub), Number(payload.id_condominio)))) {
        throw new UnauthorizedException('Sessão encerrada: seu acesso à portaria foi removido ou desativado.');
      }
      return payload;
    }

    if (!ehTokenDeUsuarioApp(payload)) return payload;
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

  /**
   * O porteiro do token segue na equipe do condomínio do token, ativo, num condomínio ativo.
   * O resultado (inclusive o negativo e a falha) fica em cache por CACHE_PORTEIRO_MS: um porteiro
   * reativado logo após ser barrado espera até 30 s. Token de porteiro re-emitido por
   * selecionarCondominio para outro condomínio cai aqui e pede novo login, que já sai como síndico.
   */
  private async porteiroAtivo(idFuncionario: number, idCondominio: number): Promise<boolean> {
    // montarSessaoPortaria sempre carimba os dois; token assinado sem eles não é sessão de porteiro.
    if (!idFuncionario || !idCondominio) return false;
    const chave = `${idFuncionario}:${idCondominio}`;
    const agora = Date.now();
    const cache = this.porteiroCache.get(chave);
    if (cache && cache.expira > agora) return cache.valor;
    let valor = true;
    try {
      const fp = await this.prisma!.funcionarios_Portaria.findFirst({
        where: { id: idFuncionario, id_condominio: idCondominio, ativo: 1, condominio: { ativo: 1 } },
        select: { id: true },
      });
      valor = !!fp;
    } catch (e: any) {
      // Fail-open, como na troca de senha: banco instável não derruba todos os consoles.
      this.logger.warn(`Não foi possível conferir o porteiro ${idFuncionario}: ${e?.message ?? e}`);
    }
    if (this.porteiroCache.size > 10_000) this.porteiroCache.clear();
    this.porteiroCache.set(chave, { valor, expira: agora + CACHE_PORTEIRO_MS });
    return valor;
  }
}
