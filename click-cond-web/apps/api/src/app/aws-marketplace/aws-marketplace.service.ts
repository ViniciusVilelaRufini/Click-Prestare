import { Injectable, Logger } from '@nestjs/common';
import { MarketplaceMeteringClient, ResolveCustomerCommand } from '@aws-sdk/client-marketplace-metering';
import { fromInstanceMetadata } from '@aws-sdk/credential-providers';

// Código do produto "Prestare - Condominium Access Control" no AWS Marketplace.
export const PRODUTO_MARKETPLACE = process.env.AWS_MARKETPLACE_PRODUCT_CODE || '9wwpc0fjcjirjupzxwbxdae01';

export interface ClienteMarketplace {
  customerIdentifier: string;
  awsAccountId: string | null;
}

/**
 * Resolve o token que o AWS Marketplace manda no fulfillment URL.
 *
 * As credenciais vêm SEMPRE do role da instância do Elastic Beanstalk (conta
 * vendedora 850401152034): a cadeia padrão do SDK pegaria antes as chaves de
 * AWS_ACCESS_KEY_ID do ambiente, que são do S3 e de outra conta, e o
 * ResolveCustomer falharia. O endpoint do metering só existe em us-east-1.
 */
@Injectable()
export class AwsMarketplaceService {
  private readonly logger = new Logger(AwsMarketplaceService.name);

  constructor(
    private readonly client: Pick<MarketplaceMeteringClient, 'send'> = new MarketplaceMeteringClient({
      region: 'us-east-1',
      credentials: fromInstanceMetadata({ timeout: 2000, maxRetries: 2 }),
    }),
  ) {}

  async resolverCliente(token: string): Promise<ClienteMarketplace | null> {
    try {
      const r = await this.client.send(new ResolveCustomerCommand({ RegistrationToken: token }));
      if (r.ProductCode !== PRODUTO_MARKETPLACE || !r.CustomerIdentifier) {
        this.logger.warn(`token de outro produto (${r.ProductCode ?? '-'})`);
        return null;
      }
      return { customerIdentifier: r.CustomerIdentifier, awsAccountId: r.CustomerAWSAccountId ?? null };
    } catch (e: any) {
      this.logger.error(`ResolveCustomer falhou: ${e?.name ?? ''} ${e?.message ?? e}`);
      return null;
    }
  }
}
