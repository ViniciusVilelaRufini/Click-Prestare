import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { assertSindicoEstrito, requireTenant } from '../auth/tenant.util';
import { autorDoToken } from '../auth/usuario-do-token.util';
import { SkipAudit } from '../common/interceptors/skip-audit.decorator';
import { InterfoneConfigService } from './interfone-config.service';
import type { AtorConfig } from './interfone-config.service';

/**
 * Configuração do interfone pelo síndico no console. `assertSindicoEstrito`
 * (typeAccess carimbado no login, nunca o `turno` do porteiro) + o condomínio
 * do token. Toda alteração grava INTERFONE_CONFIG no serviço (sem a auditoria
 * automática, que gravaria o corpo cru). Rotas que devolvem senha SIP
 * respondem `no-store`.
 */
@Controller('interfone')
export class InterfoneSindicoController {
  constructor(private readonly svc: InterfoneConfigService) {}

  private condominio(user: JwtPayload | undefined): number {
    assertSindicoEstrito(user, 'configuração do interfone');
    requireTenant(user, 'configuração do interfone');
    return Number(user?.id_condominio);
  }

  private ator(user: JwtPayload | undefined): AtorConfig {
    return { nome: String(user?.nome ?? 'Síndico'), ...autorDoToken(user) };
  }

  @Get('config')
  config(@ReqUser() user: JwtPayload) {
    return this.svc.config(this.condominio(user));
  }

  @SkipAudit()
  @Put('config')
  salvarConfig(@Body() body: any, @ReqUser() user: JwtPayload) {
    return this.svc.salvarConfig(this.condominio(user), body ?? {}, this.ator(user));
  }

  @Get('ramais')
  ramais(@ReqUser() user: JwtPayload) {
    return this.svc.ramais(this.condominio(user));
  }

  @SkipAudit()
  @Put('ramais')
  salvarRamais(@Body() body: any, @ReqUser() user: JwtPayload) {
    return this.svc.salvarRamais(this.condominio(user), body, this.ator(user));
  }

  @Header('Cache-Control', 'no-store')
  @Get('faciais')
  faciais(@ReqUser() user: JwtPayload) {
    return this.svc.faciais(this.condominio(user));
  }

  @Header('Cache-Control', 'no-store')
  @SkipAudit()
  @Put('faciais/:id')
  salvarFacial(@Param('id', ParseIntPipe) id: number, @Body() body: any, @ReqUser() user: JwtPayload) {
    return this.svc.salvarFacial(this.condominio(user), id, body ?? {}, this.ator(user));
  }

  @Header('Cache-Control', 'no-store')
  @SkipAudit()
  @Post('faciais/:id/nova-senha')
  @HttpCode(200)
  novaSenha(@Param('id', ParseIntPipe) id: number, @ReqUser() user: JwtPayload) {
    return this.svc.novaSenha(this.condominio(user), id, this.ator(user));
  }

  /**
   * Grava conta SIP + lista telefônica no facial Intelbras pelo Agente Local
   * (G1). Responde 200 com `{ok, erro?, servidor_atual?, parcial?, restantes?,
   * conflitos?, avisos?}`: a falha do aparelho é resultado, não erro HTTP; 409
   * `indisponivel` sem a flag ou com agente antigo. Auditoria própria no
   * serviço (sem a senha).
   */
  @Header('Cache-Control', 'no-store')
  @SkipAudit()
  @Post('faciais/:id/configurar')
  @HttpCode(200)
  configurarFacial(@Param('id', ParseIntPipe) id: number, @Body() body: { forcar?: boolean } | undefined, @ReqUser() user: JwtPayload) {
    // `forcar`: o síndico confirmou substituir a conta SIP de outro servidor.
    return this.svc.configurarFacialAutomatico(this.condominio(user), id, this.ator(user), { forcar: body?.forcar === true });
  }

  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="lista-telefonica.csv"')
  @Header('Cache-Control', 'no-store')
  @Get('faciais/:id/lista-telefonica.csv')
  listaTelefonica(@Param('id', ParseIntPipe) id: number, @ReqUser() user: JwtPayload) {
    return this.svc.listaTelefonica(this.condominio(user), id);
  }

  @Header('Cache-Control', 'no-store')
  @Get('monitores')
  monitores(@ReqUser() user: JwtPayload) {
    return this.svc.monitores(this.condominio(user));
  }

  @Header('Cache-Control', 'no-store')
  @SkipAudit()
  @Post('monitores')
  criarMonitor(@Body() body: any, @ReqUser() user: JwtPayload) {
    return this.svc.criarMonitor(this.condominio(user), body ?? {}, this.ator(user));
  }

  @SkipAudit()
  @Delete('monitores/:id')
  removerMonitor(@Param('id', ParseIntPipe) id: number, @ReqUser() user: JwtPayload) {
    return this.svc.removerMonitor(this.condominio(user), id, this.ator(user));
  }
}
