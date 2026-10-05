import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseIntPipe, Post, Put, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { pipeline } from 'node:stream';
import { CrmAdminGuard } from '../crm/crm-admin.guard';
import { RangeMidiaInvalido, WhatsappInboxService } from './whatsapp-inbox.service';
import { LIMITE_MULTIPART } from './whatsapp-media.validation';
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

  @Post('conversas/:id/midias')
  @UseInterceptors(FileInterceptor('arquivo', { limits: { fileSize: LIMITE_MULTIPART } }))
  enviarMidia(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() arquivo: { buffer: Buffer; mimetype: string; originalname: string } | undefined,
    @Body() body: { tipo?: 'image' | 'video' | 'document'; legenda?: string },
  ) {
    if (!arquivo) throw new BadRequestException('Arquivo de mídia obrigatório.');
    return this.inbox.enviarMidia(id, { tipo: body?.tipo as any, arquivo, legenda: body?.legenda });
  }

  @Get('midias/:mensagemId')
  async baixarMidia(
    @Param('mensagemId', ParseIntPipe) mensagemId: number,
    @Headers('range') range: string | undefined,
    @Res() res: any,
  ) {
    let midia: any;
    try {
      midia = await this.inbox.abrirMidia(mensagemId, range);
    } catch (e) {
      if (e instanceof RangeMidiaInvalido) {
        res.status(416).setHeader('Content-Range', `bytes */${e.total}`);
        return res.end();
      }
      throw e;
    }
    res.status(range ? 206 : 200);
    res.setHeader('Content-Type', midia.mime);
    res.setHeader('Content-Length', midia.tamanho);
    res.setHeader('Accept-Ranges', 'bytes');
    if (midia.nome) res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(midia.nome)}`);
    if (range) res.setHeader('Content-Range', `bytes ${midia.inicio}-${midia.fim}/${midia.total}`);
    return new Promise<void>((resolve) => pipeline(midia.stream, res, (erro: Error | null) => {
      if (erro && !res.headersSent) res.status(502).end();
      else if (erro && typeof res.destroy === 'function') res.destroy(erro);
      resolve();
    }));
  }

  @Post('leads/:leadId/iniciar')
  iniciar(@Param('leadId', ParseIntPipe) leadId: number) {
    return this.inbox.iniciarConversa(leadId);
  }

  @Post('contatos')
  novoContato(@Body() body: { nome?: string; telefone?: string; condominio?: string }) {
    return this.inbox.novoContato(body ?? {});
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
