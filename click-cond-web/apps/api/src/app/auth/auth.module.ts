import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { MobileAuthService } from './mobile-auth.service';
import { QrSessionStore } from './qr-session.store';
import {
  SindicoMobileController,
  MoradoresMobileController,
  FuncionariosMobileController,
  DashboardMobileController,
  CondominioMobileController,
  ApartamentosMobileController,
  OcorrenciasMobileController,
  EncomendasMobileController,
} from './mobile-auth.controller';

import { OcorrenciasModule } from '../ocorrencias/ocorrencias.module';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: process.env['JWT_SECRET'] ?? 'fallback-secret',
      signOptions: { expiresIn: (process.env['JWT_EXPIRES_IN'] ?? '7d') as any },
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
  ],
  providers: [AuthService, MobileAuthService, JwtStrategy, QrSessionStore],
  exports: [AuthService, QrSessionStore],
})
export class AuthModule {}