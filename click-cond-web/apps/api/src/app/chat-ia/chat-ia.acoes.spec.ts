import { AcaoPendenteStore } from './acao-pendente.store';
import { FERRAMENTAS_ACAO, acoesPara, resolverAcao } from './chat-ia.acoes';
import type { ContextoFerramenta } from './chat-ia.tools';

/**
 * Ações de escrita do assistente. O que estes testes travam:
 *
 *  - a ferramenta PROPÕE, nunca escreve (o banco não é tocado no propor);
 *  - a proposta pertence a um usuário e um condomínio, e só ele confirma;
 *  - confirmar duas vezes não executa duas vezes.
 *
 * O modelo pode errar a interpretação do pedido — é para isso que existe a
 * confirmação. O que ele NÃO pode é escapar do escopo do usuário.
 */
describe('Ações do Assistente IA', () => {
  function ctx(over: Partial<ContextoFerramenta> = {}): ContextoFerramenta {
    const prisma: any = {
      areas_Sociais: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.id === 1 && where.id_condominio === 1
            ? { id: 1, nome: 'Churrasqueira 1', precisa_agendar: 1, precisa_pagamento: 0, precisa_autorizacao: 1 }
            : null,
        ),
      },
      areas_Sociais_Agendamentos: { findMany: jest.fn(async () => []) },
      ocorrencias_Categorias: {
        findFirst: jest.fn(async () => ({ id: 3, nome: 'Manutenção' })),
      },
      // Se algum destes for chamado no propor, a ferramenta escreveu — bug.
      areas_Sociais_Agendamentos_create: jest.fn(),
    };
    return {
      idCondominio: 1, idUser: 47, papel: 'Morador', staff: false,
      aptos: [10], prisma, ...over,
    } as ContextoFerramenta;
  }

  const pegar = (nome: string) => {
    const f = FERRAMENTAS_ACAO.find((x) => x.nome === nome);
    if (!f) throw new Error(`acao ${nome} nao encontrada`);
    return f;
  };

  // Data sempre no futuro, para o teste não apodrecer com o tempo.
  const futuro = () => {
    const d = new Date(Date.now() + 7 * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  };

  // -----------------------------------------------------------------------
  describe('propor_reserva_area', () => {
    const ok = () => ({ id_area: 1, data: futuro(), hora_de: '12:00', hora_ate: '18:00' });

    it('devolve proposta sem gravar nada', async () => {
      const c = ctx();
      const r = await pegar('propor_reserva_area').propor(ok(), c);
      expect(r.erro).toBeUndefined();
      expect(r.proposta?.tipo).toBe('reserva_area');
      expect(r.proposta?.idUser).toBe(47);
      expect(r.proposta?.idCondominio).toBe(1);
      // Nenhum create foi chamado.
      expect((c.prisma as any).areas_Sociais_Agendamentos.create).toBeUndefined();
    });

    it('usa o apartamento do vínculo, não um id vindo do modelo', async () => {
      const c = ctx();
      const r = await pegar('propor_reserva_area').propor(
        { ...ok(), id_apartamento: 999 },
        c,
      );
      expect(r.proposta?.payload.id_apartamento).toBe(10);
    });

    it('recusa área de outro condomínio', async () => {
      const c = ctx();
      const r = await pegar('propor_reserva_area').propor({ ...ok(), id_area: 999 }, c);
      expect(r.erro).toMatch(/não encontrada/i);
      expect(r.proposta).toBeUndefined();
    });

    it('recusa data no passado', async () => {
      const r = await pegar('propor_reserva_area').propor(
        { ...ok(), data: '2020-01-01' },
        ctx(),
      );
      expect(r.erro).toMatch(/passou/i);
    });

    it('recusa data e hora mal formatadas', async () => {
      const f = pegar('propor_reserva_area');
      expect((await f.propor({ ...ok(), data: 'sabado' }, ctx())).erro).toBeDefined();
      expect((await f.propor({ ...ok(), hora_de: '25:00' }, ctx())).erro).toBeDefined();
    });

    it('recusa término antes do início', async () => {
      const r = await pegar('propor_reserva_area').propor(
        { ...ok(), hora_de: '18:00', hora_ate: '12:00' },
        ctx(),
      );
      expect(r.erro).toMatch(/término/i);
    });

    it('recusa quando o horário conflita com reserva existente', async () => {
      const c = ctx();
      (c.prisma as any).areas_Sociais_Agendamentos.findMany = jest.fn(async () => [
        { hora_de: new Date(Date.UTC(1970, 0, 1, 14, 0)), hora_ate: new Date(Date.UTC(1970, 0, 1, 20, 0)) },
      ]);
      const r = await pegar('propor_reserva_area').propor(ok(), c);
      expect(r.erro).toMatch(/já tem reserva/i);
    });

    it('recusa morador sem apartamento vinculado', async () => {
      const r = await pegar('propor_reserva_area').propor(ok(), ctx({ aptos: [] }));
      expect(r.erro).toMatch(/apartamento/i);
    });

    it('avisa no resumo quando a área precisa de aprovação', async () => {
      const r = await pegar('propor_reserva_area').propor(ok(), ctx());
      const rotulos = r.proposta!.itens.map((i) => i.valor).join(' ');
      expect(rotulos).toMatch(/aprovação/i);
    });
  });

  // -----------------------------------------------------------------------
  describe('propor_ocorrencia', () => {
    it('recusa descrição curta demais', async () => {
      const r = await pegar('propor_ocorrencia').propor({ descricao: 'vazou' }, ctx());
      expect(r.erro).toMatch(/curta/i);
    });

    it('monta proposta com o condomínio e o usuário do contexto', async () => {
      const r = await pegar('propor_ocorrencia').propor(
        { descricao: 'Vazamento no teto da garagem, perto da vaga 12' },
        ctx(),
      );
      expect(r.proposta?.idUser).toBe(47);
      expect(r.proposta?.idCondominio).toBe(1);
      expect(r.proposta?.payload.descricao).toContain('Vazamento');
    });

    it('segue sem categoria quando o nome não bate', async () => {
      const c = ctx();
      (c.prisma as any).ocorrencias_Categorias.findFirst = jest.fn(async () => null);
      const r = await pegar('propor_ocorrencia').propor(
        { descricao: 'Lâmpada queimada no corredor do 3o andar', categoria: 'inexistente' },
        c,
      );
      expect(r.erro).toBeUndefined();
      expect(r.proposta?.payload.tipo).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  describe('propor_visitante', () => {
    const base = () => ({ nome: 'Alek Garcia', data: futuro(), hora: '13:00' });

    /**
     * Regressão: sem data_hora_termino o validarCodigo assume `now` e ainda
     * soma 15min de tolerância, então `now > termino+15min` nunca acontece e
     * o PIN do visitante passa a valer para sempre.
     */
    it('SEMPRE define data_hora_termino', async () => {
      const r = await pegar('propor_visitante').propor(base(), ctx());
      expect(r.proposta?.payload.data_hora_termino).toBeTruthy();
    });

    it('sem hora_fim, vale até o fim do dia da visita', async () => {
      const r = await pegar('propor_visitante').propor(base(), ctx());
      expect(r.proposta?.payload.data_hora_termino).toMatch(/ 23:59:00$/);
      // Mesmo dia do início.
      const dia = (s: string) => s.split(' ')[0];
      expect(dia(r.proposta!.payload.data_hora_termino)).toBe(
        dia(r.proposta!.payload.data_hora_inicio),
      );
    });

    it('respeita hora_fim quando informada', async () => {
      const r = await pegar('propor_visitante').propor(
        { ...base(), hora_fim: '18:00' },
        ctx(),
      );
      expect(r.proposta?.payload.data_hora_termino).toMatch(/ 18:00:00$/);
    });

    it('recusa hora limite antes da chegada', async () => {
      const r = await pegar('propor_visitante').propor(
        { ...base(), hora: '18:00', hora_fim: '13:00' },
        ctx(),
      );
      expect(r.erro).toMatch(/hora limite/i);
    });

    it('mostra a janela de validade no card', async () => {
      const r = await pegar('propor_visitante').propor(base(), ctx());
      const valido = r.proposta!.itens.find((i) => i.rotulo === 'Válido');
      expect(valido?.valor).toBe('13:00 às 23:59');
    });

    it('usa o apartamento do vínculo e recusa quem não tem', async () => {
      const r1 = await pegar('propor_visitante').propor(base(), ctx());
      expect(r1.proposta?.payload.id_apartamento).toBe(10);
      const r2 = await pegar('propor_visitante').propor(base(), ctx({ aptos: [] }));
      expect(r2.erro).toMatch(/apartamento/i);
    });

    it('recusa data no passado e nome curto', async () => {
      const f = pegar('propor_visitante');
      expect((await f.propor({ ...base(), data: '2020-01-01' }, ctx())).erro).toBeDefined();
      expect((await f.propor({ ...base(), nome: 'Al' }, ctx())).erro).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  describe('propor_conta_morador', () => {
    const base = () => ({ categoria: 'Água', valor: 130 });

    it('monta a proposta com a conta do próprio morador', async () => {
      const r = await pegar('propor_conta_morador').propor(base(), ctx());
      expect(r.erro).toBeUndefined();
      expect(r.proposta?.tipo).toBe('conta_morador');
      expect(r.proposta?.idUser).toBe(47);
      expect(r.proposta?.payload.categoria).toBe('Água');
      expect(r.proposta?.payload.valor).toBe(130);
    });

    /** A regra que o produto pediu: taxa de condomínio é do síndico. */
    it('RECUSA categoria de condomínio', async () => {
      const f = pegar('propor_conta_morador');
      for (const cat of ['Condomínio', 'condominio', 'CONDOMINIO', 'Taxa Condominial']) {
        const r = await f.propor({ ...base(), categoria: cat }, ctx());
        expect(r.proposta).toBeUndefined();
        expect(r.erro).toMatch(/síndico/i);
      }
    });

    it('aceita as categorias pessoais, com ou sem acento', async () => {
      const f = pegar('propor_conta_morador');
      for (const [entrada, esperado] of [
        ['agua', 'Água'], ['Luz', 'Luz'], ['internet', 'Internet'],
        ['ALUGUEL', 'Aluguel'], ['outros', 'Outros'],
      ]) {
        const r = await f.propor({ ...base(), categoria: entrada }, ctx());
        expect(r.proposta?.payload.categoria).toBe(esperado);
      }
    });

    it('recusa categoria fora da lista', async () => {
      const r = await pegar('propor_conta_morador').propor(
        { ...base(), categoria: 'Cripto' },
        ctx(),
      );
      expect(r.erro).toMatch(/inválida/i);
    });

    it('marca como paga quando o usuário disse que pagou', async () => {
      const r = await pegar('propor_conta_morador').propor(
        { ...base(), ja_paga: true },
        ctx(),
      );
      expect(r.proposta?.payload.pago).toBe(1);
      expect(r.proposta!.itens.find((i) => i.rotulo === 'Situação')?.valor).toBe('Já paga');
    });

    it('sem vencimento informado usa hoje, no formato BR', async () => {
      const r = await pegar('propor_conta_morador').propor(base(), ctx());
      expect(r.proposta?.payload.data_vencimento).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    });

    it('converte o vencimento informado para BR', async () => {
      const r = await pegar('propor_conta_morador').propor(
        { ...base(), data_vencimento: '2026-08-10' },
        ctx(),
      );
      expect(r.proposta?.payload.data_vencimento).toBe('10/08/2026');
    });

    it('recusa valor ausente, zero, negativo ou acima do teto', async () => {
      const f = pegar('propor_conta_morador');
      for (const v of [undefined, 0, -5, 10000000]) {
        const r = await f.propor({ categoria: 'Luz', valor: v }, ctx());
        expect(r.erro).toBeDefined();
      }
    });

    it('usa nome padrão quando o usuário não descreve', async () => {
      const r = await pegar('propor_conta_morador').propor(base(), ctx());
      expect(r.proposta?.payload.nome).toBe('Conta de Água');
    });
  });

  // -----------------------------------------------------------------------
  describe('catálogo por papel', () => {
    it('as ações aparecem para os três papéis', () => {
      for (const p of ['Sindico', 'Funcionario', 'Morador'] as const) {
        expect(acoesPara(p).map((a) => a.nome)).toContain('propor_reserva_area');
      }
    });

    it('nome desconhecido não resolve', () => {
      expect(resolverAcao('apagar_condominio', 'Sindico')).toBeUndefined();
    });

    it('nenhuma declaração de ação vai com properties vazio', () => {
      for (const a of FERRAMENTAS_ACAO) {
        if (a.parametros) {
          expect(Object.keys(a.parametros.properties).length).toBeGreaterThan(0);
        }
      }
    });
  });

  // -----------------------------------------------------------------------
  describe('AcaoPendenteStore — posse e idempotência', () => {
    const nova = () => ({
      tipo: 'ocorrencia' as const,
      idUser: 47,
      idCondominio: 1,
      titulo: 'Confirmar',
      itens: [],
      payload: { descricao: 'teste de vazamento no hall' },
    });

    it('o dono confirma', () => {
      const store = new AcaoPendenteStore();
      const a = store.criar(nova());
      expect(store.obterParaConfirmar(a.id, 47, 1).acao).toBeDefined();
    });

    it('OUTRO usuário não confirma a proposta alheia', () => {
      const store = new AcaoPendenteStore();
      const a = store.criar(nova());
      const r = store.obterParaConfirmar(a.id, 99, 1);
      expect(r.acao).toBeUndefined();
      expect(r.erro).toBeDefined();
    });

    it('não confirma a partir de outro condomínio', () => {
      const store = new AcaoPendenteStore();
      const a = store.criar(nova());
      expect(store.obterParaConfirmar(a.id, 47, 2).acao).toBeUndefined();
    });

    it('confirmar duas vezes não executa duas vezes', () => {
      const store = new AcaoPendenteStore();
      const a = store.criar(nova());
      expect(store.obterParaConfirmar(a.id, 47, 1).acao).toBeDefined();
      store.marcarConsumida(a.id);
      const segunda = store.obterParaConfirmar(a.id, 47, 1);
      expect(segunda.acao).toBeUndefined();
      expect(segunda.erro).toMatch(/já foi confirmada/i);
    });

    it('liberar devolve ao pendente quando a execução falha', () => {
      const store = new AcaoPendenteStore();
      const a = store.criar(nova());
      store.marcarConsumida(a.id);
      store.liberar(a.id);
      expect(store.obterParaConfirmar(a.id, 47, 1).acao).toBeDefined();
    });

    it('id inexistente devolve erro amigável', () => {
      const store = new AcaoPendenteStore();
      expect(store.obterParaConfirmar('acao_inexistente', 47, 1).erro).toBeDefined();
    });
  });
});
