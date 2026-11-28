import { InterfoneAppController } from './interfone-app.controller';
import { InterfonePortariaController } from './interfone-portaria.controller';

describe('controllers do interfone (app e portaria)', () => {
  function acoesFalsas() {
    const fn = () => jest.fn(async () => ({ ok: true }));
    return {
      disponivel: fn(), estadoParaApp: fn(), atender: fn(), recusar: fn(), abrir: fn(), ligarPortaria: fn(),
      historico: fn(), preferencia: fn(), definirPreferencia: fn(), ligarUnidade: fn(), encerrarPortaria: fn(), hoje: fn(),
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
});
