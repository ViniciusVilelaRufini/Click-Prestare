import { BadRequestException } from '@nestjs/common';
import { VisitantesService } from './visitantes.service';

/**
 * Autorizar/Negar (portaria remota) aceitavam resposta a qualquer momento,
 * sem conferir se a visita ainda esperava resposta. A notificação fica no
 * celular: um segundo morador do apto respondendo depois do primeiro, ou o
 * morador tocando no push depois que a portaria já deu entrada, virava a
 * decisão — "negar" tirava o acesso de quem já estava dentro, e "autorizar
 * com entrada" reescrevia a entrada e reabria uma visita encerrada.
 * Também: o prazo aceito era 15 min, mas a portaria e a mensagem de erro
 * usam 10 min — o morador liberava um pedido que a portaria já via expirado.
 */
describe('Portaria remota — só responde pedido pendente e dentro do prazo', () => {
  const original = process.env['PESSOAS_MIGRATION_ENABLED'];
  afterEach(() => {
    if (original === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = original;
  });

  const minutosAtras = (m: number) => new Date(Date.now() - m * 60 * 1000);

  function montar(visita: Record<string, unknown>) {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const pessoa = { id: 2000001, nome: 'QA_SECURITY_20260923', bloqueado: 0, foto_pessoa: null };
    const v: any = {
      id: 1000004, id_pessoa: 2000001, id_condominio: 1, id_apartamento: 106, is_prestador: 0,
      bloqueado: 0, liberado: 0, data_entrada: null, data_saida: null,
      auth_status: 'pendente', auth_solicitado_em: minutosAtras(2),
      ...visita,
    };
    const rel = () => ({ ...v, pessoa, apartamento: { bloco: 'A', apto: '106' } });
    const prisma: any = {
      isConnected: true,
      pessoas: {},
      visitas: {
        update: jest.fn(async ({ data }: any) => { Object.assign(v, data); return rel(); }),
      },
    };
    const svc = new VisitantesService(
      prisma, {} as any, {} as any, {} as any, { registrar: jest.fn() } as any, {} as any,
      { emitToCondominio: jest.fn() } as any,
    );
    jest.spyOn(svc as any, 'assertPodeAcessarVisita').mockImplementation(async () => rel());
    jest.spyOn(svc as any, 'fireFacialSyncPessoa').mockImplementation(() => undefined);
    return { svc, prisma, v };
  }

  const morador = { sub: 50, nome: 'QA morador', typeAccess: 'Morador' } as any;

  it('autoriza pedido pendente dentro do prazo', async () => {
    const { svc, v } = montar({});
    await svc.autorizar(1000004, morador, true);
    expect(v.auth_status).toBe('autorizado');
    expect(v.data_entrada).toBeInstanceOf(Date);
  });

  it('nega pedido pendente', async () => {
    const { svc, v } = montar({});
    await svc.negar(1000004, morador);
    expect(v.auth_status).toBe('negado');
  });

  it.each([['negado'], ['autorizado'], [null]])(
    'autorizar pedido que não está pendente (%s) é recusado',
    async (status) => {
      const { svc, prisma } = montar({ auth_status: status });
      await expect(svc.autorizar(1000004, morador, true)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.visitas.update).not.toHaveBeenCalled();
    },
  );

  it('negar depois que a portaria já deu entrada não tira o acesso de quem está dentro', async () => {
    const entrou = minutosAtras(1);
    const { svc, prisma, v } = montar({ auth_status: 'autorizado', liberado: 1, data_entrada: entrou });
    await expect(svc.negar(1000004, morador)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.visitas.update).not.toHaveBeenCalled();
    expect(v.liberado).toBe(1);
  });

  it('autorizar depois de 10 minutos é recusado (mesmo prazo da portaria)', async () => {
    const { svc, prisma } = montar({ auth_solicitado_em: minutosAtras(12) });
    await expect(svc.autorizar(1000004, morador)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.visitas.update).not.toHaveBeenCalled();
  });
});
