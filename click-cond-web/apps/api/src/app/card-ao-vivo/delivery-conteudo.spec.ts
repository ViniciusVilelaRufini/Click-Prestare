import {
  AtendimentoCard,
  alertaDelivery,
  conteudoDelivery,
  dismissalDelivery,
  faseDoStatus,
  mensagemDelivery,
} from './delivery-conteudo';

describe('conteúdo do card do delivery', () => {
  const chegou = new Date('2026-11-13T15:40:00Z');
  const seg = (d: Date) => Math.floor(d.getTime() / 1000);
  const a: AtendimentoCard = {
    id: 9,
    status: 'CHEGOU',
    estabelecimento: 'Burger King',
    chegou_em: chegou,
    autorizado_em: null,
    recusado_em: null,
    concluido_em: null,
    motivo: null,
    bloco: 'A',
    apto: '106',
    entregadorNome: 'Carlos',
    entregadorPlataforma: 'iFood',
    fotoEntregador: null,
  };
  const agora = seg(chegou) + 60;

  it('status do delivery → fase do card', () => {
    expect(faseDoStatus('AGENDADA')).toBeNull();
    expect(faseDoStatus('CHEGOU')).toBe('chegou');
    expect(faseDoStatus('AGUARDANDO_AUTORIZACAO')).toBe('aguardando');
    expect(faseDoStatus('AUTORIZADA')).toBe('autorizado');
    expect(faseDoStatus('RETIRADA_NA_PORTARIA')).toBe('retirar');
    expect(faseDoStatus('CONCLUIDA')).toBe('entregue');
    expect(faseDoStatus('RECUSADA')).toBe('recusado');
    expect(faseDoStatus('CANCELADA')).toBe('encerrar');
  });

  it('chegou: estabelecimento, entregador, unidade e 2 h de vida', () => {
    const c = conteudoDelivery(a, 'chegou', { voceRespondeu: false }, agora);
    expect(c.fase).toBe('chegou');
    expect(c.nome).toBe('Burger King');
    expect(c.tipo).toBe('Carlos · iFood');
    expect(c.unidade).toBe('Bloco A · Apto 106');
    expect(c.chegouEm).toBe(seg(chegou));
    expect(c.expiraEm).toBe(seg(chegou) + 7200);
    expect('foto' in c).toBe(false);
  });

  it('sem entregador identificado nem estabelecimento', () => {
    const c = conteudoDelivery(
      { ...a, estabelecimento: null, entregadorNome: null, entregadorPlataforma: null },
      'chegou',
      { voceRespondeu: false },
      agora,
    );
    expect(c.nome).toBe('Delivery');
    expect(c.tipo).toBe('Entregador');
  });

  it('autorizado, entregue e recusado levam as horas, quem respondeu e o motivo', () => {
    const autorizadoEm = new Date(chegou.getTime() + 180_000);
    const aut = conteudoDelivery({ ...a, autorizado_em: autorizadoEm }, 'autorizado', { voceRespondeu: false }, agora);
    expect(aut.horaResposta).toBe(seg(autorizadoEm));
    expect(aut.pelaPortaria).toBe(true);
    expect(aut.voceRespondeu).toBe(false);

    const meu = conteudoDelivery({ ...a, autorizado_em: autorizadoEm }, 'autorizado', { voceRespondeu: true }, agora);
    expect(meu.voceRespondeu).toBe(true);
    expect(meu.pelaPortaria).toBe(false);

    const concluido = new Date(chegou.getTime() + 360_000);
    expect(conteudoDelivery({ ...a, concluido_em: concluido }, 'entregue', { voceRespondeu: false }, agora).horaEntrada).toBe(seg(concluido));

    const recusadoEm = new Date(chegou.getTime() + 120_000);
    const rec = conteudoDelivery({ ...a, recusado_em: recusadoEm, motivo: 'Entregador sem documento' }, 'recusado', { voceRespondeu: false }, agora);
    expect(rec.motivo).toBe('Entregador sem documento');
    expect(rec.horaResposta).toBe(seg(recusadoEm));
  });

  it('Final: motivo de recusa longo é cortado em 200 caracteres (o push não passa de 4 KB)', () => {
    const c = conteudoDelivery({ ...a, motivo: 'x'.repeat(5000) }, 'recusado', { voceRespondeu: false }, agora);
    expect(c.motivo!.length).toBeLessThanOrEqual(200);
    expect(c.motivo!.endsWith('…')).toBe(true);
  });

  it('foto do entregador vai no estado quando há', () => {
    expect(conteudoDelivery(a, 'chegou', { voceRespondeu: false, foto: 'QUJD' }, agora).foto).toBe('QUJD');
  });

  it('alertas: chegada, pedido de autorização e retirar tocam; o resto é silencioso', () => {
    const c = conteudoDelivery(a, 'chegou', { voceRespondeu: false }, agora);
    expect(alertaDelivery('chegou', c)).toEqual({ titulo: 'Delivery na portaria', corpo: 'Burger King chegou. Acompanhe pelo card.' });
    expect(alertaDelivery('aguardando', c)).toEqual({
      titulo: 'Autorize a entrega',
      corpo: 'A portaria aguarda sua autorização para Burger King.',
    });
    expect(alertaDelivery('retirar', c)).toEqual({ titulo: 'Retire na portaria', corpo: 'Sua entrega de Burger King está na portaria.' });
    expect(alertaDelivery('autorizado', c)).toBeNull();
    expect(alertaDelivery('entregue', c)).toBeNull();
    expect(alertaDelivery('recusado', c)).toBeNull();
  });

  it('textos da notificação de hoje não mudam', () => {
    expect(mensagemDelivery('CHEGOU')).toBe('Seu entregador chegou à portaria.');
    expect(mensagemDelivery('RECUSADA', ' Sem documento ')).toBe('Sua entrega foi recusada pela portaria. Motivo: Sem documento');
    expect(mensagemDelivery('AGENDADA')).toBe('Atualização no seu atendimento.');
  });

  it('tempo na tela depois do fim', () => {
    expect(dismissalDelivery('entregue')).toBe(300);
    expect(dismissalDelivery('recusado')).toBe(120);
    expect(dismissalDelivery('aguardando')).toBeNull();
  });
});
