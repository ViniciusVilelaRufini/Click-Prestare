import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { CrmAdminGuard } from '../crm/crm-admin.guard';
import { WhatsappInboxService } from './whatsapp-inbox.service';
import { WhatsappConfigService } from './whatsapp-config.service';

@Controller('crm/whatsapp')
@UseGuards(CrmAdminGuard)
export class WhatsappCrmController {
  constructor(private readonly inbox: WhatsappInboxService, private readonly config: WhatsappConfigService) {}

  @Get('conversas')
  conversas() { return this.inbox.listarConversas(); }

  @Get('conversas/:id/mensagens')
  mensagens(@Param('id', ParseIntPipe) id: number) { return this.inbox.mensagens(id); }

  @Post('conversas/:id/mensagens')
  enviar(@Param('id', ParseIntPipe) id: number, @Body() body: { texto?: string }) {
    return this.inbox.enviar(id, body?.texto ?? '');
  }

  @Post('leads/:leadId/iniciar')
  iniciar(@Param('leadId', ParseIntPipe) leadId: number) {
    return this.inbox.iniciarConversa(leadId);
  }

  @Get('automacoes')
  automacoes() { return this.config.automacoes(); }

  @Put('automacoes')
  salvarAutomacoes(@Body() body: unknown) { return this.config.salvarAutomacoes(body); }

  @Get('respostas')
  respostas() { return this.config.respostas(); }

  @Post('respostas')
  criarResposta(@Body() body: unknown) { return this.config.criarResposta(body); }

  @Put('respostas/:id')
  editarResposta(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) { return this.config.editarResposta(id, body); }

  @Delete('respostas/:id')
  @HttpCode(204)
  excluirResposta(@Param('id', ParseIntPipe) id: number) { return this.config.excluirResposta(id); }

  @Get('nao-lidas')
  naoLidas() { return this.inbox.naoLidas(); }
}
