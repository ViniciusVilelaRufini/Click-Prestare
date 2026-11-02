import { Module } from '@nestjs/common';
import { AwsMarketplaceController } from './aws-marketplace.controller';
import { AwsMarketplaceService } from './aws-marketplace.service';

@Module({
  controllers: [AwsMarketplaceController],
  providers: [{ provide: AwsMarketplaceService, useFactory: () => new AwsMarketplaceService() }],
})
export class AwsMarketplaceModule {}
