import { extrairJwtDaRequisicao } from './jwt.strategy';

/**
 * Pentest P-08: o JWT (365 dias) era aceito em `?token=` em QUALQUER rota e
 * acabava em logs do CloudFront/nginx, histórico e Referer. Só o download de
 * mídia do WhatsApp no CRM (`<img>/<video src>`, que não manda cabeçalho)
 * ainda precisa dele.
 */
describe('JwtStrategy — de onde o token é lido (P-08)', () => {
  const req = (over: any) => ({ method: 'GET', headers: {}, query: {}, ...over });

  it('lê o Bearer do cabeçalho Authorization', () => {
    expect(extrairJwtDaRequisicao(req({ headers: { authorization: 'Bearer abc' } }))).toBe('abc');
  });

  it('aceita o cabeçalho sem o prefixo Bearer (clientes antigos)', () => {
    expect(extrairJwtDaRequisicao(req({ headers: { authorization: 'abc' } }))).toBe('abc');
  });

  it('NÃO aceita ?token= numa rota comum', () => {
    expect(
      extrairJwtDaRequisicao(
        req({ originalUrl: '/api/condominios/1/moradores?token=xyz', path: '/api/condominios/1/moradores', query: { token: 'xyz' } }),
      ),
    ).toBeNull();
  });

  it('aceita ?token= só no GET da mídia do WhatsApp do CRM', () => {
    expect(
      extrairJwtDaRequisicao(
        req({ originalUrl: '/api/crm/whatsapp/midias/42?token=xyz', query: { token: 'xyz' } }),
      ),
    ).toBe('xyz');
  });

  it('não aceita ?token= na mesma rota com outro método', () => {
    expect(
      extrairJwtDaRequisicao(
        req({ method: 'POST', originalUrl: '/api/crm/whatsapp/midias/42?token=xyz', query: { token: 'xyz' } }),
      ),
    ).toBeNull();
  });

  it('não aceita ?token= em outras rotas do CRM', () => {
    expect(
      extrairJwtDaRequisicao(
        req({ originalUrl: '/api/crm/whatsapp/conversas?token=xyz', query: { token: 'xyz' } }),
      ),
    ).toBeNull();
    expect(
      extrairJwtDaRequisicao(
        req({ originalUrl: '/api/crm/whatsapp/midias/42/../../conversas?token=xyz', query: { token: 'xyz' } }),
      ),
    ).toBeNull();
  });

  it('ignora token em array (?token=a&token=b)', () => {
    expect(
      extrairJwtDaRequisicao(
        req({ originalUrl: '/api/crm/whatsapp/midias/42?token=a&token=b', query: { token: ['a', 'b'] } }),
      ),
    ).toBeNull();
  });
});
