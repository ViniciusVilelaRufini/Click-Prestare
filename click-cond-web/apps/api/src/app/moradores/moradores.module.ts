import { Module } from '@nestjs/common';
import { MoradoresController } from './moradores.controller';
import { MoradoresService } from './moradores.service';
import { FacialModule } from '../facial/facial.module';

@Module({
  imports: [FacialModule],
  controllers: [MoradoresController],
  providers: [MoradoresService],
  exports: [MoradoresService],
})
export class MoradoresModule {}
