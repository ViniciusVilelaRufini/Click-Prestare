import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { TenantAccessModule } from './auth/tenant-access.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { TenantGuard } from './auth/tenant.guard';
import { VisitantesModule } from './visitantes/visitantes.module';
import { PessoasModule } from './pessoas/pessoas.module';
import { VisitasModule } from './visitas/visitas.module';
import { ConvitesModule } from './convites/convites.module';
import { CredenciaisModule } from './credenciais/credenciais.module';
import { ConsentimentosModule } from './consentimentos/consentimentos.module';
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
import { RelatoriosModule } from './relatorios/relatorios.module';
import { FacialModule } from './facial/facial.module';
import { RegrasAcessoModule } from './regras-acesso/regras-acesso.module';
import { CaminhosAcessoModule } from './caminhos-acesso/caminhos-acesso.module';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { ArquivosPrivadosInterceptor } from './common/interceptors/arquivos-privados.interceptor';
import { AuditoriaModule } from './auditoria/auditoria.module';
import { CrmModule } from './crm/crm.module';
import { MarketingModule } from './marketing/marketing.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { AwsMarketplaceModule } from './aws-marketplace/aws-marketplace.module';
import { VeiculosModule } from './veiculos/veiculos.module';
import { VagasModule } from './vagas/vagas.module';
import { ContatosModule } from './contatos/contatos.module';
import { RealtimeModule } from './realtime/realtime.module';
import { CardAoVivoModule } from './card-ao-vivo/card-ao-vivo.module';
import { AgendaModule } from './agenda/agenda.module';
import { ChatIaModule } from './chat-ia/chat-ia.module';
import { SuperlogicaModule } from './superlogica/superlogica.module';
import { DeliveryModule } from './delivery/delivery.module';

import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { THROTTLERS } from './common/throttle/throttlers';

@Module({
  imports: [
    ThrottlerModule.forRoot(THROTTLERS),
    MailModule,
    StorageModule,
    PrismaModule,
    TenantAccessModule,
    AuthModule,
    DashboardModule,
    VisitantesModule,
    PessoasModule,
    VisitasModule,
    ConvitesModule,
    CredenciaisModule,
    ConsentimentosModule,
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
    RelatoriosModule,
    FacialModule,
    RegrasAcessoModule,
    CaminhosAcessoModule,
    AuditoriaModule,
    CrmModule,
    MarketingModule,
    WhatsappModule,
    AwsMarketplaceModule,
    VeiculosModule,
    VagasModule,
    ContatosModule,
    RealtimeModule,
    CardAoVivoModule,
    AgendaModule,
    ChatIaModule,
    SuperlogicaModule,
    DeliveryModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Ordem importa: o Nest roda os APP_GUARD na ordem do registro. O throttle
    // vem primeiro para que requisições recusadas com 401/403 também consumam
    // o limite (pentest I-01). Ele usa só o IP, não precisa de req.user.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ArquivosPrivadosInterceptor },
  ],
})
export class AppModule {}
