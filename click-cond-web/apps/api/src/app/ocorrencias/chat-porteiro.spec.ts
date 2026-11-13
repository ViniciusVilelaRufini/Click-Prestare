import { BadRequestException } from '@nestjs/common';
import { OcorrenciasService } from './ocorrencias.service';
import { CrmService } from '../crm/crm.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * O porteiro do console (token sem Users.id) não escrevia no chat da
 * ocorrência: `OcorrenciaMensagens.id_usuario` era FK obrigatória para Users.
 * Agora a mensagem dele grava id_usuario NULL, o Funcionarios_Portaria.id e
 * o nome, e sai em toda leitura como "Portaria · <nome>" — nunca como se
 * fosse do síndico ou do morador. O app lê `id_usuario` com toString() e
 * `usuario['name']`: id_usuario vai null e `usuario` vem preenchido com o
 * rótulo (is_sindico 0).
 */
describe('Ocorrências — chat do porteiro do console', () => {
  const AUTOR = 100;
  const SINDICO = 7;
  const RESP = 31;
  const porteiro: JwtPayload = {
    sub: 3, nome: 'João', id_condominio: 1, turno: 'Diurno', tipo_sub: 'funcionario_portaria',
  };

  function montar(opts: { user?: number | null; idResponsavel?: number | null; publica?: boolean } = {}) {
    const oc = {
      id: 5, id_condominio: 1, user: opts.user === undefined ? AUTOR : opts.user, publica: opts.publica ?? false,
      id_responsavel: opts.idResponsavel ?? null,
      criadoPor: opts.user === null ? null : { id: AUTOR, name: 'Autor', fcm_token: 'tok-autor' },
    };
    const prisma: any = {
      isConnected: true,
      funcionarios: { findFirst: jest.fn(async () => ({ ocorrencias: 1 })) },
      // O porteiro 3 (login joao@a) tem conta em Users (RESP) — é quem pode ser responsável.
      funcionarios_Portaria: { findMany: jest.fn(async () => [{ id: 3, login: 'joao@a', nome: 'João', ativo: 1 }]) },
      ocorrencias: { findUnique: jest.fn(async () => ({ ...oc })) },
      ocorrenciaMensagens: {
        create: jest.fn(async ({ data }: any) => ({ id: 1, created_at: new Date(), ...data, usuario: null })),
        findMany: jest.fn(async () => [
          {
            id: 1, id_ocorrencia: 5, id_usuario: AUTOR, id_funcionario_portaria: null, nome_autor: null, mensagem: 'Vazando',
            created_at: new Date(), usuario: { id: AUTOR, name: 'Autor', login_type: 'email', is_sindico: 0 },
          },
          {
            id: 2, id_ocorrencia: 5, id_usuario: null, id_funcionario_portaria: 3, nome_autor: 'João', mensagem: 'Já vi',
            created_at: new Date(), usuario: null,
          },
        ]),
      },
      users: {
        findUnique: jest.fn(async ({ where }: any) => ({ [RESP]: { fcm_token: 'tok-resp' } } as any)[where.id] ?? null),
        findMany: jest.fn(async ({ where }: any) =>
          where?.login ? [{ id: RESP, login: 'joao@a' }] : [{ id: SINDICO, fcm_token: 'tok-sindico' }],
        ),
      },
    };
    const notifications: any = { sendPushNotification: jest.fn(async () => undefined) };
    const tenant: any = { assertEntidade: jest.fn(async () => undefined), assertPermissaoFuncionario: jest.fn(async () => undefined) };
    const svc = new OcorrenciasService(prisma, notifications, tenant, {} as any);
    const pushes = () => notifications.sendPushNotification.mock.calls.map((c: any[]) => [c[0], c[2]]);
    return { svc, prisma, pushes };
  }

  it('grava sem Users.id, com o funcionário e o nome; a resposta sai como "Portaria · João"', async () => {
    const { svc, prisma } = montar();
    const msg: any = await svc.createMessage(5, null, 'Encanador chamado', porteiro);
    expect(prisma.ocorrenciaMensagens.create.mock.calls[0][0].data).toMatchObject({
      id_ocorrencia: 5, id_usuario: null, id_funcionario_portaria: 3, nome_autor: 'João', mensagem: 'Encanador chamado',
    });
    expect(msg.id_usuario).toBeNull();
    expect(msg.autor_tipo).toBe('portaria');
    expect(msg.usuario).toEqual({ id: null, name: 'Portaria · João', login_type: 'portaria', is_sindico: 0 });
  });

  it('leitura: mensagem do porteiro com usuario preenchido pelo rótulo; a do usuário segue igual', async () => {
    const { svc } = montar();
    const [doAutor, doPorteiro]: any[] = await svc.listMessages(5, porteiro);
    expect(doAutor.usuario).toEqual({ id: AUTOR, name: 'Autor', login_type: 'email', is_sindico: 0 });
    expect(doAutor.id_usuario).toBe(AUTOR);
    expect(doAutor.autor_tipo).toBe('usuario');
    expect(doPorteiro.id_usuario).toBeNull();
    expect(doPorteiro.usuario.name).toBe('Portaria · João');
    expect(doPorteiro.usuario.is_sindico).toBe(0);
  });

  it('o CRM lê o chat com o mesmo rótulo', async () => {
    const { svc, prisma } = montar();
    const crm = new CrmService(prisma, svc, {} as any);
    const lista: any[] = await crm.listMessages(5);
    expect(lista[1].usuario.name).toBe('Portaria · João');
  });

  it('push: em ocorrência do morador, avisa o autor com o nome da portaria', async () => {
    const { svc, pushes } = montar();
    await svc.createMessage(5, null, 'Encanador chamado', porteiro);
    expect(pushes()).toEqual([['tok-autor', 'Portaria · João: Encanador chamado']]);
  });

  it('push: em ocorrência aberta pela portaria (sem autor), avisa os síndicos', async () => {
    const { svc, pushes } = montar({ user: null });
    await svc.createMessage(5, null, 'Portão travando', porteiro);
    expect(pushes()).toEqual([['tok-sindico', 'Portaria · João: Portão travando']]);
  });

  it('push: o porteiro que é o responsável não recebe a própria mensagem', async () => {
    const { svc, pushes } = montar({ user: null, idResponsavel: RESP });
    await svc.createMessage(5, null, 'x', porteiro);
    expect(pushes().map((p: any[]) => p[0])).toEqual(['tok-sindico']);
  });

  it('sem Users.id e sem ser porteiro (ex.: token sem papel) → 400, nada gravado', async () => {
    const { svc, prisma } = montar();
    const semPapel = { sub: 9, nome: 'X', id_condominio: 1 } as JwtPayload;
    await expect(svc.createMessage(5, null, 'x', semPapel)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.ocorrenciaMensagens.create).not.toHaveBeenCalled();
  });

  it('GET acesso: o porteiro conversa', async () => {
    const { svc } = montar();
    await expect(svc.acesso(1, porteiro)).resolves.toEqual({ operar: true, administrar: false, conversar: true });
  });
});
