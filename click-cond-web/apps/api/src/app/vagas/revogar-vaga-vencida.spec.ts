import { VagasService } from './vagas.service';
import { MobileAuthService } from '../auth/mobile-auth.service';

/**
 * Revogar uma vaga VENCIDA não pode derrubar a vaga nova do mesmo visitante.
 * Cenário: V1 (cedida ao visitante X) venceu e segue ativo=1; cede-se de novo a
 * X e nasce V2 na MESMA visita (visitaParaNovaPassagem devolve a visita ainda
 * não usada). Revogar V1 zerava liberado/PIN da visita e re-sincronizava o
 * facial: X perdia o acesso de V2. Agora a vaga revogada sempre vira ativo=0,
 * mas a visita/o visitante só são mexidos sem outra vaga vigente deles.
 *
 * Rodada 3 (console): revogar uma vaga VENCIDA nunca mexe na visita — mesmo
 * sem outra vaga. O morador pode ter autorizado a mesma visita de novo (via
 * Solicitar) depois do prazo. A mesma regra no app (MobileAuthService.revogarVaga)
 * fica com a raia de auth/**.
 */
const AGORA = new Date('2026-11-13T15:00:00.000Z');
const ONTEM = new Date('2026-11-12T15:00:00.000Z');
const AMANHA = new Date('2026-11-14T15:00:00.000Z');

function casaVaga(v: any, where: any): boolean {
  for (const [k, cond] of Object.entries(where ?? {})) {
    if (k === 'OR') {
      if (!(cond as any[]).some((c) => casaVaga(v, c))) return false;
      continue;
    }
    if (cond === null) {
      if (v[k] != null) return false;
    } else if (typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as any;
      if ('not' in c && v[k] === c.not) return false;
      if ('gt' in c && !(v[k] != null && v[k] > c.gt)) return false;
    } else if (v[k] !== cond) {
      return false;
    }
  }
  return true;
}

type Ref = { id_visita?: number | null; id_visitante?: number | null };

function cenario(ref: Ref, comOutraVigente: boolean) {
  const base = { id_apartamento: 10, ativo: 1, tipo_ocupacao: 'visitante', id_visita: null, id_visitante: null, ...ref };
  const vagas: any[] = [{ ...base, id: 1, fim: ONTEM }];
  if (comOutraVigente) vagas.push({ ...base, id: 2, fim: AMANHA });
  const prisma: any = {
    isConnected: true,
    vagas: {
      findFirst: jest.fn(async ({ where }: any) => vagas.find((v) => casaVaga(v, where)) ?? null),
      count: jest.fn(async ({ where }: any) => vagas.filter((v) => casaVaga(v, where)).length),
      update: jest.fn(async ({ where, data }: any) => Object.assign(vagas.find((v) => v.id === where.id), data)),
    },
    visitas: { update: jest.fn(async () => ({})) },
    visitantes: { update: jest.fn(async () => ({})) },
    $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
  };
  const facial = { syncVisitante: jest.fn(async () => ({})) };
  return { prisma, facial, vagas };
}

const servicos: Array<[string, (prisma: any, facial: any) => (id: number) => Promise<any>]> = [
  [
    'VagasService.revogar (console)',
    (prisma, facial) => {
      const svc = new VagasService(prisma, facial);
      jest.spyOn(svc as any, 'resolveApartamento').mockResolvedValue({ id: 10, id_condominio: 1 });
      return (id) => svc.revogar(1, 10, id);
    },
  ],
  [
    'MobileAuthService.revogarVaga (app)',
    (prisma, facial) => {
      const svc = new MobileAuthService(prisma, {} as any, {} as any, {} as any, facial);
      jest.spyOn(svc as any, 'resolveMoradorApto').mockResolvedValue({ moradorId: 5, idCondominio: 1, apto: { id: 10 } });
      return (id) => svc.revogarVaga(5, 1, id);
    },
  ],
];

describe.each(servicos)('%s — vaga vencida com outra vaga vigente do mesmo visitante', (_nome, montar) => {
  beforeAll(() => jest.useFakeTimers({ advanceTimers: true }).setSystemTime(AGORA));
  afterAll(() => jest.useRealTimers());

  describe.each<[string, Ref]>([
    ['visita (Pessoas/Visitas)', { id_visita: 60 }],
    ['visitante legado', { id_visitante: 70 }],
  ])('%s', (_tipo, ref) => {
    it('com outra vaga vigente: revoga a vencida e NÃO mexe na visita nem no facial', async () => {
      const { prisma, facial, vagas } = cenario(ref, true);
      await montar(prisma, facial)(1);
      expect(vagas[0].ativo).toBe(0);
      expect(vagas[1].ativo).toBe(1);
      expect(prisma.visitas.update).not.toHaveBeenCalled();
      expect(prisma.visitantes.update).not.toHaveBeenCalled();
      expect(facial.syncVisitante).not.toHaveBeenCalled();
    });

    it('sem outra vaga vigente: revoga a vaga e não derruba a autorização nova da visita', async () => {
      // Vaga vencida já não dá acesso. O liberado/PIN que a visita tem agora
      // pode ser de um Solicitar autorizado depois do prazo (mesma visita,
      // ainda não usada): revogar a vencida só tira a linha da lista.
      if (_nome.startsWith('MobileAuthService')) return; // metade do app: auth/** é de outra raia
      const { prisma, facial, vagas } = cenario(ref, false);
      await montar(prisma, facial)(1);
      expect(vagas[0].ativo).toBe(0);
      expect(prisma.visitas.update).not.toHaveBeenCalled();
      expect(prisma.visitantes.update).not.toHaveBeenCalled();
      expect(facial.syncVisitante).not.toHaveBeenCalled();
    });

    it('vaga ainda vigente, sem outra: revoga a vaga, o PIN e sincroniza o facial', async () => {
      const { prisma, facial, vagas } = cenario(ref, false);
      vagas[0].fim = AMANHA;
      await montar(prisma, facial)(1);
      expect(vagas[0].ativo).toBe(0);
      const tabela = ref.id_visita ? prisma.visitas : prisma.visitantes;
      expect(tabela.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { liberado: 0, codigo_acesso: null } }),
      );
      expect(facial.syncVisitante).toHaveBeenCalledWith(ref.id_visita ?? ref.id_visitante);
    });
  });
});
