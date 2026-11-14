import { MoradoresService } from './moradores.service';
import { REVOGADO_PELO_OPERADOR } from '../consentimentos/consentimentos.service';

/**
 * Rodada 2 de ciclos, A6: o morador cadastrado no console com foto do rosto nunca vai para o
 * facial enquanto o titular não aceita a biometria no app (FacialService.syncMorador pula sem
 * gravar nada), e a tela não tinha como saber. A lista passa a dizer, sem criar consentimento:
 * - biometria_autorizada: o último registro de biometria do titular é um aceite (e o operador
 *   não revogou aqui) — a mesma regra do syncMorador;
 * - aguardando_aceite_biometria: tem foto no cadastro, não está no terminal e falta o aceite.
 */

function servico(prisma: any) {
  return new MoradoresService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
}

const semVinculoFora = () => ({
  sindicos_Condominios: { findMany: jest.fn().mockResolvedValue([]) },
  funcionarios: { findMany: jest.fn().mockResolvedValue([]) },
  apartamentos_Users: { findMany: jest.fn().mockResolvedValue([]) },
});

function linha(over: any = {}) {
  return {
    id: 43,
    id_user: 41,
    id_condominio: 1,
    nome: 'Ana',
    foto_pessoa: 'https://storage/rosto.jpg',
    face_id: null,
    face_sync_status: null,
    face_sync_error: null,
    user: { photo: null, apartamentosUsers: [{ id_apto: 7 }] },
    ...over,
  };
}

function prismaCom(moradores: any[], consentimentos: any[]) {
  return {
    isConnected: true,
    ...semVinculoFora(),
    moradores: { findMany: jest.fn().mockResolvedValue(moradores) },
    consentimentos: {
      findMany: jest.fn(async ({ where }: any) =>
        consentimentos.filter((c) => where.id_user.in.includes(c.id_user) && c.tipo === where.tipo),
      ),
    },
  } as any;
}

describe('A6 — lista de moradores avisa quando o rosto espera o aceite no app', () => {
  it('conta nova, com foto e sem aceite: aguardando', async () => {
    const [m] = await servico(prismaCom([linha()], [])).findAll(1);
    expect(m).toEqual(expect.objectContaining({ biometria_autorizada: false, aguardando_aceite_biometria: true }));
  });

  it('o último registro de biometria é a recusa: aguardando', async () => {
    const consent = [
      { id_user: 41, tipo: 'biometria', aceito: 0, registrado_em: new Date('2026-11-10') },
      { id_user: 41, tipo: 'biometria', aceito: 1, registrado_em: new Date('2026-10-01') },
    ];
    const [m] = await servico(prismaCom([linha()], consent)).findAll(1);
    expect(m.biometria_autorizada).toBe(false);
    expect(m.aguardando_aceite_biometria).toBe(true);
  });

  it('aceitou no app: não aguarda', async () => {
    const consent = [{ id_user: 41, tipo: 'biometria', aceito: 1, registrado_em: new Date('2026-11-10') }];
    const [m] = await servico(prismaCom([linha()], consent)).findAll(1);
    expect(m).toEqual(expect.objectContaining({ biometria_autorizada: true, aguardando_aceite_biometria: false }));
  });

  it('aceite antigo, mas o operador revogou neste condomínio: não está autorizado', async () => {
    const consent = [{ id_user: 41, tipo: 'biometria', aceito: 1, registrado_em: new Date('2026-11-10') }];
    const [m] = await servico(
      prismaCom([linha({ face_sync_error: REVOGADO_PELO_OPERADOR })], consent),
    ).findAll(1);
    expect(m.biometria_autorizada).toBe(false);
  });

  it('sem foto no cadastro não há o que aguardar', async () => {
    const [m] = await servico(prismaCom([linha({ foto_pessoa: null })], [])).findAll(1);
    expect(m.biometria_autorizada).toBe(false);
    expect(m.aguardando_aceite_biometria).toBe(false);
  });

  it('também na lista filtrada por apartamento', async () => {
    const prisma = prismaCom([], []);
    prisma.apartamentos_Users.findMany = jest.fn().mockResolvedValue([
      {
        id_user: 41,
        id_apto: 7,
        tipo: 'proprietario',
        apartamento: { id: 7, id_condominio: 1, bloco: 'A', apto: '101' },
        user: { id: 41, photo: null, email: null, phone: null, cpf: null, moradores: [linha()] },
      },
    ]);
    const [m] = await servico(prisma).findAll(1, undefined, 7);
    expect(m).toEqual(expect.objectContaining({ biometria_autorizada: false, aguardando_aceite_biometria: true }));
  });

  it('falha ao ler os consentimentos não derruba a lista (o aviso some)', async () => {
    const prisma = prismaCom([linha()], []);
    prisma.consentimentos.findMany = jest.fn().mockRejectedValue(new Error('db fora'));
    const [m] = await servico(prisma).findAll(1);
    expect(m.id).toBe(43);
    expect(m.biometria_autorizada).toBeNull();
    expect(m.aguardando_aceite_biometria).toBe(false);
  });
});
