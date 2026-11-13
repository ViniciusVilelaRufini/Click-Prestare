import { emAtencao, inicioEspera, intervaloPeriodo, minutosDesde, textoDuracao, textoEspera } from './tempo';
import { DeliveryAtendimento } from '../delivery.model';

const agora = new Date('2026-10-04T12:30:00');
const base = { id: 1, modo_entrega: 'UNIDADE', apartamento: { id: 1, apto: '1' }, eventos: [] } as unknown as DeliveryAtendimento;

describe('tempo', () => {
  it('formata espera', () => {
    expect(textoEspera(0)).toBe('agora');
    expect(textoEspera(12)).toBe('há 12 min');
    expect(textoEspera(65)).toBe('há 1 h 05 min');
  });

  it('usa chegou_em antes de created_at', () => {
    const a = { ...base, status: 'CHEGOU', created_at: '2026-10-04T11:00:00', chegou_em: '2026-10-04T12:18:00' } as DeliveryAtendimento;
    expect(minutosDesde(a.chegou_em!, agora)).toBe(12);
    expect(emAtencao(a, agora)).toBe(true);
  });

  it('só alerta em Chegou/Aguardando acima de 10 min', () => {
    const recente = { ...base, status: 'CHEGOU', created_at: '2026-10-04T12:25:00' } as DeliveryAtendimento;
    const agendada = { ...base, status: 'AGENDADA', created_at: '2026-10-04T10:00:00' } as DeliveryAtendimento;
    expect(emAtencao(recente, agora)).toBe(false);
    expect(emAtencao(agendada, agora)).toBe(false);
  });

  it('M6: entregador autorizado há mais de 15 min pede atenção (conta desde a autorização)', () => {
    const autorizada = (min: number) => ({
      ...base, status: 'AUTORIZADA', created_at: '2026-10-04T10:00:00', chegou_em: '2026-10-04T11:00:00',
      autorizado_em: new Date(agora.getTime() - min * 60_000).toISOString(),
    }) as DeliveryAtendimento;
    expect(inicioEspera(autorizada(20))).toBe(autorizada(20).autorizado_em);
    expect(emAtencao(autorizada(20), agora)).toBe(true);
    expect(emAtencao(autorizada(10), agora)).toBe(false);
  });

  it('M5: entrega deixada na portaria há mais de 30 min pede atenção (conta desde que ficou lá)', () => {
    const naPortaria = (min: number) => ({
      ...base, status: 'RETIRADA_NA_PORTARIA', created_at: '2026-10-04T10:00:00', chegou_em: '2026-10-04T10:05:00',
      eventos: [
        { id: 1, status_novo: 'CHEGOU', created_at: '2026-10-04T10:05:00' },
        { id: 2, status_novo: 'RETIRADA_NA_PORTARIA', created_at: new Date(agora.getTime() - min * 60_000).toISOString() },
      ],
    }) as DeliveryAtendimento;
    expect(emAtencao(naPortaria(40), agora)).toBe(true);
    expect(emAtencao(naPortaria(20), agora)).toBe(false);
  });

  it('A2: recusado/cancelado não pede atenção', () => {
    const recusada = { ...base, status: 'RECUSADA', created_at: '2026-10-04T10:00:00' } as DeliveryAtendimento;
    expect(emAtencao(recusada, agora)).toBe(false);
  });

  it('formata duração média', () => {
    expect(textoDuracao(null)).toBe('—');
    expect(textoDuracao(7.5)).toBe('8 min');
    expect(textoDuracao(90)).toBe('1 h 30 min');
  });

  it('calcula intervalos locais', () => {
    expect(intervaloPeriodo('hoje', agora)).toEqual({ de: '2026-10-04', ate: '2026-10-04' });
    expect(intervaloPeriodo('7d', agora)).toEqual({ de: '2026-09-28', ate: '2026-10-04' });
    expect(intervaloPeriodo('30d', agora)).toEqual({ de: '2026-09-05', ate: '2026-10-04' });
  });
});
