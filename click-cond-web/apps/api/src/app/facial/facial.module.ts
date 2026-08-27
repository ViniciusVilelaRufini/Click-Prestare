import { Module } from '@nestjs/common';
import {
  FacialController,
  FacialSimulatorController,
  FacialWebhookController,
  MockRelayController,
} from './facial.controller';
import { AgentController } from './agent.controller';
import { FacialService } from './facial.service';
import { FacialDeviceClientService } from './facial-device-client.service';
import { MockRelayService } from './mock-relay.service';
import { EnrollSessionService } from './enroll-session.service';
import { AccessStateService } from './access-state.service';
import { AgentBridgeService } from './agent-bridge.service';

/**
 * O simulador de terminal e a botoeira mock são andaimes de teste — existem
 * para exercitar o fluxo sem hardware. Estavam montados em produção:
 *
 *  - `GET /facial/simulator/:token/persons` devolve NOME e FOTO de todos os
 *    moradores e visitantes ativos do condomínio. É `@Public()`, autenticada
 *    só pelo webhook_token do device — token que viaja em URL no webhook e
 *    portanto acaba em log de acesso e de proxy.
 *  - `/facial/sim/relay/:slug/*` não tem autenticação nenhuma.
 *
 * Passam a ser montados apenas quando `FACIAL_SIMULATOR_ENABLED=true`. Sem a
 * env (o caso do Railway), as rotas simplesmente não existem — 404, que é a
 * resposta certa para andaime que não deveria estar lá.
 */
const simuladorHabilitado =
  String(process.env['FACIAL_SIMULATOR_ENABLED'] ?? '').toLowerCase() === 'true';

@Module({
  controllers: [
    FacialController,
    FacialWebhookController,
    AgentController,
    ...(simuladorHabilitado ? [FacialSimulatorController, MockRelayController] : []),
  ],
  providers: [
    FacialService,
    FacialDeviceClientService,
    MockRelayService,
    EnrollSessionService,
    AccessStateService,
    AgentBridgeService,
  ],
  // FacialDeviceClientService é exportado porque o CRM precisa dele para
  // desprovisionar a biometria dos terminais antes de excluir um condomínio
  // (CrmCondominiosService). Sem o export, o Nest não resolve a injeção e
  // derruba a aplicação inteira no bootstrap, não só o módulo do CRM.
  exports: [FacialService, AgentBridgeService, FacialDeviceClientService],
})
export class FacialModule {}
