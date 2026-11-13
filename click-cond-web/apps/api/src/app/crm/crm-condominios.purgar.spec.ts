import { ConflictException } from '@nestjs/common';
import { CrmCondominiosService } from './crm-condominios.service';

describe('CrmCondominiosService.purgar — refusal when Acessos_Facial has history', () => {
  function build(totalAcessos: number) {
    const cond = { id: 1, nome: 'Condomínio Teste', ativo: 0 };

    const prisma: any = {
      condominios: {
        findUnique: jest.fn(async () => cond),
        delete: jest.fn(async () => cond),
      },
      acessos_Facial: {
        count: jest.fn(async () => totalAcessos),
        deleteMany: jest.fn(async () => ({ count: totalAcessos })),
      },
      // limparTerminais consulta facial_Devices — não deve ser chamado se a
      // purga for recusada antes.
      facial_Devices: {
        findMany: jest.fn(async () => []),
        count: jest.fn(async () => 0),
      },
      sindicos_Condominios: { findMany: jest.fn(async () => []) },
      vagas: { deleteMany: jest.fn(async () => ({ count: 0 })) },
      moradores: {
        findMany: jest.fn(async () => []),
        count: jest.fn(async () => 0),
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
      funcionarios: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
      apartamentos: { count: jest.fn(async () => 0) },
      apartamentos_Users: { findMany: jest.fn(async () => []) },
      // Sem FK para Condominios: a cascata não os alcança.
      chat_Ia_Historico: { deleteMany: jest.fn(async () => ({ count: 0 })) },
      rag_Embeddings: { deleteMany: jest.fn(async () => ({ count: 0 })) },
      fechamentoMensal: { deleteMany: jest.fn(async () => ({ count: 0 })) },
      crm_Faturas: { deleteMany: jest.fn() },
      crm_Disparos: { deleteMany: jest.fn() },
      $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    };

    const auditoria: any = { registrar: jest.fn(async () => undefined) };
    const deviceClient: any = {
      listUserIds: jest.fn(async () => []),
      removeUsers: jest.fn(async () => undefined),
    };

    const svc = new CrmCondominiosService(prisma, auditoria, deviceClient);
    return { svc, prisma, auditoria, deviceClient, cond };
  }

  it('recusa com ConflictException quando há eventos de acesso, e NÃO limpa os terminais', async () => {
    const { svc, prisma, deviceClient } = build(3);

    await expect(svc.purgar(1, 'Condomínio Teste', 'operador@teste')).rejects.toThrow(
      ConflictException,
    );

    // A trava tem que atuar ANTES de limparTerminais (irreversível/não-transacional)
    // e antes do delete do condomínio.
    expect(prisma.facial_Devices.findMany).not.toHaveBeenCalled();
    expect(deviceClient.listUserIds).not.toHaveBeenCalled();
    expect(prisma.condominios.delete).not.toHaveBeenCalled();
  });

  it('a mensagem de recusa cita a contagem e orienta a purgar o histórico explicitamente', async () => {
    const { svc } = build(7);

    await expect(svc.purgar(1, 'Condomínio Teste', 'operador@teste')).rejects.toThrow(/7/);
  });

  it('permite excluir quando não há eventos de acesso (fluxo antigo continua funcionando)', async () => {
    const { svc, prisma } = build(0);

    const resultado = await svc.purgar(1, 'Condomínio Teste', 'operador@teste');

    expect(resultado.success).toBe(true);
    expect(prisma.condominios.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(prisma.moradores.deleteMany).toHaveBeenCalledWith({ where: { id_condominio: 1 } });
  });

  it('com purgarHistoricoAcessos=true, apaga o histórico e o condomínio na mesma transação', async () => {
    const { svc, prisma } = build(5);

    const resultado = await svc.purgar(1, 'Condomínio Teste', 'operador@teste', {
      purgarHistoricoAcessos: true,
    });

    expect(resultado.success).toBe(true);
    // O delete do histórico e o delete do condomínio entram juntos, na mesma
    // chamada de $transaction — tudo ou nada.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.acessos_Facial.deleteMany).toHaveBeenCalledWith({
      where: { id_condominio: 1 },
    });
    expect(prisma.condominios.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it('apaga chat do assistente, embeddings do RAG e fechamentos mensais na mesma transação (sem FK, fora da cascata)', async () => {
    const { svc, prisma } = build(0);

    await svc.purgar(1, 'Condomínio Teste', 'operador@teste');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const ops = prisma.$transaction.mock.calls[0][0];
    for (const modelo of ['chat_Ia_Historico', 'rag_Embeddings', 'fechamentoMensal']) {
      expect(prisma[modelo].deleteMany).toHaveBeenCalledWith({ where: { id_condominio: 1 } });
      expect(ops).toContain(prisma[modelo].deleteMany.mock.results[0].value);
    }
    // Faturamento da Prestare fica: não é dado do condomínio a apagar.
    expect(prisma.crm_Faturas.deleteMany).not.toHaveBeenCalled();
    expect(prisma.crm_Disparos.deleteMany).not.toHaveBeenCalled();
  });

  it('purga recusada não apaga chat, embeddings nem fechamentos', async () => {
    const { svc, prisma } = build(3);

    await expect(svc.purgar(1, 'Condomínio Teste', 'operador@teste')).rejects.toThrow(ConflictException);
    expect(prisma.chat_Ia_Historico.deleteMany).not.toHaveBeenCalled();
    expect(prisma.rag_Embeddings.deleteMany).not.toHaveBeenCalled();
    expect(prisma.fechamentoMensal.deleteMany).not.toHaveBeenCalled();
  });
});
