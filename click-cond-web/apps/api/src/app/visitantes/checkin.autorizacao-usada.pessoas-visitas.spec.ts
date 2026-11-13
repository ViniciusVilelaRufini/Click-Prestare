import { BadRequestException } from '@nestjs/common';
import { VisitantesService } from './visitantes.service';

/**
 * A saída pelo facial não limpa `auth_status` da visita. Uma visita
 * autorizada pelo morador, usada (entrou e saiu), ficava com
 * `auth_status = 'autorizado'` e o check-in seguinte pela portaria era
 * recusado como "autorização expirada" — embora o check-in numa visita usada
 * abra uma passagem NOVA, que não depende daquela autorização.
 */
describe('check-in (Pessoas/Visitas) — autorização já usada não trava a nova passagem', () => {
  const original = process.env['PESSOAS_MIGRATION_ENABLED'];
  afterEach(() => {
    if (original === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = original;
  });

  const H = 60 * 60 * 1000;

  function montar(visitaInicial: Record<string, unknown>) {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const pessoa = { id: 2000001, nome: 'QA_Autorizacao_Usada', bloqueado: 0 };
    const visitas = new Map<number, any>();
    visitas.set(1000004, {
      id: 1000004, id_pessoa: 2000001, id_condominio: 1, id_apartamento: 106, user: 7,
      is_visitante: 1, is_prestador: 0, data_hora_inicio: null, data_hora_termino: null,
      data_entrada: null, data_saida: null, codigo_acesso: null, liberado: 0, bloqueado: 0,
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

  const sindicoPortaria = { sub: 7, nome: 'QA síndico', id_condominio: 1, typeAccess: 'Sindico' } as any;

  it('autorizada, entrou e saiu pelo facial: check-in abre a passagem nova', async () => {
    const { svc, prisma, visitas } = montar({
      auth_status: 'autorizado',
      auth_solicitado_em: new Date(Date.now() - 3 * H),
      auth_respondido_em: new Date(Date.now() - 3 * H + 60_000),
      data_entrada: new Date(Date.now() - 2 * H),
      data_saida: new Date(Date.now() - H),
    });
    await svc.checkIn(1000004, sindicoPortaria);
    expect(prisma.visitas.create).toHaveBeenCalledTimes(1);
    expect(visitas.get(1000005).data_entrada).toBeInstanceOf(Date);
  });

  it('autorização vencida numa visita NÃO usada continua recusada', async () => {
    const { svc } = montar({
      liberado: 1,
      auth_status: 'autorizado',
      auth_solicitado_em: new Date(Date.now() - H),
      auth_respondido_em: new Date(Date.now() - H + 60_000),
    });
    await expect(svc.checkIn(1000004, sindicoPortaria)).rejects.toBeInstanceOf(BadRequestException);
  });
});
