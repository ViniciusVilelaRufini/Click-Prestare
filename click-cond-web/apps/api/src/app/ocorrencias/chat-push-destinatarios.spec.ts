import { OcorrenciasService } from './ocorrencias.service';

/**
 * O push do chat decidia pelo `is_sindico` de quem escreveu: síndico → avisa o
 * autor; qualquer outro → avisa os síndicos. Funcionário (app ou console por
 * QR) que respondia no chat avisava os síndicos e o morador nunca sabia.
 * Regra: quem escreve e NÃO é o autor → avisa o autor; quem escreve é o autor
 * → avisa os síndicos e o responsável atribuído. Ninguém recebe push da
 * própria mensagem.
 */
describe('Ocorrências — destinatários do push do chat', () => {
  const AUTOR = 100;
  const SINDICO = 7;
  const FUNC = 20;
  const RESP = 31;

  function montar(opts: { idResponsavel?: number | null } = {}) {
    const oc = {
      id: 5,
      id_condominio: 1,
      user: AUTOR,
      publica: false,
      id_responsavel: opts.idResponsavel ?? null,
      criadoPor: { id: AUTOR, name: 'Autor', fcm_token: 'tok-autor' },
    };
    const nomes: Record<number, any> = {
      [AUTOR]: { name: 'Autor', is_sindico: 0, fcm_token: 'tok-autor' },
      [SINDICO]: { name: 'Síndico', is_sindico: 1, fcm_token: 'tok-sindico' },
      [FUNC]: { name: 'Func', is_sindico: 0, fcm_token: 'tok-func' },
      [RESP]: { name: 'Resp', is_sindico: 0, fcm_token: 'tok-resp' },
    };
    const prisma: any = {
      isConnected: true,
      funcionarios: { findFirst: jest.fn(async () => ({ ocorrencias: 1 })) },
      // Equipe atribuível: o responsável precisa estar nela para receber (chat-push-responsavel.spec).
      funcionarios_Portaria: { findMany: jest.fn(async () => [{ id: 3, login: 'resp@a', nome: 'Resp', ativo: 1 }]) },
      ocorrencias: { findUnique: jest.fn(async () => ({ ...oc })) },
      ocorrenciaMensagens: { create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })) },
      users: {
        findUnique: jest.fn(async ({ where }: any) => nomes[where.id] ?? null),
        findFirst: jest.fn(async () => ({ id: SINDICO })),
        findMany: jest.fn(async ({ where }: any) =>
          where?.login ? [{ id: RESP, login: 'resp@a' }] : [{ id: SINDICO, fcm_token: 'tok-sindico' }],
        ),
      },
    };
    const notifications: any = { sendPushNotification: jest.fn(async () => undefined) };
    const tenant: any = {
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async () => undefined),
    };
    const svc = new OcorrenciasService(prisma, notifications, tenant, {} as any);
    const tokens = () => notifications.sendPushNotification.mock.calls.map((c: any[]) => c[0]).sort();
    return { svc, tokens };
  }

  const autor = { sub: AUTOR, typeAccess: 'Morador' } as any;
  const sindico = { sub: SINDICO, typeAccess: 'Sindico' } as any;
  const funcionario = { sub: FUNC, typeAccess: 'Funcionario' } as any;

  it('funcionário escreve → avisa o autor (antes avisava só os síndicos)', async () => {
    const { svc, tokens } = montar();
    await svc.createMessage(5, FUNC, 'Já chamamos o encanador', funcionario);
    expect(tokens()).toEqual(['tok-autor']);
  });

  it('síndico escreve → avisa o autor', async () => {
    const { svc, tokens } = montar();
    await svc.createMessage(5, SINDICO, 'Ok', sindico);
    expect(tokens()).toEqual(['tok-autor']);
  });

  it('autor escreve → avisa síndicos e o responsável atribuído', async () => {
    const { svc, tokens } = montar({ idResponsavel: RESP });
    await svc.createMessage(5, AUTOR, 'Continua vazando', autor);
    expect(tokens()).toEqual(['tok-resp', 'tok-sindico']);
  });

  it('autor escreve sem responsável → só os síndicos', async () => {
    const { svc, tokens } = montar();
    await svc.createMessage(5, AUTOR, 'Continua vazando', autor);
    expect(tokens()).toEqual(['tok-sindico']);
  });

  it('o responsável que é o próprio autor não recebe push da própria mensagem', async () => {
    const { svc, tokens } = montar({ idResponsavel: AUTOR });
    await svc.createMessage(5, AUTOR, 'x', autor);
    expect(tokens()).toEqual(['tok-sindico']);
  });

  it('mensagem do suporte (CRM) gravada em nome do autor, sem síndico, ainda avisa o autor', async () => {
    const { svc, tokens } = montar();
    (svc as any).prisma.users.findFirst = jest.fn(async () => null);
    await svc.createMessageDoSistema({ idOcorrencia: 5, mensagem: 'Técnico amanhã', autorRotulo: 'Suporte Prestare', origem: 'crm' });
    expect(tokens()).toEqual(['tok-autor']);
  });
});
