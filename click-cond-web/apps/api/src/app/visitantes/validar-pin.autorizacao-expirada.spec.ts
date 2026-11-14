import { BadRequestException } from '@nestjs/common';
import { VisitantesService } from './visitantes.service';

/**
 * Rodada 3, item 23A: a visita tem PIN e o morador autorizou um pedido sobre
 * ela. 15 min depois, "Validar PIN" respondia ATIVO (não aplicava os 10 min) e
 * "Confirmar Entrada" falhava no check-in com "autorização expirada". Agora o
 * Validar PIN aplica a mesma checagem do check-in.
 */
describe('validar PIN (Pessoas/Visitas) — autorização do morador vencida', () => {
  const original = process.env['PESSOAS_MIGRATION_ENABLED'];
  afterEach(() => {
    if (original === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = original;
  });

  const H = 60 * 60 * 1000;
  const MIN = 60 * 1000;

  function svc(extra: Record<string, unknown>) {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const prisma: any = {
      isConnected: true,
      pessoas: {},
      visitas: {
        findFirst: jest.fn(async () => ({
          id: 1000009, id_condominio: 1, codigo_acesso: '123456', data_saida: null, data_entrada: null,
          bloqueado: 0, liberado: 1, is_visitante: 1, is_prestador: 0, dias_semana: null,
          data_hora_inicio: new Date(Date.now() - H), data_hora_termino: new Date(Date.now() + 3 * H),
          auth_status: 'autorizado',
          ...extra,
          pessoa: { nome: 'QA_PIN', bloqueado: 0, doc_identificacao: null, foto_documento: null, foto_pessoa: null },
          apartamento: { bloco: 'A', apto: '106' },
          criadoPor: null,
        })),
      },
    };
    return new VisitantesService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  }

  it('morador autorizou há 15 min, visita não usada: recusa como o check-in', async () => {
    const s = svc({ auth_solicitado_em: new Date(Date.now() - 16 * MIN), auth_respondido_em: new Date(Date.now() - 15 * MIN) });
    await expect(s.validarCodigo(1, '123456')).rejects.toBeInstanceOf(BadRequestException);
    await expect(s.validarCodigo(1, '123456')).rejects.toThrow('A autorização desta visita está expirada.');
  });

  it('morador autorizou há 2 min: ATIVO', async () => {
    const s = svc({ auth_solicitado_em: new Date(Date.now() - 3 * MIN), auth_respondido_em: new Date(Date.now() - 2 * MIN) });
    const r: any = await s.validarCodigo(1, '123456');
    expect(r.status_vigencia).toBe('ATIVO');
  });

  it('dentro do condomínio: o PIN serve para a saída mesmo com a autorização antiga', async () => {
    const s = svc({
      auth_respondido_em: new Date(Date.now() - 2 * H),
      data_entrada: new Date(Date.now() - 90 * MIN),
    });
    const r: any = await s.validarCodigo(1, '123456');
    expect(r.acao).toBe('saida');
  });

  it('liberação da portaria (sem pedido ao morador) não tem os 10 min', async () => {
    const s = svc({ auth_status: null });
    const r: any = await s.validarCodigo(1, '123456');
    expect(r.status_vigencia).toBe('ATIVO');
  });
});
