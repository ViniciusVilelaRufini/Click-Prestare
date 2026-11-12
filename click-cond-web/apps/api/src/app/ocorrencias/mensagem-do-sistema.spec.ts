import { BadRequestException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { OcorrenciasService } from './ocorrencias.service';
import { CrmService } from '../crm/crm.service';
import { KabaniaService } from '../integrations/kabania.service';

/**
 * CRM e integração Kabania escrevem no chat da ocorrência sem token de
 * usuário. Elas chamavam a `createMessage` pública sem `requester` e levavam
 * 403 (nem autor, nem equipe). O caminho interno `createMessageDoSistema`
 * confere só que a ocorrência existe e marca a origem no texto; a pública
 * continua recusando quem não é autor nem equipe.
 */
describe('Ocorrências — mensagem do sistema (CRM e Kabania)', () => {
  function montar(opts?: { oc?: any; sindico?: any }) {
    const oc =
      opts && 'oc' in opts
        ? opts.oc
        : { id: 5, id_condominio: 1, user: 100, publica: false, descricao: 'Vazamento' };
    const sindico = opts && 'sindico' in opts ? opts.sindico : { id: 7 };
    const prisma: any = {
      isConnected: true,
      ocorrencias: {
        findUnique: jest.fn(async () =>
          oc ? { ...oc, criadoPor: { id: 100, name: 'Autor', fcm_token: 'tok-autor' } } : null,
        ),
        update: jest.fn(async ({ data }: any) => ({ ...oc, ...data })),
      },
      ocorrenciaMensagens: {
        create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
      },
      users: {
        findFirst: jest.fn(async () => sindico),
        findUnique: jest.fn(async () => ({ name: 'Síndico Zé', is_sindico: 1 })),
        findMany: jest.fn(async () => []),
      },
    };
    const notifications: any = { sendPushNotification: jest.fn(async () => undefined) };
    const tenant: any = { assertEntidade: jest.fn(async () => undefined) };
    const ocorrencias = new OcorrenciasService(prisma, notifications, tenant, {} as any);
    const crm = new CrmService(prisma, ocorrencias, {} as any);
    const kabania = new KabaniaService(prisma, crm, ocorrencias);
    return { prisma, notifications, tenant, ocorrencias, crm, kabania };
  }

  it('CRM grava a mensagem, identificada como do suporte da Prestare', async () => {
    const { crm, prisma, tenant } = montar();

    await crm.createMessage(5, 'Técnico agendado para amanhã');

    expect(prisma.ocorrenciaMensagens.create).toHaveBeenCalledTimes(1);
    const data = prisma.ocorrenciaMensagens.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ id_ocorrencia: 5, id_usuario: 7 });
    expect(data.mensagem).toBe('[Suporte Prestare] Técnico agendado para amanhã');
    // Caminho interno: não passa pela checagem de tenant de token de usuário.
    expect(tenant.assertEntidade).not.toHaveBeenCalled();
  });

  it('CRM ao reabrir grava a mensagem de reabertura', async () => {
    const { crm, prisma } = montar();

    await crm.reabrirOcorrencia(5, 'Voltou a vazar');

    const data = prisma.ocorrenciaMensagens.create.mock.calls[0][0].data;
    expect(data.mensagem).toBe('[Suporte Prestare] [Chamado Reaberto] Voltou a vazar');
  });

  it('Kabania grava a mensagem, identificada como Kabania', async () => {
    const { kabania, prisma } = montar();

    await kabania.resolveOccurrenceMessage(5, 'Ordem de serviço aberta');

    const data = prisma.ocorrenciaMensagens.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ id_ocorrencia: 5, id_usuario: 7 });
    expect(data.mensagem).toBe('[Kabania] Ordem de serviço aberta');
  });

  it('o push ao autor sai com o rótulo da origem, não com o nome do síndico', async () => {
    const { crm, notifications } = montar();

    await crm.createMessage(5, 'Técnico agendado');

    expect(notifications.sendPushNotification).toHaveBeenCalledWith(
      'tok-autor',
      expect.any(String),
      'Suporte Prestare: Técnico agendado',
      expect.anything(),
    );
  });

  it('sem síndico no condomínio, a mensagem fica com o autor da ocorrência', async () => {
    const { ocorrencias, prisma } = montar({ sindico: null });

    await ocorrencias.createMessageDoSistema({ idOcorrencia: 5, mensagem: 'oi', autorRotulo: 'Kabania', origem: 'kabania' });

    expect(prisma.ocorrenciaMensagens.create.mock.calls[0][0].data.id_usuario).toBe(100);
  });

  it('sem síndico nem autor, recusa em vez de gravar em nome de um id qualquer', async () => {
    const { ocorrencias, prisma } = montar({
      sindico: null,
      oc: { id: 5, id_condominio: 1, user: null, publica: true },
    });

    await expect(
      ocorrencias.createMessageDoSistema({ idOcorrencia: 5, mensagem: 'oi', autorRotulo: 'Kabania', origem: 'kabania' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(prisma.ocorrenciaMensagens.create).not.toHaveBeenCalled();
  });

  it('ocorrência inexistente responde 404; mensagem vazia, 400', async () => {
    const { ocorrencias, prisma } = montar({ oc: null });

    await expect(
      ocorrencias.createMessageDoSistema({ idOcorrencia: 9, mensagem: 'oi', autorRotulo: 'Suporte Prestare', origem: 'crm' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      ocorrencias.createMessageDoSistema({ idOcorrencia: 9, mensagem: '  ', autorRotulo: 'Suporte Prestare', origem: 'crm' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.ocorrenciaMensagens.create).not.toHaveBeenCalled();
  });

  // Revisão M5: ninguém imita a mensagem do suporte pela rota pública.
  it.each([
    ['[Suporte Prestare] Sua conta será bloqueada', 'Sua conta será bloqueada'],
    ['   [suporte prestare]   Ligue para 0800', 'Ligue para 0800'],
    ['[KABANIA] OS fechada', 'OS fechada'],
    ['[ Kabania ][Suporte Prestare] duplo', 'duplo'],
  ])('a createMessage pública retira o prefixo reservado: %p', async (enviado, gravado) => {
    const { ocorrencias, prisma } = montar();
    const autor = { sub: 100, typeAccess: 'Morador' } as any;

    await ocorrencias.createMessage(5, 100, enviado, autor);

    expect(prisma.ocorrenciaMensagens.create.mock.calls[0][0].data.mensagem).toBe(gravado);
  });

  it('a createMessage pública mantém o texto quando o rótulo não está no início', async () => {
    const { ocorrencias, prisma } = montar();
    const autor = { sub: 100, typeAccess: 'Morador' } as any;

    await ocorrencias.createMessage(5, 100, 'Falei com o [Suporte Prestare] ontem', autor);

    expect(prisma.ocorrenciaMensagens.create.mock.calls[0][0].data.mensagem).toBe('Falei com o [Suporte Prestare] ontem');
  });

  it('a createMessage pública recusa mensagem que era só o prefixo reservado', async () => {
    const { ocorrencias, prisma } = montar();
    const autor = { sub: 100, typeAccess: 'Morador' } as any;

    await expect(ocorrencias.createMessage(5, 100, ' [Kabania] ', autor)).rejects.toThrow('Mensagem inválida.');
    expect(prisma.ocorrenciaMensagens.create).not.toHaveBeenCalled();
  });

  it('a createMessage pública continua recusando quem não é autor nem equipe', async () => {
    const { ocorrencias, prisma } = montar();

    // Sem token (como o CRM chamava) e com token de morador vizinho.
    await expect(ocorrencias.createMessage(5, 7, 'oi')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      ocorrencias.createMessage(5, 101, 'oi', { sub: 101, typeAccess: 'Morador' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.ocorrenciaMensagens.create).not.toHaveBeenCalled();
  });
});
