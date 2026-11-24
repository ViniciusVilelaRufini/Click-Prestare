import { Module } from '@nestjs/common';
import { AssembleiasController } from './assembleias.controller';
import { AssembleiasService } from './assembleias.service';
import { ChatIaModule } from '../chat-ia/chat-ia.module';

@Module({
  // ChatIaModule: a ATA publicada ao finalizar é indexada para o assistente.
  imports: [ChatIaModule],
  controllers: [AssembleiasController],
  providers: [AssembleiasService],
})
export class AssembleiasModule {}
