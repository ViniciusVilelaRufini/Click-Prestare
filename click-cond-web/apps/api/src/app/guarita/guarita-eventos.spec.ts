import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { criarBancoFalso } from './guarita-banco-falso.testutil';
import { GuaritaEventosService } from './guarita-eventos.service';
import { GuaritaAgenteService } from './guarita-agente.service';
import { GuaritaController } from './guarita.controller';
import { GuaritaImportacaoService } from './guarita-importacao.service';
import { GuaritaOperacoesService } from './guarita-operacoes.service';
import { FacialService } from '../facial/facial.service';
import { FacialDeviceClientService } from '../facial/facial-device-client.service';
import { AgentBridgeService } from '../facial/agent-bridge.service';

/**
 * Eventos do Guarita: deduplicação pelo índice único (mesmo lote duas vezes,
 * ao vivo + recuperação), data corrigida pela diferença do relógio, histórico
 * em Acessos_Facial e alertas para a portaria — e NUNCA abertura.
 */

const hex = (s: string) => s.replace(/\s+/g, '').toUpperCase();
const OPERADOR: any = { sub: 1, nome: 'Porteiro Zé', id_condominio: 7 };

/** Evento: tipo, serial (RF 7 dígitos), hora BCD, receptor, unidade, bloco, flags. */
function evt(o: { tipo?: number; rf?: string; hora?: string; receptor?: string; unid?: string; bloco?: string; f0?: string; f1?: string } = {}) {
  const tipo = o.tipo ?? 0;
  const rf = o.rf ?? '1A2B3C4';
  return hex(
    `${tipo.toString(16)}${rf[0]} ${rf.slice(1)} ${o.hora ?? '14 35 07 15 11 26'} ${o.receptor ?? '11'} ${o.unid ?? '03 08'} ${o.bloco ?? '01'} ${o.f0 ?? '10'} ${o.f1 ?? '00'}`,
  );
}

function montar() {
  const db = criarBancoFalso();
  db.semear('facial_Devices', [{ id: 10, id_condominio: 7, nome: 'Guarita Garagem', tipo: 'guarita', fabricante: 'linear', ativo: 1 }]);
  db.semear('moradores', [{ id: 50, id_condominio: 7, nome: 'Ana Souza', bloco: 'B', apartamento: '308', id_user: 500 }]);
  db.semear('tags', [
    { id: 1, id_condominio: 7, codigo: 'G1-1A2B3C4', id_device: 10, guarita_tipo: 1, guarita_serial: '1A2B3C4', guarita_estado: 'ativo' },
  ]);
  db.semear('veiculos', [{ id: 70, id_condominio: 7, id_morador: 50, placa: 'ABC1D23', id_tag: 1, ativo: 1 }]);
  const eventos = new GuaritaEventosService(db as any);
  const agente = new GuaritaAgenteService(db as any, {} as any, undefined, undefined, eventos);
  const ctrl = new GuaritaController(new GuaritaImportacaoService(db as any), new GuaritaOperacoesService(db as any), eventos);
  const device = { id: 10, id_condominio: 7, nome: 'Guarita Garagem' };
  return { db, eventos, agente, ctrl, device };
}

const lote = (frames: string[], delta = 0, origem = 'ao_vivo') => ({
  eventos: frames.map((frame_hex) => ({ frame_hex, origem, recebido_em: '2026-11-15T17:35:10Z' })),
  relogio_delta_s: delta,
});

describe('Guarita — eventos', () => {
  it('mesmo lote duas vezes → um registro só (e as duas instâncias juntas também)', async () => {
    const { db, agente, eventos, device } = montar();
    const outra = new GuaritaAgenteService(db as any, {} as any, undefined, undefined, new GuaritaEventosService(db as any));
    const l = lote([evt(), evt({ hora: '14 36 00 15 11 26' })]);
    await expect(agente.registrarEventos(device, l)).resolves.toMatchObject({ aceitos: 2 });
    await Promise.all([agente.registrarEventos(device, l), outra.registrarEventos(device, l)]);
    expect(db.linhas('guarita_Eventos')).toHaveLength(2);
    expect(db.linhas('acessos_Facial')).toHaveLength(2);
    expect(eventos).toBeDefined();
  });

  it('ao vivo + o mesmo na recuperação (bit "lido" ligado) → um registro', async () => {
    const { db, agente, device } = montar();
    await agente.registrarEventos(device, lote([evt({ f0: '10' })]));
    await agente.registrarEventos(device, lote([evt({ f0: '50' })], 0, 'recuperacao'));
    expect(db.linhas('guarita_Eventos')).toHaveLength(1);
    expect(db.linhas('guarita_Eventos')[0].origem).toBe('ao_vivo');
  });

  it('data em horário de Brasília corrigida pela diferença do relógio (Guarita − agente); delta 0 = sem correção', async () => {
    const { db, agente, device } = montar();
    await agente.registrarEventos(device, lote([evt()], 90));
    await agente.registrarEventos(device, lote([evt({ hora: '14 35 08 15 11 26' })], 0));
    const [a, b] = db.linhas('guarita_Eventos');
    // 14:35:07 BRT = 17:35:07 UTC; Guarita 90 s adiantado → 17:33:37 UTC.
    expect(a.ocorrido_em.toISOString()).toBe('2026-11-15T17:33:37.000Z');
    expect(b.ocorrido_em.toISOString()).toBe('2026-11-15T17:35:08.000Z');
    expect(db.linhas('acessos_Facial')[0].timestamp.toISOString()).toBe('2026-11-15T17:33:37.000Z');
  });

  it('acionado por tag conhecida → histórico com o morador, o portão e o código G<tipo>-<serial>', async () => {
    const { db, agente, device } = montar();
    // Portão no CAN 2 (num_receptor 2, como no console); o nibble do evento é 0x1 (0..7).
    db.semear('guarita_Portoes', [{ id: 1, id_condominio: 7, id_device: 10, nome: 'Garagem entrada', tipo_receptor: 1, num_receptor: 2, botao: 2, rele: 1, sentido: 'entrada' }]);
    await agente.registrarEventos(device, lote([evt({ receptor: '11', f0: '10' })]));
    expect(db.linhas('acessos_Facial')[0]).toMatchObject({
      id_condominio: 7,
      id_device: 10,
      tipo_dispositivo: 'guarita',
      nome_dispositivo: 'Garagem entrada',
      face_id: 'G1-1A2B3C4',
      tipo_pessoa: 'morador',
      id_pessoa: 50,
      nome_pessoa: 'Ana Souza',
      evento: 'entrada',
    });
    expect(db.linhas('guarita_Eventos')[0].id_acesso).toBe(db.linhas('acessos_Facial')[0].id);
  });

  it('nibble 0x2 do evento casa com o portão de num_receptor 3 (CAN 3)', async () => {
    const { db, agente, device } = montar();
    db.semear('guarita_Portoes', [
      { id: 1, id_condominio: 7, id_device: 10, nome: 'Portão CAN 2', tipo_receptor: 1, num_receptor: 2, botao: null, rele: 1, sentido: null },
      { id: 2, id_condominio: 7, id_device: 10, nome: 'Portão CAN 3', tipo_receptor: 1, num_receptor: 3, botao: null, rele: 1, sentido: 'saida' },
    ]);
    await agente.registrarEventos(device, lote([evt({ receptor: '12' })]));
    expect(db.linhas('acessos_Facial')[0]).toMatchObject({ nome_dispositivo: 'Portão CAN 3', evento: 'saida' });
  });

  it('tag desconhecida entra como não identificado; sem portão o nome é "<Guarita> · RF <n>"', async () => {
    const { db, agente, device } = montar();
    await agente.registrarEventos(device, lote([evt({ rf: '0000009', receptor: '13', unid: '09 17', bloco: '00' })]));
    expect(db.linhas('acessos_Facial')[0]).toMatchObject({
      tipo_pessoa: 'desconhecido',
      id_pessoa: null,
      nome_pessoa: 'Não identificado · unidade 923 bloco A',
      face_id: 'G1-0000009',
      nome_dispositivo: 'Guarita Garagem · RF 4',
    });
  });

  it('fora do horário (flags1 0xAA) → negado; passagem com sentido S → saida', async () => {
    const { db, agente, device } = montar();
    await agente.registrarEventos(device, lote([evt({ f1: 'AA' }), evt({ tipo: 1, hora: '14 40 00 15 11 26', f0: '01', f1: '20' })]));
    expect(db.linhas('acessos_Facial').map((a: any) => a.evento)).toEqual(['negado', 'saida']);
  });

  it('pânico cria alerta "panico"; porta violada, clonagem e bateria fraca também (bateria: um por tag a cada 7 dias)', async () => {
    const { db, agente, device } = montar();
    await agente.registrarEventos(
      device,
      lote([
        evt({ tipo: 9, f0: '00' }),
        evt({ tipo: 0xc, hora: '14 41 00 15 11 26', f1: 'F9' }),
        evt({ tipo: 8, hora: '14 42 00 15 11 26' }),
        evt({ hora: '14 43 00 15 11 26', f0: '80' }), // bateria fraca
        evt({ hora: '14 44 00 15 11 26', f0: '80' }), // bateria de novo: sem 2º alerta
      ]),
    );
    expect(db.linhas('guarita_Alertas').map((a: any) => a.tipo)).toEqual(['panico', 'porta_violada', 'clonagem', 'bateria_fraca']);
    expect(db.linhas('guarita_Alertas')[0].descricao).toMatch(/Pânico/);
  });

  it('tipo 4 (cadastro pelo PC) e tipo 6 (acionamento pelo PC) ficam só no evento bruto', async () => {
    const { db, agente, device } = montar();
    await agente.registrarEventos(device, lote([evt({ tipo: 4, f1: '60' }), evt({ tipo: 6, hora: '14 50 00 15 11 26' })]));
    expect(db.linhas('guarita_Eventos')).toHaveLength(2);
    expect(db.linhas('acessos_Facial')).toHaveLength(0);
    expect(db.linhas('guarita_Alertas')).toHaveLength(0);
  });

  it('data BCD inválida grava o evento bruto sem histórico e não derruba o lote; frame torto é ignorado', async () => {
    const { db, agente, device } = montar();
    const r = await agente.registrarEventos(device, lote([evt({ hora: '25 61 07 32 13 26' }), 'XYZ', evt({ hora: '14 55 00 15 11 26' })]));
    expect(r.aceitos).toBe(2);
    expect(db.linhas('guarita_Eventos')).toHaveLength(2);
    expect(db.linhas('guarita_Eventos')[0].ocorrido_em).toBeNull();
    expect(db.linhas('acessos_Facial')).toHaveLength(1);
  });

  it('NUNCA aciona abertura: runWebhook, processAgentEvent, triggerRelay e a ponte não são chamados', async () => {
    const espioes = [
      jest.spyOn(FacialService.prototype as any, 'runWebhook'),
      jest.spyOn(FacialService.prototype, 'processAgentEvent'),
      jest.spyOn(FacialService.prototype, 'processWebhook'),
      jest.spyOn(FacialDeviceClientService.prototype, 'triggerRelay'),
      jest.spyOn(AgentBridgeService.prototype, 'enqueue'),
    ];
    const { agente, device } = montar();
    await agente.registrarEventos(device, lote([evt(), evt({ tipo: 1, hora: '14 40 00 15 11 26', f0: '00' }), evt({ tipo: 9, hora: '14 41 00 15 11 26' })]));
    for (const e of espioes) {
      expect(e).not.toHaveBeenCalled();
      e.mockRestore();
    }
  });
});

describe('Guarita — alertas no console', () => {
  it('lista os pendentes do condomínio e marca como visto (com quem viu)', async () => {
    const { db, agente, ctrl, device } = montar();
    await agente.registrarEventos(device, lote([evt({ tipo: 9 }), evt({ tipo: 8, hora: '14 42 00 15 11 26' })]));
    db.semear('guarita_Alertas', [{ id_condominio: 8, id_device: 99, tipo: 'panico', descricao: 'outro prédio' }]);
    const pendentes: any[] = await ctrl.alertas(7, '1', OPERADOR);
    expect(pendentes.map((a) => a.tipo).sort()).toEqual(['clonagem', 'panico']);
    expect(pendentes[0]).toEqual(expect.objectContaining({ id: expect.any(Number), id_device: 10, descricao: expect.any(String), visto_em: null }));
    await expect(ctrl.marcarVisto(7, pendentes[0].id, OPERADOR)).resolves.toEqual({ ok: true });
    expect((await ctrl.alertas(7, '1', OPERADOR)).length).toBe(1);
    expect((await ctrl.alertas(7, undefined, OPERADOR)).length).toBe(2);
    expect(db.linhas('guarita_Alertas').find((a: any) => a.id === pendentes[0].id).visto_por).toBe('Porteiro Zé');
    await expect(ctrl.marcarVisto(7, 3, OPERADOR)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('morador → 403', async () => {
    const { ctrl } = montar();
    await expect(ctrl.alertas(7, '1', { sub: 9, nome: 'M', typeAccess: 'Morador' } as any)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
