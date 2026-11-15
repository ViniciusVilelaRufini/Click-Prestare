import { Module } from '@nestjs/common';
import { MoradoresController } from './moradores.controller';
import { MoradoresService } from './moradores.service';
import { FacialModule } from '../facial/facial.module';
import { SuperlogicaModule } from '../superlogica/superlogica.module';
import { WalletModule } from '../wallet/wallet.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  // SuperlogicaModule para o envio de morador ao ERP (mão dupla). A seta vai
  // só nesta direção: o módulo Superlógica não depende de Moradores — quem
  // orquestra a importação de contatos é o CRM, que conhece os dois.
  // WalletModule: excluir o morador invalida o passe da carteira dele.
  // AuthModule: "Enviar Acesso" para quem já tem senha manda o link do "Esqueci a senha"
  // (MobileAuthService). O AuthModule não importa Moradores, então não há ciclo.
  imports: [FacialModule, SuperlogicaModule, WalletModule, AuthModule],
  controllers: [MoradoresController],
  providers: [MoradoresService],
  exports: [MoradoresService],
})
export class MoradoresModule {}
