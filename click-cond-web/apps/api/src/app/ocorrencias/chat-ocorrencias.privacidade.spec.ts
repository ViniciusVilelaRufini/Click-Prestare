import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { OcorrenciasService } from './ocorrencias.service';
import { OcorrenciasController } from './ocorrencias.controller';

/**
 * O chat da ocorrência só conferia o condomínio. A regra de quem VÊ uma
 * ocorrência (equipe, o autor, ou qualquer um se pública) valia no findOne,
 * mas não nas mensagens: qualquer morador do prédio lia e escrevia no chat
 * da ocorrência privada do vizinho — pelo app ou pelo console.
 *
 * E `payload.sub` virava autor: no token da portaria-web ele é o id do
 * operador em Funcionarios_Portaria, e a mensagem/ocorrência saía em nome do
 * morador de mesmo número. O porteiro também levava 403 ao abrir uma
 * ocorrência privada que a listagem já mostrava a ele.
 */
describe('Ocorrências — chat e autoria', () => {
  const privadaDoAutor = { id: 5, id_condominio: 1, user: 100, publica: false };

  function montar(oc: any = privadaDoAutor) {
    const prisma: any = {
      ocorrencias: { findUnique: jest.fn(async () => ({ ...oc })) },
      ocorrenciaMensagens: {
        findMany: jest.fn(async () => []),
        create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
      },
      users: { findUnique: jest.fn(async () => null) },
    };
    const tenant: any = { assertEntidade: jest.fn(async () => undefined) };
    const svc = new OcorrenciasService(prisma, {} as any, tenant);
    jest.spyOn(svc as any, 'sendChatNotification').mockResolvedValue(undefined);
    return { svc, prisma };
  }

  const autor = { sub: 100, nome: 'QA autor', typeAccess: 'Morador' } as any;
  const vizinho = { sub: 101, nome: 'QA_SECURITY_20260923 vizinho', typeAccess: 'Morador' } as any;
  const sindico = { sub: 7, nome: 'QA síndico', typeAccess: 'Sindico' } as any;
  const porteiroMesmoNumero = { sub: 100, nome: 'QA porteiro', id_condominio: 1 } as any;

  it('vizinho NÃO lê o chat de ocorrência privada alheia', async () => {
    const { svc, prisma } = montar();
    await expect(svc.listMessages(5, vizinho)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.ocorrenciaMensagens.findMany).not.toHaveBeenCalled();
  });

  it('vizinho NÃO escreve no chat de ocorrência alheia', async () => {
    const { svc, prisma } = montar();
    await expect(svc.createMessage(5, 101, 'oi', vizinho)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.ocorrenciaMensagens.create).not.toHaveBeenCalled();
  });

  it('vizinho lê mas não escreve no chat de ocorrência pública', async () => {
    const { svc, prisma } = montar({ ...privadaDoAutor, publica: true });
    await expect(svc.listMessages(5, vizinho)).resolves.toEqual([]);
    await expect(svc.createMessage(5, 101, 'oi', vizinho)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.ocorrenciaMensagens.create).not.toHaveBeenCalled();
  });

  it('autor e síndico continuam usando o chat', async () => {
    const { svc, prisma } = montar();
    await svc.listMessages(5, autor);
    await svc.createMessage(5, 100, 'oi', autor);
    await svc.createMessage(5, 7, 'resposta', sindico);
    expect(prisma.ocorrenciaMensagens.create).toHaveBeenCalledTimes(2);
  });

  it('porteiro vê a ocorrência privada que a lista já mostra', async () => {
    const { svc } = montar({ ...privadaDoAutor, user: 999 });
    const s = svc as any;
    expect(() => s.assertPodeVer({ user: 999, publica: false }, porteiroMesmoNumero)).not.toThrow();
  });

  it('mensagem sem Users.id (token da portaria) é recusada, não atribuída a outro', async () => {
    const { svc, prisma } = montar();
    await expect(svc.createMessage(5, null as any, 'oi', porteiroMesmoNumero)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.ocorrenciaMensagens.create).not.toHaveBeenCalled();
  });

  it('console: autor da ocorrência/mensagem sai do Users.id real', async () => {
    const service: any = {
      create: jest.fn(async () => ({})),
      createMessage: jest.fn(async () => ({})),
      listFuncionariosAtribuiveis: jest.fn(async () => []),
    };
    const ctrl = new OcorrenciasController(service);
    await ctrl.create(1, porteiroMesmoNumero, { titulo: 'x' } as any);
    expect(service.create.mock.calls[0][0].user).toBeUndefined();
    await ctrl.createMessage(5, porteiroMesmoNumero, { mensagem: 'x' });
    expect(service.createMessage.mock.calls[0][1]).toBeNull();
  });

  it('console: morador não lista os funcionários do condomínio', () => {
    const service: any = { listFuncionariosAtribuiveis: jest.fn(async () => []) };
    const ctrl = new OcorrenciasController(service);
    expect(() => (ctrl as any).funcionarios(1, vizinho)).toThrow(ForbiddenException);
    expect(service.listFuncionariosAtribuiveis).not.toHaveBeenCalled();
  });
});
