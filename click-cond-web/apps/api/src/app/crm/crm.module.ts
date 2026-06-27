import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { CrmAuthController } from './crm-auth.controller';
import { CrmAuthService } from './crm-auth.service';
import { CrmAdminGuard } from './crm-admin.guard';
import { resolveJwtSecret } from '../auth/jwt-secret';
import { OcorrenciasModule } from '../ocorrencias/ocorrencias.module';

@Module({
  imports: [
    // Mesmo segredo/expiração do AuthModule, para que os tokens emitidos aqui
    // sejam validados pela JwtStrategy global.
    JwtModule.register({
      secret: resolveJwtSecret(),
      signOptions: { expiresIn: (process.env['JWT_EXPIRES_IN'] ?? '8h') as any },
    }),
    OcorrenciasModule,
  ],
  controllers: [CrmController, CrmAuthController],
  providers: [CrmService, CrmAuthService, CrmAdminGuard],
  exports: [CrmService],
})
export class CrmModule {}

