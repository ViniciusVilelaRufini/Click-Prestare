import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ConsentimentosService } from './consentimentos.service';
import { ConsentimentosTerceirosService, TipoPessoaTerceiro } from './consentimentos-terceiros.service';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { assertOperador } from '../auth/tenant.util';

@Controller('consentimentos')
export class ConsentimentosController {
  constructor(private readonly service: ConsentimentosService) {}

  /** O app consulta no login e no bootstrap. */
  @Get('pendentes')
  pendentes(@ReqUser() user: JwtPayload) {
    return this.service.pendentes(user);
  }

  @Post()
  @HttpCode(200)
  registrar(
    @Body() body: { privacidade?: boolean; biometria?: boolean },
    @ReqUser() user: JwtPayload,
  ) {
    return this.service.registrar(user, {
      privacidade: body?.privacidade === true,
      biometria: body?.biometria === true,
    });
  }

  /**
   * Titular revoga a própria biometria pelo aplicativo móvel.
   */
  @Post('revogar-biometria')
  @HttpCode(200)
  revogarBiometria(@ReqUser() user: JwtPayload) {
    return this.service.revogarBiometria(user);
  }
}

@Controller('condominios/:idCondominio/consentimentos')
export class ConsentimentosCondominioController {
  constructor(
    private readonly service: ConsentimentosService,
    private readonly terceirosService: ConsentimentosTerceirosService,
  ) {}

  /**
   * Registro de declaração de consentimento biométrico para terceiros (visitante ou prestador).
   */
  @Post('terceiros')
  @HttpCode(200)
  async registrarTerceiro(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Body()
    body: {
      tipoPessoa: TipoPessoaTerceiro;
      idPessoa: number;
      doc?: string;
      biometria: boolean;
      maiorIdade: boolean;
    },
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'registrar declaração de biometria de terceiros');
    return this.terceirosService.registrar({
      idCondominio,
      tipoPessoa: body.tipoPessoa,
      idPessoa: Number(body.idPessoa),
      doc: body.doc,
      biometria: body.biometria === true,
      maiorIdade: body.maiorIdade === true,
      declaradoPorId: Number(user?.user?.id ?? user?.sub) || null,
      declaradoPorNome: user?.user?.name ?? (user as any)?.nome ?? 'Operador Portaria',
    });
  }

  /**
   * Consulta status de consentimento biométrico de visitante ou prestador.
   */
  @Get('terceiros/status')
  async statusTerceiro(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Query('tipoPessoa') tipoPessoa?: string,
    @Query('idPessoa') idPessoa?: string,
    @Query('doc') doc?: string,
    @ReqUser() user?: JwtPayload,
  ) {
    assertOperador(user, 'consultar status de consentimento de terceiros');
    return this.terceirosService.consultar({
      idCondominio,
      tipoPessoa: (tipoPessoa as TipoPessoaTerceiro) || 'visitante',
      idPessoa: Number(idPessoa || 0),
      doc: doc || null,
    });
  }
}
