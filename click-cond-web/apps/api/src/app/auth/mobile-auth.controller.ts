import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';
import { Public } from './public.decorator';
import { ReqUser } from './req-user.decorator';
import type { JwtPayload } from './jwt-payload.interface';
import { OcorrenciasService } from '../ocorrencias/ocorrencias.service';

// ==========================================
// SÍNDICO
// ==========================================
@Controller('sindico')
export class SindicoMobileController {
  constructor(private readonly service: MobileAuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: { login: string; password?: string; senha?: string }) {
    const pwd = body.password ?? body.senha ?? '';
    return this.service.loginSindico(body.login, pwd);
  }

  @Public()
  @Post('signup')
  @HttpCode(200)
  signup(@Body() body: any) {
    return this.service.signupSindico(body);
  }

  @Public()
  @Post('recovery-password')
  @HttpCode(200)
  recoveryPassword(@Body() body: { email: string }) {
    return this.service.recoveryPasswordSindico(body.email);
  }

  @Get('list-condominios')
  listCondominios(@ReqUser() payload: JwtPayload) {
    const idUser = payload.user?.id ?? payload.sub;
    return this.service.listCondominiosSindico(Number(idUser));
  }

  @Get('get')
  getSindico(@ReqUser() payload: JwtPayload) {
    const idUser = payload.user?.id ?? payload.sub;
    return this.service.getSindicoByIdUser(Number(idUser));
  }

  @Post('update')
  @HttpCode(200)
  updateSindico(@ReqUser() payload: JwtPayload, @Body() body: any) {
    const idUser = payload.user?.id ?? payload.sub;
    return this.service.updateSindico(Number(idUser), body);
  }

  @Post('new-password')
  @HttpCode(200)
  newPassword(@ReqUser() payload: JwtPayload, @Body() body: { senha?: string; password?: string }) {
    const idUser = payload.user?.id ?? payload.sub;
    const pwd = body.password ?? body.senha ?? '';
    return this.service.updatePassword(Number(idUser), pwd, 'Sindico');
  }

  // Vincula o próprio síndico logado como morador de um apartamento (auto-vínculo).
  @Post('link-morador')
  @HttpCode(200)
  linkMorador(@ReqUser() payload: JwtPayload, @Body() body: { id_apartamento: number; tipo?: string }) {
    const idUser = payload.user?.id ?? payload.sub;
    return this.service.linkUserAsMorador(Number(idUser), Number(body.id_apartamento), body.tipo);
  }
}

// ==========================================
// MORADORES
// ==========================================
@Controller('moradores')
export class MoradoresMobileController {
  constructor(private readonly service: MobileAuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: { login: string; password?: string; senha?: string }) {
    const pwd = body.password ?? body.senha ?? '';
    return this.service.loginMorador(body.login, pwd);
  }

  @Public()
  @Post('recovery-password')
  @HttpCode(200)
  recoveryPassword(@Body() body: { email: string }) {
    return this.service.recoveryPasswordMorador(body.email);
  }

  @Get('list-condominios')
  listCondominios(@ReqUser() payload: JwtPayload) {
    const idUser = payload.user?.id ?? payload.sub;
    return this.service.listCondominiosMorador(Number(idUser));
  }

  @Get('get-all')
  getAllMoradores(@Query('id_condominio') idCond: string, @ReqUser() payload: JwtPayload) {
    return this.service.getAllMoradores(Number(idCond), payload);
  }

  @Get('get')
  getMorador(
    @ReqUser() payload: JwtPayload,
    @Query('id') id: string,
    @Query('id_condominio') idCondominio?: string,
  ) {
    const idUser = payload.user?.id ?? payload.sub;
    return this.service.getMoradorById(
      Number(id),
      Number(idUser),
      idCondominio ? Number(idCondominio) : undefined,
      payload,
    );
  }

  @Post('insert')
  @HttpCode(200)
  insertMorador(@Body() body: any, @ReqUser() payload: JwtPayload) {
    return this.service.saveMorador(body, false, payload);
  }

  // Cadastro de familiar pelo próprio morador proprietário do apartamento.
  @Post('insert-familiar')
  @HttpCode(200)
  insertFamiliar(@Body() body: any, @ReqUser() payload: JwtPayload) {
    return this.service.insertFamiliar(body, payload);
  }

  @Post('update')
  @HttpCode(200)
  updateMorador(@Body() body: any, @ReqUser() payload: JwtPayload) {
    return this.service.saveMorador(body, true, payload);
  }

  @Post('remove')
  @HttpCode(200)
  removeMorador(@Body() body: { id: number }, @ReqUser() payload: JwtPayload) {
    return this.service.removeMorador(Number(body.id), payload);
  }

  @Post('new-password')
  @HttpCode(200)
  newPassword(@ReqUser() payload: JwtPayload, @Body() body: { senha?: string; password?: string }) {
    const idUser = payload.user?.id ?? payload.sub;
    const pwd = body.password ?? body.senha ?? '';
    return this.service.updatePassword(Number(idUser), pwd, 'Morador');
  }
}

// ==========================================
// FUNCIONÁRIOS
// ==========================================
@Controller('funcionarios')
export class FuncionariosMobileController {
  constructor(private readonly service: MobileAuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: { login: string; password?: string; senha?: string }) {
    const pwd = body.password ?? body.senha ?? '';
    return this.service.loginFuncionario(body.login, pwd);
  }

  @Public()
  @Post('recovery-password')
  @HttpCode(200)
  recoveryPassword(@Body() body: { email: string }) {
    return this.service.recoveryPasswordFuncionario(body.email);
  }

  @Get('list-condominios')
  listCondominios(@ReqUser() payload: JwtPayload) {
    const idUser = payload.user?.id ?? payload.sub;
    return this.service.listCondominiosFuncionario(Number(idUser));
  }

  @Get('get-all')
  getAllFuncionarios(@Query('id_condominio') idCond: string, @ReqUser() payload: JwtPayload) {
    return this.service.getAllFuncionarios(Number(idCond), payload);
  }

  @Get('get')
  getFuncionario(@Query('id') id: string, @ReqUser() payload: JwtPayload) {
    return this.service.getFuncionarioById(Number(id), payload);
  }

  @Post('insert')
  @HttpCode(200)
  insertFuncionario(@Body() body: any, @ReqUser() payload: JwtPayload) {
    return this.service.saveFuncionario(body, false, payload);
  }

  @Post('update')
  @HttpCode(200)
  updateFuncionario(@Body() body: any, @ReqUser() payload: JwtPayload) {
    return this.service.saveFuncionario(body, true, payload);
  }

  // Funcionário editando o próprio perfil. O alvo vem do JWT, não do corpo.
  @Post('update-infos')
  @HttpCode(200)
  updateInfos(@Body() body: any, @ReqUser() payload: JwtPayload) {
    return this.service.updateInfosFuncionario(body, payload);
  }

  @Post('remove')
  @HttpCode(200)
  removeFuncionario(@Body() body: { id: number }, @ReqUser() payload: JwtPayload) {
    return this.service.removeFuncionario(Number(body.id), payload);
  }

  @Post('new-password')
  @HttpCode(200)
  newPassword(@ReqUser() payload: JwtPayload, @Body() body: { senha?: string; password?: string }) {
    const idUser = payload.user?.id ?? payload.sub;
    const pwd = body.password ?? body.senha ?? '';
    return this.service.updatePassword(Number(idUser), pwd, 'Funcionario');
  }
}

// ==========================================
// DASHBOARD
// ==========================================
@Controller('dashboard')
export class DashboardMobileController {
  constructor(private readonly service: MobileAuthService) {}

  @Get('summary')
  summary(@ReqUser() payload: JwtPayload) {
    const idUser = payload.user?.id ?? payload.sub;
    const typeAccess = payload.typeAccess ?? payload.user?.typeAccess ?? 'Sindico';
    return this.service.getSummary(Number(idUser), typeAccess);
  }

  @Get('meus-eventos')
  meusEventos(@ReqUser() payload: JwtPayload, @Query('limit') limit?: string) {
    const idUser = payload.user?.id ?? payload.sub;
    return this.service.getMeusEventos(Number(idUser), limit ? Number(limit) : 15);
  }
}

// ==========================================
// CONDOMÍNIO GERAL
// ==========================================
@Controller('condominio')
export class CondominioMobileController {
  constructor(private readonly service: MobileAuthService) {}

  @Get('get-condominio')
  getCondominio(@Query('id_condominio') idCond: string) {
    return this.service.getCondominioById(Number(idCond));
  }

  @Post('register')
  @HttpCode(200)
  register(@Body() body: any, @ReqUser() payload: JwtPayload) {
    const idUser = payload.user?.id ?? payload.sub;
    return this.service.registerCondominio(body, Number(idUser));
  }

  @Get('infos/get')
  getInfos(@Query('id_condominio') idCond: string) {
    return this.service.getInfosCondominio(Number(idCond));
  }

  @Get('address/get')
  getAddress(@Query('id_condominio') idCond: string) {
    return this.service.getAddressCondominio(Number(idCond));
  }

  @Post('update')
  @HttpCode(200)
  update(@Body() body: any, @ReqUser() payload: JwtPayload) {
    return this.service.updateInfosCondominio(body, payload);
  }

  @Post('update-address')
  @HttpCode(200)
  updateAddress(@Body() body: any, @ReqUser() payload: JwtPayload) {
    return this.service.updateAddressCondominio(body, payload);
  }

  @Post('update-moeda')
  @HttpCode(200)
  updateMoeda(@Body() body: any, @ReqUser() payload: JwtPayload) {
    return this.service.updateMoedaCondominio(body, payload);
  }

  @Post('update-assinatura')
  @HttpCode(200)
  updateAssinatura(@ReqUser() payload: JwtPayload, @Body() body: any) {
    const idUser = payload.user?.id ?? payload.sub;
    return this.service.updateAssinaturaCondominio(body, Number(idUser), payload);
  }
}

// ==========================================
// APARTAMENTOS MOBILE
// ==========================================
@Controller('apartamentos')
export class ApartamentosMobileController {
  constructor(private readonly service: MobileAuthService) {}

  @Get('get-all')
  getAllApartamentos(@Query('id_condominio') idCond: string, @ReqUser() payload: JwtPayload) {
    return this.service.getAllApartamentos(Number(idCond), payload);
  }

  @Get('get-moradores')
  getMoradoresApto(@Query('id_apto') idApto: string, @Query('tipo') tipo: string | undefined, @ReqUser() payload: JwtPayload) {
    return this.service.getMoradoresApto(Number(idApto), tipo, payload);
  }

  @Post('insert')
  insertApto(@Body() body: any, @ReqUser() payload: JwtPayload) {
    return this.service.saveApto(body, false, payload);
  }

  @Post('update')
  updateApto(@Body() body: any, @ReqUser() payload: JwtPayload) {
    return this.service.saveApto(body, true, payload);
  }

  @Post('remove')
  removeApto(@Body() body: any, @ReqUser() payload: JwtPayload) {
    return this.service.removeApto(Number(body.id), payload);
  }
}

// ==========================================
// OCORRÊNCIAS MOBILE
// ==========================================
@Controller('ocorrencias')
export class OcorrenciasMobileController {
  constructor(
    private readonly service: MobileAuthService,
    private readonly ocorrenciasService: OcorrenciasService,
  ) {}

  @Get('categorias/get-all')
  categorias() {
    return this.service.listOcorrenciasCategorias();
  }

  @Post('insert')
  @HttpCode(200)
  insert(@Body() body: any, @ReqUser() payload: JwtPayload) {
    const idUser = payload.user?.id ?? payload.sub;
    return this.service.saveOcorrencia(body, Number(idUser), payload);
  }

  @Get('get-all')
  list(@ReqUser() payload: JwtPayload) {
    const idUser = payload.user?.id ?? payload.sub;
    return this.service.listOcorrencias(Number(idUser));
  }

  @Get('todos/get-all')
  listTodos(
    @Query('id_condominio') idCond: string,
    @ReqUser() payload: JwtPayload,
  ) {
    const idUser = payload.user?.id ?? payload.sub;
    const typeAccess = payload.typeAccess ?? payload.user?.typeAccess ?? 'Morador';
    return this.service.listOcorrenciasTodos(Number(idCond), Number(idUser), typeAccess, payload);
  }

  @Get('pendentes/get-all')
  listPendentes(
    @Query('id_condominio') idCond: string,
    @ReqUser() payload: JwtPayload,
  ) {
    const idUser = payload.user?.id ?? payload.sub;
    const typeAccess = payload.typeAccess ?? payload.user?.typeAccess ?? 'Morador';
    return this.service.listOcorrenciasPendentes(Number(idCond), Number(idUser), typeAccess, payload);
  }

  @Get('get')
  get(@Query('id') id: string, @ReqUser() payload: JwtPayload) {
    return this.service.getOcorrenciaById(Number(id), payload);
  }

  // Atribui a ocorrência a um funcionário (Users.id) e dispara push a ele.
  @Post('update-responsavel')
  @HttpCode(200)
  atribuir(@Body() body: { id: number; id_responsavel: number | null }, @ReqUser() payload: JwtPayload) {
    return this.ocorrenciasService.atribuir(
      Number(body.id),
      body.id_responsavel != null && body.id_responsavel !== ('' as any)
        ? Number(body.id_responsavel)
        : null,
      payload,
    );
  }

  // ----- Categorias (gestão pelo síndico no app) -----
  @Post('categorias/insert')
  @HttpCode(200)
  insertCategoria(@Body() body: any, @ReqUser() payload: JwtPayload) {
    const c = body.categoria ?? body;
    return this.ocorrenciasService.createCategoria({
      nome: c.nome,
      prioridade: c.prioridade != null ? Number(c.prioridade) : 0,
      sla_horas: c.sla_horas != null && c.sla_horas !== '' ? Number(c.sla_horas) : null,
    }, payload);
  }

  @Post('categorias/update')
  @HttpCode(200)
  updateCategoria(@Body() body: any, @ReqUser() payload: JwtPayload) {
    const c = body.categoria ?? body;
    return this.ocorrenciasService.updateCategoria(Number(c.id), {
      nome: c.nome,
      prioridade: c.prioridade != null ? Number(c.prioridade) : undefined,
      sla_horas: c.sla_horas === '' ? null : (c.sla_horas != null ? Number(c.sla_horas) : undefined),
    }, payload);
  }

  @Post('categorias/remove')
  @HttpCode(200)
  removeCategoria(@Body() body: { id: number }, @ReqUser() payload: JwtPayload) {
    this.ocorrenciasService.removeCategoria(Number(body.id), payload);
    return { ok: true };
  }

  @Get('mensagens/get-all')
  listMessages(@Query('id') id: string, @ReqUser() payload: JwtPayload) {
    return this.ocorrenciasService.listMessages(Number(id), payload);
  }

  @Post('mensagens/enviar')
  @HttpCode(200)
  createMessage(
    @Body() body: { id_ocorrencia: number; mensagem: string },
    @ReqUser() payload: JwtPayload,
  ) {
    const idUser = payload?.user?.id ?? payload?.sub ?? null;
    return this.ocorrenciasService.createMessage(
      Number(body.id_ocorrencia),
      Number(idUser),
      body.mensagem,
      payload,
    );
  }
}


// ==========================================
// ENCOMENDAS MOBILE
// ==========================================
@Controller('encomendas')
export class EncomendasMobileController {
  constructor(private readonly service: MobileAuthService) {}

  @Get('get-all')
  listByUser(@ReqUser() payload: JwtPayload) {
    const idUser = payload.user?.id ?? payload.sub;
    return this.service.listEncomendasByUser(Number(idUser));
  }

  @Post('cadastrar')
  cadastrar(
    @ReqUser() payload: JwtPayload,
    @Body() body: { descricao: string; recebido_de?: string; codigo_rastreio: string },
  ) {
    const idUser = payload.user?.id ?? payload.sub;
    return this.service.cadastrarRastreioMorador(Number(idUser), body);
  }

  // Condomínios sem portaria: o próprio morador dá baixa na encomenda e pode
  // anexar uma foto como comprovante da retirada.
  @Post('retirar')
  retirar(
    @ReqUser() payload: JwtPayload,
    @Body() body: { id: number | string; retirado_foto?: string },
  ) {
    const idUser = payload.user?.id ?? payload.sub;
    return this.service.retirarEncomendaMorador(
      Number(idUser),
      Number(body.id),
      body.retirado_foto,
    );
  }
}

// ==========================================
// VEÍCULOS (app do morador) — paridade com as rotas Express /veiculos/*
// ==========================================
@Controller('veiculos')
export class VeiculosMobileController {
  constructor(private readonly service: MobileAuthService) {}

  @Get('get-all')
  getAll(@ReqUser() payload: JwtPayload, @Query('id_condominio') idCondominio?: string) {
    const idUser = payload.user?.id ?? payload.sub;
    return this.service.listVeiculosByUser(Number(idUser), Number(idCondominio));
  }

  @Post('insert')
  insert(
    @ReqUser() payload: JwtPayload,
    @Body() body: { id_condominio: number | string; veiculo: any },
  ) {
    const idUser = payload.user?.id ?? payload.sub;
    return this.service.criarVeiculoMorador(Number(idUser), Number(body.id_condominio), body.veiculo);
  }

  @Post('update')
  update(
    @ReqUser() payload: JwtPayload,
    @Body() body: { id_condominio: number | string; veiculo: any },
  ) {
    const idUser = payload.user?.id ?? payload.sub;
    return this.service.atualizarVeiculoMorador(Number(idUser), Number(body.id_condominio), body.veiculo);
  }

  @Post('remove')
  remove(
    @ReqUser() payload: JwtPayload,
    @Body() body: { id: number; id_condominio: number | string },
  ) {
    const idUser = payload.user?.id ?? payload.sub;
    return this.service.removerVeiculoMorador(Number(idUser), Number(body.id_condominio), Number(body.id));
  }
}

// ==========================================
// VAGAS (app do morador) — liberar vaga p/ visitante/inquilino
// ==========================================
@Controller('vagas')
export class VagasMobileController {
  constructor(private readonly service: MobileAuthService) {}

  @Get('get-all')
  getAll(@ReqUser() payload: JwtPayload, @Query('id_condominio') idCondominio?: string) {
    const idUser = payload.user?.id ?? payload.sub;
    return this.service.listVagasByUser(Number(idUser), Number(idCondominio));
  }

  @Get('beneficiarios')
  beneficiarios(@ReqUser() payload: JwtPayload, @Query('id_condominio') idCondominio?: string) {
    const idUser = payload.user?.id ?? payload.sub;
    return this.service.listBeneficiariosVaga(Number(idUser), Number(idCondominio));
  }

  @Post('liberar')
  liberar(
    @ReqUser() payload: JwtPayload,
    @Body() body: { id_condominio: number | string } & Record<string, any>,
  ) {
    const idUser = payload.user?.id ?? payload.sub;
    return this.service.liberarVaga(Number(idUser), Number(body.id_condominio), body);
  }

  @Post('revogar')
  revogar(
    @ReqUser() payload: JwtPayload,
    @Body() body: { id: number; id_condominio: number | string },
  ) {
    const idUser = payload.user?.id ?? payload.sub;
    return this.service.revogarVaga(Number(idUser), Number(body.id_condominio), Number(body.id));
  }
}

// ==========================================
// USUÁRIO / CONTA
// ==========================================
@Controller('users')
export class UsersMobileController {
  constructor(private readonly service: MobileAuthService) {}

  @Post('delete-account')
  @HttpCode(200)
  deleteAccount(@ReqUser() payload: JwtPayload) {
    const idUser = payload.user?.id ?? payload.sub;
    return this.service.deleteAccount(Number(idUser));
  }

  // Registro do token de push. O app chama logo após o login — é o que
  // popula Users.fcm_token, lido por visitantes/ocorrências/áreas/financeiro
  // para disparar notificação.
  @Post('update-fcm-token')
  @HttpCode(200)
  updateFcmToken(
    @ReqUser() payload: JwtPayload,
    @Body() body: { fcm_token?: string },
  ) {
    const idUser = payload.user?.id ?? payload.sub;
    return this.service.updateFcmToken(Number(idUser), body?.fcm_token ?? '');
  }

  // Preferências de notificação (tela NotificationSettingsPage do app).
  @Get('settings')
  getSettings(@ReqUser() payload: JwtPayload) {
    const idUser = payload.user?.id ?? payload.sub;
    return this.service.getNotificationSettings(Number(idUser));
  }

  @Post('settings')
  @HttpCode(200)
  updateSettings(
    @ReqUser() payload: JwtPayload,
    @Body()
    body: {
      notif_encomendas?: boolean;
      notif_comunicados?: boolean;
      notif_ocorrencias?: boolean;
      notif_visitantes?: boolean;
    },
  ) {
    const idUser = payload.user?.id ?? payload.sub;
    return this.service.updateNotificationSettings(Number(idUser), body ?? {});
  }
}
