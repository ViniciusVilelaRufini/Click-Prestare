import { CORS_ORIGINS_PRINCIPAIS } from './cors-origins';

describe('CORS_ORIGINS_PRINCIPAIS', () => {
  it('permite os dois enderecos do novo dominio', () => {
    expect(CORS_ORIGINS_PRINCIPAIS).toEqual(
      expect.arrayContaining([
        'https://prestarecondominios.com.br',
        'https://www.prestarecondominios.com.br',
      ]),
    );
  });
});
