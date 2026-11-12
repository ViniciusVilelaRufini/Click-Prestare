import { AreasSociaisService } from './areas-sociais.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * A lista de áreas sociais trocava imagem vazia pela foto padrão, mas o
 * detalhe devolvia '' e o app abria o detalhe com ícone vazio.
 */
describe('AreasSociaisService.get — imagem padrão', () => {
  const PADRAO = 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=600';
  const user: JwtPayload = { sub: 6, nome: 'Porteiro Y', id_condominio: 2, typeAccess: 'Funcionario' };

  function build(imagem: string | null) {
    const prisma: any = {
      isConnected: true,
      areas_Sociais: {
        findUnique: jest.fn(async () => ({
          id: 30, id_condominio: 2, nome: 'Churrasqueira', imagem,
          precisa_agendar: 0, precisa_autorizacao: 0, precisa_pagamento: 0,
          capacidade: 10, horarios: '[]',
        })),
      },
      areas_Sociais_Agendamentos: { findMany: jest.fn(async () => []) },
      areas_Sociais_Manutencoes: { findMany: jest.fn(async () => []) },
      facial_Devices: { count: jest.fn(async () => 0) },
      $queryRaw: jest.fn(async () => []),
    };
    const svc = new AreasSociaisService(
      prisma, { sendPushNotification: jest.fn() } as any, {} as any, {} as any, new TenantAccessService(prisma),
    );
    return svc;
  }

  it.each([[null], [''], ['   ']])('imagem %j vira a foto padrão', async (imagem) => {
    const r = await build(imagem as any).get(2, 30, user);
    expect(r.imagem).toBe(PADRAO);
  });

  it('imagem preenchida é mantida', async () => {
    const r = await build('https://cdn.exemplo.com/a.jpg').get(2, 30, user);
    expect(r.imagem).toBe('https://cdn.exemplo.com/a.jpg');
  });
});
