import { Body, Controller, Get, Param, ParseIntPipe, Patch } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';
import { ReqUser } from './req-user.decorator';
import type { JwtPayload } from './jwt-payload.interface';

/**
 * Aba "Equipe da portaria" do console (Configurações). Lista os logins de portaria do condomínio e deixa o síndico
 * ativar/desativar e mudar o turno. A regra mora no MobileAuthService, ao lado da gestão de funcionários do app
 * (saveFuncionario/removeFuncionario): só síndico pelo typeAccess (assertSindicoEstrito) e isolamento por
 * condomínio (o TenantGuard confere o :idCondominio da URL; o service confere de novo e busca por id + condomínio).
 */
@Controller('condominios/:idCondominio/portaria/equipe')
export class EquipePortariaController {
  constructor(private readonly service: MobileAuthService) {}

  @Get()
  listar(@Param('idCondominio', ParseIntPipe) idCondominio: number, @ReqUser() payload: JwtPayload) {
    return this.service.listarEquipePortaria(idCondominio, payload);
  }

  @Patch(':id')
  alterar(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { ativo?: boolean; turno?: string },
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.alterarLoginPortaria(idCondominio, id, body, payload);
  }
}
