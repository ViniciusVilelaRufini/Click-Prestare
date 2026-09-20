import { Module } from '@nestjs/common';
import { VisitasService } from './visitas.service';
import { VisitasController } from './visitas.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { PessoasModule } from '../pessoas/pessoas.module';

@Module({
  imports: [PrismaModule, PessoasModule],
  controllers: [VisitasController],
  providers: [VisitasService],
  exports: [VisitasService],
})
export class VisitasModule {}
