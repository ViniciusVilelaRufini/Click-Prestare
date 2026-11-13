/* Banco e clientes falsos para os testes do card ao vivo (não é carregado em produção). */
import { CardAoVivoService } from './card-ao-vivo.service';

type Row = Record<string, any>;

function casa(valor: any, cond: any): boolean {
  if (cond === null) return valor === null || valor === undefined;
  if (cond instanceof Date) return valor instanceof Date && valor.getTime() === cond.getTime();
  if (cond && typeof cond === 'object') {
    if ('in' in cond) return cond.in.includes(valor);
    if ('lte' in cond) return valor instanceof Date ? valor.getTime() <= cond.lte.getTime() : valor <= cond.lte;
    if ('not' in cond) return !casa(valor, cond.not);
  }
  return valor === cond;
}

function filtra(rows: Row[], where: Row = {}) {
  return rows.filter((r) => Object.entries(where).every(([k, c]) => casa(r[k], c)));
}

export function tabela(inicial: Row[] = []) {
  const rows: Row[] = inicial.map((r) => ({ ...r }));
  let seq = rows.reduce((m, r) => Math.max(m, r.id ?? 0), 0);
  return {
    rows,
    create: jest.fn(async ({ data }: any) => {
      const r = {
        token_atualizacao: null,
        confirmado_em: null,
        reserva_enviada_em: null,
        encerrado_em: null,
        token_inicio: null,
        ...data,
        id: ++seq,
      };
      rows.push(r);
      return { ...r };
    }),
    findUnique: jest.fn(async ({ where }: any) => {
      const r = filtra(rows, where)[0];
      return r ? { ...r } : null;
    }),
    findMany: jest.fn(async ({ where }: any = {}) => filtra(rows, where).map((r) => ({ ...r }))),
    update: jest.fn(async ({ where, data }: any) => {
      const r = filtra(rows, where)[0];
      if (!r) throw new Error('nao achou');
      Object.assign(r, data);
      return { ...r };
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const alvo = filtra(rows, where);
      alvo.forEach((r) => Object.assign(r, data));
      return { count: alvo.length };
    }),
    deleteMany: jest.fn(async ({ where }: any) => {
      const alvo = filtra(rows, where);
      alvo.forEach((r) => rows.splice(rows.indexOf(r), 1));
      return { count: alvo.length };
    }),
  };
}

export const T0 = new Date('2026-11-13T14:28:00Z').getTime();

export function montarCard(opts: {
  aparelhos?: Row[];
  usuarios?: Row[];
  visitante?: Row | null;
  cards?: Row[];
  /** Bytes que o storage devolve para a foto (ausente = sem storage). */
  fotoBytes?: Buffer | null;
} = {}) {
  const prisma: any = {
    users_Devices: tabela(opts.aparelhos ?? []),
    users: {
      ...tabela(opts.usuarios ?? []),
      findUnique: jest.fn(async ({ where }: any) => (opts.usuarios ?? []).find((u) => u.id === where.id) ?? null),
    },
    cards_Ao_Vivo: tabela(opts.cards ?? []),
    visitantes: {
      findUnique: jest.fn(async () =>
        opts.visitante === null
          ? null
          : {
              nome: 'Vinicius Vilela',
              is_prestador: 0,
              auth_solicitado_em: new Date(T0),
              apartamento: { bloco: 'A', apto: '106' },
              ...(opts.visitante ?? {}),
            },
      ),
    },
    visitas: { findUnique: jest.fn(async () => null) },
  };
  const notifications: any = {
    enviarParaAparelho: jest.fn(async () => 'msg-id'),
    enviarDados: jest.fn(async () => 'ok'),
  };
  const storage =
    opts.fotoBytes === undefined
      ? undefined
      : ({ lerArquivoBytes: jest.fn(async () => opts.fotoBytes), lerObjetoTexto: jest.fn(async () => null) } as any);
  const svc = new CardAoVivoService(prisma, notifications, storage);
  const apns = { enviar: jest.fn(async () => ({ status: 200 })) };
  svc.apns = apns as any;
  let agora = T0;
  svc.agora = () => agora;
  const avancar = (ms: number) => {
    agora += ms;
  };
  return { svc, prisma, notifications, apns, avancar };
}

export const pedido = {
  origem: 'visitante' as const,
  id: 5,
  nome: 'Vinicius Vilela',
  isPrestador: false,
  bloco: 'A',
  apto: '106',
  solicitadoEm: new Date(T0),
};


describe('CardAoVivoService — abrir, reserva, tique', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }));
  afterEach(() => jest.useRealTimers());

  const aparelhos = [
    { id_user: 1, fcm_token: 'fcm-iphone', plataforma: 'ios', card_token_inicio: 'aa11bb22cc33dd44' },
    { id_user: 1, fcm_token: 'fcm-android', plataforma: 'android', card_token_inicio: null, card_android: 1 },
    { id_user: 2, fcm_token: 'fcm-antigo', plataforma: null, card_token_inicio: null },
  ];
  const usuarios = [
    { id: 1, fcm_token: 'fcm-iphone', name: 'Marina Souza' },
    { id: 2, fcm_token: 'fcm-antigo', name: 'Carlos' },
  ];

  it('abre card no iPhone (APNs), no Android (dados) e manda push comum ao aparelho sem card', async () => {
    const { svc, prisma, notifications, apns } = montarCard({ aparelhos, usuarios });
    await svc.abrir(pedido, [1, 2]);

    expect(apns.enviar).toHaveBeenCalledTimes(1);
    const [token, corpo, prio] = apns.enviar.mock.calls[0] as any[];
    expect(token).toBe('aa11bb22cc33dd44');
    expect(corpo.aps.event).toBe('start');
    expect(corpo.aps['content-state'].fase).toBe('aguardando');
    expect(prio).toBe(10);

    expect(notifications.enviarDados).toHaveBeenCalledWith(
      'fcm-android',
      expect.objectContaining({ type: 'card_portaria', fase: 'aguardando', origem: 'visitante', id_pedido: '5' }),
    );
    expect(notifications.enviarParaAparelho).toHaveBeenCalledTimes(1);
    expect(notifications.enviarParaAparelho).toHaveBeenCalledWith(
      'fcm-antigo',
      'Visitante na portaria',
      'Vinicius Vilela quer entrar no seu apartamento. Autorizar?',
      expect.objectContaining({ type: 'autorizacao_visitante', id: '5' }),
    );
    expect(prisma.cards_Ao_Vivo.rows).toHaveLength(2);
  });

  it('usuário deslogado (Users.fcm_token null) não recebe nada', async () => {
    const { svc, notifications, apns } = montarCard({
      aparelhos,
      usuarios: [{ id: 1, fcm_token: null }],
    });
    await svc.abrir(pedido, [1]);
    expect(apns.enviar).not.toHaveBeenCalled();
    expect(notifications.enviarDados).not.toHaveBeenCalled();
    expect(notifications.enviarParaAparelho).not.toHaveBeenCalled();
  });

  it('reserva: Android sem confirmação recebe o push comum depois de 10 s; o confirmado não', async () => {
    const { svc, prisma, notifications, avancar } = montarCard({ aparelhos, usuarios: [usuarios[0]] });
    await svc.abrir(pedido, [1]);
    const ios = prisma.cards_Ao_Vivo.rows.find((r: any) => r.plataforma === 'ios');
    await svc.confirmar(1, ios.id, 'ffee0011ffee0011');

    avancar(10_000);
    await svc.verificarReserva('visitante', 5);

    expect(notifications.enviarParaAparelho).toHaveBeenCalledTimes(1);
    expect(notifications.enviarParaAparelho).toHaveBeenCalledWith('fcm-android', 'Visitante na portaria', expect.any(String), expect.any(Object));
    const android = prisma.cards_Ao_Vivo.rows.find((r: any) => r.plataforma === 'android');
    expect(android.reserva_enviada_em).toBeInstanceOf(Date);
    expect(ios.token_atualizacao ?? prisma.cards_Ao_Vivo.rows.find((r: any) => r.id === ios.id).token_atualizacao).toBe('ffee0011ffee0011');

    // Rodar de novo não duplica.
    await svc.verificarReserva('visitante', 5);
    expect(notifications.enviarParaAparelho).toHaveBeenCalledTimes(1);
  });

  it('servidor reiniciado no meio da espera: o tique manda a reserva atrasada', async () => {
    const { svc, notifications, avancar } = montarCard({ aparelhos: [aparelhos[1]], usuarios: [usuarios[0]] });
    await svc.abrir(pedido, [1]);
    avancar(20_000);
    await svc.tick();
    expect(notifications.enviarParaAparelho).toHaveBeenCalledWith('fcm-android', expect.any(String), expect.any(String), expect.any(Object));
  });

  it('confirmar de outro usuário é recusado', async () => {
    const { svc, prisma } = montarCard({ aparelhos, usuarios });
    await svc.abrir(pedido, [1]);
    const linha = prisma.cards_Ao_Vivo.rows[0];
    await expect(svc.confirmar(2, linha.id, 'abcdabcdabcdabcd')).resolves.toEqual({ ok: false });
    expect(prisma.cards_Ao_Vivo.rows[0].confirmado_em).toBeNull();
  });

  it('APNs 410: token sai do aparelho e ele recebe o push comum na hora', async () => {
    const { svc, prisma, notifications, apns } = montarCard({ aparelhos: [aparelhos[0]], usuarios: [usuarios[0]] });
    apns.enviar.mockResolvedValueOnce({ status: 410, motivo: 'Unregistered' } as any);
    await svc.abrir(pedido, [1]);
    expect(prisma.users_Devices.rows[0].card_token_inicio).toBeNull();
    expect(notifications.enviarParaAparelho).toHaveBeenCalledWith('fcm-iphone', 'Visitante na portaria', expect.any(String), expect.any(Object));
    expect(prisma.cards_Ao_Vivo.rows[0].encerrado_em).toBeInstanceOf(Date);
  });

  it('sem chave do APNs (status 0): push comum, sem perder o aviso', async () => {
    const { svc, notifications, apns } = montarCard({ aparelhos: [aparelhos[0]], usuarios: [usuarios[0]] });
    apns.enviar.mockResolvedValueOnce({ status: 0, motivo: 'sem-chave' } as any);
    await svc.abrir(pedido, [1]);
    expect(notifications.enviarParaAparelho).toHaveBeenCalledTimes(1);
  });

  it('tique: AGUARDANDO de 4 min vira EXPIRADO; LIBERADO de 11 min é encerrado', async () => {
    const { svc, prisma, notifications, apns, avancar } = montarCard({ aparelhos, usuarios: [usuarios[0]] });
    await svc.abrir(pedido, [1]);
    const ios = prisma.cards_Ao_Vivo.rows.find((r: any) => r.plataforma === 'ios');
    await svc.confirmar(1, ios.id, 'ffee0011ffee0011');
    const android = prisma.cards_Ao_Vivo.rows.find((r: any) => r.plataforma === 'android');
    await svc.confirmar(1, android.id);
    apns.enviar.mockClear();

    avancar(4 * 60_000);
    await svc.tick();
    const fim = apns.enviar.mock.calls[0] as any[];
    expect(fim[0]).toBe('ffee0011ffee0011');
    expect(fim[1].aps.event).toBe('end');
    expect(fim[1].aps['content-state'].fase).toBe('expirado');
    expect(notifications.enviarDados).toHaveBeenLastCalledWith('fcm-android', expect.objectContaining({ fase: 'expirado' }));
    expect(prisma.cards_Ao_Vivo.rows.every((r: any) => r.encerrado_em)).toBe(true);
  });

  it('tique: LIBERADO há mais de 10 min some sem mostrar nada novo', async () => {
    const { svc, prisma, apns, avancar } = montarCard({ aparelhos: [aparelhos[0]], usuarios: [usuarios[0]] });
    await svc.abrir(pedido, [1]);
    const ios = prisma.cards_Ao_Vivo.rows[0];
    await svc.confirmar(1, ios.id, 'ffee0011ffee0011');
    await svc.respondido('visitante', 5, 'liberado', { idUser: 1, pelaPortaria: false });
    apns.enviar.mockClear();

    avancar(11 * 60_000);
    await svc.tick();
    const [, corpo] = apns.enviar.mock.calls[0] as any[];
    expect(corpo.aps.event).toBe('end');
    expect(corpo.aps['dismissal-date']).toBe(corpo.aps.timestamp);
    expect(prisma.cards_Ao_Vivo.rows[0].encerrado_em).toBeInstanceOf(Date);
  });

  it('Android com app antigo (card_android 0) recebe o push comum na hora, sem esperar a reserva', async () => {
    const { svc, notifications, prisma } = montarCard({
      aparelhos: [{ id_user: 1, fcm_token: 'fcm-velho', plataforma: 'android', card_token_inicio: null, card_android: 0 }],
      usuarios: [usuarios[0]],
    });
    await svc.abrir(pedido, [1]);
    expect(notifications.enviarDados).not.toHaveBeenCalled();
    expect(notifications.enviarParaAparelho).toHaveBeenCalledWith('fcm-velho', 'Visitante na portaria', expect.any(String), expect.any(Object));
    expect(prisma.cards_Ao_Vivo.rows).toHaveLength(0);
  });

  it('push-to-start pede o token de atualização (input-push-token)', async () => {
    const { svc, apns } = montarCard({ aparelhos: [aparelhos[0]], usuarios: [usuarios[0]] });
    await svc.abrir(pedido, [1]);
    expect((apns.enviar.mock.calls[0] as any[])[1].aps['input-push-token']).toBe(1);
  });

  it('card segue o tema do app no aparelho; tema desconhecido ou ausente não vai', async () => {
    const claro = montarCard({ aparelhos: [{ ...aparelhos[0], card_tema: 'claro' }], usuarios: [usuarios[0]] });
    await claro.svc.abrir(pedido, [1]);
    expect((claro.apns.enviar.mock.calls[0] as any[])[1].aps.attributes.tema).toBe('claro');

    const lixo = montarCard({ aparelhos: [{ ...aparelhos[0], card_tema: 'roxo' }], usuarios: [usuarios[0]] });
    await lixo.svc.abrir(pedido, [1]);
    expect((lixo.apns.enviar.mock.calls[0] as any[])[1].aps.attributes).not.toHaveProperty('tema');

    const antigo = montarCard({ aparelhos: [aparelhos[0]], usuarios: [usuarios[0]] });
    await antigo.svc.abrir(pedido, [1]);
    expect((antigo.apns.enviar.mock.calls[0] as any[])[1].aps.attributes).not.toHaveProperty('tema');
  });

  it('foto do visitante vai em miniatura no iPhone (atributos) e no Android (dados), dentro de 4 KB', async () => {
    jest.useRealTimers();
    const sharp = (await import('sharp')).default;
    const fotoBytes = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#7a5c3e' } })
      .jpeg()
      .toBuffer();
    const { svc, apns, notifications } = montarCard({ aparelhos, usuarios, fotoBytes });
    await svc.abrir({ ...pedido, fotoOrigem: 'https://bucket/visitantes/1.jpg' }, [1, 2]);

    const corpoIos = (apns.enviar.mock.calls[0] as any[])[1];
    expect(typeof corpoIos.aps.attributes.foto).toBe('string');
    expect(Buffer.from(corpoIos.aps.attributes.foto, 'base64').subarray(0, 2).toString('hex')).toBe('ffd8'); // JPEG
    expect(Buffer.byteLength(JSON.stringify(corpoIos))).toBeLessThanOrEqual(3900);

    const dados = (notifications.enviarDados.mock.calls[0] as any[])[1];
    expect(dados.foto).toBe(corpoIos.aps.attributes.foto);
  });

  it('sem foto ou foto que não é imagem: card abre com as iniciais', async () => {
    jest.useRealTimers();
    const semFoto = montarCard({ aparelhos: [aparelhos[0]], usuarios: [usuarios[0]], fotoBytes: null });
    await semFoto.svc.abrir({ ...pedido, fotoOrigem: 'https://bucket/visitantes/1.jpg' }, [1]);
    expect((semFoto.apns.enviar.mock.calls[0] as any[])[1].aps.attributes).not.toHaveProperty('foto');

    const lixo = montarCard({ aparelhos: [aparelhos[0]], usuarios: [usuarios[0]], fotoBytes: Buffer.from('lixo') });
    await lixo.svc.abrir({ ...pedido, fotoOrigem: 'https://bucket/visitantes/1.jpg' }, [1]);
    expect(lixo.apns.enviar).toHaveBeenCalledTimes(1);
    expect((lixo.apns.enviar.mock.calls[0] as any[])[1].aps.attributes).not.toHaveProperty('foto');
  });

  it('APNs lento não segura os outros aparelhos (envios em paralelo)', async () => {
    const { svc, apns, notifications } = montarCard({ aparelhos, usuarios });
    let libera: () => void = () => undefined;
    apns.enviar.mockImplementationOnce(() => new Promise((r) => { libera = () => r({ status: 200 } as any); }) as any);
    const abrindo = svc.abrir(pedido, [1, 2]);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(notifications.enviarDados).toHaveBeenCalled();
    expect(notifications.enviarParaAparelho).toHaveBeenCalledWith('fcm-antigo', expect.any(String), expect.any(String), expect.any(Object));
    libera();
    await abrindo;
  });

  it('iPhone confirma depois de o card ser encerrado (re-solicitação): recebe o fim na hora', async () => {
    const { svc, prisma, apns } = montarCard({ aparelhos: [aparelhos[0]], usuarios: [usuarios[0]] });
    await svc.abrir(pedido, [1]);
    const linha = prisma.cards_Ao_Vivo.rows[0];
    await svc.encerrar('visitante', 5);
    apns.enviar.mockClear();
    await svc.confirmar(1, linha.id, 'ffee0011ffee0011');
    const [token, corpo] = apns.enviar.mock.calls[0] as any[];
    expect(token).toBe('ffee0011ffee0011');
    expect(corpo.aps.event).toBe('end');
    expect(corpo.aps['dismissal-date']).toBe(corpo.aps.timestamp);
  });

  it('reabrir o mesmo pedido encerra o card anterior', async () => {
    const { svc, prisma } = montarCard({ aparelhos: [aparelhos[1]], usuarios: [usuarios[0]] });
    await svc.abrir(pedido, [1]);
    await svc.abrir(pedido, [1]);
    const abertos = prisma.cards_Ao_Vivo.rows.filter((r: any) => !r.encerrado_em);
    expect(abertos).toHaveLength(1);
  });
});


describe('CardAoVivoService — fases', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }));
  afterEach(() => jest.useRealTimers());

  const aparelhos = [
    { id_user: 1, fcm_token: 'fcm-marina', plataforma: 'ios', card_token_inicio: 'aaaa1111aaaa1111' },
    { id_user: 2, fcm_token: 'fcm-carlos', plataforma: 'ios', card_token_inicio: 'bbbb2222bbbb2222' },
  ];
  const usuarios = [
    { id: 1, fcm_token: 'fcm-marina', name: 'Marina Souza' },
    { id: 2, fcm_token: 'fcm-carlos', name: 'Carlos Lima' },
  ];

  async function abertoEConfirmado() {
    const k = montarCard({ aparelhos, usuarios });
    await k.svc.abrir(pedido, [1, 2]);
    for (const r of k.prisma.cards_Ao_Vivo.rows) {
      await k.svc.confirmar(r.id_user, r.id, r.id_user === 1 ? 'aaaa9999aaaa9999' : 'bbbb9999bbbb9999');
    }
    k.apns.enviar.mockClear();
    return k;
  }

  const enviadoPara = (apns: any, token: string) =>
    (apns.enviar.mock.calls as any[]).filter((c) => c[0] === token).map((c) => c[1].aps);

  it('autorizado pela Marina: ela vê "você", o Carlos vê "Marina"; card continua (update)', async () => {
    const { svc, apns, prisma } = await abertoEConfirmado();
    await svc.respondido('visitante', 5, 'liberado', { idUser: 1, pelaPortaria: false });

    const [marina] = enviadoPara(apns, 'aaaa9999aaaa9999');
    const [carlos] = enviadoPara(apns, 'bbbb9999bbbb9999');
    expect(marina.event).toBe('update');
    expect(marina['content-state']).toMatchObject({ fase: 'liberado', voceRespondeu: true, respondidoPor: 'Marina' });
    expect(carlos['content-state']).toMatchObject({ fase: 'liberado', voceRespondeu: false, respondidoPor: 'Marina' });
    expect(prisma.cards_Ao_Vivo.rows.every((r: any) => r.fase === 'liberado' && !r.encerrado_em)).toBe(true);
  });

  it('negado encerra com 2 min na tela', async () => {
    const { svc, apns, prisma } = await abertoEConfirmado();
    await svc.respondido('visitante', 5, 'negado', { idUser: 2, pelaPortaria: false });
    const [carlos] = enviadoPara(apns, 'bbbb9999bbbb9999');
    expect(carlos.event).toBe('end');
    expect(carlos['dismissal-date'] - carlos.timestamp).toBe(120);
    expect(carlos['content-state']).toMatchObject({ fase: 'negado', voceRespondeu: true });
    expect(prisma.cards_Ao_Vivo.rows.every((r: any) => r.encerrado_em)).toBe(true);
  });

  it('liberado pela portaria: sem nome, pelaPortaria=true', async () => {
    const { svc, apns } = await abertoEConfirmado();
    await svc.respondido('visitante', 5, 'liberado', { idUser: null, pelaPortaria: true });
    const [marina] = enviadoPara(apns, 'aaaa9999aaaa9999');
    expect(marina['content-state']).toMatchObject({ pelaPortaria: true, respondidoPor: null, voceRespondeu: false });
  });

  it('entrou depois de liberado: fim com 5 min e hora da entrada', async () => {
    const { svc, apns } = await abertoEConfirmado();
    await svc.respondido('visitante', 5, 'liberado', { idUser: 1, pelaPortaria: false });
    apns.enviar.mockClear();
    const em = new Date('2026-11-13T14:33:00Z');
    await svc.entrou('visitante', 5, em);
    const [marina] = enviadoPara(apns, 'aaaa9999aaaa9999');
    expect(marina.event).toBe('end');
    expect(marina['dismissal-date'] - marina.timestamp).toBe(300);
    expect(marina['content-state']).toMatchObject({ fase: 'entrou', horaEntrada: Math.floor(em.getTime() / 1000) });
  });

  it('entrou sem card aberto não chama o APNs', async () => {
    const { svc, apns } = montarCard({ aparelhos, usuarios });
    await svc.entrou('visitante', 99);
    expect(apns.enviar).not.toHaveBeenCalled();
  });

  it('segunda resposta não mexe em card já respondido', async () => {
    const { svc, apns } = await abertoEConfirmado();
    await svc.respondido('visitante', 5, 'liberado', { idUser: 1, pelaPortaria: false });
    apns.enviar.mockClear();
    await svc.respondido('visitante', 5, 'negado', { idUser: 2, pelaPortaria: false });
    expect(apns.enviar).not.toHaveBeenCalled();
  });

  it('iPhone confirma depois que outro já respondeu: recebe o estado atual', async () => {
    const k = montarCard({ aparelhos, usuarios });
    await k.svc.abrir(pedido, [1, 2]);
    const carlos = k.prisma.cards_Ao_Vivo.rows.find((r: any) => r.id_user === 2);
    await k.svc.confirmar(1, k.prisma.cards_Ao_Vivo.rows.find((r: any) => r.id_user === 1).id, 'aaaa9999aaaa9999');
    await k.svc.respondido('visitante', 5, 'liberado', { idUser: 1, pelaPortaria: false });
    k.apns.enviar.mockClear();

    await k.svc.confirmar(2, carlos.id, 'bbbb9999bbbb9999');
    const [atual] = enviadoPara(k.apns, 'bbbb9999bbbb9999');
    expect(atual.event).toBe('update');
    expect(atual['content-state'].fase).toBe('liberado');
  });

  it('confirmação atrasada recebe o conteúdo completo (quem respondeu e a hora)', async () => {
    const k = montarCard({ aparelhos, usuarios });
    await k.svc.abrir(pedido, [1, 2]);
    const marina = k.prisma.cards_Ao_Vivo.rows.find((r: any) => r.id_user === 1);
    const carlos = k.prisma.cards_Ao_Vivo.rows.find((r: any) => r.id_user === 2);
    await k.svc.confirmar(1, marina.id, 'aaaa9999aaaa9999');
    await k.svc.respondido('visitante', 5, 'liberado', { idUser: 1, pelaPortaria: false });
    k.apns.enviar.mockClear();
    await k.svc.confirmar(2, carlos.id, 'bbbb9999bbbb9999');
    const [atual] = enviadoPara(k.apns, 'bbbb9999bbbb9999');
    expect(atual['content-state']).toMatchObject({ fase: 'liberado', respondidoPor: 'Marina', voceRespondeu: false });
    expect(atual['content-state'].horaResposta).toEqual(expect.any(Number));
  });

  it('tique que expira não atropela resposta que já mudou a fase', async () => {
    const { svc, apns, avancar } = await abertoEConfirmado();
    await svc.respondido('visitante', 5, 'liberado', { idUser: 1, pelaPortaria: false });
    apns.enviar.mockClear();
    avancar(4 * 60_000);
    await svc.tick();
    const fases = (apns.enviar.mock.calls as any[]).map((c) => c[1].aps['content-state']?.fase);
    expect(fases).not.toContain('expirado');
  });

  it('logout encerra os cards abertos do usuário', async () => {
    const { svc, apns, prisma } = await abertoEConfirmado();
    await svc.encerrarDoUsuario(1);
    const [marina] = enviadoPara(apns, 'aaaa9999aaaa9999');
    expect(marina.event).toBe('end');
    expect(marina['dismissal-date']).toBe(marina.timestamp);
    expect(prisma.cards_Ao_Vivo.rows.find((r: any) => r.id_user === 1).encerrado_em).toBeInstanceOf(Date);
    expect(prisma.cards_Ao_Vivo.rows.find((r: any) => r.id_user === 2).encerrado_em).toBeNull();
  });

  it('visitante apagado: fase encerra o card em vez de mostrar dados vazios', async () => {
    const k = montarCard({ aparelhos, usuarios, visitante: null });
    await k.svc.abrir(pedido, [1]);
    const r = k.prisma.cards_Ao_Vivo.rows[0];
    await k.svc.confirmar(1, r.id, 'aaaa9999aaaa9999');
    await k.svc.respondido('visitante', 5, 'liberado', { idUser: 1, pelaPortaria: false });
    const [aps] = enviadoPara(k.apns, 'aaaa9999aaaa9999');
    expect(aps.event).toBe('end');
    expect(k.prisma.cards_Ao_Vivo.rows[0].encerrado_em).toBeInstanceOf(Date);
  });
});
