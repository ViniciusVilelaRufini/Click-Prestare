import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { PessoasService } from './pessoas.service';
import { CriarPessoaDto } from './dto/criar-pessoa.dto';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';

@Controller('condominios/:idCondominio/pessoas')
export class PessoasController {
  constructor(private readonly service: PessoasService) {}

  @Get('busca')
  async buscar(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Query('q') q?: string,
  ) {
    return this.service.buscarPessoas(idCondominio, q);
  }

  @Post()
  async criar(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Body() dto: CriarPessoaDto,
  ) {
    return this.service.obterOuCriar(idCondominio, dto);
  }

  @Get(':idPessoa/historico')
  async obterHistorico(
    @Param('idPessoa', ParseIntPipe) idPessoa: number,
  ) {
    return this.service.obterHistorico(idPessoa);
  }
}
