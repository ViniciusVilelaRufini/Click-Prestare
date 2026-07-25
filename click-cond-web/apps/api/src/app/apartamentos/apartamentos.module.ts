import { Module } from '@nestjs/common';
import { ApartamentosController } from './apartamentos.controller';
import { ApartamentosService } from './apartamentos.service';

@Module({
  controllers: [ApartamentosController],
  providers: [ApartamentosService],
  exports: [ApartamentosService],
})
export class ApartamentosModule {}
