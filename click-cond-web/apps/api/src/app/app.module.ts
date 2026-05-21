import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { VisitantesModule } from './visitantes/visitantes.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { MoradoresModule } from './moradores/moradores.module';
import { ApartamentosModule } from './apartamentos/apartamentos.module';
import { PrestadoresModule } from './prestadores/prestadores.module';
import { OcorrenciasModule } from './ocorrencias/ocorrencias.module';
import { ComunicadosModule } from './comunicados/comunicados.module';
import { EncomendasModule } from './encomendas/encomendas.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AreasSociaisModule } from './areas-sociais/areas-sociais.module';
import { AssembleiasModule } from './assembleias/assembleias.module';
import { FinanceiroModule } from './financeiro/financeiro.module';
import { DocumentosModule } from './documentos/documentos.module';
import { MudancasModule } from './mudancas/mudancas.module';
import { MailModule } from './common/mail/mail.module';
import { StorageModule } from './common/storage/storage.module';

import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000,
        limit: 20, // 20 req/s por IP — protege contra burst
      },
      {
        name: 'medium',
        ttl: 60000,
        limit: 600, // 600 req/min por IP — uso normal do app
      },
    ]),
    MailModule,
    StorageModule,
    PrismaModule,
    AuthModule,
    DashboardModule,
    VisitantesModule,
    MoradoresModule,
    ApartamentosModule,
    PrestadoresModule,
    OcorrenciasModule,
    ComunicadosModule,
    EncomendasModule,
    NotificationsModule,
    AreasSociaisModule,
    AssembleiasModule,
    FinanceiroModule,
    DocumentosModule,
    MudancasModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}