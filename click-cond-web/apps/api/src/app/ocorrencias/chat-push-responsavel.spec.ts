import { OcorrenciasService } from './ocorrencias.service';
import { TenantAccessService } from '../auth/tenant-access.service';

/**
 * Quando o autor escreve no chat, o responsável atribuído recebia
 * "<nome>: <mensagem>" por push sem nenhuma checagem: o funcionário sem a
 * flag `ocorrencias` (que toma 403 ao abrir a ocorrência privada) e o
 * porteiro desativado continuavam lendo o texto da ocorrência privada pela
 * notificação. Agora o responsável só recebe se ainda está na equipe
 * atribuível do condomínio e, na ocorrência privada, se pode lê-la.
 */
describe('Ocorrências — push do chat ao responsável respeita a leitura', () => {
  const AUTOR = 100;
  const SINDICO = 7;
  const RESP = 31;

  function montar(opts: { publica?: boolean; flag?: number; ativo?: number; vinculado?: boolean } = {}) {
    const { publica = false, flag = 1, ativo = 1, vinculado = true } = opts;
    const oc = {
      id: 5, id_condominio: 1, user: AUTOR, publica, id_responsavel: RESP,
      criadoPor: { id: AUTOR, name: 'Autor', fcm_token: 'tok-autor' },
    };
    const portaria = [{ id: 3, login: 'resp@a', nome: 'Resp', turno: 'Diurno', ativo }];
    const prisma: any = {
      isConnected: true,
      funcionarios: {
        findFirst: jest.fn(async ({ where }: any) =>
          vinculado && where.id_user === RESP && where.id_condominio === 1 ? { ocorrencias: flag } : null,
        ),
      },
      funcionarios_Portaria: {
        findMany: jest.fn(async ({ where }: any) => portaria.filter((f) => where.ativo == null || f.ativo === where.ativo)),
      },
      ocorrencias: { findUnique: jest.fn(async () => ({ ...oc })) },
      ocorrenciaMensagens: { create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })) },
      users: {
        findUnique: jest.fn(async ({ where }: any) =>
          ({ [AUTOR]: { name: 'Autor', is_sindico: 0 }, [RESP]: { fcm_token: 'tok-resp' } } as any)[where.id] ?? null,
        ),
        findMany: jest.fn(async ({ where }: any) =>
          where?.login ? [{ id: RESP, login: 'resp@a' }] : [{ id: SINDICO, fcm_token: 'tok-sindico' }],
        ),
      },
    };
    const notifications: any = { sendPushNotification: jest.fn(async () => undefined) };
    const real = new TenantAccessService(prisma);
    const tenant: any = {
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn((id: number, f: any, p: any) => real.assertPermissaoFuncionario(id, f, p)),
    };
    const svc = new OcorrenciasService(prisma, notifications, tenant, {} as any);
    const tokens = () => notifications.sendPushNotification.mock.calls.map((c: any[]) => c[0]).sort();
    return { svc, tokens };
  }
  const autor = { sub: AUTOR, typeAccess: 'Morador' } as any;

  it('privada + responsável SEM a flag `ocorrencias` → não recebe (só os síndicos)', async () => {
    const { svc, tokens } = montar({ flag: 0 });
    await svc.createMessage(5, AUTOR, 'Meu vizinho me ameaçou de novo', autor);
    expect(tokens()).toEqual(['tok-sindico']);
  });

  it('responsável desativado na portaria → não recebe', async () => {
    const { svc, tokens } = montar({ ativo: 0 });
    await svc.createMessage(5, AUTOR, 'x', autor);
    expect(tokens()).toEqual(['tok-sindico']);
  });

  it('privada + responsável sem vínculo de funcionário no condomínio → não recebe', async () => {
    const { svc, tokens } = montar({ vinculado: false });
    await svc.createMessage(5, AUTOR, 'x', autor);
    expect(tokens()).toEqual(['tok-sindico']);
  });

  it('privada + responsável ativo COM a flag → recebe', async () => {
    const { svc, tokens } = montar({ flag: 1 });
    await svc.createMessage(5, AUTOR, 'x', autor);
    expect(tokens()).toEqual(['tok-resp', 'tok-sindico']);
  });

  it('pública: basta estar na equipe ativa', async () => {
    const { svc, tokens } = montar({ publica: true, flag: 0 });
    await svc.createMessage(5, AUTOR, 'x', autor);
    expect(tokens()).toEqual(['tok-resp', 'tok-sindico']);
  });
});
