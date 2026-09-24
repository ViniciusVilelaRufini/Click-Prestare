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
    expect((await svc.listar(10)).avisos[0]).toMatchObject({ id_dispositivo: 1, de: '192.168.3.175', para: '192.168.3.60' });
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
    const l = await svc.listar(10);
    expect(l.achados.find((a) => a.ip === '192.168.3.175')?.id_dispositivo).toBe(1);
    expect(l.achados.find((a) => a.ip === '192.168.3.99')?.id_dispositivo).toBeNull();
    expect((await svc.listar(11)).achados).toEqual([]);
  });

  it('pedido de procura é consumido uma vez', () => {
    const { svc } = montar([]);
    expect(svc.consumirPedido(10)).toBe(false);
    svc.pedirProcura(10);
    expect(svc.consumirPedido(10)).toBe(true);
    expect(svc.consumirPedido(10)).toBe(false);
  });
});

describe('sanitizarDescobertos — IP canônico e classe', () => {
  it('descarta achados com IP fora da faixa privada ou não canônico', () => {
    const ips = ['192.168.3.10', '10.1.2.3', '172.16.0.5', '172.31.255.254', '8.8.8.8', '127.0.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '172.32.0.1', '192.168.03.10', '192.168.3.010', '169.254.1.1', '192.168.3.255', '192.168.3.0'];
    const r = sanitizarDescobertos({ achados: ips.map((ip) => achado({ ip })) });
    expect(r.achados.map((a) => a.ip)).toEqual(['192.168.3.10', '10.1.2.3', '172.16.0.5', '172.31.255.254']);
  });

  it('classe: string de até 20 caracteres passa; o resto vira null', () => {
    const r = sanitizarDescobertos({
      achados: [achado({ classe: 'BSC' }), achado({ classe: 'X'.repeat(21) }), achado({ classe: 42 }), achado({})],
    });
    expect(r.achados.map((a) => a.classe)).toEqual(['BSC', null, null, null]);
  });
});

describe('DescobertaService — MAC trocado (aparelho substituído)', () => {
  const OLD = 'b4:4c:3b:f4:e3:01';
  const NEW = 'b4:4c:3b:00:00:99';

  it('agente relata MAC novo no IP cadastrado: reaprende o MAC e o aparelho velho não sequestra o registro', async () => {
    const devs = [{ id: 1, id_condominio: 10, ativo: 1, nome: 'facial principal', ip: '192.168.3.175', porta: 80, mac: OLD, numero_serie: 'K3OLD' }];
    const { svc, auditoria } = montar(devs);
    const r = await svc.receber(10, {
      achados: [achado({ mac: OLD, ip: '192.168.3.60', numero_serie: 'K3OLD' })],
      macs_cadastrados: [{ id: 1, mac: NEW }],
    });
    expect(devs[0]).toMatchObject({ ip: '192.168.3.175', mac: NEW });
    expect(r.ips_corrigidos).toBe(0);
    expect(auditoria.registrar).toHaveBeenCalledWith(expect.objectContaining({
      acao: 'DISPOSITIVO_MAC_ATUALIZADO', entidade_id: 1, detalhes: expect.objectContaining({ de: OLD, para: NEW }),
    }));
    expect(auditoria.registrar).not.toHaveBeenCalledWith(expect.objectContaining({ acao: 'DISPOSITIVO_IP_CORRIGIDO' }));
  });

  it('achado no mesmo IP e porta com MAC novo: reaprende MAC e série', async () => {
    const devs = [{ id: 1, id_condominio: 10, ativo: 1, nome: 'facial principal', ip: '192.168.3.175', porta: 80, mac: OLD, numero_serie: 'K3OLD' }];
    const { svc } = montar(devs);
    await svc.receber(10, { achados: [achado({ mac: NEW, numero_serie: 'K3NEW' })] });
    expect(devs[0]).toMatchObject({ ip: '192.168.3.175', mac: NEW, numero_serie: 'K3NEW' });
  });

  it('não reaprende se o MAC novo já pertence a outro device do condomínio', async () => {
    const devs = [
      { id: 1, id_condominio: 10, ativo: 1, nome: 'a', ip: '192.168.3.175', porta: 80, mac: OLD, numero_serie: null },
      { id: 2, id_condominio: 10, ativo: 1, nome: 'b', ip: '192.168.3.180', porta: 80, mac: NEW, numero_serie: null },
    ];
    const { svc, auditoria } = montar(devs);
    await svc.receber(10, { achados: [], macs_cadastrados: [{ id: 1, mac: NEW }] });
    expect(devs[0].mac).toBe(OLD);
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });
});

describe('DescobertaService — validação da correção de IP', () => {
  const MAC = 'b4:4c:3b:f4:e3:01';
  const dev = (o: Record<string, unknown> = {}) => ({ id: 1, id_condominio: 10, ativo: 1, nome: 'facial', ip: '192.168.3.175', porta: 80, mac: MAC, numero_serie: null, ...o });

  it('não corrige para IP de outra /24 que nenhum device do condomínio usa', async () => {
    const devs = [dev()];
    const { svc } = montar(devs);
    const r = await svc.receber(10, { achados: [achado({ ip: '10.0.0.60' })] });
    expect(r.ips_corrigidos).toBe(0);
    expect(devs[0].ip).toBe('192.168.3.175');
  });

  it('aceita outra /24 quando outro device ativo do condomínio já está nela', async () => {
    const devs = [dev(), { id: 2, id_condominio: 10, ativo: 1, nome: 'b', ip: '10.0.0.5', porta: 80, mac: null, numero_serie: null }];
    const { svc } = montar(devs);
    const r = await svc.receber(10, { achados: [achado({ ip: '10.0.0.60' })] });
    expect(r.ips_corrigidos).toBe(1);
    expect(devs[0].ip).toBe('10.0.0.60');
  });

  it('no máximo 3 correções por device por hora; a quarta é ignorada com aviso no log', async () => {
    const devs = [dev()];
    const { svc } = montar(devs);
    const warn = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
    for (const ip of ['192.168.3.60', '192.168.3.61', '192.168.3.62']) {
      const r = await svc.receber(10, { achados: [achado({ ip })] });
      expect(r.ips_corrigidos).toBe(1);
    }
    const r4 = await svc.receber(10, { achados: [achado({ ip: '192.168.3.63' })] });
    expect(r4.ips_corrigidos).toBe(0);
    expect(devs[0].ip).toBe('192.168.3.62');
    expect(warn).toHaveBeenCalled();
  });

  it('libera nova correção depois de uma hora', async () => {
    jest.useFakeTimers({ now: new Date('2026-09-24T10:00:00Z') });
    try {
      const devs = [dev()];
      const { svc } = montar(devs);
      jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
      for (const ip of ['192.168.3.60', '192.168.3.61', '192.168.3.62', '192.168.3.63']) await svc.receber(10, { achados: [achado({ ip })] });
      expect(devs[0].ip).toBe('192.168.3.62');
      jest.setSystemTime(new Date('2026-09-24T11:00:01Z'));
      const r = await svc.receber(10, { achados: [achado({ ip: '192.168.3.64' })] });
      expect(r.ips_corrigidos).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('só a porta mudou: aviso e auditoria falam de porta', async () => {
    const devs = [dev()];
    const { svc, auditoria } = montar(devs);
    const r = await svc.receber(10, { achados: [achado({ porta: 8080 })] });
    expect(r.ips_corrigidos).toBe(1);
    expect(devs[0]).toMatchObject({ ip: '192.168.3.175', porta: 8080 });
    const chamada = (auditoria.registrar as jest.Mock).mock.calls[0][0];
    expect(chamada.descricao).toBe('Porta do dispositivo "facial" atualizada de 80 para 8080 (mesmo MAC b4:4c:3b:f4:e3:01).');
    expect(chamada.descricao).not.toMatch(/IP/);
    expect((await svc.listar(10)).avisos[0]).toMatchObject({ tipo: 'porta', de: '80', para: '8080' });
  });
});

describe('DescobertaService.listar — id_dispositivo vem do banco', () => {
  it('reflete device cadastrado depois da última recepção', async () => {
    const devs: any[] = [];
    const { svc } = montar(devs);
    await svc.receber(10, { achados: [achado({ mac: 'aa:bb:cc:dd:ee:02', ip: '192.168.3.99' })] });
    expect((await svc.listar(10)).achados[0].id_dispositivo).toBeNull();
    devs.push({ id: 5, id_condominio: 10, ativo: 1, nome: 'novo', ip: '192.168.3.99', porta: 80, mac: null, numero_serie: null });
    expect((await svc.listar(10)).achados[0].id_dispositivo).toBe(5);
  });

  it('consulta só os devices ativos do condomínio, com id/ip/mac', async () => {
    const { svc, prisma } = montar([]);
    await svc.receber(10, { achados: [achado()] });
    prisma.facial_Devices.findMany.mockClear();
    await svc.listar(10);
    expect(prisma.facial_Devices.findMany).toHaveBeenCalledWith({ where: { id_condominio: 10, ativo: 1 }, select: { id: true, ip: true, mac: true } });
  });
});

describe('DescobertaService — aparelho que mudou de IP e outro herdou o endereço', () => {
  it('sem relato do agente, o MAC novo no IP velho não substitui o do aparelho que foi visto em outro IP', async () => {
    const OLD = 'b4:4c:3b:f4:e3:01';
    const devs = [{ id: 1, id_condominio: 10, ativo: 1, nome: 'facial', ip: '192.168.3.175', porta: 80, mac: OLD, numero_serie: null }];
    const { svc } = montar(devs);
    const r = await svc.receber(10, {
      achados: [achado({ mac: OLD, ip: '192.168.3.60' }), achado({ mac: 'aa:bb:cc:00:00:01', ip: '192.168.3.175', classe: 'IPC' })],
    });
    expect(devs[0]).toMatchObject({ mac: OLD, ip: '192.168.3.60' });
    expect(r.ips_corrigidos).toBe(1);
  });
});
