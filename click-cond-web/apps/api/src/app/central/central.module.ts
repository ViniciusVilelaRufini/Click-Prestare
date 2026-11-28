import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { resolveJwtSecret } from '../auth/jwt-secret';
import { InterfoneModule } from '../interfone/interfone.module';
import { CentralAuthController } from './central-auth.controller';
import { CentralAuthService } from './central-auth.service';
import { CentralController } from './central.controller';
import { CentralService } from './central.service';

/**
 * Central de portaria da Prestare (operadores que atendem vários condomínios). PrismaService,
 * MailService, Storage e Realtime vêm dos módulos globais. Mesmo segredo de JWT do resto da API:
 * a JwtStrategy e o gateway em tempo real conferem o token do operador. InterfoneModule: núcleo
 * e ações da chamada (atender, abrir, encerrar, ligar).
 */
@Module({
  imports: [JwtModule.register({ secret: resolveJwtSecret() }), InterfoneModule],
  controllers: [CentralAuthController, CentralController],
  providers: [CentralAuthService, CentralService],
  exports: [CentralAuthService],
})
export class CentralModule {}
