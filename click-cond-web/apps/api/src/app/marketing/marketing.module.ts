import { Module } from '@nestjs/common';
import { CrmAdminGuard } from '../crm/crm-admin.guard';
import { MarketingAdsService } from './marketing-ads.service';
import { MarketingLeadsService } from './marketing-leads.service';
import { MarketingResumoService } from './marketing-resumo.service';
import { MarketingPublicController } from './marketing-public.controller';
import { MarketingCrmController } from './marketing-crm.controller';
import { OpenAiAdsClient } from './openai-ads.client';
import { MarketingSegredosService } from './marketing-segredos.service';

/**
 * Não importa `CrmModule`: `CrmAdminGuard` depende só de `PrismaService`
 * (global via `PrismaModule`), e o `CrmModule` traz consigo módulos pesados
 * (Ocorrencias, Moradores, Apartamentos, Facial, Superlogica) que não têm
 * nada a ver com Marketing. Prover o guard direto aqui evita esse
 * acoplamento e um ciclo de imports.
 */
@Module({
  controllers: [MarketingPublicController, MarketingCrmController],
  providers: [MarketingLeadsService, MarketingAdsService, MarketingResumoService, OpenAiAdsClient,
    MarketingSegredosService, CrmAdminGuard],
  exports: [MarketingLeadsService],
})
export class MarketingModule {}
