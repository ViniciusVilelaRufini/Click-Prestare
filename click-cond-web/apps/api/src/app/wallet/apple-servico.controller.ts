import { Body, Controller, Delete, Get, Headers, HttpException, Logger, Param, Post, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../auth/public.decorator';
import { SkipAudit } from '../common/interceptors/skip-audit.decorator';
import { comLock } from '../common/lock-distribuido';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from './wallet.service';
import { PASS_TYPE_ID } from './wallet.constantes';

/** O mínimo da resposta do Express usado aqui (facilita o teste). */
interface Resposta {
  status(codigo: number): Resposta;
  set(nome: string, valor: string): Resposta;
  send(corpo?: unknown): Resposta;
  json(corpo: unknown): Resposta;
  end(): Resposta;
}

const SERIAL = /^c([1-9][0-9]{0,9})$/;
const AUTORIZACAO = /^ApplePass ([A-Za-z0-9_-]{1,200})$/;
/** deviceLibraryIdentifier: texto opaco da Apple; aceito só o que cabe na coluna e não tem barra. */
const APARELHO = /^[A-Za-z0-9._-]{1,100}$/;
/** Token do APNs: hexadecimal. Vai no caminho do pedido ao APNs, então nada além disso entra. */
const PUSH_TOKEN = /^[0-9A-Fa-f]{16,200}$/;
const TAG = /^[0-9]{1,15}$/;
/** Aparelhos por passe: o 11º substitui o mais antigo (um token vazado não vira lista de push sem fim). */
export const MAX_APARELHOS_POR_PASSE = 10;

class Recusa extends Error {
  constructor(readonly codigo: number) {
    super(String(codigo));
  }
}

/**
 * Serviço de atualização de passes da Apple Wallet. O formato das rotas é o
 * da Apple (webServiceURL + /v1/...), documentado em developer.apple.com/
 * documentation/walletpasses ("Adding a Web Service to Update Passes"):
 *
 *  - POST   v1/devices/:device/registrations/:passType/:serial  (ApplePass) 201 | 200 | 401
 *  - GET    v1/devices/:device/registrations/:passType?passesUpdatedSince=  200 | 204
 *  - GET    v1/passes/:passType/:serial                         (ApplePass) 200 | 401
 *  - DELETE v1/devices/:device/registrations/:passType/:serial  (ApplePass) 200 | 401
 *  - POST   v1/log                                                          200
 *
 * A trava é o `authenticationToken` do passe (HMAC derivado do id da
 * credencial), conferido em tempo constante ANTES de qualquer consulta ao
 * banco. Fora do protocolo: série ou Pass Type ID que não são nossos → 404;
 * corpo inválido → 400; banco ou chaves fora → 503. Nunca 500 para entrada
 * de fora. O token, o push token e o código nunca vão para log.
 */
@Controller('wallet/apple')
export class AppleServicoController {
  private readonly logger = new Logger(AppleServicoController.name);

  constructor(
    private readonly wallet: WalletService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @SkipAudit()
  @Throttle({ medium: { limit: 120, ttl: 60_000 } })
  @Post('v1/devices/:deviceId/registrations/:passTypeId/:serial')
  async registrar(
    @Param('deviceId') deviceId: string,
    @Param('passTypeId') passTypeId: string,
    @Param('serial') serial: string,
    @Headers('authorization') autorizacao: string | undefined,
    @Body() corpo: unknown,
    @Res() res: Resposta,
  ): Promise<void> {
    await this.responder(res, async () => {
      const id = this.autenticar(passTypeId, serial, autorizacao);
      if (typeof deviceId !== 'string' || !APARELHO.test(deviceId)) throw new Recusa(400);
      const pushToken = corpo && typeof corpo === 'object' ? (corpo as { pushToken?: unknown }).pushToken : undefined;
      if (typeof pushToken !== 'string' || !PUSH_TOKEN.test(pushToken)) throw new Recusa(400);
      await this.exigirPasse(id);

      const p = this.prisma as any;
      const r = await comLock(
        p,
        `wallet:registro:${id}`,
        async () => {
          const agora = new Date();
          const existente = await p.wallet_Registros.findUnique({
            where: { device_id_id_credencial: { device_id: deviceId, id_credencial: id } },
            select: { id: true },
          });
          if (existente) {
            await p.wallet_Registros.update({
              where: { id: existente.id },
              data: { push_token: pushToken, atualizado_em: agora },
            });
            return 200;
          }
          const atuais: Array<{ id: number }> = await p.wallet_Registros.findMany({
            where: { id_credencial: id },
            select: { id: true },
            orderBy: { atualizado_em: 'asc' },
          });
          const sobra = atuais.length - (MAX_APARELHOS_POR_PASSE - 1);
          if (sobra > 0) {
            await p.wallet_Registros.deleteMany({ where: { id: { in: atuais.slice(0, sobra).map((a) => a.id) } } });
          }
          await p.wallet_Registros.create({
            data: { id_credencial: id, device_id: deviceId, push_token: pushToken, criado_em: agora, atualizado_em: agora },
          });
          return 201;
        },
        { esperaSegundos: 5, duracaoMaximaMs: 15_000 },
      );
      if (!r.obtido) throw new Recusa(503);
      res.status(r.valor).end();
    });
  }

  @Public()
  @SkipAudit()
  @Throttle({ medium: { limit: 120, ttl: 60_000 } })
  @Get('v1/devices/:deviceId/registrations/:passTypeId')
  async listar(
    @Param('deviceId') deviceId: string,
    @Param('passTypeId') passTypeId: string,
    @Query('passesUpdatedSince') desde: string | undefined,
    @Res() res: Resposta,
  ): Promise<void> {
    await this.responder(res, async () => {
      // O protocolo só tem 200 e 204: o que não é nosso não tem passes.
      if (passTypeId !== PASS_TYPE_ID || typeof deviceId !== 'string' || !APARELHO.test(deviceId)) {
        throw new Recusa(204);
      }
      const p = this.prisma as any;
      const registros: Array<{ id_credencial: number }> = await p.wallet_Registros.findMany({
        where: { device_id: deviceId },
        select: { id_credencial: true },
      });
      if (!registros.length) throw new Recusa(204);
      const creds: Array<{ id: number; wallet_atualizado_em: Date | null; criado_em: Date | null }> =
        await p.credenciais_Acesso.findMany({
          where: { id: { in: registros.map((r) => r.id_credencial) }, origem: 'wallet_apple' },
          select: { id: true, wallet_atualizado_em: true, criado_em: true },
        });
      if (!creds.length) throw new Recusa(204);

      const instante = (c: (typeof creds)[number]) => new Date(c.wallet_atualizado_em ?? c.criado_em ?? 0).getTime();
      const tag = typeof desde === 'string' && TAG.test(desde) ? Number(desde) : null;
      const alterados = creds.filter((c) => tag === null || instante(c) > tag);
      if (!alterados.length) throw new Recusa(204);
      res.status(200).json({
        serialNumbers: alterados.map((c) => `c${c.id}`),
        lastUpdated: String(Math.max(...creds.map(instante))),
      });
    });
  }

  @Public()
  @SkipAudit()
  @Throttle({ medium: { limit: 120, ttl: 60_000 } })
  @Get('v1/passes/:passTypeId/:serial')
  async entregar(
    @Param('passTypeId') passTypeId: string,
    @Param('serial') serial: string,
    @Headers('authorization') autorizacao: string | undefined,
    @Res() res: Resposta,
  ): Promise<void> {
    await this.responder(res, async () => {
      const id = this.autenticar(passTypeId, serial, autorizacao);
      const passe = await this.wallet.passeAppleDaCredencial(id);
      if (!passe) throw new Recusa(404);
      // Sempre o passe inteiro (sem 304): o código muda todo dia e o passe é pequeno.
      res
        .status(200)
        .set('Content-Type', 'application/vnd.apple.pkpass')
        .set('Last-Modified', passe.atualizadoEm.toUTCString())
        .set('Cache-Control', 'no-store')
        .send(passe.pkpass);
    });
  }

  @Public()
  @SkipAudit()
  @Throttle({ medium: { limit: 120, ttl: 60_000 } })
  @Delete('v1/devices/:deviceId/registrations/:passTypeId/:serial')
  async remover(
    @Param('deviceId') deviceId: string,
    @Param('passTypeId') passTypeId: string,
    @Param('serial') serial: string,
    @Headers('authorization') autorizacao: string | undefined,
    @Res() res: Resposta,
  ): Promise<void> {
    await this.responder(res, async () => {
      const id = this.autenticar(passTypeId, serial, autorizacao);
      if (typeof deviceId === 'string' && APARELHO.test(deviceId)) {
        await (this.prisma as any).wallet_Registros.deleteMany({ where: { device_id: deviceId, id_credencial: id } });
      }
      res.status(200).end();
    });
  }

  /**
   * Mensagens de erro da Carteira do aparelho (é por aqui que chega o motivo
   * de um passe recusado). Loga a quantidade e o começo da primeira, sem
   * nada que pareça token, push token ou código.
   */
  @Public()
  @SkipAudit()
  @Throttle({ medium: { limit: 120, ttl: 60_000 } })
  @Post('v1/log')
  async log(@Body() corpo: unknown, @Res() res: Resposta): Promise<void> {
    try {
      const logs = corpo && typeof corpo === 'object' ? (corpo as { logs?: unknown }).logs : undefined;
      if (Array.isArray(logs) && logs.length) {
        const primeira = typeof logs[0] === 'string' ? sanitizarLog(logs[0]) : '';
        this.logger.warn(`Carteira (Apple) enviou ${logs.length} mensagem(ns); primeira: "${primeira}"`);
      }
    } catch {
      /* log é melhor esforço */
    }
    res.status(200).end();
  }

  // ===================== Apoio =====================

  /**
   * Formato da série e do Pass Type ID (404) e token (401), nesta ordem e sem
   * tocar no banco. Devolve o id da credencial.
   */
  private autenticar(passTypeId: string, serial: string, autorizacao: string | undefined): number {
    if (passTypeId !== PASS_TYPE_ID) throw new Recusa(404);
    const m = SERIAL.exec(typeof serial === 'string' ? serial : '');
    const id = m ? Number(m[1]) : NaN;
    if (!Number.isSafeInteger(id) || id <= 0 || id > 0xffffffff) throw new Recusa(404);

    const recebido = AUTORIZACAO.exec(typeof autorizacao === 'string' ? autorizacao : '');
    const esperado = this.wallet.tokenDoPasseOuNulo(id);
    if (!recebido || !esperado) throw new Recusa(401);
    const a = Buffer.from(recebido[1]);
    const b = Buffer.from(esperado);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Recusa(401);
    return id;
  }

  /** Token certo mas credencial que não existe (ou não é passe da Apple): 404. */
  private async exigirPasse(id: number): Promise<void> {
    const cred = await (this.prisma as any).credenciais_Acesso.findUnique({
      where: { id },
      select: { id: true, origem: true },
    });
    if (!cred || cred.origem !== 'wallet_apple') throw new Recusa(404);
  }

  private async responder(res: Resposta, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e: any) {
      if (e instanceof Recusa) {
        res.status(e.codigo).end();
        return;
      }
      if (e instanceof HttpException && e.getStatus() < 500) {
        res.status(e.getStatus()).end();
        return;
      }
      if (!(e instanceof HttpException)) {
        // Só nome e código: a mensagem de erro do Prisma pode repetir os
        // argumentos da consulta (o push token, por exemplo).
        this.logger.warn(`Serviço da Carteira (Apple) falhou: ${e?.name ?? 'erro'}${e?.code ? ` (${e.code})` : ''}`);
      }
      res.status(503).end();
    }
  }
}

/** Primeiros 200 caracteres, sem quebras de linha e sem sequências que pareçam segredo. */
export function sanitizarLog(texto: string): string {
  return texto
    .replace(/[0-9A-Fa-f]{20,}/g, '[…]')
    .replace(/[A-Za-z0-9+/_=-]{20,}/g, '[…]')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .slice(0, 200);
}
