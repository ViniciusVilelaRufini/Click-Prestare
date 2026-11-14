import { Module } from '@nestjs/common';
import { CredenciaisNucleoModule } from '../credenciais/credenciais-nucleo.module';
import { WalletChavesService } from './wallet-chaves.service';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

/**
 * Passe na carteira (Apple Wallet). Só depende do núcleo das credenciais (a
 * validação) e dos módulos globais (Prisma, Storage, TenantAccess,
 * Auditoria): o CredenciaisModule e o MoradoresModule importam este módulo
 * sem ciclo.
 */
@Module({
  imports: [CredenciaisNucleoModule],
  controllers: [WalletController],
  providers: [WalletService, WalletChavesService],
  exports: [WalletService, WalletChavesService],
})
export class WalletModule {}
