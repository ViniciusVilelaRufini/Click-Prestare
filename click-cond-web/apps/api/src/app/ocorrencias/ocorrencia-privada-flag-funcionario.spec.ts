import { ForbiddenException } from '@nestjs/common';
import { OcorrenciasService } from './ocorrencias.service';
import { TenantAccessService } from '../auth/tenant-access.service';

/**
 * `ehEquipe` tratava todo `Funcionario` como equipe com acesso total: o chat
 * (e a ficha, e a lista) da ocorrência privada saíam para funcionário com a
 * flag `ocorrencias = 0` — a mesma ocorrência que o `getOcorrenciaById` do
 * app já recusava a ele. Ocorrência privada é onde o morador relata briga de
 * vizinho, saúde, dívida; a flag é como o síndico define quem da equipe lê.
 *
 * Pública continua mural do condomínio; síndico e o operador do console não
 * dependem de flag.
 */
describe('Ocorrências — flag ocorrencias do funcionário', () => {
  const privada = { id: 5, id_condominio: 1, user: 100, publica: false };

  function montar(flag: number, oc: any = privada) {
    const prisma: any = {
      isConnected: true,
      funcionarios: { findFirst: jest.fn(async () => ({ ocorrencias: flag })) },
      ocorrencias: {
        findUnique: jest.fn(async () => ({ status: 'Pendente', ...oc, categoria: null, criadoPor: null, id_responsavel: null })),
        findMany: jest.fn(async () => []),
        update: jest.fn(async ({ data }: any) => ({ id: 5, user: 100, ...data, categoria: null })),
        updateMany: jest.fn(async () => ({ count: 1 })),
        delete: jest.fn(async () => ({})),
      },
      funcionarios_Portaria: { findMany: jest.fn(async () => []) },
      ocorrenciaMensagens: {
        findMany: jest.fn(async () => []),
        create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
      },
      users: { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null) },
    };
    const real = new TenantAccessService(prisma);
    const tenant: any = {
      assertEntidade: jest.fn(async () => undefined),
      assertCondominio: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn((id: number, f: any, p: any) => real.assertPermissaoFuncionario(id, f, p)),
    };
    const svc = new OcorrenciasService(prisma, {} as any, tenant, {} as any);
    jest.spyOn(svc as any, 'sendChatNotification').mockResolvedValue(undefined);
    return { svc, prisma };
  }

  const funcionario = { sub: 20, nome: 'Bruno', typeAccess: 'Funcionario', user: { id: 20 } } as any;
  const sindico = { sub: 7, nome: 'Síndico', typeAccess: 'Sindico' } as any;
  const porteiroConsole = { sub: 3, nome: 'Porteiro', id_condominio: 1 } as any;

  it('NEGA o chat de ocorrência privada a funcionário sem a flag', async () => {
    const { svc, prisma } = montar(0);
    await expect(svc.listMessages(5, funcionario)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.ocorrenciaMensagens.findMany).not.toHaveBeenCalled();
  });

  it('NEGA escrever no chat de ocorrência privada a funcionário sem a flag', async () => {
    const { svc, prisma } = montar(0);
    await expect(svc.createMessage(5, 20, 'oi', funcionario)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.ocorrenciaMensagens.create).not.toHaveBeenCalled();
  });

  it('NEGA a ficha (findOne) da ocorrência privada a funcionário sem a flag', async () => {
    const { svc } = montar(0);
    await expect(svc.findOne(5, funcionario)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lista (findAll) do funcionário sem a flag tem o recorte do morador', async () => {
    const { svc, prisma } = montar(0);
    await svc.findAll(1, undefined, funcionario);
    expect(prisma.ocorrencias.findMany.mock.calls[0][0].where.OR).toEqual([{ publica: true }, { user: 20 }]);
  });

  it('PERMITE funcionário com a flag (chat, ficha e lista completa)', async () => {
    const { svc, prisma } = montar(1);
    await expect(svc.listMessages(5, funcionario)).resolves.toEqual([]);
    await expect(svc.createMessage(5, 20, 'oi', funcionario)).resolves.toMatchObject({ mensagem: 'oi' });
    await expect(svc.findOne(5, funcionario)).resolves.toMatchObject({ id: 5 });
    await svc.findAll(1, undefined, funcionario);
    expect(prisma.ocorrencias.findMany.mock.calls[0][0].where.OR).toBeUndefined();
  });

  it('ocorrência pública: funcionário sem a flag lê o chat', async () => {
    const { svc } = montar(0, { ...privada, publica: true });
    await expect(svc.listMessages(5, funcionario)).resolves.toEqual([]);
  });

  /**
   * Sem a flag, o funcionário tem o recorte do morador — e morador não escreve
   * no chat de ocorrência pública alheia (lê, mas a conversa é do autor com o
   * condomínio).
   */
  it('NEGA escrever no chat de ocorrência PÚBLICA alheia a funcionário sem a flag', async () => {
    const { svc, prisma } = montar(0, { ...privada, publica: true });
    await expect(svc.createMessage(5, 20, 'oi', funcionario)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.ocorrenciaMensagens.create).not.toHaveBeenCalled();
  });

  it('funcionário sem a flag escreve no chat da ocorrência que ele mesmo abriu', async () => {
    const { svc } = montar(0, { ...privada, user: 20 });
    await expect(svc.createMessage(5, 20, 'oi', funcionario)).resolves.toMatchObject({ mensagem: 'oi' });
  });

  /**
   * Status, resposta, atribuição e remoção passam por `loadParaMutacaoStaff`,
   * que exigia só "síndico ou funcionário": sem a flag, o funcionário ainda
   * administrava a ocorrência privada que não pode nem ler.
   */
  it('NEGA mudar status, responder, atribuir e remover a funcionário sem a flag', async () => {
    const { svc, prisma } = montar(0);
    await expect(svc.updateStatus(5, 'Ciente', funcionario)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.updateResposta(5, 'ok', funcionario)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.atribuir(5, null, funcionario)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.updatePublica(5, true, funcionario)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.remove(5, funcionario)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.ocorrencias.update).not.toHaveBeenCalled();
    expect(prisma.ocorrencias.updateMany).not.toHaveBeenCalled();
    expect(prisma.ocorrencias.delete).not.toHaveBeenCalled();
  });

  it('funcionário com a flag e o síndico administram a ocorrência', async () => {
    const a = montar(1);
    await a.svc.updateStatus(5, 'Ciente', funcionario);
    expect(a.prisma.ocorrencias.updateMany.mock.calls[0][0].data).toEqual({ status: 'Ciente' });
    const b = montar(0);
    await b.svc.updateStatus(5, 'Ciente', sindico);
    expect(b.prisma.ocorrencias.updateMany.mock.calls[0][0].data).toEqual({ status: 'Ciente' });
    expect(b.prisma.funcionarios.findFirst).not.toHaveBeenCalled();
  });

  it('síndico e operador do console seguem sem depender de flag', async () => {
    const { svc, prisma } = montar(0);
    await expect(svc.listMessages(5, sindico)).resolves.toEqual([]);
    await expect(svc.listMessages(5, porteiroConsole)).resolves.toEqual([]);
    expect(prisma.funcionarios.findFirst).not.toHaveBeenCalled();
  });
});
