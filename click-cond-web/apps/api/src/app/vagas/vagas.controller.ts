import {
  Body, Controller, Get, Param, ParseIntPipe, Post,
} from '@nestjs/common';
import { VagasService } from './vagas.service';
import { SkipAudit } from '../common/interceptors/skip-audit.decorator';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { assertOperador } from '../auth/tenant.util';

// Versão canônica (portaria-web) de Vagas — a superfície mobile (VagasMobileController)
// continua servindo o app, escopada ao morador logado; aqui o operador gerencia
// a vaga de qualquer apartamento do condomínio.
@Controller('condominios/:idCondominio/apartamentos/:idApartamento/vagas')
export class VagasController {
  constructor(private readonly service: VagasService) {}

  @Get()
  list(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('idApartamento', ParseIntPipe) idApartamento: number,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'listar as vagas do apartamento');
    return this.service.list(idCondominio, idApartamento);
  }

  @Get('beneficiarios')
  beneficiarios(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('idApartamento', ParseIntPipe) idApartamento: number,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'listar os beneficiários de vaga');
    return this.service.beneficiarios(idCondominio, idApartamento);
  }

  @SkipAudit()
  @Post('liberar')
  liberar(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('idApartamento', ParseIntPipe) idApartamento: number,
    @Body() body: any,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'liberar vaga');
    return this.service.liberar(idCondominio, idApartamento, body);
  }

  @SkipAudit()
  @Post(':id/revogar')
  revogar(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('idApartamento', ParseIntPipe) idApartamento: number,
    @Param('id', ParseIntPipe) id: number,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'revogar vaga');
    return this.service.revogar(idCondominio, idApartamento, id);
  }
}
