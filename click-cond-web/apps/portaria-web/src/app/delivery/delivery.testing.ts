import { of } from 'rxjs';
import { DeliveryAtendimento, DeliveryEntregador } from './delivery.model';

export const ATENDIMENTOS: DeliveryAtendimento[] = [
  {
    id: 1, status: 'CHEGOU', estabelecimento: 'Pizzaria Central', modo_entrega: 'UNIDADE',
    apartamento: { id: 10, bloco: 'Bloco A', apto: '101' },
    entregador: { id: 20, nome: 'João Motoboy', telefone: '11999999999', status: 'BLOQUEADO', veiculos: [{ id: 1, placa: 'ABC1D23' }] },
    eventos: [{ id: 1, status_anterior: 'AGENDADA', status_novo: 'CHEGOU', created_at: '2026-09-27T12:00:00.000Z', autor_nome: 'Porteiro' }],
    created_at: '2026-09-27T11:30:00.000Z',
  },
  {
    id: 2, status: 'AGENDADA', estabelecimento: 'Mercado', nome_entregador: 'Maria Avulsa', telefone_entregador: '11888887777',
    modo_entrega: 'PORTARIA', apartamento: { id: 11, bloco: 'Bloco B', apto: '202' }, entregador: null, eventos: [],
    created_at: '2026-09-27T11:00:00.000Z',
  } as DeliveryAtendimento,
];

export class DeliveryApiStub {
  listAtivos = jest.fn(() => of(ATENDIMENTOS));
  listHistorico = jest.fn(() => of([] as DeliveryAtendimento[]));
  resumo = jest.fn();
  listEntregadores = jest.fn(() => of([] as DeliveryEntregador[]));
  atualizarStatus = jest.fn(() => of(ATENDIMENTOS[0]));
  criarEntregador = jest.fn();
  atualizarEntregador = jest.fn();
}
