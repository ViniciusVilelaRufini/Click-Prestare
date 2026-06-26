import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RegrasAcessoController } from './regras-acesso.controller';
import { RegrasAcessoService } from './regras-acesso.service';
import { FacialModule } from '../facial/facial.module';

@Module({
  // FacialModule: ao mudar uma regra, re-sincronizamos os rostos do aparelho
  // (cadastra/remove por categoria) para a regra valer FISICAMENTE.
  imports: [PrismaModule, FacialModule],
  controllers: [RegrasAcessoController],
  providers: [RegrasAcessoService],
  exports: [RegrasAcessoService],
})
export class RegrasAcessoModule {}
