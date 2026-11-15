import { Module } from '@nestjs/common';
import { ApartamentosController } from './apartamentos.controller';
import { ApartamentosService } from './apartamentos.service';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { GuaritaNucleoModule } from '../guarita/guarita-nucleo.module';

@Module({
  // GuaritaNucleoModule: remover a unidade tira do Guarita os dispositivos de quem morava nela.
  imports: [AuditoriaModule, GuaritaNucleoModule],
  controllers: [ApartamentosController],
  providers: [ApartamentosService],
  exports: [ApartamentosService],
})
export class ApartamentosModule {}
