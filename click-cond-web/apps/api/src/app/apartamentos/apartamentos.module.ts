import { Module } from '@nestjs/common';
import { ApartamentosController } from './apartamentos.controller';
import { ApartamentosService } from './apartamentos.service';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { GuaritaNucleoModule } from '../guarita/guarita-nucleo.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  // GuaritaNucleoModule: remover a unidade tira do Guarita os dispositivos de quem morava nela.
  // WalletModule: quem fica sem unidade perde o QR do app e o passe da carteira.
  imports: [AuditoriaModule, GuaritaNucleoModule, WalletModule],
  controllers: [ApartamentosController],
  providers: [ApartamentosService],
  exports: [ApartamentosService],
})
export class ApartamentosModule {}
