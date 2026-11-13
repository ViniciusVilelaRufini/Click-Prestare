import { OcorrenciasService } from './ocorrencias.service';

/**
 * Ocorrência sem autor em Users (`user` nulo: aberta pela portaria, pelo CRM
 * ou pelo monitor de dispositivos). A regra do push dizia "quem não é o
 * autor avisa o autor" — sem autor, ninguém era avisado, nem os síndicos.
 * Sem autor, quem escreve avisa os síndicos (e o responsável que pode ler),
 * nunca a si mesmo.
 */
describe('Ocorrências — push do chat em ocorrência sem autor', () => {
  const SINDICO = 7;
  const SINDICO2 = 8;
  const FUNC = 20;

  function montar() {
    const oc = { id: 5, id_condominio: 1, user: null, publica: false, id_responsavel: null, criadoPor: null, origem: 'portaria' };
    const prisma: any = {
      isConnected: true,
      funcionarios: { findFirst: jest.fn(async () => ({ ocorrencias: 1 })) },
      funcionarios_Portaria: { findMany: jest.fn(async () => []) },
      ocorrencias: { findUnique: jest.fn(async () => ({ ...oc })) },
      ocorrenciaMensagens: { create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })) },
      users: {
        findUnique: jest.fn(async ({ where }: any) =>
          ({ [FUNC]: { name: 'Func', is_sindico: 0 }, [SINDICO]: { name: 'Síndico', is_sindico: 1 } } as any)[where.id] ?? null,
        ),
        findFirst: jest.fn(async () => ({ id: SINDICO })),
        findMany: jest.fn(async () => [
          { id: SINDICO, fcm_token: 'tok-sindico' },
          { id: SINDICO2, fcm_token: 'tok-sindico2' },
        ]),
      },
    };
    const notifications: any = { sendPushNotification: jest.fn(async () => undefined) };
    const tenant: any = { assertEntidade: jest.fn(async () => undefined), assertPermissaoFuncionario: jest.fn(async () => undefined) };
    const svc = new OcorrenciasService(prisma, notifications, tenant, {} as any);
    const tokens = () => notifications.sendPushNotification.mock.calls.map((c: any[]) => c[0]).sort();
    return { svc, tokens };
  }

  it('funcionário escreve → avisa os síndicos (antes, ninguém)', async () => {
    const { svc, tokens } = montar();
    await svc.createMessage(5, FUNC, 'Vou verificar', { sub: FUNC, typeAccess: 'Funcionario' } as any);
    expect(tokens()).toEqual(['tok-sindico', 'tok-sindico2']);
  });

  it('síndico escreve → avisa os outros síndicos, não a si mesmo', async () => {
    const { svc, tokens } = montar();
    await svc.createMessage(5, SINDICO, 'Ok', { sub: SINDICO, typeAccess: 'Sindico' } as any);
    expect(tokens()).toEqual(['tok-sindico2']);
  });
});
