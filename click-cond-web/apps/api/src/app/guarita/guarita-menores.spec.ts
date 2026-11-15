import { BadRequestException, Logger } from '@nestjs/common';
import { criarBancoFalso } from './guarita-banco-falso.testutil';
import { GuaritaEventosService } from './guarita-eventos.service';
import { GuaritaOperacoesService } from './guarita-operacoes.service';
import { TagsService } from '../veiculos/tags.service';
import { FacialService } from '../facial/facial.service';

/** Menores da revisão da raia B. */

const DEV = { id: 10, id_condominio: 7, nome: 'Guarita' };
const hex = (s: string) => s.replace(/\s+/g, '').toUpperCase();
const evt = (seg: string) => hex(`01 A2 B3 C4 14 35 ${seg} 15 11 26 11 03 08 01 10 00`);
const lote = (frames: string[]) => ({ eventos: frames.map((frame_hex) => ({ frame_hex, origem: 'ao_vivo', recebido_em: 'x' })), relogio_delta_s: 0 });

describe('Eventos em lote', () => {
  function montar() {
    const db = criarBancoFalso();
    db.semear('facial_Devices', [{ id: 10, id_condominio: 7, nome: 'Guarita', tipo: 'guarita', ativo: 1 }]);
    return { db, svc: new GuaritaEventosService(db as any) };
  }

  it('um INSERT em lote (createMany) e os já registrados nem viram INSERT', async () => {
    const { db, svc } = montar();
    const createMany = jest.spyOn(db.guarita_Eventos, 'createMany');
    const create = jest.spyOn(db.guarita_Eventos, 'create');
    await svc.registrarEventos(DEV, lote([evt('01'), evt('02'), evt('03')]));
    await svc.registrarEventos(DEV, lote([evt('01'), evt('02'), evt('03'), evt('04')]));
    expect(create).not.toHaveBeenCalled();
    expect(createMany).toHaveBeenCalledTimes(2);
    expect((createMany.mock.calls[1][0] as any).data).toHaveLength(1);
    expect(db.linhas('guarita_Eventos')).toHaveLength(4);
    expect(db.linhas('acessos_Facial')).toHaveLength(4);
  });

  it('falha no meio do histórico: o reenvio refaz (o acesso não se perde)', async () => {
    const { db, svc } = montar();
    const original = db.acessos_Facial.create;
    db.acessos_Facial.create = jest.fn(async () => {
      throw new Error('banco caiu');
    });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await svc.registrarEventos(DEV, lote([evt('01')]));
    expect(db.linhas('acessos_Facial')).toHaveLength(0);
    expect(db.linhas('guarita_Eventos')[0].id_acesso).toBeNull();
    db.acessos_Facial.create = original;
    await svc.registrarEventos(DEV, lote([evt('01')]));
    expect(db.linhas('acessos_Facial')).toHaveLength(1);
    expect(db.linhas('guarita_Eventos')[0].id_acesso).toBe(db.linhas('acessos_Facial')[0].id);
    await svc.registrarEventos(DEV, lote([evt('01')]));
    expect(db.linhas('acessos_Facial')).toHaveLength(1);
  });
});

describe('ativo só pelo 29 enfileirado DEPOIS da gravação', () => {
  it('um 29 mais antigo que a gravação não promove a tag', async () => {
    const db = criarBancoFalso();
    db.semear('tags', [{ id: 1, id_condominio: 7, codigo: 'G2-000001', id_device: 10, guarita_tipo: 2, guarita_serial: '000001', guarita_estado: 'gravado' }]);
    db.semear('guarita_Operacoes', [
      { id: 5, id_condominio: 7, id_device: 10, tipo: 'atualizar_receptores', estado: 'enviada' },
      { id: 6, id_condominio: 7, id_device: 10, id_tag: 1, tipo: 'cadastrar', estado: 'ok' },
      { id: 7, id_condominio: 7, id_device: 10, tipo: 'atualizar_receptores', estado: 'enviada' },
    ]);
    const ops = new GuaritaOperacoesService(db as any);
    await ops.aplicarResultado(5, { ok: true });
    expect(db.linhas('tags')[0].guarita_estado).toBe('gravado');
    await ops.aplicarResultado(7, { ok: true });
    expect(db.linhas('tags')[0].guarita_estado).toBe('ativo');
  });
});

describe('tag do Guarita saindo, em conflito ou ausente não é "livre"', () => {
  it('GET tags?livres=true esconde removendo/conflito/ausente e mantém as tags comuns', async () => {
    const db = criarBancoFalso();
    db.semear('tags', [
      { id: 1, id_condominio: 7, codigo: 'COMUM', ativo: 1 },
      { id: 2, id_condominio: 7, codigo: 'G2-1', ativo: 1, id_device: 10, guarita_estado: 'removendo' },
      { id: 3, id_condominio: 7, codigo: 'G2-2', ativo: 1, id_device: 10, guarita_estado: 'a_vincular' },
    ]);
    const svc = new TagsService(db as any);
    const findMany = db.tags.findMany;
    // O banco falso não entende `veiculos: { none }`: tira esse filtro e aplica o resto.
    db.tags.findMany = async (a: any) => {
      const { veiculos: _v, ...where } = a.where;
      return findMany({ ...a, where });
    };
    const livres = await svc.findAll(7, true);
    expect(livres.map((t: any) => t.id).sort()).toEqual([1, 3]);
  });
});

describe('palavra de autorização ao virar Guarita', () => {
  it('trocar o tipo para guarita com uma senha herdada inválida → 400; válida passa', async () => {
    const db = criarBancoFalso();
    const svc: any = Object.create(FacialService.prototype);
    svc.prisma = db;
    svc.logger = new Logger('teste');
    svc.auditoria = { registrar: jest.fn(async () => undefined) };
    svc.agent = { isOnline: () => false };
    db.semear('facial_Devices', [
      { id: 1, id_condominio: 7, nome: 'Relé', tipo: 'botoeira', fabricante: 'genérico', ip: '10.0.0.1', porta: 80, api_password: 'senha com acentuação é ruim', webhook_token: 'a', ativo: 1 },
      { id: 2, id_condominio: 8, nome: 'Relé 2', tipo: 'botoeira', fabricante: 'genérico', ip: '10.0.0.2', porta: 80, api_password: 'Boa123', webhook_token: 'b', ativo: 1 },
    ]);
    await expect(svc.updateDevice(1, { tipo: 'guarita', fabricante: 'linear' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.updateDevice(2, { tipo: 'guarita', fabricante: 'linear' })).resolves.toMatchObject({ tipo: 'guarita' });
  });
});
