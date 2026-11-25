import { selecionarUltimosEventos } from './dashboard.service';

/**
 * Varredura do console 25/11: a aba "Encomendas" de Últimos eventos dizia "Nenhum evento deste
 * tipo" com encomendas recentes no banco — a API cortava a lista mista nos 15 mais recentes e o
 * front filtrava só esse recorte. Agora vão os 15 mais recentes no geral + os 15 de cada tipo.
 */
describe('selecionarUltimosEventos', () => {
  const ev = (tipo: string, dia: number) => ({ tipo, quando: new Date(Date.UTC(2026, 10, dia, 12)).toISOString() });

  it('mantém os 15 mais recentes no geral, em ordem decrescente', () => {
    const lista = Array.from({ length: 20 }, (_, i) => ev('Visitante', i + 1));
    const r = selecionarUltimosEventos(lista, 15);
    expect(r.length).toBe(15);
    expect(r[0].quando > r[14].quando).toBe(true);
  });

  it('inclui os eventos mais recentes de cada tipo mesmo fora do top 15 geral', () => {
    const visitantes = Array.from({ length: 20 }, (_, i) => ev('Visitante', 10 + i));
    const encomendas = [ev('Encomenda', 2), ev('Encomenda', 3)];
    const ocorrencias = [ev('Ocorrência', 1)];
    const r = selecionarUltimosEventos([...visitantes, ...encomendas, ...ocorrencias], 15);
    expect(r.filter((e) => e.tipo === 'Encomenda').length).toBe(2);
    expect(r.filter((e) => e.tipo === 'Ocorrência').length).toBe(1);
    // os 15 primeiros continuam sendo os mais recentes no geral (a aba "Todos")
    expect(r.slice(0, 15).every((e) => e.tipo === 'Visitante')).toBe(true);
  });

  it('limita cada tipo a n e não repete evento', () => {
    const lista = [...Array.from({ length: 30 }, (_, i) => ev('Encomenda', i + 1))];
    const r = selecionarUltimosEventos(lista, 15);
    expect(r.length).toBe(15);
    expect(new Set(r).size).toBe(r.length);
  });
});
