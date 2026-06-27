import { Module } from '@nestjs/common';
import { KabaniaController } from './kabania.controller';
import { KabaniaService } from './kabania.service';
import { KabaniaApiKeyGuard } from './kabania-api-key.guard';
import { CrmModule } from '../crm/crm.module';
import { OcorrenciasModule } from '../ocorrencias/ocorrencias.module';

@Module({
  imports: [CrmModule, OcorrenciasModule],
  controllers: [KabaniaController],
  providers: [KabaniaService, KabaniaApiKeyGuard],
  exports: [KabaniaService],
})
export class IntegrationsModule {}

