import { Module } from '@nestjs/common';
import { VisitantesController, VisitantesGlobalController } from './visitantes.controller';
import { VisitantesService } from './visitantes.service';

@Module({
  controllers: [VisitantesController, VisitantesGlobalController],
  providers: [VisitantesService],
})
export class VisitantesModule {}
