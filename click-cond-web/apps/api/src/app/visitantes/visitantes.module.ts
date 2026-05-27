import { Module } from '@nestjs/common';
import { VisitantesController, VisitantesGlobalController } from './visitantes.controller';
import { VisitantesService } from './visitantes.service';
import { FacialModule } from '../facial/facial.module';

@Module({
  imports: [FacialModule],
  controllers: [VisitantesController, VisitantesGlobalController],
  providers: [VisitantesService],
})
export class VisitantesModule {}
