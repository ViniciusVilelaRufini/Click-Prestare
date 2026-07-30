import { Module } from '@nestjs/common';
import { ApartamentosController } from './apartamentos.controller';
import { ApartamentosService } from './apartamentos.service';
import { AuditoriaModule } from '../auditoria/auditoria.module';

@Module({
  imports: [AuditoriaModule],
  controllers: [ApartamentosController],
  providers: [ApartamentosService],
  exports: [ApartamentosService],
})
export class ApartamentosModule {}
