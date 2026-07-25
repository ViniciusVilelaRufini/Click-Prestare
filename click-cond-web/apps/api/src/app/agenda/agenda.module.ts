import { Module } from '@nestjs/common';
import { AgendaController } from './agenda.controller';
import { AgendaService } from './agenda.service';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantAccessModule } from '../auth/tenant-access.module';

@Module({
  imports: [PrismaModule, TenantAccessModule],
  controllers: [AgendaController],
  providers: [AgendaService],
})
export class AgendaModule {}
