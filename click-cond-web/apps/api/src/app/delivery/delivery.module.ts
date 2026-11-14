import { Module } from '@nestjs/common';
import { CardAoVivoModule } from '../card-ao-vivo/card-ao-vivo.module';
import { FacialModule } from '../facial/facial.module';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';
import { DeliveryPortaoService } from './portao/delivery-portao.service';

@Module({
  // Card ao vivo do atendimento (spec 2026-11-13-card-ao-vivo-delivery).
  // Facial: o autoatendimento do portão abre o aparelho do pedido
  // (FacialService.abrirDispositivoInterno). FacialModule não importa este
  // módulo, então não há ciclo.
  imports: [CardAoVivoModule, FacialModule],
  controllers: [DeliveryController],
  providers: [DeliveryService, DeliveryPortaoService],
  exports: [DeliveryService],
})
export class DeliveryModule {}
