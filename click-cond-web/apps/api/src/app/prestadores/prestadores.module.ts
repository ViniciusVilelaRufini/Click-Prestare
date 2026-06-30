import { Module } from '@nestjs/common';
import { PrestadoresController } from './prestadores.controller';
import { PrestadoresMobileController } from './prestadores-mobile.controller';
import { PrestadoresService } from './prestadores.service';
import { FacialModule } from '../facial/facial.module';

@Module({
  imports: [FacialModule],
  controllers: [PrestadoresController, PrestadoresMobileController],
  providers: [PrestadoresService],
})
export class PrestadoresModule {}
