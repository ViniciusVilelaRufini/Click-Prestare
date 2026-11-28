import { InterfoneService } from './interfone.service';

/**
 * Núcleo do interfone com banco, push, voz e realtime falsos e relógio fixo.
 * O banco falso entende só as consultas que o serviço faz.
 */
const AGORA = Date.UTC(2026, 10, 27, 17, 5, 0); // 14:05 em Brasília

type Linha = Record<string, any>;

function bancoFalso(opts: { cond?: Partial<Linha>; facial?: Partial<Linha>; aptos?: Linha[]; vinculos?: Linha[] } = {}) {
  const cond: Linha = {
    id: 1,
    nome: 'Residencial Teste',
    ativo: 1,
    interfone_contratado: 1,
    interfone_ativo: 1,
    interfone_toque_apto_s: 30,
    interfone_transferir: 1,
    interfone_toque_portaria_s: 45,
    ...opts.cond,
  };
  const faciais: Linha[] = [
    {
      id: 12,
      id_condominio: 1,
      nome: 'Portão social',
      ativo: 1,
      fabricante: 'intelbras',
      interfone_habilitado: 1,
      interfone_senha: 's3nha',
      interfone_blocos: null,
      interfone_registrado: 0,
      interfone_registrado_em: null,
      ...opts.facial,
    },
  ];
  const aptos: Linha[] = opts.aptos ?? [{ id: 100, id_condominio: 1, apto: '106', bloco: 'A', interfone_ramal: '106' }];
  const vinculos: Linha[] = opts.vinculos ?? [{ id_apto: 100, id_user: 7, vencimento: null }];
  const usuarios: Linha[] = [
    { id: 7, name: 'Ana Morador' },
    { id: 8, name: 'Bruno Morador' },
  ];
  const porteiros: Linha[] = [{ id: 3, nome: 'Carlos Porteiro', id_condominio: 1 }];
  const moradores: Linha[] = [];
  const monitores: Linha[] = [];
  const chamadas: Linha[] = [];

  const casa = (l: Linha, w: Linha): boolean =>
    Object.entries(w).every(([k, v]) => {
      if (k === 'condominio') return casa(cond, v as Linha);
      if (k === 'OR') return (v as Linha[]).some((x) => casa(l, x));
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        if ('in' in v) return v.in.includes(l[k]);
        if ('notIn' in v) return !v.notIn.includes(l[k]);
        if ('not' in v) return l[k] !== v.not;
        if ('gte' in v) return l[k] >= v.gte;
        if ('lt' in v) return l[k] < v.lt;
        return false;
      }
      return l[k] === v;
    });

  const comRel = (c: Linha) =>
    c && {
      ...c,
      condominio: cond,
      apartamento: aptos.find((a) => a.id === c.id_apartamento) ?? null,
      facial: faciais.find((f) => f.id === c.id_facial) ?? null,
    };

  const prisma: any = {
    facial_Devices: {
      findFirst: jest.fn(async ({ where }: any) => {
        const f = faciais.find((x) => x.id === where.id);
        return f ? { ...f, condominio: cond } : null;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        faciais.filter(
          (f) =>
            f.interfone_habilitado === where.interfone_habilitado &&
            f.ativo === where.ativo &&
            f.interfone_senha !== null &&
            cond.ativo === 1 &&
            cond.interfone_contratado === 1 &&
            cond.interfone_ativo === 1,
        ),
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const alvo = faciais.filter((f) => casa(f, where));
        alvo.forEach((f) => Object.assign(f, data));
        return { count: alvo.length };
      }),
    },
    apartamentos: {
      findFirst: jest.fn(async ({ where }: any) => aptos.find((a) => casa(a, where)) ?? null),
    },
    users: {
      findMany: jest.fn(async ({ where }: any) => {
        const some = where.apartamentosUsers.some;
        // Vínculo = existir a linha; o vencimento é só exibição no resto do sistema.
        expect(some).toEqual({ id_apto: some.id_apto });
        const ids = vinculos.filter((v) => v.id_apto === some.id_apto).map((v) => v.id_user);
        return usuarios.filter((u) => ids.includes(u.id)).map((u) => ({ id: u.id }));
      }),
      findUnique: jest.fn(async ({ where }: any) => usuarios.find((u) => u.id === where.id) ?? null),
    },
    funcionarios_Portaria: {
      findUnique: jest.fn(async ({ where }: any) => porteiros.find((p) => p.id === where.id) ?? null),
    },
    moradores: {
      findFirst: jest.fn(async ({ where, orderBy }: any) => {
        const achados = moradores.filter((m) => casa(m, where));
        if (orderBy) achados.sort((a, b) => b.id - a.id);
        return achados[0] ?? null;
      }),
    },
    interfone_Monitores: {
      findMany: jest.fn(async ({ where }: any) => monitores.filter((m) => casa(m, where))),
      findUnique: jest.fn(async ({ where }: any) => monitores.find((m) => m.id === where.id) ?? null),
      count: jest.fn(async ({ where }: any) => monitores.filter((m) => casa(m, where)).length),
    },
    interfone_Chamadas: {
      count: jest.fn(async ({ where }: any) => chamadas.filter((c) => casa(c, where)).length),
      create: jest.fn(async ({ data }: any) => {
        const c = { id: chamadas.length + 1, resultado: null, motivo_portaria: null, atendida_em: null, created_at: new Date(AGORA), ...data };
        chamadas.push(c);
        return c;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const c = chamadas.find((x) => x.id === where.id);
        Object.assign(c!, data);
        return c;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const alvo = chamadas.filter((c) => casa(c, where));
        alvo.forEach((c) => Object.assign(c, data));
        return { count: alvo.length };
      }),
      findUnique: jest.fn(async ({ where }: any) => comRel(chamadas.find((c) => c.id === where.id)!) ?? null),
      findMany: jest.fn(async ({ where, take }: any) => chamadas.filter((c) => casa(c, where)).slice(0, take).map(comRel)),
    },
  };
  return { prisma, cond, faciais, aptos, vinculos, usuarios, porteiros, moradores, monitores, chamadas };
}

function montar(banco = bancoFalso(), online = true, opcoes: { esperarSegundoPlano?: boolean } = {}) {
  const push = {
    tocar: jest.fn(async () => ({ tocou: 1, semApp: 0, ids: [7] })),
    fim: jest.fn(async () => undefined),
    perdida: jest.fn(async () => undefined),
  };
  const voz = {
    portaria: jest.fn(async () => true),
    dtmf: jest.fn(async () => true),
    encerrar: jest.fn(async () => true),
  };
  const realtime = {
    porteirosOnline: jest.fn(async () => online),
    emitirPortaria: jest.fn(),
  };
  const svc = new InterfoneService(banco.prisma, push as any, voz as any, realtime as any);
  svc.agora = () => AGORA;
  svc.dormir = async () => undefined;
  // Por padrão os testes esperam o que o serviço dispara em segundo plano
  // (push, eventos do console) antes de conferir; os testes de "responde sem
  // esperar" desligam isto.
  if (opcoes.esperarSegundoPlano !== false) {
    for (const nome of ['novaChamadaFacial', 'evento', 'fecharOrfas'] as const) {
      const original = (svc as any)[nome].bind(svc);
      (svc as any)[nome] = async (...a: any[]) => {
        const r = await original(...a);
        await svc.ociosos();
        return r;
      };
    }
  }
  return { svc, push, voz, realtime, ...banco };
}

/** Deixa rodar o que o serviço disparou sem esperar (transferência em segundo plano, foto). */
const soltar = () => new Promise((r) => setImmediate(r));
const nunca = () => new Promise<any>(() => undefined);

describe('InterfoneService.novaChamadaFacial', () => {
  it('número sem unidade → nao_encontrado (sem tocar ninguém)', async () => {
    const { svc, push, chamadas } = montar();
    await expect(svc.novaChamadaFacial('fac-12', '999')).resolves.toEqual({ ok: false, motivo: 'nao_encontrado' });
    expect(push.tocar).not.toHaveBeenCalled();
    expect(chamadas).toHaveLength(0);
  });

  it('número inválido → nao_encontrado', async () => {
    const { svc } = montar();
    await expect(svc.novaChamadaFacial('fac-12', '10a')).resolves.toEqual({ ok: false, motivo: 'nao_encontrado' });
    await expect(svc.novaChamadaFacial('fac-12', '')).resolves.toEqual({ ok: false, motivo: 'nao_encontrado' });
  });

  it('unidade fora dos blocos do facial → nao_encontrado', async () => {
    const { svc, push } = montar(bancoFalso({ facial: { interfone_blocos: '["B"]' } }));
    await expect(svc.novaChamadaFacial('fac-12', '106')).resolves.toEqual({ ok: false, motivo: 'nao_encontrado' });
    expect(push.tocar).not.toHaveBeenCalled();
  });

  it('módulo não contratado → indisponivel', async () => {
    const { svc } = montar(bancoFalso({ cond: { interfone_contratado: 0 } }));
    await expect(svc.novaChamadaFacial('fac-12', '106')).resolves.toEqual({ ok: false, motivo: 'indisponivel' });
  });

  it('módulo desligado pelo síndico, facial não habilitado, conta desconhecida → indisponivel', async () => {
    for (const banco of [bancoFalso({ cond: { interfone_ativo: 0 } }), bancoFalso({ facial: { interfone_habilitado: 0 } })]) {
      const { svc } = montar(banco);
      await expect(svc.novaChamadaFacial('fac-12', '106')).resolves.toEqual({ ok: false, motivo: 'indisponivel' });
    }
    const { svc } = montar();
    await expect(svc.novaChamadaFacial('fac-99', '106')).resolves.toEqual({ ok: false, motivo: 'indisponivel' });
    await expect(svc.novaChamadaFacial('mon-12', '106')).resolves.toEqual({ ok: false, motivo: 'indisponivel' });
  });

  it('conta nova sem hífen (fac12) e antiga (fac-12) são reconhecidas; mon12 não é facial', async () => {
    const { svc } = montar();
    await expect(svc.novaChamadaFacial('fac12', '106')).resolves.toMatchObject({ ok: true });
    await expect(svc.novaChamadaFacial('fac-12', '106')).resolves.toMatchObject({ ok: true });
    await expect(svc.novaChamadaFacial('mon12', '106')).resolves.toEqual({ ok: false, motivo: 'indisponivel' });
  });

  it('registros reconhece fac12 e fac-12', async () => {
    const { svc, faciais } = montar();
    await svc.registros([{ conta: 'fac12', registrado: true }]);
    expect(faciais[0].interfone_registrado).toBe(1);
    await svc.registros([{ conta: 'fac-12', registrado: false }]);
    expect(faciais[0].interfone_registrado).toBe(0);
  });

  it('cria a chamada chamando e toca os moradores com unidade, portão e condomínio', async () => {
    const { svc, push, chamadas } = montar();
    const r = await svc.novaChamadaFacial('fac-12', '106');
    expect(r).toEqual({ ok: true, id: 1, toque_s: 30, monitores: [] });
    expect(chamadas[0]).toMatchObject({
      id_condominio: 1,
      tipo: 'facial_unidade',
      estado: 'chamando',
      id_facial: 12,
      id_apartamento: 100,
      numero_discado: '106',
    });
    expect(push.tocar).toHaveBeenCalledWith(1, [7], {
      tipo: 'facial_unidade',
      unidade: 'Bloco A · Apto 106',
      portao: 'Portão social',
      condominio: 'Residencial Teste',
    });
  });

  it('7ª chamada do mesmo facial no mesmo minuto → limite', async () => {
    const banco = bancoFalso({
      aptos: Array.from({ length: 7 }, (_, i) => ({ id: 100 + i, id_condominio: 1, apto: `10${i}`, bloco: 'A', interfone_ramal: `10${i}` })),
    });
    const { svc } = montar(banco);
    for (let i = 0; i < 6; i++) {
      await expect(svc.novaChamadaFacial('fac-12', `10${i}`)).resolves.toMatchObject({ ok: true });
    }
    await expect(svc.novaChamadaFacial('fac-12', '106')).resolves.toEqual({ ok: false, motivo: 'limite' });
  });

  it('4ª chamada para a mesma unidade em 5 min → limite', async () => {
    const { svc } = montar();
    for (let i = 0; i < 3; i++) await svc.novaChamadaFacial('fac-12', '106');
    await expect(svc.novaChamadaFacial('fac-12', '106')).resolves.toEqual({ ok: false, motivo: 'limite' });
  });

  it('vínculo com vencimento passado toca (o vencimento de 45 dias do app é só exibição)', async () => {
    const banco = bancoFalso({
      vinculos: [
        { id_apto: 100, id_user: 7, vencimento: null },
        { id_apto: 100, id_user: 8, vencimento: new Date(Date.UTC(2026, 10, 20)) },
      ],
    });
    const { svc, push } = montar(banco);
    await svc.novaChamadaFacial('fac-12', '106');
    expect((push.tocar.mock.calls as any[])[0][1]).toEqual([7, 8]);
  });

  it('ninguém tocou (tocou===0) → voz.portaria e motivo_portaria=sem_app', async () => {
    const { svc, push, voz, realtime, chamadas } = montar();
    push.tocar.mockResolvedValueOnce({ tocou: 0, semApp: 1 });
    const r = await svc.novaChamadaFacial('fac-12', '106');
    expect(r).toMatchObject({ ok: true, id: 1 });
    await soltar();
    expect(voz.portaria).toHaveBeenCalledWith(1);
    expect(chamadas[0]).toMatchObject({ motivo_portaria: 'sem_app', estado: 'portaria' });
    expect(realtime.emitirPortaria).toHaveBeenCalledWith(1, 'interfone:chamada', {
      id: 1,
      tipo: 'facial_unidade',
      unidade: 'Bloco A · Apto 106',
      motivo: 'sem_app',
      morador_nome: null,
      foto_url: null,
    });
  });

  it('ninguém tocou e não há porteiro online → grava sem_app mas não transfere', async () => {
    const { svc, push, voz, chamadas } = montar(bancoFalso(), false);
    push.tocar.mockResolvedValueOnce({ tocou: 0, semApp: 0 });
    await svc.novaChamadaFacial('fac-12', '106');
    await soltar();
    expect(voz.portaria).not.toHaveBeenCalled();
    expect(chamadas[0]).toMatchObject({ motivo_portaria: 'sem_app', estado: 'chamando' });
  });

  it('ninguém tocou mas a unidade tem monitor ativo → não transfere (o monitor toca)', async () => {
    const banco = bancoFalso();
    banco.monitores.push({ id: 5, id_condominio: 1, id_apartamento: 100, nome: 'Sala', senha: 'x', ativo: 1 });
    const { svc, push, voz } = montar(banco);
    push.tocar.mockResolvedValueOnce({ tocou: 0, semApp: 0 });
    const r = await svc.novaChamadaFacial('fac-12', '106');
    expect(r).toMatchObject({ ok: true, monitores: ['mon5'] });
    await soltar();
    expect(voz.portaria).not.toHaveBeenCalled();
  });

  it('dispara a foto sem esperar (falha da foto não derruba a chamada)', async () => {
    const { svc } = montar();
    svc.foto = { capturar: jest.fn(() => Promise.reject(new Error('offline'))) };
    await expect(svc.novaChamadaFacial('fac-12', '106')).resolves.toMatchObject({ ok: true });
    await soltar();
    expect(svc.foto.capturar).toHaveBeenCalledWith(1, expect.objectContaining({ id: 12 }));
  });

  it('responde ao serviço sem esperar o push (APNs lento não derruba a chamada)', async () => {
    const { svc, push, chamadas } = montar(bancoFalso(), true, { esperarSegundoPlano: false });
    push.tocar.mockImplementationOnce(nunca);
    await expect(svc.novaChamadaFacial('fac-12', '106')).resolves.toEqual({ ok: true, id: 1, toque_s: 30, monitores: [] });
    expect(chamadas[0].estado).toBe('chamando');
  });

  it('número inexistente também conta para o limite por facial', async () => {
    const { svc } = montar();
    for (let i = 0; i < 5; i++) {
      await expect(svc.novaChamadaFacial('fac-12', `99${i}`)).resolves.toEqual({ ok: false, motivo: 'nao_encontrado' });
    }
    await expect(svc.novaChamadaFacial('fac-12', '106')).resolves.toMatchObject({ ok: true });
    await expect(svc.novaChamadaFacial('fac-12', '106')).resolves.toEqual({ ok: false, motivo: 'limite' });
    // Passado o minuto, os erros saem da conta.
    svc.agora = () => AGORA + 61_000;
    await expect(svc.novaChamadaFacial('fac-12', '106')).resolves.toMatchObject({ ok: true });
  });

  it('toque fora da faixa vira o limite (15–60)', async () => {
    const { svc } = montar(bancoFalso({ cond: { interfone_toque_apto_s: 600 } }));
    await expect(svc.novaChamadaFacial('fac-12', '106')).resolves.toMatchObject({ toque_s: 60 });
  });
});

describe('InterfoneService.evento', () => {
  async function comChamada(banco = bancoFalso(), online = true) {
    const m = montar(banco, online);
    await m.svc.novaChamadaFacial('fac-12', '106');
    m.push.tocar.mockClear();
    return m;
  }

  it('toque_esgotado com transferir=0 → encerrar', async () => {
    const { svc, realtime } = await comChamada(bancoFalso({ cond: { interfone_transferir: 0 } }));
    await expect(svc.evento(1, { evento: 'toque_esgotado' })).resolves.toEqual({ proximo: 'encerrar' });
    expect(realtime.emitirPortaria).not.toHaveBeenCalled();
  });

  it('toque_esgotado sem porteiro online → encerrar', async () => {
    const { svc } = await comChamada(bancoFalso(), false);
    await expect(svc.evento(1, { evento: 'toque_esgotado' })).resolves.toEqual({ proximo: 'encerrar' });
  });

  it('toque_esgotado com porteiro online → portaria, para o toque dos celulares e avisa o console', async () => {
    const { svc, push, realtime, chamadas } = await comChamada();
    await expect(svc.evento(1, { evento: 'toque_esgotado' })).resolves.toEqual({ proximo: 'portaria' });
    expect(chamadas[0]).toMatchObject({ estado: 'portaria', motivo_portaria: 'nao_atendeu' });
    expect(push.fim).toHaveBeenCalledWith(1, [7]);
    expect(realtime.emitirPortaria).toHaveBeenCalledWith(1, 'interfone:chamada', expect.objectContaining({ id: 1, motivo: 'nao_atendeu' }));
  });

  it('toque_esgotado responde portaria sem esperar o push fim', async () => {
    const m = montar(bancoFalso(), true, { esperarSegundoPlano: false });
    await m.svc.novaChamadaFacial('fac-12', '106');
    await m.svc.ociosos();
    m.push.fim.mockImplementationOnce(nunca);
    await expect(m.svc.evento(1, { evento: 'toque_esgotado' })).resolves.toEqual({ proximo: 'portaria' });
    expect(m.chamadas[0].estado).toBe('portaria');
  });

  it('toque_esgotado mantém o motivo que já havia', async () => {
    const { svc, chamadas } = await comChamada();
    chamadas[0].motivo_portaria = 'recusou';
    await svc.evento(1, { evento: 'toque_esgotado' });
    expect(chamadas[0].motivo_portaria).toBe('recusou');
  });

  it('atendida grava quem atendeu, para os outros e avisa o console', async () => {
    const banco = bancoFalso({
      vinculos: [
        { id_apto: 100, id_user: 7, vencimento: null },
        { id_apto: 100, id_user: 8, vencimento: null },
      ],
    });
    const { svc, push, realtime, chamadas } = await comChamada(banco);
    await svc.evento(1, { evento: 'atendida', papel: 'morador', uid: 8 });
    expect(chamadas[0]).toMatchObject({
      estado: 'atendida',
      atendida_por_tipo: 'morador',
      atendida_por_id: 8,
      atendida_por_nome: 'Bruno Morador',
    });
    expect(chamadas[0].atendida_em).toEqual(new Date(AGORA));
    expect(push.fim).toHaveBeenCalledWith(1, [7]);
    expect(realtime.emitirPortaria).toHaveBeenCalledWith(1, 'interfone:fim', { id: 1 });
  });

  it('atendida duas vezes → a segunda não sobrescreve', async () => {
    const { svc, push, chamadas } = await comChamada();
    await svc.evento(1, { evento: 'atendida', papel: 'morador', uid: 7 });
    push.fim.mockClear();
    await svc.evento(1, { evento: 'atendida', papel: 'portaria', uid: 3 });
    expect(chamadas[0]).toMatchObject({ atendida_por_tipo: 'morador', atendida_por_id: 7, atendida_por_nome: 'Ana Morador' });
    expect(push.fim).not.toHaveBeenCalled();
  });

  it('atendida pelo monitor IP grava tipo monitor e o nome do monitor', async () => {
    const banco = bancoFalso();
    banco.monitores.push({ id: 5, id_condominio: 1, id_apartamento: 100, nome: 'Monitor da sala', senha: 'x', ativo: 1 });
    const { svc, push, chamadas } = await comChamada(banco);
    await svc.evento(1, { evento: 'atendida', papel: 'monitor', uid: 5 });
    expect(chamadas[0]).toMatchObject({ estado: 'atendida', atendida_por_tipo: 'monitor', atendida_por_id: 5, atendida_por_nome: 'Monitor da sala' });
    expect(push.fim).toHaveBeenCalledWith(1, [7]);
  });

  it('reenvio do serviço: atendida repetida pelo mesmo papel/uid e encerrada repetida → 200 sem efeito', async () => {
    const { svc, push, realtime, chamadas } = await comChamada();
    await expect(svc.evento(1, { evento: 'atendida', papel: 'morador', uid: 7 })).resolves.toEqual({ ok: true });
    const gravado = { ...chamadas[0] };
    push.fim.mockClear();
    realtime.emitirPortaria.mockClear();
    await expect(svc.evento(1, { evento: 'atendida', papel: 'morador', uid: 7 })).resolves.toEqual({ ok: true });
    expect(chamadas[0]).toEqual(gravado);
    expect(push.fim).not.toHaveBeenCalled();
    expect(realtime.emitirPortaria).not.toHaveBeenCalled();

    await expect(svc.evento(1, { evento: 'encerrada', resultado: 'atendida_morador', duracao_s: 30 })).resolves.toEqual({ ok: true });
    const encerrada = { ...chamadas[0] };
    push.fim.mockClear();
    realtime.emitirPortaria.mockClear();
    for (let i = 0; i < 3; i++) {
      await expect(svc.evento(1, { evento: 'encerrada', resultado: 'atendida_morador', duracao_s: 31 })).resolves.toEqual({ ok: true });
      await expect(svc.evento(1, { evento: 'atendida', papel: 'morador', uid: 7 })).resolves.toEqual({ ok: true });
    }
    expect(chamadas[0]).toEqual(encerrada);
    expect(push.fim).not.toHaveBeenCalled();
    expect(push.perdida).not.toHaveBeenCalled();
    expect(realtime.emitirPortaria).not.toHaveBeenCalled();
  });

  it('encerrada nao_atendida reenviada não repete o aviso de perdida', async () => {
    const { svc, push } = await comChamada();
    await svc.evento(1, { evento: 'encerrada', resultado: 'nao_atendida', duracao_s: 0 });
    await svc.evento(1, { evento: 'encerrada', resultado: 'nao_atendida', duracao_s: 0 });
    expect(push.perdida).toHaveBeenCalledTimes(1);
    expect(push.fim).toHaveBeenCalledTimes(1);
  });

  it('atendida pela portaria grava o nome do porteiro', async () => {
    const { svc, chamadas } = await comChamada();
    await svc.evento(1, { evento: 'toque_esgotado' });
    await svc.evento(1, { evento: 'atendida', papel: 'portaria', uid: 3 });
    expect(chamadas[0]).toMatchObject({ estado: 'atendida', atendida_por_tipo: 'portaria', atendida_por_nome: 'Carlos Porteiro' });
  });

  describe('atendida_por_nome (veio NULL numa chamada real)', () => {
    it('morador sem Users.name → nome do cadastro de morador no condomínio da chamada', async () => {
      const banco = bancoFalso();
      banco.usuarios[0].name = null;
      banco.moradores.push(
        { id: 1, id_user: 7, id_condominio: 2, nome: 'Ana de outro condomínio' },
        { id: 2, id_user: 7, id_condominio: 1, nome: 'Ana Souza' },
      );
      const { svc, chamadas } = await comChamada(banco);
      await svc.evento(1, { evento: 'atendida', papel: 'morador', uid: 7 });
      expect(chamadas[0].atendida_por_nome).toBe('Ana Souza');
    });

    it('Users.name em branco conta como sem nome', async () => {
      const banco = bancoFalso();
      banco.usuarios[0].name = '   ';
      banco.moradores.push({ id: 2, id_user: 7, id_condominio: 1, nome: ' Ana Souza ' });
      const { svc, chamadas } = await comChamada(banco);
      await svc.evento(1, { evento: 'atendida', papel: 'morador', uid: 7 });
      expect(chamadas[0].atendida_por_nome).toBe('Ana Souza');
    });

    it('sem nome no banco → usa o nome que o serviço de voz trouxe do token', async () => {
      const banco = bancoFalso();
      banco.usuarios[0].name = null;
      const { svc, chamadas } = await comChamada(banco);
      await svc.evento(1, { evento: 'atendida', papel: 'morador', uid: 7, nome: '  Ana do Token  ' });
      expect(chamadas[0].atendida_por_nome).toBe('Ana do Token');
    });

    it('banco falhando na consulta do nome → nome do token, e a chamada fica atendida', async () => {
      const banco = bancoFalso();
      banco.prisma.users.findUnique.mockRejectedValueOnce(new Error('banco fora'));
      const { svc, chamadas } = await comChamada(banco);
      await svc.evento(1, { evento: 'atendida', papel: 'morador', uid: 7, nome: 'Ana do Token' });
      expect(chamadas[0]).toMatchObject({ estado: 'atendida', atendida_por_nome: 'Ana do Token' });
    });

    it('o nome do banco vence o do token', async () => {
      const { svc, chamadas } = await comChamada();
      await svc.evento(1, { evento: 'atendida', papel: 'morador', uid: 7, nome: 'Outro' });
      expect(chamadas[0].atendida_por_nome).toBe('Ana Morador');
    });

    it('porteiro fora de Funcionarios_Portaria → nome do token (cortado em 120)', async () => {
      const { svc, chamadas } = await comChamada();
      await svc.evento(1, { evento: 'toque_esgotado' });
      await svc.evento(1, { evento: 'atendida', papel: 'portaria', uid: 99, nome: 'P'.repeat(200) });
      expect(chamadas[0]).toMatchObject({ atendida_por_tipo: 'portaria', atendida_por_nome: 'P'.repeat(120) });
    });

    it('nome do token que não é texto é ignorado', async () => {
      const banco = bancoFalso();
      banco.usuarios[0].name = null;
      const { svc, chamadas } = await comChamada(banco);
      await svc.evento(1, { evento: 'atendida', papel: 'morador', uid: 7, nome: 123 as any });
      expect(chamadas[0].atendida_por_nome).toBeNull();
    });
  });

  it('encerrada nao_atendida de facial → grava, para tudo e manda perdida com a hora de Brasília', async () => {
    const { svc, push, realtime, chamadas } = await comChamada();
    await expect(svc.evento(1, { evento: 'encerrada', resultado: 'nao_atendida', duracao_s: 0 })).resolves.toEqual({ ok: true });
    expect(chamadas[0]).toMatchObject({ estado: 'encerrada', resultado: 'nao_atendida', duracao_s: 0 });
    expect(push.fim).toHaveBeenCalledWith(1, [7]);
    expect(realtime.emitirPortaria).toHaveBeenCalledWith(1, 'interfone:fim', { id: 1 });
    expect(push.perdida).toHaveBeenCalledWith(1, [7], '14:05');
  });

  it('encerrada cancelada (visitante desligou) → para tudo sem aviso de perdida', async () => {
    const { svc, push, realtime } = await comChamada();
    await svc.evento(1, { evento: 'encerrada', resultado: 'cancelada', duracao_s: 4 });
    expect(push.fim).toHaveBeenCalledWith(1, [7]);
    expect(realtime.emitirPortaria).toHaveBeenCalledWith(1, 'interfone:fim', { id: 1 });
    expect(push.perdida).not.toHaveBeenCalled();
  });

  it('encerrada repetida não regrava nem reenvia', async () => {
    const { svc, push, chamadas } = await comChamada();
    await svc.evento(1, { evento: 'encerrada', resultado: 'atendida_morador', duracao_s: 40 });
    push.fim.mockClear();
    await svc.evento(1, { evento: 'encerrada', resultado: 'nao_atendida', duracao_s: 0 });
    expect(chamadas[0]).toMatchObject({ resultado: 'atendida_morador', duracao_s: 40 });
    expect(push.fim).not.toHaveBeenCalled();
    expect(push.perdida).not.toHaveBeenCalled();
  });

  it('evento ou resultado inválido → 400; chamada inexistente → 404', async () => {
    const { svc } = await comChamada();
    await expect(svc.evento(1, { evento: 'outro' } as any)).rejects.toMatchObject({ status: 400 });
    await expect(svc.evento(1, { evento: 'encerrada', resultado: 'xpto', duracao_s: 1 } as any)).rejects.toMatchObject({ status: 400 });
    await expect(svc.evento(1, { evento: 'atendida', papel: 'admin', uid: 1 } as any)).rejects.toMatchObject({ status: 400 });
    await expect(svc.evento(99, { evento: 'toque_esgotado' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('InterfoneService — rotas internas do serviço de voz', () => {
  it('dadosParaServico devolve tipo, estado, toques e monitores', async () => {
    const banco = bancoFalso();
    banco.monitores.push({ id: 5, id_condominio: 1, id_apartamento: 100, nome: 'Sala', senha: 'x', ativo: 1 });
    const { svc } = montar(banco);
    await svc.novaChamadaFacial('fac-12', '106');
    await expect(svc.dadosParaServico(1)).resolves.toEqual({
      id: 1,
      tipo: 'facial_unidade',
      estado: 'chamando',
      toque_s: 30,
      toque_portaria_s: 45,
      monitores: ['mon5'],
    });
    await expect(svc.dadosParaServico(99)).rejects.toMatchObject({ status: 404 });
  });

  it('dadosParaServico: monitores também tocam quando a portaria liga para a unidade', async () => {
    const banco = bancoFalso();
    banco.monitores.push({ id: 5, id_condominio: 1, id_apartamento: 100, nome: 'Sala', senha: 'x', ativo: 1 });
    banco.chamadas.push(
      { id: 1, id_condominio: 1, tipo: 'portaria_unidade', estado: 'chamando', id_apartamento: 100, created_at: new Date(AGORA) },
      { id: 2, id_condominio: 1, tipo: 'unidade_portaria', estado: 'portaria', id_apartamento: 100, created_at: new Date(AGORA) },
    );
    const { svc } = montar(banco);
    await expect(svc.dadosParaServico(1)).resolves.toMatchObject({ tipo: 'portaria_unidade', monitores: ['mon5'] });
    await expect(svc.dadosParaServico(2)).resolves.toMatchObject({ tipo: 'unidade_portaria', monitores: [] });
  });

  it('contas: faciais habilitados (dtmf info para Intelbras/Dahua, rfc4733 para os demais) e monitores', async () => {
    const banco = bancoFalso();
    banco.faciais.push({ ...banco.faciais[0], id: 13, fabricante: 'dahua' }, { ...banco.faciais[0], id: 14, fabricante: 'hikvision' });
    banco.monitores.push({ id: 5, id_condominio: 1, id_apartamento: 100, nome: 'Sala', senha: 'm0n', ativo: 1 });
    const { svc } = montar(banco);
    const r = await svc.contas();
    expect(r.faciais).toEqual([
      { conta: 'fac12', senha: 's3nha', id_condominio: 1, dtmf_modo: 'info' },
      { conta: 'fac13', senha: 's3nha', id_condominio: 1, dtmf_modo: 'info' },
      { conta: 'fac14', senha: 's3nha', id_condominio: 1, dtmf_modo: 'rfc4733' },
    ]);
    expect(r.monitores).toEqual([{ conta: 'mon5', senha: 'm0n', id_condominio: 1, id_apartamento: 100 }]);
  });

  it('registros grava interfone_registrado e a hora só quando passa a 1', async () => {
    const { svc, faciais } = montar();
    await svc.registros([{ conta: 'fac-12', registrado: true }, { conta: 'lixo', registrado: true }]);
    expect(faciais[0]).toMatchObject({ interfone_registrado: 1, interfone_registrado_em: new Date(AGORA) });
    const antes = faciais[0].interfone_registrado_em;
    svc.agora = () => AGORA + 60_000;
    await svc.registros([{ conta: 'fac-12', registrado: true }]);
    expect(faciais[0].interfone_registrado_em).toBe(antes);
    await svc.registros([{ conta: 'fac-12', registrado: false }]);
    expect(faciais[0].interfone_registrado).toBe(0);
  });

  it('registros em lote; facial que saiu da lista (desabilitado) volta a 0', async () => {
    const banco = bancoFalso();
    banco.faciais.push({ ...banco.faciais[0], id: 13, interfone_registrado: 1 }, { ...banco.faciais[0], id: 14, interfone_registrado: 1 });
    const { svc, faciais, prisma } = montar(banco);
    const r = await svc.registros([
      { conta: 'fac-12', registrado: true },
      { conta: 'fac-13', registrado: false },
    ]);
    expect(faciais.map((f) => f.interfone_registrado)).toEqual([1, 0, 0]);
    expect(r).toEqual({ ok: true, atualizados: 3 });
    expect(prisma.facial_Devices.updateMany).toHaveBeenCalledTimes(3);
  });
});

describe('InterfoneService.fecharOrfas (serviço de voz reiniciou e perdeu o encerrada)', () => {
  it('fecha como falha as chamadas além do prazo do estado, para o toque e avisa o console', async () => {
    const { svc, push, realtime, chamadas } = montar();
    await svc.novaChamadaFacial('fac-12', '106'); // id 1, chamando
    await svc.novaChamadaFacial('fac-12', '106'); // id 2, atendida
    await svc.evento(2, { evento: 'atendida', papel: 'morador', uid: 7 });
    await svc.novaChamadaFacial('fac-12', '106'); // id 3, já encerrada
    await svc.evento(3, { evento: 'encerrada', resultado: 'cancelada', duracao_s: 2 });
    push.fim.mockClear();
    realtime.emitirPortaria.mockClear();

    svc.agora = () => AGORA + 7 * 60_000 + 1;
    await expect(svc.fecharOrfas()).resolves.toBe(2);
    expect(chamadas[0]).toMatchObject({ estado: 'encerrada', resultado: 'falha' });
    expect(chamadas[1]).toMatchObject({ estado: 'encerrada', resultado: 'falha' });
    expect(chamadas[2]).toMatchObject({ resultado: 'cancelada' });
    expect(push.fim).toHaveBeenCalledWith(1, [7]);
    expect(realtime.emitirPortaria).toHaveBeenCalledWith(1, 'interfone:fim', { id: 1 });
    expect(realtime.emitirPortaria).toHaveBeenCalledWith(1, 'interfone:fim', { id: 2 });
    expect(push.perdida).not.toHaveBeenCalled();
  });

  it('prazo por estado (pior caso + 60 s): chamando > 3 min, portaria > 4 min, atendida > 7 min', async () => {
    const { svc, chamadas } = montar();
    await svc.novaChamadaFacial('fac-12', '106'); // 1 chamando
    await svc.novaChamadaFacial('fac-12', '106'); // 2 portaria
    await svc.evento(2, { evento: 'toque_esgotado' });
    await svc.novaChamadaFacial('fac-12', '106'); // 3 atendida
    await svc.evento(3, { evento: 'atendida', papel: 'morador', uid: 7 });

    svc.agora = () => AGORA + 3 * 60_000;
    await expect(svc.fecharOrfas()).resolves.toBe(0);
    svc.agora = () => AGORA + 3 * 60_000 + 1;
    await expect(svc.fecharOrfas()).resolves.toBe(1);
    expect(chamadas.map((c) => c.estado)).toEqual(['encerrada', 'portaria', 'atendida']);
    svc.agora = () => AGORA + 4 * 60_000 + 1;
    await expect(svc.fecharOrfas()).resolves.toBe(1);
    expect(chamadas[2].estado).toBe('atendida');
    svc.agora = () => AGORA + 7 * 60_000 + 1;
    await expect(svc.fecharOrfas()).resolves.toBe(1);
    expect(chamadas.every((c) => c.resultado === 'falha')).toBe(true);
  });

  it('ligação originada não atendida: falha em toque + 25 s (unidade: toque_apto; portaria: toque_portaria) e encerra no serviço', async () => {
    const { svc, push, voz, realtime, chamadas } = montar();
    chamadas.push(
      { id: 1, id_condominio: 1, tipo: 'portaria_unidade', estado: 'chamando', id_apartamento: 100, created_at: new Date(AGORA) },
      { id: 2, id_condominio: 1, tipo: 'unidade_portaria', estado: 'portaria', id_apartamento: 100, created_at: new Date(AGORA) },
      { id: 3, id_condominio: 1, tipo: 'unidade_portaria', estado: 'atendida', id_apartamento: 100, created_at: new Date(AGORA) },
    );
    svc.agora = () => AGORA + 55_000;
    await expect(svc.fecharOrfas()).resolves.toBe(0);
    svc.agora = () => AGORA + 55_001; // 30 + 25
    await expect(svc.fecharOrfas()).resolves.toBe(1);
    expect(chamadas[0]).toMatchObject({ estado: 'encerrada', resultado: 'falha' });
    expect(push.fim).toHaveBeenCalledWith(1, [7]);
    expect(realtime.emitirPortaria).toHaveBeenCalledWith(1, 'interfone:fim', { id: 1 });
    expect(voz.encerrar).toHaveBeenCalledWith(1);
    svc.agora = () => AGORA + 70_001; // 45 + 25
    await expect(svc.fecharOrfas()).resolves.toBe(1);
    expect(voz.encerrar).toHaveBeenCalledWith(2);
    expect(chamadas[1]).toMatchObject({ estado: 'encerrada', resultado: 'falha' });
    expect(chamadas[2].estado).toBe('atendida');
  });

  it('toque_esgotado com a chamada do facial já na portaria responde portaria', async () => {
    const { svc, chamadas } = montar();
    await svc.novaChamadaFacial('fac-12', '106');
    chamadas[0].estado = 'portaria';
    await expect(svc.evento(1, { evento: 'toque_esgotado' })).resolves.toEqual({ proximo: 'portaria' });
  });

  it('encerrarComo com leitura velha (atendida entre a leitura e a escrita) não sobrescreve', async () => {
    const { svc, chamadas } = montar();
    await svc.novaChamadaFacial('fac-12', '106');
    const lida = await svc.carregar(1);
    await svc.evento(1, { evento: 'atendida', papel: 'morador', uid: 7 });
    await expect(svc.encerrarComo(lida!, 'recusada')).resolves.toBe(false);
    expect(chamadas[0]).toMatchObject({ estado: 'atendida', resultado: null });
  });

  it('rotina de órfãs não fecha a chamada que mudou de estado depois da leitura', async () => {
    const { svc, prisma, chamadas } = montar();
    await svc.novaChamadaFacial('fac-12', '106');
    svc.agora = () => AGORA + 3 * 60_000 + 1;
    const original = prisma.interfone_Chamadas.findMany.getMockImplementation();
    prisma.interfone_Chamadas.findMany.mockImplementationOnce(async (a: any) => {
      const r = await original(a);
      chamadas[0].estado = 'atendida'; // atendida logo depois da leitura
      return r;
    });
    await expect(svc.fecharOrfas()).resolves.toBe(0);
    expect(chamadas[0].estado).toBe('atendida');
  });

  it('reserva vale só no estado em que foi feita e é liberada ao transferir', async () => {
    const { svc } = montar();
    expect(svc.reservar(1, 'morador:7', 'chamando', AGORA)).toBe(true);
    expect(svc.reservar(1, 'morador:8', 'chamando', AGORA)).toBe(false);
    expect(svc.reservar(1, 'portaria:3', 'portaria', AGORA)).toBe(true);
    svc.liberarReserva(1, 'morador:7'); // não é dele: nada
    expect(svc.reservar(1, 'portaria:4', 'portaria', AGORA)).toBe(false);
    svc.liberarReserva(1);
    expect(svc.reservar(1, 'portaria:4', 'portaria', AGORA)).toBe(true);
  });

  it('grava em tocou_ids os usuários em que o toque saiu', async () => {
    const { svc, push, chamadas } = montar();
    push.tocar.mockResolvedValueOnce({ tocou: 1, semApp: 1, ids: [7] } as any);
    await svc.novaChamadaFacial('fac-12', '106');
    expect(JSON.parse(chamadas[0].tocou_ids)).toEqual([7]);
  });
});
