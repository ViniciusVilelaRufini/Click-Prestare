import type { ChamadaHoje, ResultadoChamada } from './interfone.api';
import { contar, dataLocal, filtrar, frequentes, grupo, limitesData } from './interfone-lista';

function ch(id: number, resultado: ResultadoChamada | null, extra: Partial<ChamadaHoje> = {}): ChamadaHoje {
  return {
    id,
    tipo: 'facial_unidade',
    inicio: `2026-11-27T1${id}:00:00.000Z`,
    resultado,
    atendida_por_nome: null,
    foto_url: null,
    porta_aberta: false,
    unidade: 'Bloco A · Apto 106',
    id_apartamento: 100,
    ...extra,
  };
}

// Mais recente primeiro, como a API manda.
const LISTA: ChamadaHoje[] = [
  ch(9, null, { unidade: 'Bloco B · Apto 201', id_apartamento: 200 }),
  ch(8, 'falha'),
  ch(7, 'cancelada', { unidade: 'Bloco B · Apto 201', id_apartamento: 200 }),
  ch(6, 'recusada', { unidade: 'Bloco C · Apto 3', id_apartamento: 300 }),
  ch(5, 'nao_atendida', { unidade: 'Sem unidade', id_apartamento: null }),
  ch(4, 'atendida_portaria'),
  ch(3, 'atendida_morador', { porta_aberta: true }),
];

describe('interfone-lista', () => {
  it('grupo junta os resultados em atendida, sem resposta, falha e em andamento', () => {
    expect(LISTA.map(grupo)).toEqual(['andamento', 'falha', 'sem_resposta', 'sem_resposta', 'sem_resposta', 'atendida', 'atendida']);
  });

  it('contar devolve o total e cada grupo, mais os portões abertos', () => {
    expect(contar(LISTA)).toEqual({ todas: 7, atendidas: 2, sem_resposta: 3, falhas: 1, portoes: 1 });
    expect(contar([])).toEqual({ todas: 0, atendidas: 0, sem_resposta: 0, falhas: 0, portoes: 0 });
  });

  it('filtrar mantém a ordem e devolve só o grupo pedido', () => {
    expect(filtrar(LISTA, 'todas')).toBe(LISTA);
    expect(filtrar(LISTA, 'atendidas').map((c) => c.id)).toEqual([4, 3]);
    expect(filtrar(LISTA, 'sem_resposta').map((c) => c.id)).toEqual([7, 6, 5]);
    expect(filtrar(LISTA, 'falhas').map((c) => c.id)).toEqual([8]);
    expect(filtrar(LISTA, 'portoes').map((c) => c.id)).toEqual([3]);
  });

  it('frequentes conta por unidade, mais chamada primeiro e, no empate, a mais recente; ignora sem unidade', () => {
    expect(frequentes(LISTA)).toEqual([
      { id_apartamento: 100, unidade: 'Bloco A · Apto 106', total: 3 },
      { id_apartamento: 200, unidade: 'Bloco B · Apto 201', total: 2 },
      { id_apartamento: 300, unidade: 'Bloco C · Apto 3', total: 1 },
    ]);
    expect(frequentes(LISTA, 1)).toHaveLength(1);
    expect(frequentes([ch(1, 'falha', { id_apartamento: undefined })])).toEqual([]);
  });

  it('dataLocal e limitesData usam o calendário do navegador e 30 dias', () => {
    const d = new Date(2026, 10, 28, 23, 50);
    expect(dataLocal(d)).toBe('2026-11-28');
    expect(limitesData(d)).toEqual({ min: '2026-10-29', max: '2026-11-28' });
    expect(limitesData(new Date(2026, 2, 5, 8, 0))).toEqual({ min: '2026-02-03', max: '2026-03-05' });
  });
});
