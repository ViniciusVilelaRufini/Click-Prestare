import { VisitantesService } from './visitantes.service';

/**
 * O modal "Validar PIN" registra ENTRADA ou SAÍDA conforme a pessoa já entrou.
 * A validação cobrava a janela (+15 min) e o dia permitido também de quem está
 * DENTRO: a visita que passou do horário não conseguia registrar a saída pelo
 * PIN. Para a saída, só importa estar dentro.
 */
describe('validar PIN — saída de quem está dentro', () => {
  const original = process.env['PESSOAS_MIGRATION_ENABLED'];
  afterEach(() => {
    if (original === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = original;
  });

  const H = 60 * 60 * 1000;
  const ontem = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'][new Date(Date.now() - 3 * H - 24 * H).getUTCDay()];

  const base = (extra: Record<string, unknown>) => ({
    id: 1000009, id_condominio: 1, codigo_acesso: '123456', data_saida: null, data_entrada: null,
    bloqueado: 0, liberado: 1, is_visitante: 1, is_prestador: 0, dias_semana: null,
    data_hora_inicio: new Date(Date.now() - 6 * H),
    data_hora_termino: new Date(Date.now() - 2 * H), // janela encerrou há 2 h
    ...extra,
  });

  function pessoasVisitas(visita: Record<string, unknown>) {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const prisma: any = {
      isConnected: true,
      pessoas: {},
      visitas: {
        findFirst: jest.fn(async () => ({
          ...base(visita),
          pessoa: { nome: 'QA_PIN', bloqueado: 0, doc_identificacao: null, foto_documento: null, foto_pessoa: null },
          apartamento: { bloco: 'A', apto: '106' },
          criadoPor: null,
        })),
      },
    };
    return new VisitantesService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  }

  function legado(visita: Record<string, unknown>) {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
    const prisma: any = {
      isConnected: true,
      visitantes: {
        findFirst: jest.fn(async () => ({
          ...base(visita), nome: 'QA_PIN', doc_identificacao: null, foto_documento: null, foto_pessoa: null,
          apartamento: { bloco: 'A', apto: '106' }, criadoPor: null,
        })),
      },
    };
    return new VisitantesService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  }

  describe.each([['Pessoas/Visitas', pessoasVisitas], ['legado', legado]])('%s', (_, svc) => {
    it('dentro, janela encerrada: valida para a saída', async () => {
      const r: any = await svc({ data_entrada: new Date(Date.now() - 5 * H) }).validarCodigo(1, '123456');
      expect(r.id).toBe(1000009);
      expect(r.data_entrada).toBeTruthy();
    });

    it('dentro, dia não permitido: valida para a saída', async () => {
      const r: any = await svc({
        data_entrada: new Date(Date.now() - 5 * H),
        data_hora_termino: null,
        dias_semana: ontem,
      }).validarCodigo(1, '123456');
      expect(r.id).toBe(1000009);
    });

    it('fora, janela encerrada: continua recusado para a entrada', async () => {
      await expect(svc({}).validarCodigo(1, '123456')).rejects.toThrow(/expirou/);
    });
  });
});
