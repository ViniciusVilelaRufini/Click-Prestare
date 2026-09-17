import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RelatoriosController, CondominiosExportController } from './relatorios.controller';
import { RelatoriosService } from './relatorios.service';
import { CondominiosExportService } from './condominios-export.service';

@Module({
  imports: [PrismaModule],
  controllers: [RelatoriosController, CondominiosExportController],
  providers: [RelatoriosService, CondominiosExportService],
  exports: [RelatoriosService, CondominiosExportService],
})
export class RelatoriosModule {}
