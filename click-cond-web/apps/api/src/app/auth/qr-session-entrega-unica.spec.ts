import { AuthService } from './auth.service';
import { QrSessionStore } from './qr-session.store';

/**
 * GET /auth/qr/status/:qrToken é público e o qrToken é o próprio conteúdo do
 * QR. O token de portaria era devolvido em TODA consulta até a sessão expirar:
 * quem fotografasse o QR da tela recebia a mesma sessão do navegador legítimo.
 */
describe('Login por QR — token de portaria entregue uma vez só', () => {
  function build() {
    const store = new QrSessionStore();
    const prisma: any = {
      isConnected: true,
      condominios: { findUnique: jest.fn(async () => ({ nome: 'Edifício A' })) },
      sindicos_Condominios: { findFirst: jest.fn(async () => ({ id: 1 })) },
    };
    const svc = new AuthService(prisma, { sign: jest.fn(() => 'token-portaria') } as any, store);
    return { svc };
  }

  it('a segunda consulta depois da confirmação não recebe o token', async () => {
    const { svc } = build();
    const s = svc.createQrSession();
    await svc.authorizeQrSession({ sub: 3, nome: 'S', typeAccess: 'Sindico' }, s.qrToken, 1);

    const primeira = await svc.getQrStatus(s.qrToken);
    expect(primeira).toMatchObject({ status: 'confirmed', access_token: 'token-portaria' });

    const segunda = await svc.getQrStatus(s.qrToken);
    expect(segunda).toEqual({ status: 'expired' });
  });

  it('enquanto pendente, as consultas do navegador continuam vendo "pending"', async () => {
    const { svc } = build();
    const s = svc.createQrSession();

    expect(await svc.getQrStatus(s.qrToken)).toEqual({ status: 'pending' });
    expect(await svc.getQrStatus(s.qrToken)).toEqual({ status: 'pending' });
  });
});
