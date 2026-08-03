import { Module } from '@nestjs/common';
import { VagasController } from './vagas.controller';
import { VagasService } from './vagas.service';
import { FacialModule } from '../facial/facial.module';

@Module({
  imports: [FacialModule],
  controllers: [VagasController],
  providers: [VagasService],
})
export class VagasModule {}
