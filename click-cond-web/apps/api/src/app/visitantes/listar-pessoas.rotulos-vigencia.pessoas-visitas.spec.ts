import { VisitantesService } from './visitantes.service';

/**
 * Rótulos da lista que ignoravam a vigência (caminho Pessoas/Visitas):
 *  - R2-P1: `statusLabel` "Liberado" para visita com `data_hora_termino`
 *    vencida (o painel "Na portaria agora" listava quem o terminal recusa).
 *  - R2-P2: selo "PIN" (`temPinAtivo`) em visita com a janela encerrada.
 *  - item 23B: `liberado` da unidade valia só 10 min depois do cadastro, mesmo
 *    com a janela de 4 h valendo — o modal dizia "Sem autorização ativa" de
 *    quem a linha mostrava "Liberado".
 */
describe('listarPessoas (Pessoas/Visitas) — rótulos respeitam a vigência', () => {
  const original = process.env['PESSOAS_MIGRATION_ENABLED'];
  beforeEach(() => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
  });
  afterEach(() => {
    if (original === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = original;
  });

  const H = 60 * 60 * 1000;

  function listar(visita: Record<string, unknown>) {
    const pessoa = {
      id: 2000001, id_condominio: 1, nome: 'QA_Rotulo', doc_identificacao: null, telefone: null,
      foto_pessoa: null, foto_documento: null, face_id: null, face_sync_status: null, face_enrolled_at: null,
      bloqueado: 0, created_at: new Date(Date.now() - 48 * H),
      visitas: [
        {
          id: 1000001, id_pessoa: 2000001, id_condominio: 1, id_apartamento: 6, is_visitante: 1, is_prestador: 0,
          liberado: 1, bloqueado: 0, codigo_acesso: '123456', data_entrada: null, data_saida: null,
          data_hora_inicio: new Date(Date.now() - 2 * H), data_hora_termino: new Date(Date.now() + 2 * H),
          dias_semana: null, categorias: null, auth_status: null, created_at: new Date(Date.now() - 2 * H),
          apartamento: { id: 6, bloco: 'A', apto: '106' },
          ...visita,
        },
      ],
    };
    const prisma: any = {
      isConnected: true,
      pessoas: { findMany: jest.fn(async () => [pessoa]) },
      visitas: { findMany: jest.fn(async () => []), groupBy: jest.fn(async () => []) },
      vagas: { findMany: jest.fn(async () => []) },
    };
    const svc = new VisitantesService(
      prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    return svc.listarPessoas(1).then((l: any[]) => l[0]);
  }

  describe('R2-P1 — statusLabel', () => {
    it('janela valendo, cadastrada há 2 h: "Liberado"', async () => {
      expect((await listar({})).statusLabel).toBe('Liberado');
    });

    it('janela vencida: não é "Liberado"', async () => {
      const p = await listar({ data_hora_termino: new Date(Date.now() - H) });
      expect(p.statusLabel).not.toBe('Liberado');
    });

    it('autorização do morador vencida (10 min) numa visita não usada: não é "Liberado"', async () => {
      const p = await listar({
        auth_status: 'autorizado',
        auth_solicitado_em: new Date(Date.now() - 40 * 60 * 1000),
        auth_respondido_em: new Date(Date.now() - 30 * 60 * 1000),
      });
      expect(p.statusLabel).not.toBe('Liberado');
    });

    it('janela ainda não começou: "Agendado"', async () => {
      const p = await listar({ data_hora_inicio: new Date(Date.now() + 2 * H), data_hora_termino: new Date(Date.now() + 6 * H) });
      expect(p.statusLabel).toBe('Agendado');
    });

    it('prestador com "Liberado até" vencido: não é "Liberado"', async () => {
      const p = await listar({ is_prestador: 1, is_visitante: 0, data_hora_termino: new Date(Date.now() - H) });
      expect(p.statusLabel).not.toBe('Liberado');
    });
  });

  describe('R2-P2 — selo PIN', () => {
    it('PIN com janela valendo: selo', async () => {
      const p = await listar({});
      expect(p.temPinAtivo).toBe(true);
      expect(p.apartamentosVisitados[0].temPinAtivo).toBe(true);
    });

    it('PIN com janela encerrada: sem selo', async () => {
      const p = await listar({ data_hora_termino: new Date(Date.now() - H) });
      expect(p.temPinAtivo).toBe(false);
      expect(p.apartamentosVisitados[0].temPinAtivo).toBe(false);
    });

    it('PIN numa visita sem liberação (pedido pendente/negado): sem selo', async () => {
      const p = await listar({ liberado: 0, auth_status: 'negado' });
      expect(p.temPinAtivo).toBe(false);
    });
  });

  describe('item 23B — liberado da unidade', () => {
    it('"Cadastrar e liberar" há 2 h com janela de 4 h valendo: a unidade está liberada', async () => {
      const p = await listar({});
      expect(p.apartamentosVisitados[0].liberado).toBe(true);
    });

    it('janela vencida: a unidade não está liberada', async () => {
      const p = await listar({ data_hora_termino: new Date(Date.now() - H) });
      expect(p.apartamentosVisitados[0].liberado).toBe(false);
    });

    it('autorização do morador vencida: continua não liberada (regra dos 10 min)', async () => {
      const p = await listar({
        auth_status: 'autorizado',
        auth_solicitado_em: new Date(Date.now() - 40 * 60 * 1000),
        auth_respondido_em: new Date(Date.now() - 30 * 60 * 1000),
      });
      expect(p.apartamentosVisitados[0].liberado).toBe(false);
    });
  });

  // Revisão M-5: mesmas regras do terminal e da tela.
  describe('M-5 — tolerância e coerência com a tela', () => {
    it('janela terminou há 5 min (dentro dos 15 min do terminal/PIN): ainda "Liberado" e com PIN', async () => {
      const p = await listar({ data_hora_termino: new Date(Date.now() - 5 * 60 * 1000) });
      expect(p.statusLabel).toBe('Liberado');
      expect(p.temPinAtivo).toBe(true);
      expect(p.apartamentosVisitados[0].liberado).toBe(true);
    });

    it('janela terminou há 20 min: encerrada', async () => {
      const p = await listar({ data_hora_termino: new Date(Date.now() - 20 * 60 * 1000) });
      expect(p.statusLabel).not.toBe('Liberado');
    });

    it('liberado com janela futura: a unidade diz "agendado" (o modal e a linha batem)', async () => {
      const p = await listar({ data_hora_inicio: new Date(Date.now() + 2 * H), data_hora_termino: new Date(Date.now() + 6 * H) });
      expect(p.apartamentosVisitados[0].agendado).toBe(true);
    });

    it('recorrente que saiu com término futuro: "Liberado", como a tela (acesso contínuo)', async () => {
      const p = await listar({
        dias_semana: 'seg,qua',
        data_entrada: new Date(Date.now() - 3 * H),
        data_saida: new Date(Date.now() - H),
        data_hora_termino: new Date(Date.now() + 30 * 24 * H),
      });
      expect(p.statusLabel).toBe('Liberado');
      expect(p.apartamentosVisitados[0].liberado).toBe(true);
    });
  });
});
