import { Injectable, Logger, Optional, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { JwtPayload } from './jwt-payload.interface';
import { resolveJwtSecret } from './jwt-secret';
import { PrismaService } from '../prisma/prisma.service';
import { ehTokenDeUsuarioApp } from './usuario-app.guard';
import { tokenAnteriorATrocaDeSenha } from './senha-alterada.util';
import { carimboCredencialPortaria } from './credencial-portaria.util';

/** Por quanto tempo a data da última troca de senha fica em cache por usuário. */
const CACHE_TROCA_SENHA_MS = 30_000;
/** Por quanto tempo o "porteiro segue ativo na equipe" fica em cache por token. */
const CACHE_PORTEIRO_MS = 30_000;

/**
 * Única rota em que o JWT ainda pode vir em `?token=`: o download de mídia do
 * WhatsApp no CRM, aberto por `<img>/<video src>` (o navegador não manda
 * cabeçalho Authorization). Em qualquer outra rota o token na URL vazaria para
 * logs do CloudFront/nginx, histórico e Referer (pentest P-08). O realtime lê o
 * token do handshake do Socket.IO, à parte.
 */
const ROTA_TOKEN_NA_QUERY = /^\/api\/crm\/whatsapp\/midias\/\d+$/;

export function extrairJwtDaRequisicao(req: any): string | null {
  if (!req) return null;
  const authHeader = req.headers?.['authorization'];
  if (authHeader) {
    return authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
  }
  const token = req.query?.token;
  if (typeof token !== 'string' || !token) return null;
  const caminho = String(req.originalUrl ?? req.url ?? '').split('?')[0];
  if (req.method === 'GET' && ROTA_TOKEN_NA_QUERY.test(caminho)) return token;
  return null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);
  private readonly trocaSenhaCache = new Map<number, { valor: Date | null; expira: number }>();
  private readonly porteiroCache = new Map<string, { valor: boolean; expira: number }>();

  constructor(@Optional() private readonly prisma?: PrismaService) {
    super({
      jwtFromRequest: extrairJwtDaRequisicao,
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
   * abrindo a porta) até o token vencer. Token de console com sub = Users.id (síndico, QR) é recusado quando
   * o vínculo com o condomínio do token sumiu ou o condomínio foi desativado (vinculoConsoleAtivo). Token do
   * CRM não passa por aqui. Tokens de porteiro emitidos
   * antes de existir tipo_sub (commit ced8f6b4) não são cobertos e vencem sozinhos em até 24h.
   *
   * Banco indisponível ou erro na consulta: segue aceitando (o app trata 401 como fim de sessão, e uma
   * queda do banco deslogaria todo mundo). A revogação pode atrasar até CACHE_TROCA_SENHA_MS /
   * CACHE_PORTEIRO_MS.
   */
  async validate(payload: JwtPayload & { iat?: number }) {
    if (!this.prisma?.isConnected) return payload;

    if (payload.tipo_sub === 'funcionario_portaria') {
      if (!(await this.porteiroAtivo(Number(payload.sub), Number(payload.id_condominio), payload.cred))) {
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
    // Token de CONSOLE com sub = Users.id (síndico na portaria-web, QR Code): o id_condominio do token valia
    // como prova de vínculo pela vida toda dele (24 h) — funcionário removido seguia operando o console e a
    // porta, e condomínio desativado no CRM seguia de pé. Token do app não carrega id_condominio.
    if (payload.id_condominio && !(await this.vinculoConsoleAtivo(idUser, Number(payload.id_condominio), payload))) {
      throw new UnauthorizedException(
        'Sessão encerrada: seu acesso a este condomínio foi removido ou o condomínio foi desativado.',
      );
    }
    return payload;
  }

  /**
   * O usuário do token de console segue vinculado ao condomínio do token, e o condomínio segue ativo:
   * síndico por Sindicos_Condominios, funcionário por Funcionarios (o mesmo critério do
   * assertVinculoCondominio que emitiu o token). Mesmo cache e fail-open do porteiroAtivo, com prefixo
   * próprio na chave: o sub do porteiro é Funcionarios_Portaria.id, outra numeração.
   */
  private async vinculoConsoleAtivo(idUser: number, idCondominio: number, payload: JwtPayload): Promise<boolean> {
    const sindico = (payload.typeAccess ?? payload.user?.typeAccess ?? '').toString().toLowerCase() === 'sindico';
    const chave = `u:${sindico ? 's' : 'f'}:${idUser}:${idCondominio}`;
    const agora = Date.now();
    const cache = this.porteiroCache.get(chave);
    if (cache && cache.expira > agora) return cache.valor;
    let valor = true;
    try {
      const vinculo = sindico
        ? await this.prisma!.sindicos_Condominios.findFirst({
            where: { id_user: idUser, id_condominio: idCondominio, condominio: { ativo: 1 } },
            select: { id: true },
          })
        : await this.prisma!.funcionarios.findFirst({
            where: { id_user: idUser, id_condominio: idCondominio, condominio: { ativo: 1 } },
            select: { id: true },
          });
      valor = !!vinculo;
    } catch (e: any) {
      // Fail-open, como no porteiro: banco instável não derruba todos os consoles.
      this.logger.warn(`Não foi possível conferir o vínculo do usuário ${idUser} com o condomínio ${idCondominio}: ${e?.message ?? e}`);
    }
    if (this.porteiroCache.size > 10_000) this.porteiroCache.clear();
    this.porteiroCache.set(chave, { valor, expira: agora + CACHE_PORTEIRO_MS });
    return valor;
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
   *
   * `cred`: carimbo da credencial com que o porteiro entrou (credencial-portaria.util). Trocar o e-mail (login)
   * ou a senha da linha mantém o id; sem esta comparação a sessão aberta com a credencial antiga seguia valendo
   * até vencer. Token sem `cred` (emitido antes do carimbo existir) segue aceito até vencer, em até 24 h.
   */
  private async porteiroAtivo(idFuncionario: number, idCondominio: number, cred?: string): Promise<boolean> {
    // montarSessaoPortaria sempre carimba os dois; token assinado sem eles não é sessão de porteiro.
    if (!idFuncionario || !idCondominio) return false;
    const chave = `${idFuncionario}:${idCondominio}:${cred ?? ''}`;
    const agora = Date.now();
    const cache = this.porteiroCache.get(chave);
    if (cache && cache.expira > agora) return cache.valor;
    let valor = true;
    try {
      const fp = await this.prisma!.funcionarios_Portaria.findFirst({
        where: { id: idFuncionario, id_condominio: idCondominio, ativo: 1, condominio: { ativo: 1 } },
        select: { id: true, login: true, password: true },
      });
      valor = !!fp && (!cred || carimboCredencialPortaria(fp) === cred);
    } catch (e: any) {
      // Fail-open, como na troca de senha: banco instável não derruba todos os consoles.
      this.logger.warn(`Não foi possível conferir o porteiro ${idFuncionario}: ${e?.message ?? e}`);
    }
    if (this.porteiroCache.size > 10_000) this.porteiroCache.clear();
    this.porteiroCache.set(chave, { valor, expira: agora + CACHE_PORTEIRO_MS });
    return valor;
  }
}
