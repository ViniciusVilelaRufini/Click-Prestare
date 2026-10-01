import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseIntPipe, Post, Put, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Transform } from 'node:stream';
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

  @Post('conversas/:id/midias')
  @UseInterceptors(FileInterceptor('arquivo'))
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
    const midia = await this.inbox.abrirMidia(mensagemId);
    const intervalo = this.intervalo(range, midia.tamanho);
    if (range && !intervalo) {
      res.status(416).setHeader('Content-Range', `bytes */${midia.tamanho}`);
      return res.end();
    }
    const inicio = intervalo?.inicio ?? 0;
    const fim = intervalo?.fim ?? midia.tamanho - 1;
    const tamanho = Math.max(0, fim - inicio + 1);
    res.status(intervalo ? 206 : 200);
    res.setHeader('Content-Type', midia.mime);
    res.setHeader('Content-Length', tamanho);
    res.setHeader('Accept-Ranges', 'bytes');
    if (midia.nome) res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(midia.nome)}`);
    if (intervalo) res.setHeader('Content-Range', `bytes ${inicio}-${fim}/${midia.tamanho}`);
    return (intervalo ? midia.stream.pipe(this.fatiar(inicio, fim)) : midia.stream).pipe(res);
  }

  private intervalo(range: string | undefined, total: number): { inicio: number; fim: number } | null {
    if (!range) return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match || total <= 0) return null;
    const [, inicioValor, fimValor] = match;
    if (!inicioValor && !fimValor) return null;
    const inicio = inicioValor ? Number(inicioValor) : Math.max(0, total - Number(fimValor));
    const fim = fimValor && inicioValor ? Math.min(Number(fimValor), total - 1) : total - 1;
    if (!Number.isSafeInteger(inicio) || !Number.isSafeInteger(fim) || inicio < 0 || inicio > fim || inicio >= total) return null;
    return { inicio, fim };
  }

  private fatiar(inicio: number, fim: number): Transform {
    let posicao = 0;
    return new Transform({
      transform(chunk, _encoding, callback) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const doChunk = posicao;
        posicao += buffer.length;
        const de = Math.max(inicio - doChunk, 0);
        const ate = Math.min(fim - doChunk + 1, buffer.length);
        if (de < ate) this.push(buffer.subarray(de, ate));
        callback();
      },
    });
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
