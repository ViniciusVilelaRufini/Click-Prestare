import { montarConteudo, payloadFim, payloadInicio, rotuloUnidade, textoAlerta } from './conteudo';

describe('conteúdo do card ao vivo', () => {
  const base = {
    nome: 'Vinicius Vilela',
    isPrestador: false,
    bloco: 'A',
    apto: '106',
    solicitadoEm: new Date('2026-11-13T14:28:00Z'),
  };
  const chegou = Math.floor(base.solicitadoEm.getTime() / 1000);

  it('aguardando expira 3 minutos depois do pedido', () => {
    const c = montarConteudo(base, 'aguardando');
    expect(c.chegouEm).toBe(chegou);
    expect(c.expiraEm).toBe(chegou + 180);
    expect(c.tipo).toBe('Visitante');
    expect(c.unidade).toBe('Bloco A · Apto 106');
    expect(c.voceRespondeu).toBe(false);
  });

  it('prestador e unidade sem bloco', () => {
    const c = montarConteudo({ ...base, isPrestador: true, bloco: null }, 'aguardando');
    expect(c.tipo).toBe('Prestador');
    expect(c.unidade).toBe('Apto 106');
    expect(rotuloUnidade(null, null)).toBe('');
  });

  it('extras sobrescrevem o padrão', () => {
    const c = montarConteudo(base, 'liberado', { respondidoPor: 'Marina', horaResposta: chegou + 60 });
    expect(c.fase).toBe('liberado');
    expect(c.respondidoPor).toBe('Marina');
    expect(c.horaResposta).toBe(chegou + 60);
  });

  it('push-to-start leva atributos, tipo dos atributos e alerta', () => {
    const c = montarConteudo(base, 'aguardando');
    const p = payloadInicio(c, { idCartao: '9', idPedido: '5', origem: 'visitante' }, 1000);
    expect(p.aps.event).toBe('start');
    expect(p.aps['attributes-type']).toBe('CardPortariaAttributes');
    expect(p.aps.attributes).toEqual({ idCartao: '9', idPedido: '5', origem: 'visitante' });
    expect(p.aps['content-state']).toBe(c);
    expect(p.aps.alert.title).toBe('Visitante na portaria');
    expect(p.aps.alert.body).toBe('Vinicius Vilela quer entrar. Autorizar?');
    expect(p.aps.timestamp).toBe(1000);
  });

  it('fim marca a hora de sumir', () => {
    const c = montarConteudo(base, 'negado');
    expect(payloadFim(c, 1000, 120).aps['dismissal-date']).toBe(1120);
    expect(payloadFim(c, 1000, 0).aps.event).toBe('end');
  });

  it('texto do alerta', () => {
    expect(textoAlerta({ tipo: 'Prestador', nome: 'Ana' })).toEqual({
      titulo: 'Prestador na portaria',
      corpo: 'Ana quer entrar. Autorizar?',
    });
  });
});
