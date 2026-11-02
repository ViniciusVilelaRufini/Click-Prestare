import { Body, Controller, Get, Logger, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { AwsMarketplaceService } from './aws-marketplace.service';

// Página de contato da landing; a origem fica na UTM para o lead cair
// identificado no CRM quando a pessoa preencher o formulário.
export const DESTINO_CADASTRO = 'https://www.prestarecondominios.com.br/sobre?utm_source=aws-marketplace&utm_medium=marketplace';

interface Resposta {
  redirect(status: number, url: string): void;
}

/**
 * Fulfillment URL do produto SaaS no AWS Marketplace. Depois da assinatura, o
 * navegador do comprador faz um POST (form-urlencoded) com o campo
 * x-amzn-marketplace-token. O produto é gratuito, então não há entitlement a
 * provisionar: valida o token, registra quem assinou e manda para o cadastro.
 * Token inválido também redireciona — o comprador não pode ficar numa tela de erro.
 */
@Controller('public/aws-marketplace')
export class AwsMarketplaceController {
  private readonly logger = new Logger(AwsMarketplaceController.name);

  constructor(private readonly marketplace: AwsMarketplaceService) {}

  @Public()
  @Throttle({ medium: { limit: 10, ttl: 60_000 } })
  @Post('fulfillment')
  async fulfillment(@Body() body: Record<string, unknown> | undefined, @Res() res: Resposta): Promise<void> {
    const token = body?.['x-amzn-marketplace-token'];
    if (typeof token === 'string' && token.trim()) {
      const cliente = await this.marketplace.resolverCliente(token.trim());
      if (cliente) {
        this.logger.log(`nova assinatura no Marketplace: cliente ${cliente.customerIdentifier}, conta ${cliente.awsAccountId ?? '-'}`);
      }
    } else {
      this.logger.warn('fulfillment sem x-amzn-marketplace-token');
    }
    res.redirect(302, DESTINO_CADASTRO);
  }

  // Quem abre a URL direto no navegador (ou a revisão da AWS) cai no mesmo cadastro.
  @Public()
  @Get('fulfillment')
  abrir(@Res() res: Resposta): void {
    res.redirect(302, DESTINO_CADASTRO);
  }
}
