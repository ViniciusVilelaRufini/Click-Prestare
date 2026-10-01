import { Module } from '@nestjs/common';
import { CrmAdminGuard } from '../crm/crm-admin.guard';
import { MarketingModule } from '../marketing/marketing.module';
import { WhatsappCrmController } from './whatsapp-crm.controller';
import { WhatsappGraphClient } from './whatsapp-graph.client';
import { WhatsappInboxService } from './whatsapp-inbox.service';
import { WhatsappConfigService } from './whatsapp-config.service';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';
import { WhatsappMediaService } from './whatsapp-media.service';

@Module({
  imports: [MarketingModule],
  controllers: [WhatsappWebhookController, WhatsappCrmController],
  providers: [
    WhatsappInboxService, WhatsappConfigService, WhatsappGraphClient, CrmAdminGuard,
    { provide: WhatsappMediaService, useFactory: (graph: WhatsappGraphClient) => new WhatsappMediaService(graph), inject: [WhatsappGraphClient] },
  ],
})
export class WhatsappModule {}
