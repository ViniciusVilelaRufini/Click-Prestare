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
  NotificacoesMobileController,
} from './mobile-auth.controller';

import { OcorrenciasModule } from '../ocorrencias/ocorrencias.module';
import { FacialModule } from '../facial/facial.module';
import { FinanceiroModule } from '../financeiro/financeiro.module';
import { ApartamentosModule } from '../apartamentos/apartamentos.module';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: resolveJwtSecret(),
      // Sessão estendida para 90 dias: mantém moradores e síndicos logados no app móvel
      // sem deslogar diariamente. Override via JWT_EXPIRES_IN se necessário.
      signOptions: { expiresIn: (process.env['JWT_EXPIRES_IN'] ?? '90d') as any },
    }),
    OcorrenciasModule,
    FacialModule,
    // O saldo do card do dashboard vem do mesmo cálculo da tela de Financeiro.
    FinanceiroModule,
    // removeApto delega a exclusao (e a auditoria da cascata) para ca.
    ApartamentosModule,
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
  NotificacoesMobileController,
  ],
  providers: [AuthService, MobileAuthService, JwtStrategy, QrSessionStore],
  exports: [AuthService, QrSessionStore],
})
export class AuthModule {}