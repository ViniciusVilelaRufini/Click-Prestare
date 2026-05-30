import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query,
} from '@nestjs/common';
import { CreateMoradorDto, MoradoresService } from './moradores.service';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { assertSameTenant } from '../auth/tenant.util';
import { SkipAudit } from '../common/interceptors/skip-audit.decorator';

@Controller('condominios/:idCondominio/moradores')
export class MoradoresController {
  constructor(private readonly service: MoradoresService) {}

  @Get()
  list(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Query('search') search?: string,
    @Query('id_apto') idApto?: string,
  ) {
    return this.service.findAll(idCondominio, search, idApto ? Number(idApto) : undefined);
  }

  @Get('export-excel')
  exportExcel(@Param('idCondominio', ParseIntPipe) idCondominio: number) {
    return this.service.exportExcel(idCondominio);
  }

  @Post('import-bulk')
  importBulk(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Body() body: { linhas: any[] },
  ) {
    return this.service.importBulk(idCondominio, body.linhas);
  }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number, @ReqUser() user: JwtPayload) {
    const morador = await this.service.findOne(id);
    assertSameTenant((morador as any)?.id_condominio, user, `morador #${id}`);
    return morador;
  }

  /**
   * Atividade completa do morador para o painel de detalhes: visitas
   * que convidou, encomendas do apto, ocorrências que abriu, histórico
   * de acessos faciais. Tudo num único request paralelo.
   */
  @Get(':id/atividade')
  async atividade(@Param('id', ParseIntPipe) id: number, @ReqUser() user: JwtPayload) {
    // findOne só pra validar tenant; atividade tem queries paralelas próprias.
    const morador = await this.service.findOne(id);
    assertSameTenant((morador as any)?.id_condominio, user, `morador #${id}`);
    return this.service.atividade(id);
  }

  @SkipAudit()
  @Post()
  create(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Body() body: Omit<CreateMoradorDto, 'id_condominio'>,
    @ReqUser() user: JwtPayload,
  ) {
    return this.service.create({ ...body, id_condominio: idCondominio }, user);
  }

  @SkipAudit()
  @Put(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Partial<CreateMoradorDto>,
    @ReqUser() user: JwtPayload,
  ) {
    const morador = await this.service.findOne(id);
    assertSameTenant((morador as any)?.id_condominio, user, `morador #${id}`);
    return this.service.update(id, body, user);
  }

  @SkipAudit()
  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number, @ReqUser() user: JwtPayload) {
    const morador = await this.service.findOne(id);
    assertSameTenant((morador as any)?.id_condominio, user, `morador #${id}`);
    this.service.remove(id, user);
    return { ok: true };
  }

  @SkipAudit()
  @Post(':id/send-credentials')
  async sendCredentials(@Param('id', ParseIntPipe) id: number, @ReqUser() user: JwtPayload) {
    const morador = await this.service.findOne(id);
    assertSameTenant((morador as any)?.id_condominio, user, `morador #${id}`);
    return this.service.sendCredentials(id, user);
  }
}
