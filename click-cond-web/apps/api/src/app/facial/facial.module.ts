import { Module } from '@nestjs/common';
import {
  FacialController,
  FacialSimulatorController,
  FacialWebhookController,
} from './facial.controller';
import { FacialService } from './facial.service';
import { FacialDeviceClientService } from './facial-device-client.service';

@Module({
  controllers: [FacialController, FacialWebhookController, FacialSimulatorController],
  providers: [FacialService, FacialDeviceClientService],
  exports: [FacialService],
})
export class FacialModule {}
