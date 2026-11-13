import { Module } from '@nestjs/common';
import { CardAoVivoController } from './card-ao-vivo.controller';
import { CardAoVivoService } from './card-ao-vivo.service';

// Prisma, Notifications e Storage são módulos globais.
@Module({
  controllers: [CardAoVivoController],
  providers: [CardAoVivoService],
  exports: [CardAoVivoService],
})
export class CardAoVivoModule {}
