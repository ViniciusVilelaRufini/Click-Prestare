import { Module } from '@nestjs/common';
import { ChatIaController } from './chat-ia.controller';
import { ChatIaService } from './chat-ia.service';
import { GeminiClient } from './gemini.client';
import { AcaoPendenteStore } from './acao-pendente.store';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantAccessModule } from '../auth/tenant-access.module';
import { AreasSociaisModule } from '../areas-sociais/areas-sociais.module';
import { OcorrenciasModule } from '../ocorrencias/ocorrencias.module';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { VisitantesModule } from '../visitantes/visitantes.module';
import { FinanceiroModule } from '../financeiro/financeiro.module';

@Module({
  // As ações confirmadas executam pelos services de verdade, não por queries
  // próprias — é lá que vivem as regras de negócio e as validações.
  imports: [
    PrismaModule,
    TenantAccessModule,
    AreasSociaisModule,
    OcorrenciasModule,
    AuditoriaModule,
    VisitantesModule,
    FinanceiroModule,
  ],
  controllers: [ChatIaController],
  providers: [ChatIaService, GeminiClient, AcaoPendenteStore],
  // Exportado para o módulo de documentos indexar no upload.
  exports: [ChatIaService],
})
export class ChatIaModule {}
