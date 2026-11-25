import { Body, Controller, Get, HttpCode, Logger, Optional, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { MfaService } from './mfa.service';
import { Public } from '../public.decorator';
import { extractClientIp } from '../../common/context/request-context';
import { AuditoriaService } from '../../auditoria/auditoria.service';

/** Mesmo teto do login do app (mobile-auth.service): um síndico com muitos condomínios não multiplica sem fim. */
const MAX_CONDOMINIOS_AUDITORIA = 10;

@Controller('auth/mfa')
export class MfaController {
  private readonly logger = new Logger(MfaController.name);

  constructor(
    private readonly mfaService: MfaService,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  // 10 por 10 minutos por IP: o código tem 6 dígitos, o limite por desafio sozinho não basta.
  @Throttle({ medium: { limit: 10, ttl: 10 * 60_000 } })
  @Public()
  @Post('verify')
  @HttpCode(200)
  async verify(
    @Body() body: { mfa_token: string; code: string; remember_device?: boolean },
    @Req() req: any,
  ) {
    const userAgent = req.headers?.['user-agent'];
    const ip = extractClientIp(req) || req.ip;

    // Login do síndico pelo app em aparelho não confiável: a conta é lida antes (o desafio some no
    // sucesso). O console não passa por aqui (auth.service chama verifyChallenge e grava o próprio log).
    const conta = this.auditoria ? await this.mfaService.contaDoDesafio(body?.mfa_token) : null;
    try {
      const r = await this.mfaService.verifyChallenge(
        body.mfa_token,
        body.code,
        body.remember_device ?? false,
        { userAgent, ip },
      );
      this.auditar(conta, 'LOGIN');
      return r;
    } catch (e: any) {
      // 401 = código incorreto; 429 = desafio invalidado por excesso de erros. Expirado (400) e banco
      // fora (503) não são tentativa com código errado. Mesma regra do console (auth.service).
      const status = typeof e?.getStatus === 'function' ? e.getStatus() : 0;
      if (status === 401 || status === 429) this.auditar(conta, 'LOGIN_FALHA');
      throw e;
    }
  }

  /** Sem await: a resposta não espera o INSERT e a auditoria nunca derruba o login. Nunca grava o código. */
  private auditar(
    conta: { id_user: number; nome: string; email: string | null; condominios: number[] } | null,
    acao: 'LOGIN' | 'LOGIN_FALHA',
  ): void {
    if (!conta || !this.auditoria) return;
    const ids = [...new Set(conta.condominios)].slice(0, MAX_CONDOMINIOS_AUDITORIA);
    for (const id_condominio of ids) {
      void Promise.resolve()
        .then(() =>
          this.auditoria!.registrar({
            id_condominio,
            usuario_nome: conta.nome,
            usuario_email: conta.email ?? undefined,
            // Rota pública: não há req.user para o registrar tirar o autor.
            autor_id: conta.id_user,
            autor_tipo: 'user',
            acao,
            modulo: 'auth',
            entidade_id: conta.id_user,
            descricao:
              acao === 'LOGIN'
                ? 'Login no app (síndico, código de verificação)'
                : 'Código de verificação incorreto no login do app',
            detalhes: { metodo: 'mfa', app: true },
          }),
        )
        .catch((err: any) => this.logger.warn(`Auditoria do login MFA do app não gravada: ${err?.message ?? err}`));
    }
  }

  @Throttle({ medium: { limit: 10, ttl: 10 * 60_000 } })
  @Public()
  @Post('resend')
  @HttpCode(200)
  async resend(@Body() body: { mfa_token: string }) {
    return this.mfaService.resendChallenge(body.mfa_token);
  }

  // Não é pública (pentest 04/11): cada chamada abre uma conexão SMTP (transporter.verify) e, em
  // falha, devolvia a mensagem crua do servidor de e-mail. Nenhum front-end a usa.
  @Get('health')
  async health() {
    return this.mfaService.checkMailHealth();
  }
}
