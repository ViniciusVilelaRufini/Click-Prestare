import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RegrasAcessoController } from './regras-acesso.controller';
import { RegrasAcessoService } from './regras-acesso.service';

@Module({
  imports: [PrismaModule],
  controllers: [RegrasAcessoController],
  providers: [RegrasAcessoService],
  exports: [RegrasAcessoService],
})
export class RegrasAcessoModule {}
