import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CaminhosAcessoController } from './caminhos-acesso.controller';
import { CaminhosAcessoService } from './caminhos-acesso.service';
import { AuditoriaModule } from '../auditoria/auditoria.module';

@Module({
  imports: [PrismaModule, AuditoriaModule],
  controllers: [CaminhosAcessoController],
  providers: [CaminhosAcessoService],
  exports: [CaminhosAcessoService],
})
export class CaminhosAcessoModule {}
