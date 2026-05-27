import { Module } from '@nestjs/common';
import { FacialController, FacialWebhookController } from './facial.controller';
import { FacialService } from './facial.service';
import { FacialDeviceClientService } from './facial-device-client.service';

@Module({
  controllers: [FacialController, FacialWebhookController],
  providers: [FacialService, FacialDeviceClientService],
  exports: [FacialService],
})
export class FacialModule {}
