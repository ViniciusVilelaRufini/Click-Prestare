import { Module } from '@nestjs/common';
import { VisitantesModule } from '../visitantes/visitantes.module';
import { CredenciaisNucleoModule } from './credenciais-nucleo.module';
import { CredenciaisController, PassesPublicosController } from './credenciais.controller';
import { CredenciaisService } from './credenciais.service';
import { WalletModule } from '../wallet/wallet.module';

/**
 * Emissão da credencial dinâmica, link do passe do visitante e a opção "QR
 * no app". Depende de VisitantesModule para decidir quem pode gerar o link
 * de uma visita (mesmas travas das outras ações sobre ela). A validação no
 * leitor fica no CredenciaisNucleoModule, usado pelo FacialModule.
 */
@Module({
  // WalletModule: a opção do condomínio marca os passes da carteira.
  imports: [VisitantesModule, CredenciaisNucleoModule, WalletModule],
  controllers: [CredenciaisController, PassesPublicosController],
  providers: [CredenciaisService],
})
export class CredenciaisModule {}
