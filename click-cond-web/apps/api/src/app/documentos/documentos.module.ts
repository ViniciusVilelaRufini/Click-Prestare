import { Module } from '@nestjs/common';
import { DocumentosController } from './documentos.controller';
import { DocumentosService } from './documentos.service';
import { ChatIaModule } from '../chat-ia/chat-ia.module';

@Module({
  // ChatIaModule: ao publicar um documento ele é indexado, para o assistente
  // conseguir resumir o conteúdo ao morador.
  imports: [ChatIaModule],
  controllers: [DocumentosController],
  providers: [DocumentosService],
})
export class DocumentosModule {}
