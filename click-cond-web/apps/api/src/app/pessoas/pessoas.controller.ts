import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { PessoasService } from './pessoas.service';
import { CriarPessoaDto } from './dto/criar-pessoa.dto';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { assertOperador } from '../auth/tenant.util';

/**
 * Como em `visitantes.controller.ts`: o TenantGuard só confere o
 * `:idCondominio` da rota, e um morador legitimamente pertence ao
 * condomínio dele — então o guard sozinho não impede um morador autenticado
 * de listar/buscar/criar pessoas (nome, CPF, telefone, fotos) ou ler o
 * histórico de visitas de qualquer um. `assertOperador` é quem fecha isso.
 */
@Controller('condominios/:idCondominio/pessoas')
export class PessoasController {
  constructor(private readonly service: PessoasService) {}

  @Get('busca')
  async buscar(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @ReqUser() payload: JwtPayload,
    @Query('q') q?: string,
  ) {
    assertOperador(payload, 'buscar pessoas cadastradas no condomínio');
    return this.service.buscarPessoas(idCondominio, q);
  }

  @Post()
  async criar(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Body() dto: CriarPessoaDto,
    @ReqUser() payload: JwtPayload,
  ) {
    assertOperador(payload, 'cadastrar uma pessoa');
    return this.service.obterOuCriar(idCondominio, dto);
  }

  @Get(':idPessoa/historico')
  async obterHistorico(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('idPessoa', ParseIntPipe) idPessoa: number,
    @ReqUser() payload: JwtPayload,
  ) {
    assertOperador(payload, 'ver o histórico de visitas de uma pessoa');
    // O service confere que a pessoa carregada pertence a idCondominio
    // (IDOR cross-tenant fechado na camada de dados, não só aqui).
    return this.service.obterHistorico(idCondominio, idPessoa);
  }
}
