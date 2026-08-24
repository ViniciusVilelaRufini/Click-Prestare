import { Module } from '@nestjs/common';
import { ComunicadosController } from './comunicados.controller';
import { ComunicadosMobileController } from './comunicados-mobile.controller';
import { ComunicadosService } from './comunicados.service';

@Module({
  controllers: [ComunicadosController, ComunicadosMobileController],
  providers: [ComunicadosService],
  exports: [ComunicadosService],
})
export class ComunicadosModule {}
