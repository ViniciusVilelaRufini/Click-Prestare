import { InterfoneService } from './interfone.service';
import { InterfoneAcoesService } from './interfone-acoes.service';
import { verificarTokenVoz } from './token-voz';
import { criarBancoFalso } from './banco-falso.spec';

const AGORA = Date.UTC(2026, 10, 27, 17, 5, 0);
const SEGREDO = 'segredo-token-voz';

function montar(opts: { online?: boolean; dtmf?: string | null; cond?: Record<string, any> } = {}) {
  const banco = criarBancoFalso({
    condominios: [
      {
        id: 1,
        nome: 'Residencial Teste',
        ativo: 1,
        interfone_contratado: 1,
        interfone_ativo: 1,
        interfone_toque_apto_s: 30,
        interfone_transferir: 1,
        interfone_toque_portaria_s: 45,
        ...opts.cond,
      },
      { id: 2, nome: 'Outro', ativo: 1, interfone_contratado: 1, interfone_ativo: 1, interfone_toque_apto_s: 30, interfone_transferir: 1, interfone_toque_portaria_s: 45 },
    ],
    apartamentos: [
      { id: 100, id_condominio: 1, apto: '106', bloco: 'A', interfone_ramal: '106' },
      { id: 200, id_condominio: 1, apto: '201', bloco: 'A', interfone_ramal: '201' },
      { id: 900, id_condominio: 2, apto: '1', bloco: null, interfone_ramal: '1' },
    ],
    users: [
      { id: 7, name: 'Ana Morador', fcm_token: 'f7', interfone_receber: 1 },
      { id: 8, name: 'Bruno Morador', fcm_token: 'f8', interfone_receber: 1 },
      { id: 9, name: 'Carla Vizinha', fcm_token: 'f9', interfone_receber: 1 },
    ],
    apartamentos_Users: [
      { id: 1, id_apto: 100, id_user: 7, vencimento: null },
      { id: 2, id_apto: 100, id_user: 8, vencimento: null },
      { id: 3, id_apto: 200, id_user: 9, vencimento: null },
    ],
    facial_Devices: [
      {
        id: 12,
        id_condominio: 1,
        nome: 'Portão social',
        ativo: 1,
        fabricante: 'intelbras',
        ip: '10.0.0.5',
        porta: 80,
        interfone_habilitado: 1,
        interfone_senha: 'x',
        interfone_blocos: null,
        interfone_dtmf: opts.dtmf ?? null,
      },
    ],
    funcionarios_Portaria: [
      { id: 3, nome: 'Carlos Porteiro', id_condominio: 1 },
      { id: 4, nome: 'Outro Porteiro', id_condominio: 2 },
    ],
  });
  const push = {
    tocar: jest.fn(async () => ({ tocou: 2, semApp: 0 })),
    fim: jest.fn(async () => undefined),
    perdida: jest.fn(async () => undefined),
  };
  const voz = {
    portaria: jest.fn(async () => true),
    dtmf: jest.fn(async () => true),
    encerrar: jest.fn(async () => true),
  };
  const realtime = { porteirosOnline: jest.fn(async () => opts.online ?? true), emitirPortaria: jest.fn() };
  const facial = { abrirDispositivoInterno: jest.fn(async () => ({ ok: true })) };
  const auditoria = { registrar: jest.fn(async () => undefined) };
  const nucleo = new InterfoneService(banco.prisma, push as any, voz as any, realtime as any);
  nucleo.agora = () => AGORA;
  nucleo.dormir = async () => undefined;
  const acoes = new InterfoneAcoesService(banco.prisma, nucleo, push as any, voz as any, facial as any, auditoria as any);
  acoes.agora = () => AGORA;
  return { ...banco, push, voz, realtime, facial, auditoria, nucleo, acoes };
}

const ANA = { papel: 'morador' as const, uid: 7, nome: 'Ana Morador' };
const BRUNO = { papel: 'morador' as const, uid: 8, nome: 'Bruno Morador' };
const CARLA = { papel: 'morador' as const, uid: 9, nome: 'Carla Vizinha' };
const PORTEIRO = { papel: 'portaria' as const, uid: 3, nome: 'Carlos Porteiro', idCondominio: 1 };
const PORTEIRO_OUTRO = { papel: 'portaria' as const, uid: 4, nome: 'Outro Porteiro', idCondominio: 2 };

const antes = { t: process.env['VOZ_TOKEN_SECRET'], u: process.env['VOZ_TURN_SECRET'] };
beforeEach(() => {
  process.env['VOZ_TOKEN_SECRET'] = SEGREDO;
  process.env['VOZ_TURN_SECRET'] = 'turn';
});
afterAll(() => {
  for (const [k, v] of [['VOZ_TOKEN_SECRET', antes.t], ['VOZ_TURN_SECRET', antes.u]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function chamadaFacial(m: ReturnType<typeof montar>) {
  const r = await m.nucleo.novaChamadaFacial('fac-12', '106');
  if (!r.ok) throw new Error('chamada não criada');
  return r.id;
}

describe('atender', () => {
  it('morador da unidade recebe os dados de entrada com token de 120 s do papel morador', async () => {
    const m = montar();
    const id = await chamadaFacial(m);
    const d = await m.acoes.atender(id, ANA);
    expect(d).toMatchObject({ id, wss: 'wss://voz.prestarecondominios.com.br:8089/ws', sip_uri: 'sip:entrar@voz.prestarecondominios.com.br' });
    expect(d.ice).toHaveLength(2);
    expect(verificarTokenVoz(d.token, SEGREDO, AGORA / 1000)).toEqual({ cid: id, papel: 'morador', uid: 7, nome: 'Ana Morador' });
  });

  it('atender não marca a chamada como atendida (quem marca é o serviço quando a mídia entra)', async () => {
    const m = montar();
    const id = await chamadaFacial(m);
    await m.acoes.atender(id, ANA);
    expect(m.tabelas['interfone_Chamadas'][0].estado).toBe('chamando');
  });

  it('dois atender seguidos de moradores diferentes → o segundo 409 ja_atendida; o mesmo morador repete', async () => {
    const m = montar();
    const id = await chamadaFacial(m);
    await m.acoes.atender(id, ANA);
    await expect(m.acoes.atender(id, BRUNO)).rejects.toMatchObject({ status: 409, response: { motivo: 'ja_atendida' } });
    await expect(m.acoes.atender(id, ANA)).resolves.toMatchObject({ id });
  });

  it('a reserva vence em 15 s e outro morador pode atender', async () => {
    const m = montar();
    const id = await chamadaFacial(m);
    await m.acoes.atender(id, ANA);
    m.acoes.agora = () => AGORA + 15_001;
    await expect(m.acoes.atender(id, BRUNO)).resolves.toMatchObject({ id });
  });

  it('chamada encerrada → 409 encerrada; já atendida → 409 ja_atendida', async () => {
    const m = montar();
    const id = await chamadaFacial(m);
    await m.nucleo.evento(id, { evento: 'atendida', papel: 'morador', uid: 7 });
    await expect(m.acoes.atender(id, BRUNO)).rejects.toMatchObject({ status: 409, response: { motivo: 'ja_atendida' } });
    await m.nucleo.evento(id, { evento: 'encerrada', resultado: 'atendida_morador', duracao_s: 3 });
    await expect(m.acoes.atender(id, BRUNO)).rejects.toMatchObject({ status: 409, response: { motivo: 'encerrada' } });
  });

  it('morador sem vínculo com a unidade → 403', async () => {
    const m = montar();
    const id = await chamadaFacial(m);
    await expect(m.acoes.atender(id, CARLA)).rejects.toMatchObject({ status: 403 });
  });

  it('chamada inexistente → 404', async () => {
    const m = montar();
    await expect(m.acoes.atender(999, ANA)).rejects.toMatchObject({ status: 404 });
  });

  it('chamada já na portaria: morador não atende mais (409); porteiro atende', async () => {
    const m = montar();
    const id = await chamadaFacial(m);
    await expect(m.acoes.atender(id, PORTEIRO)).rejects.toMatchObject({ status: 409 });
    await m.nucleo.evento(id, { evento: 'toque_esgotado' });
    await expect(m.acoes.atender(id, ANA)).rejects.toMatchObject({ status: 409, response: { motivo: 'ja_atendida' } });
    const d = await m.acoes.atender(id, PORTEIRO);
    expect(verificarTokenVoz(d.token, SEGREDO, AGORA / 1000)).toMatchObject({ papel: 'portaria', uid: 3 });
  });

  it('porteiro de outro condomínio → 403', async () => {
    const m = montar();
    const id = await chamadaFacial(m);
    await m.nucleo.evento(id, { evento: 'toque_esgotado' });
    await expect(m.acoes.atender(id, PORTEIRO_OUTRO)).rejects.toMatchObject({ status: 403 });
  });

  it('sem segredo de token configurado → 503 (falha fechado)', async () => {
    const m = montar();
    const id = await chamadaFacial(m);
    delete process.env['VOZ_TOKEN_SECRET'];
    await expect(m.acoes.atender(id, ANA)).rejects.toMatchObject({ status: 503 });
  });
});

describe('recusar', () => {
  it('um recusa: nada muda; todos recusam → recusou e vai para a portaria', async () => {
    const m = montar();
    const id = await chamadaFacial(m);
    await expect(m.acoes.recusar(id, 7)).resolves.toEqual({ ok: true });
    expect(m.voz.portaria).not.toHaveBeenCalled();
    await m.acoes.recusar(id, 7); // repetido não conta duas vezes
    expect(m.voz.portaria).not.toHaveBeenCalled();
    await m.acoes.recusar(id, 8);
    expect(m.voz.portaria).toHaveBeenCalledWith(id);
    const c = m.tabelas['interfone_Chamadas'][0];
    expect(c).toMatchObject({ motivo_portaria: 'recusou', estado: 'portaria' });
    expect(JSON.parse(c.recusas)).toEqual([7, 8]);
    expect(m.realtime.emitirPortaria).toHaveBeenCalledWith(1, 'interfone:chamada', expect.objectContaining({ id, motivo: 'recusou' }));
  });

  it('todos recusam sem porteiro online → encerra a chamada no serviço', async () => {
    const m = montar({ online: false });
    const id = await chamadaFacial(m);
    await m.acoes.recusar(id, 7);
    await m.acoes.recusar(id, 8);
    expect(m.voz.portaria).not.toHaveBeenCalled();
    expect(m.voz.encerrar).toHaveBeenCalledWith(id);
  });

  it('sem vínculo → 403', async () => {
    const m = montar();
    const id = await chamadaFacial(m);
    await expect(m.acoes.recusar(id, 9)).rejects.toMatchObject({ status: 403 });
  });
});

describe('abrir', () => {
  async function atendidaPorAna(m: ReturnType<typeof montar>) {
    const id = await chamadaFacial(m);
    await m.nucleo.evento(id, { evento: 'atendida', papel: 'morador', uid: 7 });
    return id;
  }

  it('por quem não atendeu → {ok:false} sem acionar nada', async () => {
    const m = montar();
    const id = await atendidaPorAna(m);
    await expect(m.acoes.abrir(id, BRUNO)).resolves.toMatchObject({ ok: false });
    expect(m.facial.abrirDispositivoInterno).not.toHaveBeenCalled();
  });

  it('chamada ainda tocando ou encerrada → recusado', async () => {
    const m = montar();
    const id = await chamadaFacial(m);
    await expect(m.acoes.abrir(id, ANA)).resolves.toMatchObject({ ok: false });
    await m.nucleo.evento(id, { evento: 'atendida', papel: 'morador', uid: 7 });
    await m.nucleo.evento(id, { evento: 'encerrada', resultado: 'atendida_morador', duracao_s: 9 });
    await expect(m.acoes.abrir(id, ANA)).resolves.toMatchObject({ ok: false });
    expect(m.facial.abrirDispositivoInterno).not.toHaveBeenCalled();
  });

  it('ok → aciona o facial da chamada, grava quem abriu e audita', async () => {
    const m = montar();
    const id = await atendidaPorAna(m);
    await expect(m.acoes.abrir(id, ANA)).resolves.toEqual({ ok: true });
    expect(m.facial.abrirDispositivoInterno).toHaveBeenCalledWith(12, {
      origem: 'interfone',
      tipoPessoa: 'visitante',
      nomePessoa: 'Interfone Bloco A · Apto 106',
    });
    expect(m.tabelas['interfone_Chamadas'][0]).toMatchObject({
      porta_aberta_por_nome: 'Ana Morador',
      porta_aberta_como: 'agente',
      porta_aberta_em: new Date(AGORA),
    });
    expect(m.auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ acao: 'INTERFONE_ABRIR', modulo: 'interfone', id_condominio: 1, entidade_id: id, autor_id: 7, autor_tipo: 'user' }),
    );
  });

  it('pode repetir enquanto a chamada está atendida', async () => {
    const m = montar();
    const id = await atendidaPorAna(m);
    await m.acoes.abrir(id, ANA);
    await expect(m.acoes.abrir(id, ANA)).resolves.toEqual({ ok: true });
    expect(m.facial.abrirDispositivoInterno).toHaveBeenCalledTimes(2);
  });

  it('agente falhou e o facial tem DTMF → abre pelo DTMF', async () => {
    const m = montar({ dtmf: '#1' });
    m.facial.abrirDispositivoInterno.mockResolvedValueOnce({ ok: false, erro: 'agente offline' } as any);
    const id = await atendidaPorAna(m);
    await expect(m.acoes.abrir(id, ANA)).resolves.toEqual({ ok: true });
    expect(m.voz.dtmf).toHaveBeenCalledWith(id, '#1');
    expect(m.tabelas['interfone_Chamadas'][0].porta_aberta_como).toBe('dtmf');
  });

  it('agente falhou sem DTMF → {ok:false, motivo} e nada gravado', async () => {
    const m = montar();
    m.facial.abrirDispositivoInterno.mockResolvedValueOnce({ ok: false, erro: 'agente offline' } as any);
    const id = await atendidaPorAna(m);
    const r = await m.acoes.abrir(id, ANA);
    expect(r.ok).toBe(false);
    expect(r.motivo).toBeTruthy();
    expect(m.tabelas['interfone_Chamadas'][0].porta_aberta_em).toBeNull();
    expect(m.auditoria.registrar).not.toHaveBeenCalled();
  });

  it('porteiro que atendeu abre; auditoria com autor funcionario_portaria', async () => {
    const m = montar();
    const id = await chamadaFacial(m);
    await m.nucleo.evento(id, { evento: 'toque_esgotado' });
    await m.nucleo.evento(id, { evento: 'atendida', papel: 'portaria', uid: 3 });
    await expect(m.acoes.abrir(id, PORTEIRO)).resolves.toEqual({ ok: true });
    expect(m.auditoria.registrar).toHaveBeenCalledWith(expect.objectContaining({ autor_id: 3, autor_tipo: 'funcionario_portaria' }));
  });
});

describe('ligar', () => {
  it('ligarPortaria sem porteiro online → 409 portaria_indisponivel', async () => {
    const m = montar({ online: false });
    await expect(m.acoes.ligarPortaria(ANA, 100)).rejects.toMatchObject({ status: 409, response: { motivo: 'portaria_indisponivel' } });
  });

  it('ligarPortaria cria a chamada na portaria, avisa o console e devolve token de origem', async () => {
    const m = montar();
    const d = await m.acoes.ligarPortaria(ANA, 100);
    expect(m.tabelas['interfone_Chamadas'][0]).toMatchObject({
      tipo: 'unidade_portaria',
      estado: 'portaria',
      id_apartamento: 100,
      id_user_origem: 7,
      id_condominio: 1,
    });
    expect(verificarTokenVoz(d.token, SEGREDO, AGORA / 1000)).toEqual({ cid: d.id, papel: 'origem', uid: 7, nome: 'Ana Morador' });
    expect(m.realtime.emitirPortaria).toHaveBeenCalledWith(1, 'interfone:chamada', {
      id: d.id,
      tipo: 'unidade_portaria',
      unidade: 'Bloco A · Apto 106',
      motivo: null,
      morador_nome: 'Ana Morador',
      foto_url: null,
    });
    // Uma chamada ativa por usuário.
    await expect(m.acoes.ligarPortaria(ANA, 100)).rejects.toMatchObject({ status: 409 });
    // O porteiro atende a ligação da unidade.
    await expect(m.acoes.atender(d.id, PORTEIRO)).resolves.toMatchObject({ id: d.id });
  });

  it('ligarPortaria sem vínculo → 403; módulo desligado → 409', async () => {
    const m = montar();
    await expect(m.acoes.ligarPortaria(CARLA, 100)).rejects.toMatchObject({ status: 403 });
    const m2 = montar({ cond: { interfone_ativo: 0 } });
    await expect(m2.acoes.ligarPortaria(ANA, 100)).rejects.toMatchObject({ status: 409 });
  });

  it('ligarUnidade toca os moradores com portão "Portaria" e o morador atende', async () => {
    const m = montar();
    const d = await m.acoes.ligarUnidade(PORTEIRO, 100);
    expect(m.tabelas['interfone_Chamadas'][0]).toMatchObject({ tipo: 'portaria_unidade', estado: 'chamando', id_porteiro_origem: 3 });
    expect(m.push.tocar).toHaveBeenCalledWith(d.id, [7, 8], {
      tipo: 'portaria_unidade',
      unidade: 'Bloco A · Apto 106',
      portao: 'Portaria',
      condominio: 'Residencial Teste',
    });
    expect(verificarTokenVoz(d.token, SEGREDO, AGORA / 1000)).toMatchObject({ papel: 'origem', uid: 3 });
    await expect(m.acoes.atender(d.id, ANA)).resolves.toMatchObject({ id: d.id });
  });

  it('ligarUnidade de outro condomínio → 403; ninguém com app → 409 sem_app e chamada fechada', async () => {
    const m = montar();
    await expect(m.acoes.ligarUnidade(PORTEIRO, 900)).rejects.toMatchObject({ status: 403 });
    m.push.tocar.mockResolvedValueOnce({ tocou: 0, semApp: 2 });
    await expect(m.acoes.ligarUnidade(PORTEIRO, 100)).rejects.toMatchObject({ status: 409, response: { motivo: 'sem_app' } });
    expect(m.tabelas['interfone_Chamadas'][0]).toMatchObject({ estado: 'encerrada', resultado: 'falha' });
  });
});

describe('consultas do app e do console', () => {
  it('historico: só quem tem vínculo, 30 dias, mais recente primeiro', async () => {
    const m = montar();
    const id = await chamadaFacial(m);
    m.tabelas['interfone_Chamadas'].push({
      ...m.tabelas['interfone_Chamadas'][0],
      id: 50,
      created_at: new Date(AGORA - 31 * 86_400_000),
    });
    await m.nucleo.evento(id, { evento: 'atendida', papel: 'morador', uid: 7 });
    m.tabelas['interfone_Chamadas'][0].porta_aberta_em = new Date(AGORA);
    m.tabelas['interfone_Chamadas'][0].foto = 'https://bucket/interfone/x.jpg';
    const h = await m.acoes.historico(8, 100);
    expect(h).toEqual([
      {
        id,
        tipo: 'facial_unidade',
        inicio: new Date(AGORA),
        resultado: null,
        atendida_por_nome: 'Ana Morador',
        foto_url: 'https://bucket/interfone/x.jpg',
        porta_aberta: true,
      },
    ]);
    await expect(m.acoes.historico(9, 100)).rejects.toMatchObject({ status: 403 });
  });

  it('hoje: chamadas do dia do condomínio, com a unidade', async () => {
    const m = montar();
    const id = await chamadaFacial(m);
    const h = await m.acoes.hoje(1);
    expect(h).toEqual([expect.objectContaining({ id, unidade: 'Bloco A · Apto 106', porta_aberta: false })]);
    await expect(m.acoes.hoje(2)).resolves.toEqual([]);
  });

  it('estadoParaApp: estado, unidade, portão e se fui eu que atendi; sem vínculo → 403', async () => {
    const m = montar();
    const id = await chamadaFacial(m);
    await m.nucleo.evento(id, { evento: 'atendida', papel: 'morador', uid: 7 });
    await expect(m.acoes.estadoParaApp(id, 7)).resolves.toEqual({
      id,
      tipo: 'facial_unidade',
      estado: 'atendida',
      resultado: null,
      unidade: 'Bloco A · Apto 106',
      portao: 'Portão social',
      foto_url: null,
      atendida_por_mim: true,
    });
    await expect(m.acoes.estadoParaApp(id, 8)).resolves.toMatchObject({ atendida_por_mim: false });
    await expect(m.acoes.estadoParaApp(id, 9)).rejects.toMatchObject({ status: 403 });
  });

  it('preferência: lê e grava interfone_receber', async () => {
    const m = montar();
    await expect(m.acoes.preferencia(7)).resolves.toEqual({ receber: true });
    await expect(m.acoes.definirPreferencia(7, false)).resolves.toEqual({ receber: false });
    expect(m.tabelas['users'].find((u: any) => u.id === 7).interfone_receber).toBe(0);
  });

  it('disponivel: vínculo vigente em condomínio com o módulo ligado', async () => {
    const m = montar();
    await expect(m.acoes.disponivel(7)).resolves.toEqual({ ativo: true });
    const m2 = montar({ cond: { interfone_contratado: 0 } });
    await expect(m2.acoes.disponivel(7)).resolves.toEqual({ ativo: false });
  });

  it('encerrar pela portaria: só do próprio condomínio', async () => {
    const m = montar();
    const id = await chamadaFacial(m);
    await expect(m.acoes.encerrarPortaria(id, PORTEIRO_OUTRO)).rejects.toMatchObject({ status: 403 });
    await expect(m.acoes.encerrarPortaria(id, PORTEIRO)).resolves.toEqual({ ok: true });
    expect(m.voz.encerrar).toHaveBeenCalledWith(id);
  });
});
