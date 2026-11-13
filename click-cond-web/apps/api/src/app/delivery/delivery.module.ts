import { Module } from '@nestjs/common';
import { CardAoVivoModule } from '../card-ao-vivo/card-ao-vivo.module';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';

@Module({
  // Card ao vivo do atendimento (spec 2026-11-13-card-ao-vivo-delivery).
  imports: [CardAoVivoModule],
  controllers: [DeliveryController],
  providers: [DeliveryService],
  exports: [DeliveryService],
})
export class DeliveryModule {}
