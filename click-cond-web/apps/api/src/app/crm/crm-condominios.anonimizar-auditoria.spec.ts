import { ConflictException } from '@nestjs/common';
import { CrmCondominiosService } from './crm-condominios.service';

/**
 * LGPD: `audit_logs` não tem FK para Condominios, então a cascata da purga não
 * a alcança. Depois de uma purga bem-sucedida as linhas do condomínio mantêm a
 * trilha (data, ação, módulo, id da entidade) e perdem os dados pessoais.
 */
describe('CrmCondominiosService.purgar — anonimização de audit_logs', () => {
  function build(opts?: { ativo?: number; totalAcessos?: number; falhaAnonimizacao?: boolean }) {
    const cond = { id: 1, nome: 'Condomínio Teste', ativo: opts?.ativo ?? 0 };
    const totalAcessos = opts?.totalAcessos ?? 0;
    const ordem: string[] = [];

    const prisma: any = {
      condominios: {
        findUnique: jest.fn(async () => cond),
        delete: jest.fn(async () => {
          ordem.push('delete-condominio');
          return cond;
        }),
        update: jest.fn(async () => cond),
      },
      acessos_Facial: {
        count: jest.fn(async () => totalAcessos),
        deleteMany: jest.fn(async () => ({ count: totalAcessos })),
      },
      facial_Devices: {
        findMany: jest.fn(async () => []),
        count: jest.fn(async () => 2),
        updateMany: jest.fn(async () => ({ count: 2 })),
      },
      sindicos_Condominios: { findMany: jest.fn(async () => []) },
      moradores: { findMany: jest.fn(async () => []), count: jest.fn(async () => 12) },
      funcionarios: { findMany: jest.fn(async () => []), count: jest.fn(async () => 3) },
      apartamentos: { count: jest.fn(async () => 40) },
      apartamentos_Users: { findMany: jest.fn(async () => []) },
      auditLog: {
        updateMany: jest.fn(async () => {
          ordem.push('anonimizar');
          if (opts?.falhaAnonimizacao) throw new Error('Lock wait timeout exceeded');
          return { count: 57 };
        }),
      },
      $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    };

    const auditoria: any = {
      registrar: jest.fn(async () => {
        ordem.push('registrar-exclusao');
      }),
    };
    const deviceClient: any = {
      listUserIds: jest.fn(async () => []),
      removeUsers: jest.fn(async () => undefined),
    };

    const svc = new CrmCondominiosService(prisma, auditoria, deviceClient);
    // Silencia o log de erro esperado no cenário de falha.
    jest.spyOn((svc as any).logger, 'error').mockImplementation(() => undefined);
    return { svc, prisma, auditoria, ordem };
  }

  it('sobrescreve os dados pessoais das linhas do condomínio e preserva a trilha', async () => {
    const { svc, prisma } = build();

    await svc.purgar(1, 'Condomínio Teste', 'operador@teste');

    expect(prisma.auditLog.updateMany).toHaveBeenCalledTimes(1);
    const arg = prisma.auditLog.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id_condominio: 1 });
    expect(arg.data).toMatchObject({
      usuario_nome: 'Anonimizado',
      usuario_email: null,
      autor_id: null,
      autor_tipo: null,
      ip: null,
      detalhes: null,
      descricao: 'Registro anonimizado na exclusão definitiva do condomínio',
    });
    // A trilha fica: nada de mexer em data, ação, módulo ou id da entidade.
    for (const campo of ['created_at', 'acao', 'modulo', 'entidade_id', 'id_condominio']) {
      expect(arg.data).not.toHaveProperty(campo);
    }
  });

  it('anonimiza depois da cascata e ANTES de gravar a linha da exclusão (que fica íntegra)', async () => {
    const { svc, ordem } = build();

    await svc.purgar(1, 'Condomínio Teste', 'operador@teste');

    expect(ordem).toEqual(['delete-condominio', 'anonimizar', 'registrar-exclusao']);
  });

  it('informa quantas linhas foram anonimizadas no retorno e na linha da exclusão', async () => {
    const { svc, auditoria } = build();

    const resultado = await svc.purgar(1, 'Condomínio Teste', 'operador@teste');

    expect(resultado.auditoriaAnonimizada).toBe(57);
    expect(resultado.auditoriaAnonimizacaoFalhou).toBe(false);

    const linha = auditoria.registrar.mock.calls[0][0];
    expect(linha.usuario_nome).toBe('operador@teste');
    expect(linha.acao).toBe('DELETE');
    expect(linha.detalhes.auditoriaAnonimizada).toBe(57);
    expect(linha.detalhes.auditoriaAnonimizacaoFalhou).toBe(false);
  });

  it('falha na anonimização não desfaz a purga, mas aparece no retorno e na linha da exclusão', async () => {
    const { svc, prisma, auditoria } = build({ falhaAnonimizacao: true });

    const resultado = await svc.purgar(1, 'Condomínio Teste', 'operador@teste');

    expect(resultado.success).toBe(true);
    expect(prisma.condominios.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(resultado.auditoriaAnonimizada).toBeNull();
    expect(resultado.auditoriaAnonimizacaoFalhou).toBe(true);

    expect(auditoria.registrar).toHaveBeenCalledTimes(1);
    const linha = auditoria.registrar.mock.calls[0][0];
    expect(linha.detalhes.auditoriaAnonimizada).toBeNull();
    expect(linha.detalhes.auditoriaAnonimizacaoFalhou).toBe(true);
    expect(linha.descricao).toMatch(/anonimização.*falhou/i);
  });

  it('o resumo da linha da exclusão só carrega contagens, flags e nomes de terminal', async () => {
    const { svc, auditoria } = build();

    await svc.purgar(1, 'Condomínio Teste', 'operador@teste');

    const { detalhes } = auditoria.registrar.mock.calls[0][0];
    expect(Object.keys(detalhes).sort()).toEqual(
      [
        'apartamentos',
        'auditoriaAnonimizacaoFalhou',
        'auditoriaAnonimizada',
        'contasPreservadas',
        'contasRemovidas',
        'eventosAcessoRemovidos',
        'funcionarios',
        'historicoAcessosPurgado',
        'moradores',
        'terminais',
        'terminaisComFalha',
        'terminaisLimpos',
      ].sort(),
    );
    for (const [chave, valor] of Object.entries(detalhes)) {
      if (chave === 'terminaisComFalha') continue; // nomes de aparelho, não de pessoa
      expect(['number', 'boolean']).toContain(typeof valor);
    }
  });

  it('purga recusada não anonimiza nada', async () => {
    const { svc, prisma } = build({ totalAcessos: 4 });

    await expect(svc.purgar(1, 'Condomínio Teste', 'operador@teste')).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.auditLog.updateMany).not.toHaveBeenCalled();
  });

  it('se o delete do condomínio falhar, não anonimiza', async () => {
    const { svc, prisma } = build();
    prisma.condominios.delete.mockRejectedValueOnce(new Error('FK restrict'));

    await expect(svc.purgar(1, 'Condomínio Teste', 'operador@teste')).rejects.toThrow('FK restrict');
    expect(prisma.auditLog.updateMany).not.toHaveBeenCalled();
  });

  it('desativar (sem purgar) NÃO anonimiza — o condomínio pode ser reativado', async () => {
    const { svc, prisma } = build({ ativo: 1 });

    await svc.desativar(1, 'inadimplência', 'operador@teste');

    expect(prisma.auditLog.updateMany).not.toHaveBeenCalled();
  });
});
