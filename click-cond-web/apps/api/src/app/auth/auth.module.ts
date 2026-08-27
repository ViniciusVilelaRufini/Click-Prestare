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
import { EncomendasModule } from '../encomendas/encomendas.module';
import { SuperlogicaModule } from '../superlogica/superlogica.module';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: resolveJwtSecret(),
      // Sessão estendida para 365 dias: mantém moradores e síndicos logados no app móvel
      // sem deslogar diariamente.
      signOptions: { expiresIn: '365d' },
    }),
    OcorrenciasModule,
    FacialModule,
    // O saldo do card do dashboard vem do mesmo cálculo da tela de Financeiro.
    FinanceiroModule,
    // removeApto delega a exclusao (e a auditoria da cascata) para ca.
    ApartamentosModule,
    EncomendasModule,
    // Mão dupla com a Superlógica: o cadastro de morador feito PELO APP entra
    // por saveMorador aqui, não pelo MoradoresService do painel web.
    SuperlogicaModule,
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