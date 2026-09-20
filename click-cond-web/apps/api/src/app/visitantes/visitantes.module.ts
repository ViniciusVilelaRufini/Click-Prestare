import { Module } from '@nestjs/common';
import { VisitantesController, VisitantesGlobalController } from './visitantes.controller';
import { VisitantesService } from './visitantes.service';
import { FacialModule } from '../facial/facial.module';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { PessoasModule } from '../pessoas/pessoas.module';
import { VisitasModule } from '../visitas/visitas.module';

@Module({
  imports: [FacialModule, AuditoriaModule, PessoasModule, VisitasModule],
  controllers: [VisitantesController, VisitantesGlobalController],
  providers: [VisitantesService],
  // Exportado para o ChatIaModule cadastrar visitantes propostos pelo assistente.
  exports: [VisitantesService],
})
export class VisitantesModule {}
