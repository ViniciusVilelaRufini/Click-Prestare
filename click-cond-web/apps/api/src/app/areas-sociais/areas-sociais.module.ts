import { Module } from '@nestjs/common';
import { AreasSociaisController } from './areas-sociais.controller';
import { AreasSociaisService } from './areas-sociais.service';
import { FacialModule } from '../facial/facial.module';

@Module({
  imports: [FacialModule],
  controllers: [AreasSociaisController],
  providers: [AreasSociaisService],
  // Exportado para o ChatIaModule executar reservas propostas pelo assistente.
  exports: [AreasSociaisService],
})
export class AreasSociaisModule {}
