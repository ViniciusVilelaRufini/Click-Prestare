import { BadRequestException } from '@nestjs/common';
import { VisitantesService } from './visitantes.service';

/**
 * Check-in / check-out (modelo Pessoas/Visitas):
 *  - check-in numa visita encerrada sobrescrevia entrada e apagava a saída
 *    (perdia a passagem do histórico); com a pessoa dentro, um duplo clique
 *    reescrevia a hora da entrada;
 *  - saída de quem não entrou / saída repetida fechavam a visita errada;
 *  - `visitas.user` (FK para Users) recebia o `sub` do token do porteiro, que
 *    é um id de Funcionarios_Portaria: atribuía ao usuário errado ou 500.
 */
describe('check-in / check-out — integridade da visita', () => {
  const original = process.env['PESSOAS_MIGRATION_ENABLED'];
  afterEach(() => {
    if (original === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = original;
  });

  const entrou = new Date('2026-09-23T04:40:22Z');
  const saiu = new Date('2026-09-23T04:46:06Z');

  function montar(visitaInicial: Record<string, unknown>) {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const pessoa = { id: 2000001, nome: 'QA_SECURITY_20260923', bloqueado: 0 };
    const visitas = new Map<number, any>();
    visitas.set(1000004, {
      id: 1000004, id_pessoa: 2000001, id_condominio: 1, id_apartamento: 106, user: 7,
      is_visitante: 1, is_prestador: 0, data_hora_inicio: null, data_hora_termino: null,
      data_entrada: null, data_saida: null, codigo_acesso: null, liberado: 1, bloqueado: 0,
      avisar: 1, tag_rfid: null, dias_semana: null, categorias: null, auth_status: null,
      ...visitaInicial,
    });
    let seq = 1000005;
    const rel = (v: any) => ({ ...v, pessoa, apartamento: { bloco: 'A', apto: '106' } });
    const prisma: any = {
      isConnected: true,
      visitas: {
        create: jest.fn(async ({ data }: any) => { const n = { id: seq++, ...data }; visitas.set(n.id, n); return rel(n); }),
        update: jest.fn(async ({ where, data }: any) => { const v = visitas.get(where.id); Object.assign(v, data); return rel(v); }),
      },
      vagas: { updateMany: jest.fn(async () => ({ count: 0 })) },
    };
    const svc = new VisitantesService(
      prisma, {} as any, {} as any, {} as any, { registrar: jest.fn() } as any, {} as any,
      { emitToCondominio: jest.fn() } as any,
    );
    const s = svc as any;
    jest.spyOn(s, 'assertPodeAcessarVisita').mockImplementation(async (id: any) => rel(visitas.get(Number(id))));
    jest.spyOn(s, 'fireFacialSyncPessoa').mockImplementation(() => undefined);
    return { svc, prisma, visitas };
  }

  const porteiro = { sub: 3, nome: 'QA porteiro', id_condominio: 1, turno: 'Diurno' } as any;
  const sindicoPortaria = { sub: 7, nome: 'QA síndico', id_condominio: 1, typeAccess: 'Sindico' } as any;

  it('check-in numa visita encerrada abre uma visita nova e preserva a antiga', async () => {
    const { svc, prisma, visitas } = montar({ data_entrada: entrou, data_saida: saiu, liberado: 0 });
    await svc.checkIn(1000004, sindicoPortaria);
    expect(visitas.get(1000004).data_entrada).toEqual(entrou);
    expect(visitas.get(1000004).data_saida).toEqual(saiu);
    expect(prisma.visitas.create).toHaveBeenCalledTimes(1);
    expect(visitas.get(1000005).data_entrada).toBeInstanceOf(Date);
  });

  it('check-in de quem já está dentro é recusado (duplo clique não reescreve a entrada)', async () => {
    const { svc, visitas } = montar({ data_entrada: entrou });
    await expect(svc.checkIn(1000004, sindicoPortaria)).rejects.toBeInstanceOf(BadRequestException);
    expect(visitas.get(1000004).data_entrada).toEqual(entrou);
  });

  it('saída de quem não entrou é recusada', async () => {
    const { svc, visitas } = montar({});
    await expect(svc.checkOut(1000004, sindicoPortaria)).rejects.toBeInstanceOf(BadRequestException);
    expect(visitas.get(1000004).data_saida).toBeNull();
  });

  it('saída repetida é recusada e não muda a hora da primeira', async () => {
    const { svc, visitas } = montar({ data_entrada: entrou, data_saida: saiu });
    await expect(svc.checkOut(1000004, sindicoPortaria)).rejects.toBeInstanceOf(BadRequestException);
    expect(visitas.get(1000004).data_saida).toEqual(saiu);
  });

  it('check-in pelo porteiro não grava o id dele em visitas.user (FK para Users)', async () => {
    const { svc, prisma } = montar({});
    await svc.checkIn(1000004, porteiro);
    const data = prisma.visitas.update.mock.calls.at(-1)[0].data;
    expect(data.user).toBeUndefined();
  });

  it('check-in pelo síndico continua registrando quem fez', async () => {
    const { svc, prisma } = montar({});
    await svc.checkIn(1000004, sindicoPortaria);
    expect(prisma.visitas.update.mock.calls.at(-1)[0].data.user).toBe(7);
  });
});
