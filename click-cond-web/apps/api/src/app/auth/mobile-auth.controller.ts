import { Body, Controller, ForbiddenException, Get, HttpCode, Post, Query } from '@nestjs/common';
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

  // ── Diagnóstico / recuperação de emergência ───────────────────────────────
  // Acesso protegido por chave. Usado para inspecionar e restaurar vínculos
  // perdidos sem precisar de acesso direto ao banco.

  @Public()
  @Get('admin-diagnostico')
  async adminDiagnostico(@Query('key') key: string, @Query('login') login?: string) {
    if (key !== (process.env['ADMIN_RECOVERY_KEY'] ?? 'click-recovery-2024')) {
      throw new ForbiddenException();
    }
    return this.service.adminDiagnostico(login);
  }

  @Public()
  @Post('admin-restaurar-vinculo')
  @HttpCode(200)
  async adminRestaurarVinculo(
    @Query('key') key: string,
    @Body() body: { id_user: number; id_condominio: number },
  ) {
    if (key !== (process.env['ADMIN_RECOVERY_KEY'] ?? 'click-recovery-2024')) {
      throw new ForbiddenException();
    }
    return this.service.adminRestaurarVinculo(Number(body.id_user), Number(body.id_condominio));
  }

  @Public()
  @Post('admin-criar-sindico')
  @HttpCode(200)
  async adminCriarSindico(
    @Query('key') key: string,
    @Body() body: { login: string; senha: string; nome: string; id_condominio: number },
  ) {
    if (key !== (process.env['ADMIN_RECOVERY_KEY'] ?? 'click-recovery-2024')) {
      throw new ForbiddenException();
    }
    return this.service.adminCriarSindico({
      login: body.login,
      senha: body.senha,
      nome: body.nome,
      id_condominio: Number(body.id_condominio),
    });
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
  getAllMoradores(@Query('id_condominio') idCond: string) {
    return this.service.getAllMoradores(Number(idCond));
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
    );
  }

  @Post('insert')
  @HttpCode(200)
  insertMorador(@Body() body: any) {
    return this.service.saveMorador(body, false);
  }

  @Post('update')
  @HttpCode(200)
  updateMorador(@Body() body: any) {
    return this.service.saveMorador(body, true);
  }

  @Post('remove')
  @HttpCode(200)
  removeMorador(@Body() body: { id: number }) {
    return this.service.removeMorador(Number(body.id));
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
  getAllFuncionarios(@Query('id_condominio') idCond: string) {
    return this.service.getAllFuncionarios(Number(idCond));
  }

  @Get('get')
  getFuncionario(@Query('id') id: string) {
    return this.service.getFuncionarioById(Number(id));
  }

  @Post('insert')
  @HttpCode(200)
  insertFuncionario(@Body() body: any) {
    return this.service.saveFuncionario(body, false);
  }

  @Post('update')
  @HttpCode(200)
  updateFuncionario(@Body() body: any) {
    return this.service.saveFuncionario(body, true);
  }

  @Post('remove')
  @HttpCode(200)
  removeFuncionario(@Body() body: { id: number }) {
    return this.service.removeFuncionario(Number(body.id));
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
  update(@Body() body: any) {
    return this.service.updateInfosCondominio(body);
  }

  @Post('update-address')
  @HttpCode(200)
  updateAddress(@Body() body: any) {
    return this.service.updateAddressCondominio(body);
  }

  @Post('update-moeda')
  @HttpCode(200)
  updateMoeda(@Body() body: any) {
    return this.service.updateMoedaCondominio(body);
  }

  @Post('update-assinatura')
  @HttpCode(200)
  updateAssinatura(@ReqUser() payload: JwtPayload, @Body() body: any) {
    const idUser = payload.user?.id ?? payload.sub;
    return this.service.updateAssinaturaCondominio(body, Number(idUser));
  }
}

// ==========================================
// APARTAMENTOS MOBILE
// ==========================================
@Controller('apartamentos')
export class ApartamentosMobileController {
  constructor(private readonly service: MobileAuthService) {}

  @Get('get-all')
  getAllApartamentos(@Query('id_condominio') idCond: string) {
    return this.service.getAllApartamentos(Number(idCond));
  }

  @Get('get-moradores')
  getMoradoresApto(@Query('id_apto') idApto: string, @Query('tipo') tipo?: string) {
    return this.service.getMoradoresApto(Number(idApto), tipo);
  }

  @Post('insert')
  insertApto(@Body() body: any) {
    return this.service.saveApto(body, false);
  }

  @Post('update')
  updateApto(@Body() body: any) {
    return this.service.saveApto(body, true);
  }

  @Post('remove')
  removeApto(@Body() body: any) {
    return this.service.removeApto(Number(body.id));
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
    return this.service.saveOcorrencia(body, Number(idUser));
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
    return this.service.listOcorrenciasTodos(Number(idCond), Number(idUser), typeAccess);
  }

  @Get('pendentes/get-all')
  listPendentes(
    @Query('id_condominio') idCond: string,
    @ReqUser() payload: JwtPayload,
  ) {
    const idUser = payload.user?.id ?? payload.sub;
    const typeAccess = payload.typeAccess ?? payload.user?.typeAccess ?? 'Morador';
    return this.service.listOcorrenciasPendentes(Number(idCond), Number(idUser), typeAccess);
  }

  @Get('get')
  get(@Query('id') id: string) {
    return this.service.getOcorrenciaById(Number(id));
  }

  @Get('mensagens/get-all')
  listMessages(@Query('id') id: string) {
    return this.ocorrenciasService.listMessages(Number(id));
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
}
