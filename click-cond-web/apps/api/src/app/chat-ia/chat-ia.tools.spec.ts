import {
  FERRAMENTAS_LEITURA,
  declaracoesPara,
  ferramentasPara,
  resolverFerramenta,
  type ContextoFerramenta,
} from './chat-ia.tools';

/**
 * O modelo é entrada não confiável: um morador pode escrever "liste todos os
 * moradores do prédio" e o Gemini vai tentar chamar a ferramenta. Estes testes
 * travam as duas camadas que impedem isso — o catálogo por papel e o escopo
 * por JWT — e garantem que nenhum id vindo dos `args` vira filtro de tenant.
 */
describe('Ferramentas do Assistente IA — autorização', () => {
  function ctx(over: Partial<ContextoFerramenta> = {}): ContextoFerramenta {
    const prisma: any = {
      moradores: {
        count: jest.fn(async () => 36),
        groupBy: jest.fn(async () => [{ tipo: 'proprietario', _count: { id: 36 } }]),
        findMany: jest.fn(async () => []),
        findFirst: jest.fn(async () => ({ nome: 'Fulano', bloco: 'A', apartamento: '101' })),
      },
      apartamentos: {
        count: jest.fn(async () => 62),
        groupBy: jest.fn(async () => []),
        // Unidade do morador do contexto (ctx.aptos = [10]).
        findMany: jest.fn(async () => [{ apto: '101', bloco: 'A' }]),
      },
      areas_Sociais: { count: jest.fn(async () => 7), findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
      areas_Sociais_Agendamentos: { findMany: jest.fn(async () => []) },
      encomendas: { count: jest.fn(async () => 3), findMany: jest.fn(async () => []) },
      financeiro: { findMany: jest.fn(async () => []) },
      ocorrencias: { findMany: jest.fn(async () => []) },
      visitantes: { findMany: jest.fn(async () => []) },
    };
    return {
      idCondominio: 1,
      idUser: 47,
      papel: 'Morador',
      staff: false,
      aptos: [10],
      prisma,
      cartoes: [],
      ...over,
    } as ContextoFerramenta;
  }

  // -----------------------------------------------------------------------
  describe('camada 1 — catálogo por papel', () => {
    it('morador NÃO enxerga buscar_morador', () => {
      const nomes = ferramentasPara('Morador').map((f) => f.nome);
      expect(nomes).not.toContain('buscar_morador');
    });

    it('síndico e funcionário enxergam buscar_morador', () => {
      expect(ferramentasPara('Sindico').map((f) => f.nome)).toContain('buscar_morador');
      expect(ferramentasPara('Funcionario').map((f) => f.nome)).toContain('buscar_morador');
    });

    it('contar_moradores fica disponível para TODOS (agregado não identifica ninguém)', () => {
      for (const papel of ['Sindico', 'Funcionario', 'Morador'] as const) {
        expect(ferramentasPara(papel).map((f) => f.nome)).toContain('contar_moradores');
      }
    });

    it('as declarações enviadas ao Gemini seguem o mesmo recorte', () => {
      const decls = declaracoesPara('Morador').map((d) => d.name);
      expect(decls).not.toContain('buscar_morador');
      expect(decls).toContain('contar_moradores');
    });
  });

  // -----------------------------------------------------------------------
  describe('formato aceito pelo Gemini', () => {
    /**
     * Regressão real: com `parameters: { type: 'object', properties: {} }` o
     * Gemini responde 400 "parameters.properties: should be non-empty for
     * OBJECT type" e recusa a REQUISIÇÃO INTEIRA — o assistente parou de
     * responder qualquer coisa, não só as ferramentas sem argumento.
     */
    it('nenhuma declaração vai com properties vazio', () => {
      for (const papel of ['Sindico', 'Funcionario', 'Morador'] as const) {
        for (const d of declaracoesPara(papel)) {
          if (d.parameters !== undefined) {
            expect(Object.keys(d.parameters.properties ?? {}).length).toBeGreaterThan(0);
          }
        }
      }
    });

    it('ferramentas sem argumento omitem parameters por completo', () => {
      const semArgs = declaracoesPara('Morador').find((d) => d.name === 'contar_moradores');
      expect(semArgs).toBeDefined();
      expect(semArgs).not.toHaveProperty('parameters');
    });

    it('ferramentas com argumento declaram o schema', () => {
      const comArgs = declaracoesPara('Sindico').find((d) => d.name === 'buscar_morador');
      expect(comArgs?.parameters?.type).toBe('object');
      expect(Object.keys(comArgs?.parameters?.properties ?? {})).toContain('nome');
    });

    it('toda declaração tem nome e descrição preenchidos', () => {
      for (const d of declaracoesPara('Sindico')) {
        expect(d.name).toMatch(/^[a-z_]+$/);
        expect(d.description.length).toBeGreaterThan(10);
      }
    });
  });

  // -----------------------------------------------------------------------
  describe('camada 2 — resolução recusa ferramenta fora do papel', () => {
    it('resolverFerramenta devolve undefined p/ morador pedindo buscar_morador', () => {
      expect(resolverFerramenta('buscar_morador', 'Morador')).toBeUndefined();
    });

    it('resolverFerramenta devolve a ferramenta p/ síndico', () => {
      expect(resolverFerramenta('buscar_morador', 'Sindico')).toBeDefined();
    });

    it('nome inexistente não resolve', () => {
      expect(resolverFerramenta('apagar_tudo', 'Sindico')).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  describe('escopo — filtros saem do contexto, nunca dos args', () => {
    function pegar(nome: string) {
      const f = FERRAMENTAS_LEITURA.find((x) => x.nome === nome);
      if (!f) throw new Error(`ferramenta ${nome} nao encontrada`);
      return f;
    }

    it('meus_boletos escopa pelo JWT mesmo se os args pedirem outro usuário/condomínio', async () => {
      const c = ctx();
      await pegar('meus_boletos').executar({ id_usuario: 999, id_condominio: 888 }, c);
      const arg = (c.prisma as any).financeiro.findMany.mock.calls[0][0];
      expect(arg.where.id_condominio).toBe(1);
      // O OR aceita conta pessoal do próprio usuário OU cobrança tipo 'C' —
      // esta última é peneirada pela unidade dele logo depois da query.
      expect(arg.where.OR).toEqual([{ id_usuario: 47 }, { tipo: 'C' }]);
    });

    /**
     * A taxa gerada pela recorrência automática nasce SEM id_usuario (o job
     * cria pelo nome "Apto X Bloco Y"), e é a maioria das cobranças. Com o
     * filtro antigo, só por id_usuario, o assistente respondia "você não tem
     * cobranças" enquanto a tela de Finanças mostrava a fatura do mês.
     */
    it('meus_boletos enxerga a fatura da unidade sem id_usuario e ignora a do vizinho', async () => {
      const c = ctx();
      (c.prisma as any).financeiro.findMany = jest.fn(async () => [
        { id: 1, nome: 'Apto 101 Bloco A - Condomínio Ref. 07/2026', tipo: 'C', valor: 650, pago: 0, id_usuario: null, data_vencimento: new Date('2026-07-10'), status: '0' },
        { id: 2, nome: 'Apto 102 Bloco A - Condomínio Ref. 07/2026', tipo: 'C', valor: 650, pago: 0, id_usuario: null, data_vencimento: new Date('2026-07-10'), status: '0' },
        { id: 3, nome: 'Luz', tipo: 'D', valor: 180, pago: 0, id_usuario: 47, data_vencimento: new Date('2026-07-20'), status: '0' },
      ]);
      const r: any = await pegar('meus_boletos').executar({}, c);
      expect(r.cobrancas.map((x: any) => x.id).sort()).toEqual([1, 3]);
    });

    it('meus_boletos não confunde Apto 101 com Apto 1010', async () => {
      const c = ctx();
      (c.prisma as any).financeiro.findMany = jest.fn(async () => [
        { id: 4, nome: 'Apto 1010 Bloco A - Ref. 07/2026', tipo: 'C', valor: 650, pago: 0, id_usuario: null, data_vencimento: null, status: '0' },
      ]);
      const r: any = await pegar('meus_boletos').executar({}, c);
      expect(r.total).toBe(0);
    });

    it('minhas_ocorrencias limita ao próprio usuário quando não é staff', async () => {
      const c = ctx();
      await pegar('minhas_ocorrencias').executar({}, c);
      const arg = (c.prisma as any).ocorrencias.findMany.mock.calls[0][0];
      expect(arg.where.user).toBe(47);
    });

    it('minhas_ocorrencias abre para o condomínio quando é staff', async () => {
      const c = ctx({ papel: 'Sindico', staff: true });
      await pegar('minhas_ocorrencias').executar({}, c);
      const arg = (c.prisma as any).ocorrencias.findMany.mock.calls[0][0];
      expect(arg.where.user).toBeUndefined();
      expect(arg.where.id_condominio).toBe(1);
    });

    it('visitas_do_meu_apartamento usa os aptos do vínculo, não dos args', async () => {
      const c = ctx();
      await pegar('visitas_do_meu_apartamento').executar({ id_apartamento: 999 }, c);
      const arg = (c.prisma as any).visitantes.findMany.mock.calls[0][0];
      expect(arg.where.id_apartamento).toEqual({ in: [10] });
    });

    it('morador sem apartamento vinculado não recebe visita alguma', async () => {
      const c = ctx({ aptos: [] });
      const r: any = await pegar('visitas_do_meu_apartamento').executar({}, c);
      expect(r.total).toBe(0);
      expect((c.prisma as any).visitantes.findMany).not.toHaveBeenCalled();
    });

    it('reservas_da_area_na_data recusa área de outro condomínio', async () => {
      const c = ctx();
      // findFirst devolve null => area nao pertence ao condominio do contexto
      const r: any = await pegar('reservas_da_area_na_data').executar(
        { id_area: 999, data: '2026-08-01' },
        c,
      );
      expect(r.erro).toBeDefined();
      expect((c.prisma as any).areas_Sociais_Agendamentos.findMany).not.toHaveBeenCalled();
    });

    it('reservas_da_area_na_data valida o formato da data', async () => {
      const c = ctx();
      const r: any = await pegar('reservas_da_area_na_data').executar(
        { id_area: 1, data: 'sabado que vem' },
        c,
      );
      expect(r.erro).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  describe('como_pagar_conta', () => {
    function pegar(nome: string) {
      const f = FERRAMENTAS_LEITURA.find((x) => x.nome === nome);
      if (!f) throw new Error(`ferramenta ${nome} nao encontrada`);
      return f;
    }

    // Conta pessoal do próprio morador (id_usuario = 47).
    const cobranca = {
      id: 9, nome: 'Internet', tipo: 'D', valor: 450, data_vencimento: new Date('2026-08-10'),
      pago: 0, url_boleto: 'https://boleto/9', pix_copia_cola: 'PIX123', linha_digitavel: '3419...',
      id_usuario: 47,
    };

    /** O que a query devolve; a peneira por unidade acontece no código. */
    function comFinanceiro(c: ContextoFerramenta, registros: any[]) {
      (c.prisma as any).financeiro.findMany = jest.fn(async () => registros);
    }

    it('ignora o id_usuario dos args — o escopo vem do JWT', async () => {
      const c = ctx();
      comFinanceiro(c, [cobranca]);
      await pegar('como_pagar_conta').executar({ id_cobranca: 9, id_usuario: 999 }, c);
      const arg = (c.prisma as any).financeiro.findMany.mock.calls[0][0];
      expect(arg.where.id_condominio).toBe(1);
      expect(arg.where.OR).toEqual([{ id_usuario: 47 }, { tipo: 'C' }]);
    });

    it('emite card com os meios de pagamento disponíveis', async () => {
      const c = ctx();
      comFinanceiro(c, [cobranca]);
      await pegar('como_pagar_conta').executar({ id_cobranca: 9 }, c);
      expect(c.cartoes).toHaveLength(1);
      const card = c.cartoes[0];
      expect(card.confirmavel).toBe(false);
      expect(card.botoes?.map((b) => b.efeito)).toEqual(['copiar', 'copiar', 'abrir_url']);
      expect(card.botoes?.[0].valor).toBe('PIX123');
    });

    it('atende a taxa condominial da unidade, que não tem id_usuario', async () => {
      const c = ctx();
      comFinanceiro(c, [
        { ...cobranca, id: 11, nome: 'Apto 101 Bloco A - Condomínio Ref. 07/2026', tipo: 'C', id_usuario: null },
      ]);
      await pegar('como_pagar_conta').executar({ id_cobranca: 11 }, c);
      expect(c.cartoes).toHaveLength(1);
    });

    it('sem meio de pagamento, oferece abrir a tela do Financeiro', async () => {
      const c = ctx();
      comFinanceiro(c, [{ ...cobranca, url_boleto: null, pix_copia_cola: null, linha_digitavel: null }]);
      await pegar('como_pagar_conta').executar({ id_cobranca: 9 }, c);
      expect(c.cartoes[0].botoes).toEqual([
        { rotulo: 'Abrir Financeiro', efeito: 'abrir_tela', valor: 'financeiro' },
      ]);
    });

    it('não emite card para cobrança já paga', async () => {
      const c = ctx();
      comFinanceiro(c, [{ ...cobranca, pago: 1 }]);
      const r: any = await pegar('como_pagar_conta').executar({ id_cobranca: 9 }, c);
      expect(r.ja_paga).toBe(true);
      expect(c.cartoes).toHaveLength(0);
    });

    it('cobrança de outro usuário não é encontrada', async () => {
      const c = ctx();
      comFinanceiro(c, [{ ...cobranca, id_usuario: 99 }]);
      const r: any = await pegar('como_pagar_conta').executar({ id_cobranca: 9 }, c);
      expect(r.erro).toBeDefined();
      expect(c.cartoes).toHaveLength(0);
    });

    it('não entrega o Pix da dívida do vizinho quando o modelo chuta o id', async () => {
      const c = ctx();
      comFinanceiro(c, [
        { ...cobranca, id: 12, nome: 'Apto 102 Bloco A - Ref. 07/2026', tipo: 'C', id_usuario: null },
      ]);
      const r: any = await pegar('como_pagar_conta').executar({ id_cobranca: 12 }, c);
      expect(r.erro).toBeDefined();
      expect(c.cartoes).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  describe('abrir_tela_do_app', () => {
    const f = () => FERRAMENTAS_LEITURA.find((x) => x.nome === 'abrir_tela_do_app')!;

    it('emite card de navegação para tela conhecida', async () => {
      const c = ctx();
      await f().executar({ tela: 'visitantes', motivo: 'cadastrar o visitante' }, c);
      expect(c.cartoes[0].tipo).toBe('navegacao');
      expect(c.cartoes[0].confirmavel).toBe(false);
      expect(c.cartoes[0].botoes?.[0]).toEqual({
        rotulo: 'Abrir Visitantes', efeito: 'abrir_tela', valor: 'visitantes',
      });
    });

    it('recusa tela desconhecida sem emitir card', async () => {
      const c = ctx();
      const r: any = await f().executar({ tela: 'painel_secreto' }, c);
      expect(r.erro).toBeDefined();
      expect(c.cartoes).toHaveLength(0);
    });

    it('aceita a chave em maiúsculas/com espaço', async () => {
      const c = ctx();
      await f().executar({ tela: '  Financeiro ' }, c);
      expect(c.cartoes[0].botoes?.[0].valor).toBe('financeiro');
    });
  });

  // -----------------------------------------------------------------------
  describe('contar_moradores', () => {
    it('devolve total e quebra por tipo do condomínio do contexto', async () => {
      const c = ctx();
      const f = FERRAMENTAS_LEITURA.find((x) => x.nome === 'contar_moradores')!;
      const r: any = await f.executar({}, c);
      expect(r.total).toBe(36);
      expect(r.por_tipo).toEqual([{ tipo: 'proprietario', total: 36 }]);
      expect((c.prisma as any).moradores.count).toHaveBeenCalledWith({
        where: { id_condominio: 1 },
      });
    });
  });
});
