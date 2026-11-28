import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../common/storage/storage.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { FacialModule } from '../facial/facial.module';
import { FacialService } from '../facial/facial.service';
import { AgentBridgeService } from '../facial/agent-bridge.service';
import { InterfoneModule } from './interfone.module';
import { InterfoneAcoesService } from './interfone-acoes.service';
import { InterfoneService } from './interfone.service';
import { InterfoneFotoService } from './interfone-foto.service';
@Global()
@Module({ providers: [
  { provide: PrismaService, useValue: {} }, { provide: NotificationsService, useValue: {} }, { provide: AuditoriaService, useValue: { registrar: async () => 1 } },
  { provide: StorageService, useValue: {} }, { provide: RealtimeGateway, useValue: { porteirosOnline: async () => true } }],
  exports: [PrismaService, NotificationsService, StorageService, RealtimeGateway, AuditoriaService] })
class G {}
@Module({ providers: [{ provide: FacialService, useValue: { x: 1 } }, { provide: AgentBridgeService, useValue: { y: 1 } }], exports: [FacialService, AgentBridgeService] })
class FakeFacial {}
it('o InterfoneModule resolve as dependências (FacialModule trocado por falso)', async () => {
  const m = await Test.createTestingModule({ imports: [G, InterfoneModule] }).overrideModule(FacialModule).useModule(FakeFacial).compile();
  const s: any = m.get(InterfoneAcoesService);
  expect(s.facial).toEqual({ x: 1 });
  expect(s.auditoria).toBeDefined();
  // A foto do visitante vem ligada no núcleo.
  expect(m.get(InterfoneService).foto).toBeInstanceOf(InterfoneFotoService);
});
