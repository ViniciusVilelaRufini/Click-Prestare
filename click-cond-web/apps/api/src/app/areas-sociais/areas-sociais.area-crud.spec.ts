import { AreasSociaisService } from './areas-sociais.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * A tela de áreas da portaria-web edita a partir do payload do `get-all` e
 * devolve o objeto inteiro no `update`. Duas consequências que quebravam a
 * área ao salvar:
 *
 *  1. `get-all` não devolvia `horarios` → o front mandava um default de
 *     08:00–22:00 nos 7 dias e substituía a grade real;
 *  2. `update` escrevia `precisa_pagamento`/`capacidade` incondicionalmente
 *     (`?? 0`) → salvar a área desligava a cobrança e zerava a capacidade,
 *     mesmo com o cliente nem tendo mandado esses campos.
 */
describe('AreasSociaisService — CRUD de área (get-all + update parcial)', () => {
  const sindico: JwtPayload = { sub: 1, nome: 'Síndico', id_condominio: 2, typeAccess: 'Sindico' };

  const GRADE = Array.from({ length: 7 }).map(() => ({
    horarios: [{ horarioDe: '10:00', horarioAte: '14:00' }],
  }));

  function build(opts: { horarios?: string | null } = {}) {
    const areaRow = {
      id: 30,
      nome: 'Churrasqueira',
      imagem: '',
      capacidade: 25,
      limite_mensal_apto: 2,
      precisa_agendar: 1,
      precisa_autorizacao: 0,
      precisa_pagamento: 1,
      regras: 'Sem som alto',
      horarios: opts.horarios === undefined ? JSON.stringify(GRADE) : opts.horarios,
      _count: { devices: 0 },
    };
    const prisma: any = {
      isConnected: true,
      areas_Sociais: {
        findMany: jest.fn(async () => [areaRow]),
        findUnique: jest.fn(async () => ({ ...areaRow })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      $queryRaw: jest.fn(async () => []),
    };
    const notifications: any = { sendPushNotification: jest.fn() };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const facial: any = { syncReservaArea: jest.fn() };
    const tenant = new TenantAccessService(prisma);
    const svc = new AreasSociaisService(prisma, notifications, storage, facial, tenant);
    return { svc, prisma };
  }

  describe('getAll devolve a grade semanal', () => {
    it('inclui `horarios` já parseado (é o que o front reenvia no update)', async () => {
      const { svc, prisma } = build();
      const lista: any[] = await svc.getAll(2, sindico);

      // A coluna precisa estar no select — sem isso o campo nem existe.
      expect(prisma.areas_Sociais.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ select: expect.objectContaining({ horarios: true }) }),
      );
      expect(lista[0].horarios).toEqual(GRADE);
    });

    it('coluna vazia/corrompida vira [] em vez de derrubar a listagem', async () => {
      const { svc } = build({ horarios: '{isso não é json' });
      const lista: any[] = await svc.getAll(2, sindico);
      expect(lista[0].horarios).toEqual([]);

      const { svc: svc2 } = build({ horarios: null });
      const lista2: any[] = await svc2.getAll(2, sindico);
      expect(lista2[0].horarios).toEqual([]);
    });
  });

  describe('update() só toca a coluna quando a chave veio no payload', () => {
    async function dataDoUpdate(payload: any) {
      const { svc, prisma } = build();
      await svc.update(2, payload, sindico);
      return prisma.areas_Sociais.updateMany.mock.calls[0][0].data;
    }

    it('sem `pagar`/`precisa_pagamento`: não desliga a cobrança configurada', async () => {
      const data = await dataDoUpdate({ id: 30, nome: 'Churrasqueira' });
      expect('precisa_pagamento' in data).toBe(false);
    });

    it('sem `capacidade`: não zera a capacidade configurada', async () => {
      const data = await dataDoUpdate({ id: 30, nome: 'Churrasqueira' });
      expect('capacidade' in data).toBe(false);
    });

    it('sem `horarios`: não apaga a grade semanal', async () => {
      const data = await dataDoUpdate({ id: 30, nome: 'Churrasqueira' });
      expect('horarios' in data).toBe(false);
    });

    it('chaves presentes continuam gravando normalmente', async () => {
      const data = await dataDoUpdate({
        id: 30,
        nome: 'Churrasqueira',
        pagar: 1,
        capacidade: 40,
        horarios: GRADE,
      });
      expect(data.precisa_pagamento).toBe(1);
      expect(data.capacidade).toBe(40);
      expect(data.horarios).toBe(JSON.stringify(GRADE));
    });

    it('`precisa_pagamento` (grafia longa) também é aceito e desligar é possível de propósito', async () => {
      const data = await dataDoUpdate({ id: 30, nome: 'Churrasqueira', precisa_pagamento: 0 });
      expect(data.precisa_pagamento).toBe(0);
    });

    it('`horarios` presente como string JSON passa direto', async () => {
      const data = await dataDoUpdate({ id: 30, nome: 'X', horarios: '[]' });
      expect(data.horarios).toBe('[]');
    });
  });
});
