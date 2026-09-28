import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { CrmAdminGuard } from '../crm/crm-admin.guard';
import { WhatsappInboxService } from './whatsapp-inbox.service';

@Controller('crm/whatsapp')
@UseGuards(CrmAdminGuard)
export class WhatsappCrmController {
  constructor(private readonly inbox: WhatsappInboxService) {}

  @Get('conversas')
  conversas() { return this.inbox.listarConversas(); }

  @Get('conversas/:id/mensagens')
  mensagens(@Param('id', ParseIntPipe) id: number) { return this.inbox.mensagens(id); }

  @Post('conversas/:id/mensagens')
  enviar(@Param('id', ParseIntPipe) id: number, @Body() body: { texto?: string }) {
    return this.inbox.enviar(id, body?.texto ?? '');
  }

  @Get('nao-lidas')
  naoLidas() { return this.inbox.naoLidas(); }
}
