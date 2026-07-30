import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query,
} from '@nestjs/common';
import { CreateMoradorDto, MoradoresService } from './moradores.service';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { TenantAccessService } from '../auth/tenant-access.service';
import { SkipAudit } from '../common/interceptors/skip-audit.decorator';
import { assertOperador } from '../auth/tenant.util';

/**
 * Superfície do CONSOLE (portaria-web). Enxerga o cadastro de moradores do
 * condomínio inteiro — nome, CPF, telefone, e-mail, unidade — e permite
 * criar, editar, apagar e vincular pessoas a apartamentos.
 *
 * O TenantGuard protege pelo :idCondominio da rota, mas morador também
 * pertence ao condomínio: sozinho ele não separa quem administra de quem
 * mora. O app usa a superfície própria (/moradores/*) e, daqui, só o
 * send-credentials.
 */
@Controller('condominios/:idCondominio/moradores')
export class MoradoresController {
  constructor(
    private readonly service: MoradoresService,
    private readonly tenant: TenantAccessService,
  ) {}

  @Get()
  list(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @ReqUser() user: JwtPayload,
    @Query('search') search?: string,
    @Query('id_apto') idApto?: string,
  ) {
    assertOperador(user, 'listar os moradores do condomínio');
    return this.service.findAll(idCondominio, search, idApto ? Number(idApto) : undefined);
  }

  @Get('export-excel')
  exportExcel(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @ReqUser() user: JwtPayload,
  ) {
    // Planilha com o cadastro inteiro do prédio: o vazamento de maior volume
    // do módulo.
    assertOperador(user, 'exportar a lista de moradores');
    return this.service.exportExcel(idCondominio);
  }

  // Síndicos do condomínio (para o admin/porteiro escolher quem vincular como morador).
  // Declarado antes de @Get(':id') para não ser capturado como id.
  @Get('sindicos')
  listSindicos(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'listar os síndicos do condomínio');
    return this.service.listSindicosCondominio(idCondominio);
  }

  @Post('import-bulk')
  importBulk(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Body() body: { linhas: any[] },
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'importar moradores em massa');
    return this.service.importBulk(idCondominio, body.linhas);
  }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number, @ReqUser() user: JwtPayload) {
    assertOperador(user, 'abrir a ficha de um morador');
    const morador = await this.service.findOne(id);
    await this.tenant.assertEntidade((morador as any)?.id_condominio, user, `morador #${id}`);
    return morador;
  }

  /**
   * Atividade completa do morador para o painel de detalhes: visitas
   * que convidou, encomendas do apto, ocorrências que abriu, histórico
   * de acessos faciais. Tudo num único request paralelo.
   */
  @Get(':id/atividade')
  async atividade(@Param('id', ParseIntPipe) id: number, @ReqUser() user: JwtPayload) {
    // Dossiê do morador: visitas que convidou, encomendas, ocorrências e o
    // histórico de acessos faciais dele. Nada disso é dado de vizinho.
    assertOperador(user, 'ver a atividade de um morador');
    // findOne só pra validar tenant; atividade tem queries paralelas próprias.
    const morador = await this.service.findOne(id);
    await this.tenant.assertEntidade((morador as any)?.id_condominio, user, `morador #${id}`);
    return this.service.atividade(id);
  }

  @SkipAudit()
  @Post()
  create(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Body() body: Omit<CreateMoradorDto, 'id_condominio'>,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'cadastrar morador');
    return this.service.create({ ...body, id_condominio: idCondominio }, user);
  }

  // Vincula um usuário existente (síndico) a um apartamento como morador.
  @SkipAudit()
  @Post('link-user')
  linkUser(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Body() body: { id_user: number; id_apartamento: number; tipo?: string },
    @ReqUser() user: JwtPayload,
  ) {
    // Esta rota não recebia sequer o usuário autenticado. Ela cria a linha em
    // Apartamentos_Users — a tabela pela qual TODO o isolamento do sistema
    // resolve "de quem é este apartamento". Sem checagem de papel, um morador
    // vinculava a si mesmo a qualquer unidade do prédio e passava a enxergar
    // os visitantes, o financeiro e o histórico do vizinho. Era a chave-mestra
    // que anulava as demais regras.
    assertOperador(user, 'vincular usuário a apartamento');
    return this.service.linkExistingUser(idCondominio, body, user);
  }

  @SkipAudit()
  @Put(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Partial<CreateMoradorDto>,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'editar morador');
    const morador = await this.service.findOne(id);
    await this.tenant.assertEntidade((morador as any)?.id_condominio, user, `morador #${id}`);
    return this.service.update(id, body, user);
  }

  @SkipAudit()
  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number, @ReqUser() user: JwtPayload) {
    assertOperador(user, 'remover morador');
    const morador = await this.service.findOne(id);
    await this.tenant.assertEntidade((morador as any)?.id_condominio, user, `morador #${id}`);
    // Faltava o `await` — terceira ocorrência do mesmo padrão (prestadores e
    // apartamentos foram as outras). Respondia { ok: true } antes de saber se
    // apagou, e a exceção virava unhandled rejection.
    return this.service.remove(id, user);
  }

  @SkipAudit()
  @Post(':id/send-credentials')
  async sendCredentials(@Param('id', ParseIntPipe) id: number, @ReqUser() user: JwtPayload) {
    // Dispara e-mail/SMS com credencial de acesso. É a única rota daqui que o
    // app chama (tela do síndico), e assertOperador cobre síndico.
    assertOperador(user, 'enviar credenciais de acesso');
    const morador = await this.service.findOne(id);
    await this.tenant.assertEntidade((morador as any)?.id_condominio, user, `morador #${id}`);
    return this.service.sendCredentials(id, user);
  }
}
