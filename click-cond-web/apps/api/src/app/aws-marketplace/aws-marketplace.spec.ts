import { Reflector } from '@nestjs/core';
import { ResolveCustomerCommand } from '@aws-sdk/client-marketplace-metering';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { AwsMarketplaceController, DESTINO_CADASTRO } from './aws-marketplace.controller';
import { AwsMarketplaceService, PRODUTO_MARKETPLACE } from './aws-marketplace.service';

function servico(resposta: unknown | Error) {
  const send = jest.fn(async () => {
    if (resposta instanceof Error) throw resposta;
    return resposta;
  });
  return { send, svc: new AwsMarketplaceService({ send } as any) };
}

function resposta() {
  return { redirect: jest.fn() };
}

describe('AwsMarketplaceService', () => {
  it('resolve o cliente do nosso produto', async () => {
    const { send, svc } = servico({ ProductCode: PRODUTO_MARKETPLACE, CustomerIdentifier: 'cli-1', CustomerAWSAccountId: '111122223333' });
    await expect(svc.resolverCliente('tok')).resolves.toEqual({ customerIdentifier: 'cli-1', awsAccountId: '111122223333' });
    const cmd = (send.mock.calls[0] as unknown[])[0] as ResolveCustomerCommand;
    expect(cmd.input).toEqual({ RegistrationToken: 'tok' });
  });
  it('ignora token de outro produto', async () => {
    await expect(servico({ ProductCode: 'outro', CustomerIdentifier: 'cli-1' }).svc.resolverCliente('tok')).resolves.toBeNull();
  });
  it('erro da AWS vira null (não derruba o fulfillment)', async () => {
    await expect(servico(new Error('InvalidTokenException')).svc.resolverCliente('tok')).resolves.toBeNull();
  });
});

describe('AwsMarketplaceController', () => {
  it('rotas são públicas (o comprador chega da AWS sem login)', () => {
    const r = new Reflector();
    expect(r.get(IS_PUBLIC_KEY, AwsMarketplaceController.prototype.fulfillment)).toBe(true);
    expect(r.get(IS_PUBLIC_KEY, AwsMarketplaceController.prototype.abrir)).toBe(true);
  });
  it('POST com token resolve e redireciona para o cadastro', async () => {
    const mp = { resolverCliente: jest.fn(async () => ({ customerIdentifier: 'cli-1', awsAccountId: null })) };
    const res = resposta();
    await new AwsMarketplaceController(mp as any).fulfillment({ 'x-amzn-marketplace-token': ' tok ' }, res);
    expect(mp.resolverCliente).toHaveBeenCalledWith('tok');
    expect(res.redirect).toHaveBeenCalledWith(302, DESTINO_CADASTRO);
  });
  it('POST sem token não chama a AWS e redireciona mesmo assim', async () => {
    const mp = { resolverCliente: jest.fn() };
    const res = resposta();
    await new AwsMarketplaceController(mp as any).fulfillment({}, res);
    expect(mp.resolverCliente).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(302, DESTINO_CADASTRO);
  });
  it('GET redireciona para o cadastro', () => {
    const res = resposta();
    new AwsMarketplaceController({} as any).abrir(res);
    expect(res.redirect).toHaveBeenCalledWith(302, DESTINO_CADASTRO);
  });
});
