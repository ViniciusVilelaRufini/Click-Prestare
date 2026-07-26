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
      apartamentos: { count: jest.fn(async () => 62), groupBy: jest.fn(async () => []) },
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
      // Formato exigido pelo functionDeclarations.
      for (const d of declaracoesPara('Sindico')) {
        expect(d.parameters.type).toBe('object');
        expect(typeof d.description).toBe('string');
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

    it('meus_boletos filtra pelo id_usuario do JWT mesmo se os args pedirem outro', async () => {
      const c = ctx();
      await pegar('meus_boletos').executar({ id_usuario: 999, id_condominio: 888 }, c);
      const arg = (c.prisma as any).financeiro.findMany.mock.calls[0][0];
      expect(arg.where.id_usuario).toBe(47);
      expect(arg.where.id_condominio).toBe(1);
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
