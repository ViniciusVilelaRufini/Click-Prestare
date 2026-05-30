import { Module } from '@nestjs/common';
import {
  FacialController,
  FacialSimulatorController,
  FacialWebhookController,
  MockRelayController,
} from './facial.controller';
import { FacialService } from './facial.service';
import { FacialDeviceClientService } from './facial-device-client.service';
import { MockRelayService } from './mock-relay.service';
import { EnrollSessionService } from './enroll-session.service';
import { AccessStateService } from './access-state.service';

@Module({
  controllers: [
    FacialController,
    FacialWebhookController,
    FacialSimulatorController,
    MockRelayController,
  ],
  providers: [
    FacialService,
    FacialDeviceClientService,
    MockRelayService,
    EnrollSessionService,
    AccessStateService,
  ],
  exports: [FacialService],
})
export class FacialModule {}
