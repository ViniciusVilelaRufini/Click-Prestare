import { InterfoneConfigService, gerarSenhaSip } from './interfone-config.service';
import { InterfoneSindicoController } from './interfone-sindico.controller';
import { CrmInterfoneController } from '../crm/crm-interfone.controller';
import { CrmAdminGuard } from '../crm/crm-admin.guard';
import { criarBancoFalso } from './banco-falso.spec';

const ATOR = { nome: 'Síndica Sara', autor_id: 50, autor_tipo: 'user' as const };

function montar(cond: Record<string, any> = {}, agent?: { enqueue: jest.Mock; getTelemetria?: jest.Mock }) {
  const banco = criarBancoFalso({
    condominios: [
      {
        id: 1,
        nome: 'Residencial Teste',
        ativo: 1,
        interfone_contratado: 1,
        interfone_ativo: 0,
        interfone_toque_apto_s: 30,
        interfone_transferir: 1,
        interfone_toque_portaria_s: 45,
        ...cond,
      },
      { id: 2, nome: 'Outro', ativo: 1, interfone_contratado: 1, interfone_ativo: 1, interfone_toque_apto_s: 30, interfone_transferir: 1, interfone_toque_portaria_s: 45 },
    ],
    apartamentos: [
      { id: 100, id_condominio: 1, apto: '106', bloco: 'A', interfone_ramal: '106' },
      { id: 101, id_condominio: 1, apto: '201', bloco: 'A', interfone_ramal: '201' },
      { id: 102, id_condominio: 1, apto: '106', bloco: 'B', interfone_ramal: null },
      { id: 103, id_condominio: 1, apto: '12', bloco: 'B', interfone_ramal: null },
      { id: 900, id_condominio: 2, apto: '1', bloco: null, interfone_ramal: '1' },
    ],
    facial_Devices: [
      {
        id: 12,
        id_condominio: 1,
        nome: 'Portão social',
        tipo: 'facial',
        modelo: 'SS 3532 MF',
        fabricante: 'intelbras',
        ativo: 1,
        interfone_habilitado: 0,
        interfone_senha: null,
        interfone_blocos: null,
        interfone_dtmf: null,
        interfone_registrado: 0,
        interfone_registrado_em: null,
      },
      { id: 13, id_condominio: 1, nome: 'Botoeira', tipo: 'botoeira', fabricante: 'generico', ativo: 1, interfone_habilitado: 0 },
      { id: 90, id_condominio: 2, nome: 'Outro facial', tipo: 'facial', fabricante: 'intelbras', ativo: 1, interfone_habilitado: 0 },
    ],
  });
  const auditoria = { registrar: jest.fn(async () => undefined) };
  const svc = new InterfoneConfigService(banco.prisma, auditoria as any, agent as any);
  return { ...banco, auditoria, svc };
}

describe('config do módulo', () => {
  it('GET mostra contratado mesmo quando não contratado (a aba some no console)', async () => {
    const m = montar({ interfone_contratado: 0 });
    await expect(m.svc.config(1)).resolves.toEqual({
      contratado: false,
      ativo: false,
      toque_apto_s: 30,
      transferir: true,
      toque_portaria_s: 45,
    });
  });

  it('não contratado → 403 no resto', async () => {
    const m = montar({ interfone_contratado: 0 });
    await expect(m.svc.salvarConfig(1, { ativo: true }, ATOR)).rejects.toMatchObject({ status: 403 });
    await expect(m.svc.ramais(1)).rejects.toMatchObject({ status: 403 });
    await expect(m.svc.faciais(1)).rejects.toMatchObject({ status: 403 });
    await expect(m.svc.monitores(1)).rejects.toMatchObject({ status: 403 });
    await expect(m.svc.listaTelefonica(1, 12)).rejects.toMatchObject({ status: 403 });
  });

  it('PUT grava (sem contratado), valida a faixa e audita', async () => {
    const m = montar();
    await expect(
      m.svc.salvarConfig(1, { ativo: true, toque_apto_s: 40, transferir: false, toque_portaria_s: 60, contratado: true } as any, ATOR),
    ).resolves.toEqual({ contratado: true, ativo: true, toque_apto_s: 40, transferir: false, toque_portaria_s: 60 });
    expect(m.tabelas['condominios'][0]).toMatchObject({ interfone_ativo: 1, interfone_transferir: 0, interfone_toque_apto_s: 40 });
    expect(m.auditoria.registrar).toHaveBeenCalledWith(expect.objectContaining({ acao: 'INTERFONE_CONFIG', modulo: 'interfone', id_condominio: 1 }));
    await expect(m.svc.salvarConfig(1, { toque_apto_s: 10 }, ATOR)).rejects.toMatchObject({ status: 400 });
    await expect(m.svc.salvarConfig(1, { toque_portaria_s: 121 }, ATOR)).rejects.toMatchObject({ status: 400 });
    await expect(m.svc.salvarConfig(1, { ativo: 'sim' } as any, ATOR)).rejects.toMatchObject({ status: 400 });
  });
});

describe('ramais', () => {
  it('lista as unidades com sugestão e conflito', async () => {
    const m = montar();
    const r = await m.svc.ramais(1);
    expect(r).toEqual(
      expect.arrayContaining([
        { id_apartamento: 100, unidade: 'Bloco A · Apto 106', ramal: '106', sugestao: '1106', conflito: false },
        // O 106 já é ramal do A·106: a sugestão do B·106 ganha o prefixo do bloco (B = 2º bloco).
        { id_apartamento: 102, unidade: 'Bloco B · Apto 106', ramal: null, sugestao: '2106', conflito: false },
        { id_apartamento: 103, unidade: 'Bloco B · Apto 12', ramal: null, sugestao: '12', conflito: false },
      ]),
    );
    expect(r).toHaveLength(4);
  });

  it('ramal duplicado (na lista ou contra outra unidade) → 400 com a lista; nada gravado', async () => {
    const m = montar();
    await expect(
      m.svc.salvarRamais(1, [{ id_apartamento: 102, ramal: '106' }], ATOR),
    ).rejects.toMatchObject({ status: 400, response: { erros: [expect.objectContaining({ id_apartamento: 102, ramal: '106' })] } });
    await expect(
      m.svc.salvarRamais(1, [
        { id_apartamento: 102, ramal: '2106' },
        { id_apartamento: 103, ramal: '2106' },
      ], ATOR),
    ).rejects.toMatchObject({ status: 400 });
    expect(m.tabelas['apartamentos'].find((a: any) => a.id === 102).interfone_ramal).toBeNull();
  });

  it('ramal inválido ou unidade de outro condomínio → 400', async () => {
    const m = montar();
    await expect(m.svc.salvarRamais(1, [{ id_apartamento: 102, ramal: '12a' }], ATOR)).rejects.toMatchObject({ status: 400 });
    await expect(m.svc.salvarRamais(1, [{ id_apartamento: 900, ramal: '5' }], ATOR)).rejects.toMatchObject({ status: 400 });
    await expect(m.svc.salvarRamais(1, 'x' as any, ATOR)).rejects.toMatchObject({ status: 400 });
  });

  it('lista parcial: grava só as unidades enviadas e não mexe nas outras', async () => {
    const m = montar();
    const r = (id: number) => m.tabelas['apartamentos'].find((a: any) => a.id === id).interfone_ramal;
    const lista = await m.svc.salvarRamais(1, [{ id_apartamento: 102, ramal: '2106' }], ATOR);
    expect([r(100), r(101), r(102), r(103)]).toEqual(['106', '201', '2106', null]);
    expect(lista.find((x) => x.id_apartamento === 102)).toMatchObject({ ramal: '2106', conflito: false });
    expect(lista.find((x) => x.id_apartamento === 103)).toMatchObject({ ramal: null, sugestao: '12' });
  });

  it('ramal vazio ou null limpa o ramal da unidade', async () => {
    const m = montar();
    const r = (id: number) => m.tabelas['apartamentos'].find((a: any) => a.id === id).interfone_ramal;
    await m.svc.salvarRamais(1, [{ id_apartamento: 100, ramal: '' }], ATOR);
    expect([r(100), r(101)]).toEqual([null, '201']);
    await m.svc.salvarRamais(1, [{ id_apartamento: 101, ramal: '   ' }], ATOR);
    expect(r(101)).toBeNull();
    await m.svc.salvarRamais(1, [{ id_apartamento: 102, ramal: '2106' }], ATOR);
    await m.svc.salvarRamais(1, [{ id_apartamento: 102, ramal: null }], ATOR);
    expect(r(102)).toBeNull();
  });

  it('grava, permite trocar dois ramais entre si e limpar, e audita', async () => {
    const m = montar();
    await m.svc.salvarRamais(1, [
      { id_apartamento: 100, ramal: '201' },
      { id_apartamento: 101, ramal: '106' },
      { id_apartamento: 102, ramal: '2106' },
      { id_apartamento: 103, ramal: null },
    ], ATOR);
    const r = (id: number) => m.tabelas['apartamentos'].find((a: any) => a.id === id).interfone_ramal;
    expect([r(100), r(101), r(102), r(103)]).toEqual(['201', '106', '2106', null]);
    expect(m.auditoria.registrar).toHaveBeenCalledWith(expect.objectContaining({ acao: 'INTERFONE_CONFIG' }));
  });
});

describe('faciais', () => {
  it('lista só faciais do condomínio, com dados para o instalador', async () => {
    const m = montar();
    const l = await m.svc.faciais(1);
    expect(l).toEqual([
      {
        id: 12,
        nome: 'Portão social',
        modelo: 'SS 3532 MF',
        habilitado: false,
        blocos: null,
        dtmf: null,
        conta: 'fac12',
        senha: null,
        servidor: 'voz.prestarecondominios.com.br',
        porta: 5080,
        registrado: false,
        registrado_em: null,
        config_automatica: false,
      },
    ]);
  });

  it('habilitar pela primeira vez gera a senha; blocos inexistentes e DTMF inválido → 400', async () => {
    const m = montar();
    await expect(m.svc.salvarFacial(1, 12, { habilitado: true, blocos: ['Z'], dtmf: null }, ATOR)).rejects.toMatchObject({ status: 400 });
    await expect(m.svc.salvarFacial(1, 12, { habilitado: true, blocos: null, dtmf: '1;2' }, ATOR)).rejects.toMatchObject({ status: 400 });
    const f = await m.svc.salvarFacial(1, 12, { habilitado: true, blocos: ['Bloco A'], dtmf: '#1' }, ATOR);
    expect(f).toMatchObject({ habilitado: true, blocos: ['Bloco A'], dtmf: '#1' });
    expect(f.senha).toMatch(/^[A-Za-z0-9]{24}$/);
    const senha = f.senha;
    const f2 = await m.svc.salvarFacial(1, 12, { habilitado: true, blocos: [], dtmf: '' }, ATOR);
    expect(f2).toMatchObject({ blocos: null, dtmf: null, senha });
    expect(m.auditoria.registrar).toHaveBeenCalledWith(expect.objectContaining({ acao: 'INTERFONE_CONFIG' }));
    // A senha nunca vai para a auditoria.
    expect(JSON.stringify((m.auditoria.registrar.mock.calls as any[]).map((c) => c[0]))).not.toContain(senha);
  });

  it("facial antigo com tipo '' conta como facial: aparece na lista e pode ser configurado", async () => {
    const m = montar();
    m.tabelas['facial_Devices'].push({
      id: 14, id_condominio: 1, nome: 'Portão antigo', tipo: '', modelo: null, fabricante: 'intelbras', ativo: 1,
      interfone_habilitado: 0, interfone_senha: null, interfone_blocos: null, interfone_dtmf: null, interfone_registrado: 0,
    });
    const l = await m.svc.faciais(1);
    expect(l.map((f) => f.id)).toEqual([12, 14]);
    await expect(m.svc.salvarFacial(1, 14, { habilitado: true, blocos: null, dtmf: null }, ATOR)).resolves.toMatchObject({
      id: 14,
      habilitado: true,
    });
    await expect(m.svc.novaSenha(1, 14, ATOR)).resolves.toMatchObject({ senha: expect.stringMatching(/^[A-Za-z0-9]{24}$/) });
    await expect(m.svc.listaTelefonica(1, 14)).resolves.toEqual(expect.any(String));
  });

  it('facial de outro condomínio ou que não é facial → 404', async () => {
    const m = montar();
    await expect(m.svc.salvarFacial(1, 90, { habilitado: true, blocos: null, dtmf: null }, ATOR)).rejects.toMatchObject({ status: 404 });
    await expect(m.svc.salvarFacial(1, 13, { habilitado: true, blocos: null, dtmf: null }, ATOR)).rejects.toMatchObject({ status: 404 });
    await expect(m.svc.novaSenha(1, 90, ATOR)).rejects.toMatchObject({ status: 404 });
  });

  it('nova-senha tem 24 caracteres [A-Za-z0-9] e troca a anterior', async () => {
    const m = montar();
    const a = await m.svc.novaSenha(1, 12, ATOR);
    const b = await m.svc.novaSenha(1, 12, ATOR);
    expect(a.senha).toMatch(/^[A-Za-z0-9]{24}$/);
    expect(b.senha).not.toBe(a.senha);
    expect(m.tabelas['facial_Devices'][0].interfone_senha).toBe(b.senha);
    expect(gerarSenhaSip()).toMatch(/^[A-Za-z0-9]{24}$/);
  });
});

describe('configurar o facial automaticamente (G1, só pela rota manual)', () => {
  const ENV = 'INTERFONE_CONFIG_AUTOMATICA';
  let antes: string | undefined;
  beforeEach(() => {
    antes = process.env[ENV];
    process.env[ENV] = '1';
  });
  afterEach(() => {
    if (antes === undefined) delete process.env[ENV];
    else process.env[ENV] = antes;
  });

  const OK = { ok: true, parcial: false, restantes: 0, conflitos: [], avisos: [] };
  const agente = (resultado: Record<string, unknown> = OK, versao: string | null = '2026.11.28') => ({
    enqueue: jest.fn(async () => resultado),
    getTelemetria: jest.fn(async () => (versao ? { versao } : null)),
  });

  async function habilitado(m: ReturnType<typeof montar>, blocos: string[] | null = null) {
    return m.svc.salvarFacial(1, 12, { habilitado: true, blocos }, ATOR);
  }

  it('monta a conta (a MESMA de GET /faciais, sem hífen) e os contatos e enfileira interfone_config', async () => {
    const agent = agente();
    const m = montar({}, agent);
    const f = await habilitado(m);
    await expect(m.svc.configurarFacialAutomatico(1, 12, ATOR)).resolves.toEqual(OK);
    const [lista] = await m.svc.faciais(1);
    expect(lista.conta).toBe('fac12');
    expect(agent.enqueue).toHaveBeenCalledTimes(1);
    expect(agent.enqueue).toHaveBeenCalledWith(12, {
      type: 'interfone_config',
      interfone: {
        servidor: 'voz.prestarecondominios.com.br',
        porta: 5080,
        conta: lista.conta,
        senha: f.senha,
        forcar: false,
        contatos: [
          { nome: 'Bloco A · Apto 106', numero: '106', bloco: 'A', andar: '1' },
          { nome: 'Bloco A · Apto 201', numero: '201', bloco: 'A', andar: '2' },
        ],
      },
    });
    const auditorias = JSON.stringify((m.auditoria.registrar.mock.calls as any[]).map((c) => c[0]));
    expect(auditorias).toContain('configurado automaticamente');
    expect(auditorias).not.toContain(f.senha as string);
  });

  it('respeita os blocos do facial', async () => {
    const agent = agente();
    const m = montar({}, agent);
    m.tabelas['apartamentos'].find((a: any) => a.id === 102).interfone_ramal = '1106';
    await habilitado(m, ['B']);
    await m.svc.configurarFacialAutomatico(1, 12, ATOR);
    const cmd = (agent.enqueue.mock.calls[0] as any[])[1];
    expect(cmd.interfone.contatos).toEqual([{ nome: 'Bloco B · Apto 106', numero: '1106', bloco: 'B', andar: '1' }]);
  });

  it('conta SIP de outro servidor: devolve sip_de_outro_servidor com o servidor atual; forcar repassa ao agente', async () => {
    const agent = agente({ ok: false, error: 'sip_de_outro_servidor', servidor_atual: '10.0.0.5' });
    const m = montar({}, agent);
    await habilitado(m);
    await expect(m.svc.configurarFacialAutomatico(1, 12, ATOR)).resolves.toEqual({
      ok: false,
      erro: 'sip_de_outro_servidor',
      servidor_atual: '10.0.0.5',
    });
    await m.svc.configurarFacialAutomatico(1, 12, ATOR, { forcar: true });
    expect((agent.enqueue.mock.calls[1] as any[])[1].interfone.forcar).toBe(true);
  });

  it('parcial, conflitos e avisos do agente chegam ao console', async () => {
    const agent = agente({ ok: true, parcial: true, restantes: 15, conflitos: ['301'], avisos: ['x'] });
    const m = montar({}, agent);
    await habilitado(m);
    await expect(m.svc.configurarFacialAutomatico(1, 12, ATOR)).resolves.toEqual({
      ok: true,
      parcial: true,
      restantes: 15,
      conflitos: ['301'],
      avisos: ['x'],
    });
  });

  it('sem a flag, com agente antigo ou sem telemetria: 409 indisponivel, sem enfileirar; GET /faciais sem config_automatica', async () => {
    const casos: [string | undefined, string | null][] = [
      [undefined, '2026.11.28'],
      ['0', '2026.11.28'],
      ['1', '2026.11.24'],
      ['1', null],
    ];
    for (const [flag, versao] of casos) {
      if (flag === undefined) delete process.env[ENV];
      else process.env[ENV] = flag;
      const agent = agente(OK, versao);
      const m = montar({}, agent);
      await habilitado(m);
      await expect(m.svc.configurarFacialAutomatico(1, 12, ATOR)).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({ motivo: 'indisponivel' }),
      });
      expect((await m.svc.faciais(1))[0].config_automatica).toBe(false);
      expect(agent.enqueue).not.toHaveBeenCalled();
    }
    process.env[ENV] = '1';
    const m = montar({}, agente());
    expect((await m.svc.faciais(1))[0].config_automatica).toBe(true);
  });

  it('facial sem interfone habilitado, inativo ou de outra marca: {ok:false} sem enfileirar', async () => {
    const agent = agente();
    const m = montar({}, agent);
    await expect(m.svc.configurarFacialAutomatico(1, 12, ATOR)).resolves.toMatchObject({ ok: false, erro: expect.stringMatching(/habilit/i) });
    await habilitado(m);
    const dev = m.tabelas['facial_Devices'].find((d: any) => d.id === 12);
    dev.ativo = 0;
    await expect(m.svc.configurarFacialAutomatico(1, 12, ATOR)).resolves.toMatchObject({ ok: false, erro: expect.stringMatching(/desativado/i) });
    expect((await m.svc.faciais(1))[0].config_automatica).toBe(false);
    dev.ativo = 1;
    dev.fabricante = 'hikvision';
    await expect(m.svc.configurarFacialAutomatico(1, 12, ATOR)).resolves.toMatchObject({ ok: false, erro: expect.stringMatching(/Intelbras/) });
    expect(agent.enqueue).not.toHaveBeenCalled();
  });

  it('falha no agente volta como {ok:false, erro} e fica na auditoria', async () => {
    const agent = agente({ ok: false, error: 'interfone: o aparelho não devolveu a configuração SIP' });
    const m = montar({}, agent);
    await habilitado(m);
    const r = await m.svc.configurarFacialAutomatico(1, 12, ATOR);
    expect(r).toEqual({ ok: false, erro: 'interfone: o aparelho não devolveu a configuração SIP' });
    expect(m.auditoria.registrar).toHaveBeenLastCalledWith(
      expect.objectContaining({ acao: 'INTERFONE_CONFIG', descricao: expect.stringContaining('falhou') }),
    );
  });

  it('não contratado → 403; facial de outro condomínio → 404', async () => {
    const agent = agente();
    await expect(montar({ interfone_contratado: 0 }, agent).svc.configurarFacialAutomatico(1, 12, ATOR)).rejects.toMatchObject({ status: 403 });
    await expect(montar({}, agent).svc.configurarFacialAutomatico(1, 90, ATOR)).rejects.toMatchObject({ status: 404 });
    expect(agent.enqueue).not.toHaveBeenCalled();
  });

  it('salvar o facial ou os ramais NÃO dispara a configuração automática (fica para depois da bancada)', async () => {
    const agent = agente();
    const m = montar({}, agent);
    await habilitado(m);
    await m.svc.salvarRamais(1, [{ id_apartamento: 102, ramal: '1106' }], ATOR);
    expect(agent.enqueue).not.toHaveBeenCalled();
  });
});

describe('lista telefônica Intelbras', () => {
  it('CSV de 2 unidades tem 3 linhas; andar de 106 é 1; ring = toque_apto + toque_portaria + 10', async () => {
    const m = montar();
    m.tabelas['facial_Devices'][0].interfone_blocos = '["A"]';
    const csv = await m.svc.listaTelefonica(1, 12);
    const linhas = csv.split(/\r?\n/).filter(Boolean);
    expect(linhas).toEqual([
      'Ramal;1° núm. chamado;Conta SIP;Tempo de ring;2° núm. chamado;Grupo agenda;Nome do bloco;Núm. andar',
      'Bloco A · Apto 106;106;1;85;;;A;1',
      'Bloco A · Apto 201;201;1;85;;;A;2',
    ]);
  });

  it('só unidades com ramal; andar vazio com menos de 3 dígitos', async () => {
    const m = montar();
    m.tabelas['apartamentos'].find((a: any) => a.id === 103).interfone_ramal = '12';
    const linhas = (await m.svc.listaTelefonica(1, 12)).split(/\r?\n/).filter(Boolean);
    expect(linhas).toHaveLength(4);
    expect(linhas).toContain('Bloco B · Apto 12;12;1;85;;;B;');
  });
});

describe('revisão 2: CSV e corrida no PUT /ramais', () => {
  it('célula que começa com = + - @ ganha apóstrofo (sem fórmula no Excel)', async () => {
    const m = montar();
    m.tabelas['apartamentos'].push({ id: 104, id_condominio: 1, apto: '301', bloco: '=HYPERLINK("x")', interfone_ramal: '301' });
    const csv = await m.svc.listaTelefonica(1, 12);
    const linha = csv.split(/\r?\n/).find((l) => l.includes('301;1;85'))!;
    expect(linha.split(';')[0]).not.toMatch(/^=/);
    expect(linha).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('chave única violada por save concorrente (P2002) → 400 ramal_repetido', async () => {
    const m = montar();
    m.prisma.$transaction.mockRejectedValueOnce(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));
    await expect(m.svc.salvarRamais(1, [{ id_apartamento: 102, ramal: '2106' }], ATOR)).rejects.toMatchObject({
      status: 400,
      response: { erros: [expect.objectContaining({ motivo: 'ramal_repetido' })] },
    });
  });
});

describe('monitores', () => {
  it('cadastra, lista (com dados de registro) e remove; audita', async () => {
    const m = montar();
    const criado = await m.svc.criarMonitor(1, { id_apartamento: 100, nome: 'Monitor da sala' }, ATOR);
    expect(criado).toMatchObject({ id_apartamento: 100, nome: 'Monitor da sala', unidade: 'Bloco A · Apto 106', conta: `mon${criado.id}`, porta: 5080 });
    expect(criado.senha).toMatch(/^[A-Za-z0-9]{24}$/);
    await expect(m.svc.monitores(1)).resolves.toEqual([criado]);
    await expect(m.svc.removerMonitor(1, criado.id, ATOR)).resolves.toEqual({ ok: true });
    await expect(m.svc.monitores(1)).resolves.toEqual([]);
    expect(m.auditoria.registrar).toHaveBeenCalledTimes(2);
  });

  it('unidade de outro condomínio ou nome vazio → 400; remover de outro condomínio → 404', async () => {
    const m = montar();
    await expect(m.svc.criarMonitor(1, { id_apartamento: 900, nome: 'X' }, ATOR)).rejects.toMatchObject({ status: 400 });
    await expect(m.svc.criarMonitor(1, { id_apartamento: 100, nome: ' ' }, ATOR)).rejects.toMatchObject({ status: 400 });
    m.tabelas['interfone_Monitores'].push({ id: 77, id_condominio: 2, id_apartamento: 900, nome: 'M', senha: 's', ativo: 1 });
    await expect(m.svc.removerMonitor(1, 77, ATOR)).rejects.toMatchObject({ status: 404 });
  });
});

describe('controller do síndico', () => {
  const SINDICO: any = { sub: 50, nome: 'Síndica Sara', id_condominio: 1, typeAccess: 'Sindico' };
  const PORTEIRO: any = { sub: 3, nome: 'Carlos', id_condominio: 1, tipo_sub: 'funcionario_portaria', turno: 'Síndico' };
  const MORADOR_APP: any = { sub: 7, nome: 'Ana', typeAccess: 'Morador' };

  it('porteiro (mesmo com turno "Síndico") e morador → 403; síndico passa com o condomínio do token', async () => {
    const svc: any = { config: jest.fn(async () => ({})) };
    const c = new InterfoneSindicoController(svc);
    expect(() => c.config(PORTEIRO)).toThrow();
    expect(() => c.config(MORADOR_APP)).toThrow();
    await c.config(SINDICO);
    expect(svc.config).toHaveBeenCalledWith(1);
  });

  it('POST faciais/:id/configurar: só síndico, condomínio do token, responde 200 com {ok, erro?}', async () => {
    const svc: any = { configurarFacialAutomatico: jest.fn(async () => ({ ok: true })) };
    const c = new InterfoneSindicoController(svc);
    expect(() => c.configurarFacial(12, {}, PORTEIRO)).toThrow();
    await expect(c.configurarFacial(12, {}, SINDICO)).resolves.toEqual({ ok: true });
    expect(svc.configurarFacialAutomatico).toHaveBeenCalledWith(1, 12, expect.objectContaining({ nome: 'Síndica Sara' }), { forcar: false });
    await c.configurarFacial(12, { forcar: true }, SINDICO);
    expect(svc.configurarFacialAutomatico).toHaveBeenLastCalledWith(1, 12, expect.anything(), { forcar: true });
    await c.configurarFacial(12, { forcar: 'sim' } as any, SINDICO);
    expect(svc.configurarFacialAutomatico).toHaveBeenLastCalledWith(1, 12, expect.anything(), { forcar: false });
    expect(Reflect.getMetadata('__httpCode__', (InterfoneSindicoController.prototype as any).configurarFacial)).toBe(200);
  });

  it('rotas que devolvem senha SIP respondem com Cache-Control: no-store', () => {
    for (const m of ['faciais', 'salvarFacial', 'novaSenha', 'monitores', 'criarMonitor'] as const) {
      const h = Reflect.getMetadata('__headers__', (InterfoneSindicoController.prototype as any)[m]) ?? [];
      expect(h).toContainEqual({ name: 'Cache-Control', value: 'no-store' });
    }
  });
});

describe('CRM: contratado', () => {
  it('só crm_admin (CrmAdminGuard no controller)', () => {
    expect(Reflect.getMetadata('__guards__', CrmInterfoneController)).toContain(CrmAdminGuard);
  });

  it('lista clientes e liga/desliga o contratado com auditoria', async () => {
    const m = montar();
    const c = new CrmInterfoneController(m.svc);
    const lista = await c.clientes();
    expect(lista).toEqual(expect.arrayContaining([{ id: 1, nome: 'Residencial Teste', contratado: true }]));
    await expect(c.contratado(1, false, { sub: 1, nome: 'Admin', role: 'crm_admin' } as any)).resolves.toEqual({ id: 1, contratado: false });
    expect(m.tabelas['condominios'][0].interfone_contratado).toBe(0);
    expect(m.auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ acao: 'INTERFONE_CONFIG', id_condominio: 1, autor_tipo: 'crm_admin', usuario_nome: 'Admin' }),
    );
    await expect(c.contratado(999, true, { sub: 1, role: 'crm_admin' } as any)).rejects.toMatchObject({ status: 404 });
    await expect(c.contratado(1, 'sim' as any, { sub: 1, role: 'crm_admin' } as any)).rejects.toMatchObject({ status: 400 });
  });
});
