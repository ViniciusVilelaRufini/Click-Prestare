import { Module } from '@nestjs/common';
import { FacialModule } from '../facial/facial.module';
import { InterfoneAcoesService } from './interfone-acoes.service';
import { InterfoneAppController } from './interfone-app.controller';
import { InterfoneConfigService } from './interfone-config.service';
import { InterfoneSindicoController } from './interfone-sindico.controller';
import { InterfoneFotoService } from './interfone-foto.service';
import { InterfoneInternoController } from './interfone-interno.controller';
import { InterfonePortariaController } from './interfone-portaria.controller';
import { InterfonePushService } from './interfone-push.service';
import { InterfoneService } from './interfone.service';
import { VozControleClient } from './voz-controle.client';

// Prisma, Notifications, Storage, Auditoria e Realtime são módulos globais.
// FacialModule: abrir o portão da chamada (FacialService.abrirDispositivoInterno) e a
// foto do visitante (AgentBridgeService, comando snapshot).
@Module({
  imports: [FacialModule],
  controllers: [InterfoneInternoController, InterfoneAppController, InterfonePortariaController, InterfoneSindicoController],
  providers: [
    InterfoneService,
    InterfoneAcoesService,
    InterfoneConfigService,
    InterfonePushService,
    InterfoneFotoService,
    VozControleClient,
  ],
  // InterfoneConfigService: o CRM liga o módulo (crm/crm-interfone.controller.ts).
  exports: [InterfoneService, InterfoneAcoesService, InterfoneConfigService, InterfonePushService, VozControleClient],
})
export class InterfoneModule {}
