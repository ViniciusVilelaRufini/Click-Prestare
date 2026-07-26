import { Module } from '@nestjs/common';
import { FinanceiroController } from './financeiro.controller';
import { FinanceiroService } from './financeiro.service';
import { FechamentoService } from './fechamento.service';
import { OpenPixService } from './openpix.service';
import { MailModule } from '../common/mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [MailModule, NotificationsModule],
  controllers: [FinanceiroController],
  providers: [FinanceiroService, FechamentoService, OpenPixService],
  // FinanceiroService exportado para o ChatIaModule lançar as contas pessoais
  // propostas pelo assistente.
  exports: [FechamentoService, OpenPixService, FinanceiroService],
})
export class FinanceiroModule {}
