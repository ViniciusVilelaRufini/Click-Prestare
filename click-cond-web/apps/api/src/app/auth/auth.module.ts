import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { MobileAuthService } from './mobile-auth.service';
import { QrSessionStore } from './qr-session.store';
import { resolveJwtSecret } from './jwt-secret';
import {
  SindicoMobileController,
  MoradoresMobileController,
  FuncionariosMobileController,
  DashboardMobileController,
  CondominioMobileController,
  ApartamentosMobileController,
  OcorrenciasMobileController,
  EncomendasMobileController,
  VeiculosMobileController,
  VagasMobileController,
  UsersMobileController,
} from './mobile-auth.controller';

import { OcorrenciasModule } from '../ocorrencias/ocorrencias.module';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: resolveJwtSecret(),
      // Default reduzido de 7d para 8h: porteiro fica logado durante o turno,
      // mas crachá expira no dia seguinte. Reduz janela de exposição se
      // o token vazar. Override via JWT_EXPIRES_IN para casos especiais.
      signOptions: { expiresIn: (process.env['JWT_EXPIRES_IN'] ?? '8h') as any },
    }),
    OcorrenciasModule,
  ],
  controllers: [
    AuthController,
    SindicoMobileController,
    MoradoresMobileController,
    FuncionariosMobileController,
    DashboardMobileController,
    CondominioMobileController,
    ApartamentosMobileController,
    OcorrenciasMobileController,
    EncomendasMobileController,
    VeiculosMobileController,
    VagasMobileController,
    UsersMobileController,
  ],
  providers: [AuthService, MobileAuthService, JwtStrategy, QrSessionStore],
  exports: [AuthService, QrSessionStore],
})
export class AuthModule {}