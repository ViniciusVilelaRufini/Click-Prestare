import { Controller, Get, UseGuards, Put, Post, Param, Body, ParseIntPipe } from '@nestjs/common';
import { KabaniaService } from './kabania.service';
import { KabaniaApiKeyGuard } from './kabania-api-key.guard';
import { Public } from '../auth/public.decorator';

@Controller('integrations/kabania')
export class KabaniaController {
  constructor(private readonly kabaniaService: KabaniaService) {}

  @Public()
  @UseGuards(KabaniaApiKeyGuard)
  @Get('sync-data')
  async getSyncData() {
    return this.kabaniaService.getSyncData();
  }

  @Public()
  @UseGuards(KabaniaApiKeyGuard)
  @Put('ocorrencias/:id/resolve')
  async resolveOccurrence(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { resposta: string }
  ) {
    return this.kabaniaService.resolveOccurrence(id, body.resposta);
  }

  @Public()
  @UseGuards(KabaniaApiKeyGuard)
  @Post('ocorrencias/:id/mensagem')
  async resolveOccurrenceMessage(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { mensagem: string }
  ) {
    return this.kabaniaService.resolveOccurrenceMessage(id, body.mensagem);
  }
}

