import { InterfoneAppController } from './interfone-app.controller';
import { InterfonePortariaController } from './interfone-portaria.controller';

describe('controllers do interfone (app e portaria)', () => {
  function acoesFalsas() {
    const fn = () => jest.fn(async () => ({ ok: true }));
    return {
      disponivel: fn(), estadoParaApp: fn(), atender: fn(), recusar: fn(), abrir: fn(), ligarPortaria: fn(),
      historico: fn(), preferencia: fn(), definirPreferencia: fn(), ligarUnidade: fn(), encerrarPortaria: fn(), hoje: fn(), dia: fn(),
    };
  }
  const MORADOR: any = { sub: 7, nome: 'Ana', typeAccess: 'Morador' };
  const PORTEIRO: any = { sub: 3, nome: 'Carlos', id_condominio: 1, tipo_sub: 'funcionario_portaria' };
  const SINDICO_CONSOLE: any = { sub: 9, nome: 'Síndico', id_condominio: 1, typeAccess: 'Sindico' };

  it('app: repassa o morador do token; token de porteiro é recusado', async () => {
    const a = acoesFalsas();
    const c = new InterfoneAppController(a as any);
    await c.atender(5, MORADOR);
    expect(a.atender).toHaveBeenCalledWith(5, { papel: 'morador', uid: 7, nome: 'Ana' });
    expect(() => c.atender(5, PORTEIRO)).toThrow(/aplicativo/);
  });

  it('app: corpo inválido → 400', () => {
    const c = new InterfoneAppController(acoesFalsas() as any);
    expect(() => c.ligarPortaria({ id_apartamento: 'x' as any }, MORADOR)).toThrow(/id_apartamento/);
    expect(() => c.definirPreferencia({ receber: 'sim' as any }, MORADOR)).toThrow(/receber/);
  });

  it('portaria: só porteiro (síndico no console e morador → 403)', async () => {
    const a = acoesFalsas();
    const c = new InterfonePortariaController(a as any);
    await c.atender(5, PORTEIRO);
    expect(a.atender).toHaveBeenCalledWith(5, { papel: 'portaria', uid: 3, nome: 'Carlos', idCondominio: 1 });
    expect(() => c.atender(5, SINDICO_CONSOLE)).toThrow(/porteiro/);
    expect(() => c.hoje(MORADOR)).toThrow(/porteiro/);
    await c.hoje(PORTEIRO);
    expect(a.hoje).toHaveBeenCalledWith(1);
  });

  it('app: pedido do portão — GET e responder repassam o morador do token; decisão inválida → 400', async () => {
    const p = { paraApp: jest.fn(async () => ({ id: 5 })), responder: jest.fn(async () => ({ id: 5 })) };
    const c = new InterfoneAppController(acoesFalsas() as any, p as any);
    await c.pedido(5, MORADOR);
    expect(p.paraApp).toHaveBeenCalledWith(5, 7);
    await c.responderPedido(5, { decisao: 'negar', mensagem: 'Já desço' }, MORADOR);
    expect(p.responder).toHaveBeenCalledWith(5, 7, 'negar', 'Já desço');
    await c.responderPedido(5, { decisao: 'autorizar' }, MORADOR);
    expect(p.responder).toHaveBeenLastCalledWith(5, 7, 'autorizar', undefined);
    expect(() => c.responderPedido(5, { decisao: 'abrir' as any }, MORADOR)).toThrow(/decisao/);
    expect(() => c.responderPedido(5, undefined as any, MORADOR)).toThrow(/decisao/);
    expect(() => c.responderPedido(5, { decisao: 'negar', mensagem: 12 as any }, MORADOR)).toThrow(/mensagem/);
    expect(() => c.responderPedido(5, { decisao: 'autorizar' }, PORTEIRO)).toThrow(/aplicativo/);
    expect(() => c.pedido(5, PORTEIRO)).toThrow(/aplicativo/);
    expect(p.responder).toHaveBeenCalledTimes(2);
  });

  it('portaria: dia repassa o condomínio do token e a data', async () => {
    const a = acoesFalsas();
    const c = new InterfonePortariaController(a as any);
    expect(() => c.dia(MORADOR, '2026-11-27')).toThrow(/porteiro/);
    await c.dia(PORTEIRO, '2026-11-27');
    expect(a.dia).toHaveBeenCalledWith(1, '2026-11-27');
  });
});
