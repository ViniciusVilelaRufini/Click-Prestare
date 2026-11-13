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

  // M7: pedido em andamento e autorização do morador valendo contam em
  // "Liberados (Aguardando)", não em "Inativos / Saíram".
  it('aguardando o morador é "liberados"', () => {
    const p: any = { noLocal: false, liberado: 0, auth_status: 'pendente', auth_solicitado_em: new Date().toISOString() };
    expect(tela.categoriaKpi(p)).toBe('liberados');
  });

  it('autorizado pelo morador (valendo) é "liberados"', () => {
    const p: any = { noLocal: false, liberado: 1, auth_status: 'autorizado', auth_respondido_em: new Date().toISOString() };
    expect(tela.categoriaKpi(p)).toBe('liberados');
  });

  it('pedido vencido continua "historico"', () => {
    const p: any = {
      noLocal: false, liberado: 0, auth_status: 'pendente',
      auth_solicitado_em: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    };
    expect(tela.categoriaKpi(p)).toBe('historico');
  });
});
