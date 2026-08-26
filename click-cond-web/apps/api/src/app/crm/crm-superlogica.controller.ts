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
}
