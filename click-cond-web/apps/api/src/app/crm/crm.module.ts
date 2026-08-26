import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { CrmFaturasService } from './crm-faturas.service';
import { CrmAuthController } from './crm-auth.controller';
import { CrmAuthService } from './crm-auth.service';
import { CrmAdminGuard } from './crm-admin.guard';
import { resolveJwtSecret } from '../auth/jwt-secret';
import { OcorrenciasModule } from '../ocorrencias/ocorrencias.module';
import { MoradoresModule } from '../moradores/moradores.module';
import { ApartamentosModule } from '../apartamentos/apartamentos.module';
import { FacialModule } from '../facial/facial.module';
import { SuperlogicaModule } from '../superlogica/superlogica.module';
import { CrmSuperlogicaController } from './crm-superlogica.controller';
import { CrmSuperlogicaService } from './crm-superlogica.service';

@Module({
  imports: [
    // Mesmo segredo/expiração do AuthModule, para que os tokens emitidos aqui
    // sejam validados pela JwtStrategy global.
    JwtModule.register({
      secret: resolveJwtSecret(),
      signOptions: { expiresIn: '365d' },
    }),
    OcorrenciasModule,
    // O CRM lê moradores/apartamentos por conta própria (rotas sob CrmAdminGuard),
    // sem passar pelas rotas /condominios/:id/* que são exclusivas de cada tenant.
    MoradoresModule,
    ApartamentosModule,
    // Status ao vivo dos terminais (heartbeat do agente local), o mesmo sinal
    // que a portaria-web usa — ver AgentBridgeService.
    FacialModule,
    // Leitura do ERP Superlógica para a tela de ativação comercial.
    // (AuditoriaService vem do AuditoriaModule, que é @Global.)
    SuperlogicaModule,
  ],
  controllers: [CrmController, CrmAuthController, CrmSuperlogicaController],
  providers: [CrmService, CrmFaturasService, CrmAuthService, CrmAdminGuard, CrmSuperlogicaService],
  exports: [CrmService],
})
export class CrmModule {}

