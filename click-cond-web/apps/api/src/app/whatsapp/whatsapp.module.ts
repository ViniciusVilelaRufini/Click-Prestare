import { Module } from '@nestjs/common';
import { CrmAdminGuard } from '../crm/crm-admin.guard';
import { MarketingModule } from '../marketing/marketing.module';
import { WhatsappCrmController } from './whatsapp-crm.controller';
import { WhatsappGraphClient } from './whatsapp-graph.client';
import { WhatsappInboxService } from './whatsapp-inbox.service';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

@Module({
  imports: [MarketingModule],
  controllers: [WhatsappWebhookController, WhatsappCrmController],
  providers: [WhatsappInboxService, WhatsappGraphClient, CrmAdminGuard],
})
export class WhatsappModule {}
