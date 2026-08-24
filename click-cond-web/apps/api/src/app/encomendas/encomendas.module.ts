import { Module } from '@nestjs/common';
import { EncomendasController } from './encomendas.controller';
import { EncomendasService } from './encomendas.service';

@Module({
  controllers: [EncomendasController],
  providers: [EncomendasService],
  exports: [EncomendasService],
})
export class EncomendasModule {}
