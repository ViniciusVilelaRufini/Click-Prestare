import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { MobileAuthService } from './mobile-auth.service';
import { QrSessionStore } from './qr-session.store';
import { resolveJwtSecret } from './jwt-secret';
import { MfaService } from './mfa/mfa.service';
import { MfaController } from './mfa/mfa.controller';
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
import { EquipePortariaController } from './equipe-portaria.controller';

import { OcorrenciasModule } from '../ocorrencias/ocorrencias.module';
import { FacialModule } from '../facial/facial.module';
import { FinanceiroModule } from '../financeiro/financeiro.module';
import { ApartamentosModule } from '../apartamentos/apartamentos.module';
import { EncomendasModule } from '../encomendas/encomendas.module';
import { SuperlogicaModule } from '../superlogica/superlogica.module';
import { CardAoVivoModule } from '../card-ao-vivo/card-ao-vivo.module';
import { WalletModule } from '../wallet/wallet.module';
import { GuaritaNucleoModule } from '../guarita/guarita-nucleo.module';

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
    CardAoVivoModule,
    // O saldo do card do dashboard vem do mesmo cálculo da tela de Financeiro.
    FinanceiroModule,
    // removeApto delega a exclusao (e a auditoria da cascata) para ca.
    ApartamentosModule,
    EncomendasModule,
    // Mão dupla com a Superlógica: o cadastro de morador feito PELO APP entra
    // por saveMorador aqui, não pelo MoradoresService do painel web.
    SuperlogicaModule,
    // Excluir morador (removeMorador) ou a conta revoga os passes da carteira.
    WalletModule,
    // Módulo Guarita: veículos/tags do app e exclusões de morador/conta.
    GuaritaNucleoModule,
  ],
  controllers: [
    AuthController,
    MfaController,
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
    EquipePortariaController,
  ],
  providers: [AuthService, MobileAuthService, MfaService, JwtStrategy, QrSessionStore],
  // MobileAuthService: o "Enviar Acesso" do console manda o mesmo link do "Esqueci a senha" do morador.
  exports: [AuthService, MfaService, QrSessionStore, MobileAuthService],
})
export class AuthModule {}