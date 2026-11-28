import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { resolveJwtSecret } from '../auth/jwt-secret';
import { CentralAuthController } from './central-auth.controller';
import { CentralAuthService } from './central-auth.service';

/**
 * Central de portaria da Prestare (operadores que atendem vários condomínios). PrismaService e
 * MailService vêm dos módulos globais. Mesmo segredo de JWT do resto da API: a JwtStrategy e o
 * gateway em tempo real conferem o token do operador.
 */
@Module({
  imports: [JwtModule.register({ secret: resolveJwtSecret() })],
  controllers: [CentralAuthController],
  providers: [CentralAuthService],
  exports: [CentralAuthService],
})
export class CentralModule {}
