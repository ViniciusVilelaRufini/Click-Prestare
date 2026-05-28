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

@Controller('condominios/:idCondominio/regras-acesso')
export class RegrasAcessoController {
  constructor(private readonly service: RegrasAcessoService) {}

  @Get()
  list(@Param('idCondominio', ParseIntPipe) idCondominio: number) {
    return this.service.findAll(idCondominio);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  create(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Body() dto: CreateRegraAcessoDto,
  ) {
    return this.service.create(idCondominio, dto);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<CreateRegraAcessoDto>,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
