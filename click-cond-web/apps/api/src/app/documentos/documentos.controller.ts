import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { DocumentosService } from './documentos.service';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';

@Controller('documentos')
export class DocumentosController {
  constructor(private readonly service: DocumentosService) {}

  @Post('insert')
  @HttpCode(200)
  insert(@Body() body: { id_condominio: string | number; documento: any }, @ReqUser() payload: JwtPayload) {
    return this.service.insert(Number(body.id_condominio), body.documento, payload);
  }

  @Get('get-all')
  getAll(
    @Query('id_condominio') idCondominio: string,
    @Query('is_ata') isAta: string,
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.getAll(Number(idCondominio), isAta, payload);
  }

  @Post('remove')
  @HttpCode(200)
  remove(@Body() body: { id: string | number }, @ReqUser() payload: JwtPayload) {
    return this.service.remove(Number(body.id), payload);
  }
}
