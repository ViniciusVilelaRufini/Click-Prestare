import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RealtimeGateway } from './realtime.gateway';
import { resolveJwtSecret } from '../auth/jwt-secret';

// @Global() para qualquer service (visitantes, dashboard, etc.) injetar
// RealtimeGateway sem precisar importar este módulo em cada feature module —
// mesma conveniência do PrismaModule.
@Global()
@Module({
  imports: [
    JwtModule.register({ secret: resolveJwtSecret() }),
  ],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
