import { FacialService } from './facial.service';

describe('FacialService.parseExternalId — suporte a pessoa_', () => {
  let svc: any;

  beforeAll(() => {
    jest.useFakeTimers();
    process.env.FACIAL_INTEGRATION_ENABLED = 'true';
    const prisma: any = { isConnected: true };
    svc = new FacialService(
      prisma,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
    );
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('reconhece identificador no formato morador_X', () => {
    const res = svc.parseExternalId('morador_42');
    expect(res).toEqual({ tipo: 'morador', id: 42 });
  });

  it('reconhece identificador no formato visitante_X', () => {
    const res = svc.parseExternalId('visitante_99');
    expect(res).toEqual({ tipo: 'visitante', id: 99 });
  });

  it('reconhece identificador no formato prestador_servico_X', () => {
    const res = svc.parseExternalId('prestador_servico_15');
    expect(res).toEqual({ tipo: 'prestador_servico', id: 15 });
  });

  it('reconhece identificador no formato pessoa_X (migração pessoas/visitas)', () => {
    const res = svc.parseExternalId('pessoa_77');
    expect(res).toEqual({ tipo: 'pessoa', id: 77 });
  });

  it('retorna desconhecido para formatos inválidos ou de instalador', () => {
    expect(svc.parseExternalId('admin')).toEqual({ tipo: 'desconhecido', id: 0 });
    expect(svc.parseExternalId('usuario_123')).toEqual({ tipo: 'desconhecido', id: 0 });
    expect(svc.parseExternalId('pessoa_abc')).toEqual({ tipo: 'desconhecido', id: 0 });
  });
});
