import { Module } from '@nestjs/common';
import { InterfoneInternoController } from './interfone-interno.controller';
import { InterfonePushService } from './interfone-push.service';
import { InterfoneService } from './interfone.service';
import { VozControleClient } from './voz-controle.client';

// Prisma, Notifications, Storage, Auditoria e Realtime são módulos globais.
@Module({
  controllers: [InterfoneInternoController],
  providers: [InterfoneService, InterfonePushService, VozControleClient],
  exports: [InterfoneService, InterfonePushService, VozControleClient],
})
export class InterfoneModule {}
