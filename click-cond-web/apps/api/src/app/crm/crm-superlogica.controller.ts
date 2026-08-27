import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CrmSuperlogicaService } from './crm-superlogica.service';
import { CrmAdminGuard } from './crm-admin.guard';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Ativação da integração Superlógica, pelo painel do CRM.
 *
 * Todas as rotas exigem CrmAdminGuard: ativar um condomínio é ato comercial da
 * operadora, não do síndico. Token de porteiro ou de síndico é rejeitado.
 *
 * Nenhuma rota aqui escreve na Superlógica.
 */
@UseGuards(CrmAdminGuard)
@Controller('crm/superlogica')
export class CrmSuperlogicaController {
  constructor(private readonly service: CrmSuperlogicaService) {}

  private operador(payload?: JwtPayload): string {
    return (payload as any)?.nome ?? (payload as any)?.email ?? 'Admin CRM';
  }

  /** Credenciais presentes no servidor? A tela avisa em vez de dar erro seco. */
  @Get('status')
  status() {
    return this.service.status();
  }

  /** Condomínios do ERP, marcando os que já estão vinculados. */
  @Get('condominios')
  disponiveis() {
    return this.service.listarDisponiveis();
  }

  /** Condomínios do Clique e o estado do vínculo de cada um. */
  @Get('clientes')
  clientes() {
    return this.service.listarCondominiosClique();
  }

  /** Prévia das unidades do ERP — leitura, não importa nada. */
  @Get('clientes/:id/preview-unidades')
  preview(@Param('id', ParseIntPipe) id: number) {
    return this.service.previewUnidades(id);
  }

  /**
   * Ativa a integração para um condomínio.
   *
   * O id do condomínio do Clique vem da rota (validado contra o banco) e o da
   * Superlógica é conferido contra a lista real do ERP antes de gravar.
   */
  @Post('clientes/:id/vincular')
  vincular(
    @Param('id', ParseIntPipe) id: number,
    @Body('idSuperlogica', ParseIntPipe) idSuperlogica: number,
    @ReqUser() user?: JwtPayload,
  ) {
    return this.service.vincular(id, idSuperlogica, this.operador(user));
  }

  /** Desativa a integração. Não apaga o que já foi sincronizado. */
  @Delete('clientes/:id/vincular')
  desvincular(@Param('id', ParseIntPipe) id: number, @ReqUser() user?: JwtPayload) {
    return this.service.desvincular(id, this.operador(user));
  }

  /**
   * Importa as unidades do ERP como apartamentos, já vinculados.
   *
   * Passo único da ativação: é o que grava `id_superlogica_uni` e dispensa
   * casar unidade por texto depois. Idempotente.
   */
  @Post('clientes/:id/importar-unidades')
  importar(
    @Param('id', ParseIntPipe) id: number,
    @Body('comMoradores') comMoradores?: boolean,
    @ReqUser() user?: JwtPayload,
  ) {
    // Default false: trazer os contatos cria contas de pessoas reais, então é
    // decisão explícita do operador, não efeito colateral de importar unidade.
    return this.service.importarUnidades(id, this.operador(user), comMoradores === true);
  }

  /**
   * Roda a sincronização das cobranças agora, sem esperar o ciclo horário.
   * Útil logo após a importação, para o operador ver o resultado.
   */
  @Post('clientes/:id/sincronizar')
  sincronizar(@Param('id', ParseIntPipe) id: number, @ReqUser() user?: JwtPayload) {
    return this.service.sincronizarAgora(id, this.operador(user));
  }

  /**
   * Liga/desliga o envio de moradores do Clique para o ERP.
   *
   * A única escrita da integração. Nasce desligada e é ligada condomínio a
   * condomínio, porque altera cadastro real da administradora.
   */
  /**
   * Reenvia ao ERP os moradores que ainda não subiram.
   *
   * Síncrono de propósito: o envio automático é fire-and-forget e a falha só
   * aparece no log. Aqui o motivo de cada recusa volta para a tela.
   */
  @Post('clientes/:id/reenviar-moradores')
  reenviar(@Param('id', ParseIntPipe) id: number, @ReqUser() user?: JwtPayload) {
    return this.service.reenviarMoradores(id, this.operador(user));
  }

  @Post('clientes/:id/escrita')
  escrita(
    @Param('id', ParseIntPipe) id: number,
    @Body('ligado') ligado: boolean,
    @ReqUser() user?: JwtPayload,
  ) {
    return this.service.definirEscrita(id, ligado === true, this.operador(user));
  }
}
