import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import { CreateRegraAcessoDto, RegrasAcessoService } from './regras-acesso.service';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';

@Controller('condominios/:idCondominio/regras-acesso')
export class RegrasAcessoController {
  constructor(private readonly service: RegrasAcessoService) {}

  @Get()
  list(@Param('idCondominio', ParseIntPipe) idCondominio: number) {
    return this.service.findAll(idCondominio);
  }

  @Get(':id')
  get(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.findOne(id, idCondominio);
  }

  @Post()
  create(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Body() dto: CreateRegraAcessoDto,
    @ReqUser() user: JwtPayload,
  ) {
    return this.service.create(idCondominio, dto, user);
  }

  @Put(':id')
  update(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<CreateRegraAcessoDto>,
    @ReqUser() user: JwtPayload,
  ) {
    return this.service.update(id, dto, idCondominio, user);
  }

  @Delete(':id')
  remove(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('id', ParseIntPipe) id: number,
    @ReqUser() user: JwtPayload,
  ) {
    return this.service.remove(id, idCondominio, user);
  }
}
