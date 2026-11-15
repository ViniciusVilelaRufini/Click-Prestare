import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { GuaritaEventosService } from './guarita-eventos.service';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { assertOperador, assertTenantStrict } from '../auth/tenant.util';
import { GuaritaPortoesService } from './guarita-portoes.service';
import type { PortaoDto } from './guarita-portoes.service';
import { GuaritaCapturaService } from './guarita-captura.service';
import { GuaritaImportacaoService } from './guarita-importacao.service';
import { GuaritaOperacoesService } from './guarita-operacoes.service';
import { autorDoUsuario } from './guarita-comum.util';
import { SkipAudit } from '../common/interceptors/skip-audit.decorator';

/**
 * Rotas do console para o Módulo Guarita (`condominios/:idCondominio/guarita/…`).
 *
 * TenantGuard global amarra o :idCondominio ao token; aqui exige-se a mesma
 * permissão que protege Veículos/Tags (assertOperador: síndico, funcionário ou
 * operador da portaria). Guarita de outro condomínio → 404. As rotas sem
 * `:deviceId` (alertas) são declaradas ANTES das com `:deviceId`.
 *
 * Nenhuma resposta daqui contém a palavra de autorização do Guarita.
 */
@Controller('condominios/:idCondominio/guarita')
export class GuaritaController {
  constructor(
    private readonly importacao: GuaritaImportacaoService,
    private readonly operacoes: GuaritaOperacoesService,
    private readonly eventos: GuaritaEventosService,
    private readonly portoes: GuaritaPortoesService,
    private readonly captura: GuaritaCapturaService,
  ) {}

  // ------------------------------------------- alertas (ANTES de :deviceId)

  /** Alertas do Guarita para a portaria (`?pendentes=1`: só os não vistos). */
  @Get('alertas')
  async alertas(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Query('pendentes') pendentes: string | undefined,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'ver os alertas do Guarita');
    return this.eventos.listarAlertas(idCondominio, pendentes === '1' || pendentes === 'true');
  }

  @Post('alertas/:idAlerta/visto')
  async marcarVisto(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('idAlerta', ParseIntPipe) idAlerta: number,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'marcar alerta do Guarita como visto');
    return this.eventos.marcarVisto(idCondominio, idAlerta, autorDoUsuario(user));
  }

  // ------------------------------------------------------------- estado

  @Get(':deviceId/estado')
  async estado(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('deviceId', ParseIntPipe) deviceId: number,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'ver o estado do Guarita');
    return this.portoes.estado(idCondominio, deviceId);
  }

  // ------------------------------------------------------------ portões

  @Get(':deviceId/portoes')
  async listarPortoes(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('deviceId', ParseIntPipe) deviceId: number,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'listar os portões do Guarita');
    return this.portoes.listar(idCondominio, deviceId);
  }

  @Post(':deviceId/portoes')
  async criarPortao(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('deviceId', ParseIntPipe) deviceId: number,
    @Body() body: PortaoDto,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'cadastrar portão do Guarita');
    return this.portoes.criar(idCondominio, deviceId, body);
  }

  @Put(':deviceId/portoes/:idPortao')
  async atualizarPortao(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('deviceId', ParseIntPipe) deviceId: number,
    @Param('idPortao', ParseIntPipe) idPortao: number,
    @Body() body: PortaoDto,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'editar portão do Guarita');
    return this.portoes.atualizar(idCondominio, deviceId, idPortao, body);
  }

  @Delete(':deviceId/portoes/:idPortao')
  async removerPortao(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('deviceId', ParseIntPipe) deviceId: number,
    @Param('idPortao', ParseIntPipe) idPortao: number,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'remover portão do Guarita');
    return this.portoes.remover(idCondominio, deviceId, idPortao);
  }

  /**
   * Abrir portão pelo relé do Guarita. Mesma permissão do "Acionar Abertura"
   * de hoje (POST facial/devices/:id/trigger): sessão do console vinculada ao
   * condomínio. Morador e token do app sem condomínio → 403.
   */
  @SkipAudit()
  @Post(':deviceId/portoes/:idPortao/abrir')
  async abrirPortao(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('deviceId', ParseIntPipe) deviceId: number,
    @Param('idPortao', ParseIntPipe) idPortao: number,
    @ReqUser() user: JwtPayload,
  ) {
    assertTenantStrict(idCondominio, user, `portão do Guarita do condomínio ${idCondominio}`);
    return this.portoes.abrir(idCondominio, deviceId, idPortao, user);
  }

  // ---------------------------------------------- cadastro de dispositivo

  @Post(':deviceId/captura')
  async abrirCaptura(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('deviceId', ParseIntPipe) deviceId: number,
    @Body() body: { id_veiculo?: number },
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'cadastrar controle/tag no Guarita');
    return this.captura.abrir(idCondominio, deviceId, body?.id_veiculo, autorDoUsuario(user));
  }

  @Get(':deviceId/captura')
  async listarCaptura(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('deviceId', ParseIntPipe) deviceId: number,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'cadastrar controle/tag no Guarita');
    return this.captura.listar(idCondominio, deviceId);
  }

  @Post(':deviceId/captura/confirmar')
  async confirmarCaptura(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('deviceId', ParseIntPipe) deviceId: number,
    @Body() body: { tipo?: number; serial_hex?: string; id_veiculo?: number },
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'cadastrar controle/tag no Guarita');
    return this.captura.confirmar(idCondominio, deviceId, body, autorDoUsuario(user));
  }

  @Post(':deviceId/dispositivos')
  async cadastrarDigitado(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('deviceId', ParseIntPipe) deviceId: number,
    @Body() body: { id_veiculo?: number; tipo?: number; codigo_impresso?: string },
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'cadastrar tag/cartão no Guarita');
    return this.captura.cadastrarDigitado(idCondominio, deviceId, body, autorDoUsuario(user));
  }

  // ------------------------------------------------ importação / conferência

  @Post(':deviceId/importar')
  async importar(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('deviceId', ParseIntPipe) deviceId: number,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'importar o cadastro do Guarita');
    return this.importacao.solicitar(idCondominio, deviceId, 'importar', autorDoUsuario(user));
  }

  @Post(':deviceId/conferir')
  async conferir(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('deviceId', ParseIntPipe) deviceId: number,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'conferir o cadastro do Guarita');
    return this.importacao.solicitar(idCondominio, deviceId, 'conferir', autorDoUsuario(user));
  }

  @Get(':deviceId/operacoes/:idOperacao')
  async operacao(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('deviceId', ParseIntPipe) deviceId: number,
    @Param('idOperacao', ParseIntPipe) idOperacao: number,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'acompanhar operação do Guarita');
    return this.importacao.operacao(idCondominio, deviceId, idOperacao);
  }

  // ------------------------------------------------------- dispositivos

  @Get(':deviceId/dispositivos')
  async listarDispositivos(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('deviceId', ParseIntPipe) deviceId: number,
    @Query('estado') estado: string | undefined,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'listar os dispositivos do Guarita');
    return this.importacao.listarDispositivos(idCondominio, deviceId, estado);
  }

  @Post(':deviceId/dispositivos/:idTag/vincular')
  async vincular(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('deviceId', ParseIntPipe) deviceId: number,
    @Param('idTag', ParseIntPipe) idTag: number,
    @Body() body: { id_veiculo?: number },
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'vincular dispositivo do Guarita');
    return this.importacao.vincular(idCondominio, deviceId, idTag, body?.id_veiculo);
  }

  /** Tag vinculada pelo morador no app: vai para o Guarita (cadastro na fila). Corpo opcional `{ tipo?: 2|3|6, codigo_impresso? }`. */
  @Post(':deviceId/dispositivos/:idTag/aprovar')
  async aprovar(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('deviceId', ParseIntPipe) deviceId: number,
    @Param('idTag', ParseIntPipe) idTag: number,
    @Body() body: { tipo?: number; codigo_impresso?: string } | undefined,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'aprovar tag no Guarita');
    return this.operacoes.aprovar(idCondominio, deviceId, idTag, body, autorDoUsuario(user));
  }

  /** Dispositivo que não está mais no Guarita: o síndico decide regravar (cadastro na fila). */
  @Post(':deviceId/dispositivos/:idTag/regravar')
  async regravar(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('deviceId', ParseIntPipe) deviceId: number,
    @Param('idTag', ParseIntPipe) idTag: number,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'regravar dispositivo no Guarita');
    return this.operacoes.regravar(idCondominio, deviceId, idTag, autorDoUsuario(user));
  }

  /** Dispositivo em conflito (ou que não está mais no Guarita): sai do Prestare, nada vai para o Guarita. */
  @Post(':deviceId/dispositivos/:idTag/desfazer')
  async desfazer(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('deviceId', ParseIntPipe) deviceId: number,
    @Param('idTag', ParseIntPipe) idTag: number,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'desfazer vínculo de dispositivo do Guarita');
    return this.operacoes.desfazer(idCondominio, deviceId, idTag);
  }

  /** Tag vinculada pelo morador no app: não vai para o Guarita (continua como tag comum do veículo). */
  @Post(':deviceId/dispositivos/:idTag/recusar')
  async recusar(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('deviceId', ParseIntPipe) deviceId: number,
    @Param('idTag', ParseIntPipe) idTag: number,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'recusar tag no Guarita');
    return this.operacoes.recusar(idCondominio, deviceId, idTag);
  }

  // ------------------------------------------------- cópias de segurança

  @Get(':deviceId/backups')
  async listarBackups(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('deviceId', ParseIntPipe) deviceId: number,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'listar as cópias de segurança do Guarita');
    return this.importacao.listarBackups(idCondominio, deviceId);
  }

  @Get(':deviceId/backups/:idBackup')
  async baixarBackup(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('deviceId', ParseIntPipe) deviceId: number,
    @Param('idBackup', ParseIntPipe) idBackup: number,
    @ReqUser() user: JwtPayload,
  ) {
    assertOperador(user, 'baixar cópia de segurança do Guarita');
    return this.importacao.baixarBackup(idCondominio, deviceId, idBackup);
  }
}
