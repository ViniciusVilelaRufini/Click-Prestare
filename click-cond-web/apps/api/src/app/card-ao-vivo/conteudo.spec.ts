import { montarConteudo, payloadAtualizacao, payloadFim, payloadInicio, rotuloUnidade, textoAlerta } from './conteudo';

describe('conteúdo do card ao vivo', () => {
  const base = {
    nome: 'Vinicius Vilela',
    isPrestador: false,
    bloco: 'A',
    apto: '106',
    solicitadoEm: new Date('2026-11-13T14:28:00Z'),
  };
  const chegou = Math.floor(base.solicitadoEm.getTime() / 1000);

  // Mesmo prazo da API (AUTORIZACAO_EXPIRACAO_MS): depois de 10 min o
  // morador não consegue mais autorizar — o card não pode vencer antes.
  it('aguardando expira 10 minutos depois do pedido (prazo da API)', () => {
    const c = montarConteudo(base, 'aguardando');
    expect(c.chegouEm).toBe(chegou);
    expect(c.expiraEm).toBe(chegou + 600);
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

  it('não repete "Bloco"/"Apto" quando o cadastro já traz a palavra', () => {
    expect(rotuloUnidade('Bloco A', '106')).toBe('Bloco A · Apto 106');
    expect(rotuloUnidade('BLOCO 2', 'Apto 31')).toBe('BLOCO 2 · Apto 31');
    expect(rotuloUnidade('Torre Norte', 'Casa 4')).toBe('Torre Norte · Casa 4');
    expect(rotuloUnidade('A', '12B')).toBe('Bloco A · Apto 12B');
    expect(rotuloUnidade('  ', ' 7 ')).toBe('Apto 7');
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
    const comAlerta = payloadInicio(c, { idCartao: '9', idPedido: '5', origem: 'delivery' }, 1000, { titulo: 'T', corpo: 'C' });
    expect(comAlerta.aps.alert).toEqual({ title: 'T', body: 'C', sound: 'default' });
    const tocando = payloadAtualizacao(c, 1000, { titulo: 'T', corpo: 'C' });
    expect((tocando.aps as any).alert).toEqual({ title: 'T', body: 'C', sound: 'default' });
    expect((tocando.aps as any).sound).toBe('default');
    expect((payloadAtualizacao(c, 1000).aps as any).alert).toBeUndefined();
    expect((payloadAtualizacao(c, 1000, null).aps as any).alert).toBeUndefined();
    const comTema = payloadInicio(c, { idCartao: '9', idPedido: '5', origem: 'visitante', tema: 'claro' }, 1000);
    expect(comTema.aps.attributes).toEqual({ idCartao: '9', idPedido: '5', origem: 'visitante', tema: 'claro' });
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
