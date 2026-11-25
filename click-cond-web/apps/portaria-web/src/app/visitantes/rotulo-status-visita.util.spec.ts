import { rotuloStatusVisita } from './rotulo-status-visita.util';

/**
 * W1 (varredura 25/11): o detalhe da visita dizia "Aguardando entrada" para uma
 * visita cuja janela e cujo pedido já tinham expirado, enquanto a lista dizia
 * "Pedido expirado". A regra do rótulo agora é uma só (esta função), na mesma
 * ordem dos ramos da lista.
 */
describe('rotuloStatusVisita', () => {
  const agora = new Date('2026-11-25T15:00:00Z').getTime();
  const h = (horas: number) => new Date(agora + horas * 3600_000).toISOString();
  const min = (m: number) => new Date(agora + m * 60_000).toISOString();

  it('sem visita', () => {
    expect(rotuloStatusVisita({ totalVisitas: 0 }, agora)).toMatchObject({ chave: 'sem-visita', label: 'Sem visita', tom: 'ink' });
  });

  it('janela expirada + pedido expirado → "Pedido expirado" (não "Aguardando entrada")', () => {
    const r = rotuloStatusVisita(
      {
        totalVisitas: 3,
        liberado: 0,
        auth_status: null,
        pedido_expirado: true,
        data_entrada: null,
        data_saida: null,
        data_hora_inicio: '2026-11-15T10:00:00Z',
        data_hora_termino: '2026-11-15T14:00:00Z',
      },
      agora,
    );
    expect(r).toMatchObject({ chave: 'pedido-expirado', label: 'Pedido expirado', tom: 'warn' });
  });

  it('presente → "No condomínio"', () => {
    const r = rotuloStatusVisita({ liberado: 1, data_entrada: h(-1), data_saida: null }, agora);
    expect(r).toMatchObject({ chave: 'presente', label: 'No condomínio', tom: 'ok' });
    expect(r.alerta).toBeUndefined();
  });

  it('presente há mais de 12 h traz o alerta', () => {
    const r = rotuloStatusVisita({ liberado: 1, data_entrada: h(-13), data_saida: null }, agora);
    expect(r.label).toBe('No condomínio');
    expect(r.alerta).toBe('Dentro há mais de 12 h');
  });

  it('liberado', () => {
    const r = rotuloStatusVisita({ liberado: 1, data_hora_inicio: h(-1), data_hora_termino: h(3) }, agora);
    expect(r).toMatchObject({ chave: 'liberado', label: 'Liberado', tom: 'ink' });
  });

  it('agendado', () => {
    const r = rotuloStatusVisita({ liberado: 1, data_hora_inicio: h(2), data_hora_termino: h(5) }, agora);
    expect(r).toMatchObject({ chave: 'agendado', label: 'Agendado', tom: 'ink' });
  });

  it('autorizado pelo morador (dentro do prazo)', () => {
    const r = rotuloStatusVisita({ liberado: 0, auth_status: 'autorizado', auth_respondido_em: min(-2) }, agora);
    expect(r).toMatchObject({ chave: 'auth-autorizado', label: 'Autorizado', tom: 'ok' });
  });

  it('negado pelo morador', () => {
    const r = rotuloStatusVisita({ liberado: 0, auth_status: 'negado', auth_respondido_em: min(-2) }, agora);
    expect(r).toMatchObject({ chave: 'negado', label: 'Negado', tom: 'danger' });
  });

  it('pendente recente → "Aguardando morador"', () => {
    const r = rotuloStatusVisita({ liberado: 0, auth_status: 'pendente', auth_solicitado_em: min(-1) }, agora);
    expect(r).toMatchObject({ chave: 'aguardando-morador', label: 'Aguardando morador', tom: 'warn' });
  });

  it('pendente há mais de 3 min (e menos de 10) → "Sem resposta"', () => {
    const r = rotuloStatusVisita({ liberado: 0, auth_status: 'pendente', auth_solicitado_em: min(-5) }, agora);
    expect(r).toMatchObject({ chave: 'sem-resposta', label: 'Sem resposta', tom: 'warn' });
  });

  it('autorização expirada (flag da API)', () => {
    const r = rotuloStatusVisita({ liberado: 0, autorizacao_expirada: true }, agora);
    expect(r).toMatchObject({ chave: 'expirado', label: 'Autorização expirada', tom: 'warn' });
  });

  it('liberado com a janela encerrada → "Janela encerrada"', () => {
    const r = rotuloStatusVisita({ liberado: 1, data_hora_inicio: h(-6), data_hora_termino: h(-2) }, agora);
    expect(r).toMatchObject({ chave: 'janela-encerrada', label: 'Janela encerrada', tom: 'ink' });
  });

  it('saiu', () => {
    const r = rotuloStatusVisita({ liberado: 0, data_entrada: h(-3), data_saida: h(-2) }, agora);
    expect(r).toMatchObject({ chave: 'saiu', label: 'Saiu', tom: 'ink' });
  });
});
