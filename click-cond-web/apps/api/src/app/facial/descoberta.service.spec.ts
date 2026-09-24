import { DescobertaService, sanitizarDescobertos } from './descoberta.service';

const achado = (o: Record<string, unknown> = {}) => ({
  mac: 'b4:4c:3b:f4:e3:01', ip: '192.168.3.175', porta: 80, fabricante: 'intelbras',
  modelo: 'SS 3530 MF FACE W', numero_serie: 'K3LJ3400209RH', dhcp: true, validado_em_campo: true, ...o,
});

function montar(devices: any[]) {
  const prisma: any = {
    facial_Devices: {
      findMany: jest.fn(async ({ where }: any) => devices.filter((d) => d.id_condominio === where.id_condominio && d.ativo === 1)),
      update: jest.fn(async ({ where, data }: any) => Object.assign(devices.find((d) => d.id === where.id), data)),
    },
  };
  const auditoria: any = { registrar: jest.fn(async () => undefined) };
  return { svc: new DescobertaService(prisma, auditoria), prisma, auditoria };
}

describe('sanitizarDescobertos', () => {
  it('descarta itens inválidos, normaliza MAC e limita a 200', () => {
    const r = sanitizarDescobertos({
      achados: [achado({ mac: 'B4-4C-3B-F4-E3-01' }), { ip: 'x' }, achado({ fabricante: 'outra' }), ...Array(300).fill(achado())],
      macs_cadastrados: [{ id: 1, mac: 'AA-BB-CC-DD-EE-FF' }, { id: 'x', mac: 'zz' }],
    });
    expect(r.achados[0].mac).toBe('b4:4c:3b:f4:e3:01');
    expect(r.achados.length).toBe(200);
    expect(r.achados.every((a) => ['intelbras', 'hikvision', 'control_id'].includes(a.fabricante))).toBe(true);
    expect(r.macs_cadastrados).toEqual([{ id: 1, mac: 'aa:bb:cc:dd:ee:ff' }]);
  });
  it('corpo lixo vira listas vazias', () => {
    expect(sanitizarDescobertos('oi')).toEqual({ achados: [], macs_cadastrados: [] });
  });
});

describe('DescobertaService', () => {
  it('aprende MAC e série do device cadastrado pelo IP e pelo macs_cadastrados', async () => {
    const devs = [
      { id: 1, id_condominio: 10, ativo: 1, nome: 'facial principal', ip: '192.168.3.175', porta: 80, mac: null, numero_serie: null },
      { id: 2, id_condominio: 10, ativo: 1, nome: 'saída', ip: '192.168.3.180', porta: 80, mac: null, numero_serie: null },
    ];
    const { svc } = montar(devs);
    const r = await svc.receber(10, { achados: [achado()], macs_cadastrados: [{ id: 2, mac: 'aa:bb:cc:dd:ee:ff' }] });
    expect(devs[0]).toMatchObject({ mac: 'b4:4c:3b:f4:e3:01', numero_serie: 'K3LJ3400209RH' });
    expect(devs[1].mac).toBe('aa:bb:cc:dd:ee:ff');
    expect(r.macs_aprendidos).toBe(2);
  });

  it('corrige o IP de quem mudou (mesmo MAC) e audita', async () => {
    const devs = [{ id: 1, id_condominio: 10, ativo: 1, nome: 'facial principal', ip: '192.168.3.175', porta: 80, mac: 'b4:4c:3b:f4:e3:01', numero_serie: 'K3LJ3400209RH' }];
    const { svc, auditoria } = montar(devs);
    const r = await svc.receber(10, { achados: [achado({ ip: '192.168.3.60' })] });
    expect(devs[0].ip).toBe('192.168.3.60');
    expect(r.ips_corrigidos).toBe(1);
    expect(auditoria.registrar).toHaveBeenCalledWith(expect.objectContaining({ acao: 'DISPOSITIVO_IP_CORRIGIDO', id_condominio: 10, entidade_id: 1 }));
    expect(svc.listar(10).avisos[0]).toMatchObject({ id_dispositivo: 1, de: '192.168.3.175', para: '192.168.3.60' });
  });

  it('não mexe em device de outro condomínio com o mesmo MAC', async () => {
    const devs = [{ id: 9, id_condominio: 99, ativo: 1, nome: 'x', ip: '10.0.0.5', porta: 80, mac: 'b4:4c:3b:f4:e3:01', numero_serie: null }];
    const { svc, prisma } = montar(devs);
    await svc.receber(10, { achados: [achado({ ip: '192.168.3.60' })] });
    expect(prisma.facial_Devices.update).not.toHaveBeenCalled();
    expect(devs[0].ip).toBe('10.0.0.5');
  });

  it('não corrige se outro device do condomínio já usa o IP novo', async () => {
    const devs = [
      { id: 1, id_condominio: 10, ativo: 1, nome: 'a', ip: '192.168.3.175', porta: 80, mac: 'b4:4c:3b:f4:e3:01', numero_serie: null },
      { id: 2, id_condominio: 10, ativo: 1, nome: 'b', ip: '192.168.3.60', porta: 80, mac: null, numero_serie: null },
    ];
    const { svc } = montar(devs);
    const r = await svc.receber(10, { achados: [achado({ ip: '192.168.3.60' })] });
    expect(r.ips_corrigidos).toBe(0);
    expect(devs[0].ip).toBe('192.168.3.175');
  });

  it('listar marca achados já cadastrados (por MAC ou IP)', async () => {
    const devs = [{ id: 1, id_condominio: 10, ativo: 1, nome: 'a', ip: '192.168.3.175', porta: 80, mac: null, numero_serie: null }];
    const { svc } = montar(devs);
    await svc.receber(10, { achados: [achado(), achado({ mac: 'aa:bb:cc:dd:ee:01', ip: '192.168.3.99', fabricante: 'control_id', validado_em_campo: false })] });
    const l = svc.listar(10);
    expect(l.achados.find((a) => a.ip === '192.168.3.175')?.id_dispositivo).toBe(1);
    expect(l.achados.find((a) => a.ip === '192.168.3.99')?.id_dispositivo).toBeNull();
    expect(svc.listar(11).achados).toEqual([]);
  });

  it('pedido de procura é consumido uma vez', () => {
    const { svc } = montar([]);
    expect(svc.consumirPedido(10)).toBe(false);
    svc.pedirProcura(10);
    expect(svc.consumirPedido(10)).toBe(true);
    expect(svc.consumirPedido(10)).toBe(false);
  });
});
