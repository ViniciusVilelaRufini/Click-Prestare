import { MarketingSegredosService } from './marketing-segredos.service';
import { encryptSecret } from '../facial/device-secret.util';

describe('MarketingSegredosService', () => {
  const antigo = { ...process.env };
  afterEach(() => { process.env = { ...antigo }; });

  function montar(valor: string | null) {
    const findUnique = jest.fn(async () => (valor == null ? null : { chave: 'X', valor }));
    return { findUnique, svc: new MarketingSegredosService({ crm_Config: { findUnique } } as any) };
  }

  it('env tem precedência e não consulta o banco', async () => {
    process.env.OPENAI_ADS_API_KEY = 'da-env';
    const { svc, findUnique } = montar('outro');
    await expect(svc.obter('OPENAI_ADS_API_KEY')).resolves.toBe('da-env');
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('sem env, decifra o valor de crm_config', async () => {
    delete process.env.OPENAI_ADS_API_KEY;
    process.env.JWT_SECRET = 'segredo-de-teste';
    const { svc } = montar(encryptSecret('sk-teste')!);
    await expect(svc.obter('OPENAI_ADS_API_KEY')).resolves.toBe('sk-teste');
  });

  it('valor cifrado com outra chave vira ausente', async () => {
    delete process.env.ADS_INGEST_TOKEN;
    process.env.JWT_SECRET = 'chave-a';
    const cifrado = encryptSecret('tok')!;
    process.env.JWT_SECRET = 'chave-b';
    const { svc } = montar(cifrado);
    await expect(svc.obter('ADS_INGEST_TOKEN')).resolves.toBeUndefined();
  });

  it('sem env e sem linha no banco é ausente, e o resultado fica em cache', async () => {
    delete process.env.ADS_INGEST_TOKEN;
    const { svc, findUnique } = montar(null);
    await expect(svc.obter('ADS_INGEST_TOKEN')).resolves.toBeUndefined();
    await svc.obter('ADS_INGEST_TOKEN');
    expect(findUnique).toHaveBeenCalledTimes(1);
  });
});
