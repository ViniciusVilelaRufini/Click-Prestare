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

@Module({
  controllers: [
    FacialController,
    FacialWebhookController,
    FacialSimulatorController,
    MockRelayController,
    AgentController,
  ],
  providers: [
    FacialService,
    FacialDeviceClientService,
    MockRelayService,
    EnrollSessionService,
    AccessStateService,
    AgentBridgeService,
  ],
  exports: [FacialService],
})
export class FacialModule {}
