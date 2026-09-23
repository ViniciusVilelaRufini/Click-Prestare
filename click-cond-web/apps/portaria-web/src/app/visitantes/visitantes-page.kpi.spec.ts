import { VisitantesPageComponent } from './visitantes-page.component';

/**
 * Os cards "No local / Liberados / Histórico" e o filtro das abas contavam
 * "Liberados" só por `liberado === 1`. A linha, porém, mostra "Saiu" quando a
 * visita atual já tem saída e "Expirado" quando a autorização do morador
 * venceu. O card dizia 3 liberados, o filtro abria 3 linhas, e duas diziam
 * "Saiu"/"Expirado". Card, aba e linha agora usam a mesma regra.
 */
describe('VisitantesPageComponent.categoriaKpi', () => {
  const tela = Object.create(VisitantesPageComponent.prototype) as VisitantesPageComponent;
  const antes = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  it('dentro do condomínio é "ativos"', () => {
    expect(tela.categoriaKpi({ noLocal: true, liberado: 1, data_entrada: antes, data_saida: null } as any)).toBe('ativos');
  });

  it('liberado e ainda não entrou é "liberados"', () => {
    expect(tela.categoriaKpi({ noLocal: false, liberado: 1, data_entrada: null, data_saida: null } as any)).toBe('liberados');
  });

  it('já saiu da visita atual não é "liberados", mesmo com liberado=1', () => {
    expect(tela.categoriaKpi({ noLocal: false, liberado: 1, data_entrada: antes, data_saida: antes } as any)).toBe('historico');
  });

  it('autorização do morador expirada não é "liberados"', () => {
    expect(
      tela.categoriaKpi({ noLocal: false, liberado: 1, data_entrada: null, data_saida: null, autorizacao_expirada: true } as any),
    ).toBe('historico');
  });

  it('pessoa sem liberação é "historico"', () => {
    expect(tela.categoriaKpi({ noLocal: false, liberado: 0, data_entrada: null, data_saida: null } as any)).toBe('historico');
  });
});
