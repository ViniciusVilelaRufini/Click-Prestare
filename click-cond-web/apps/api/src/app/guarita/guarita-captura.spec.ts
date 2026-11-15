import { BadRequestException, NotFoundException } from '@nestjs/common';
import { montarConsole } from './guarita-console.testutil';
import { GuaritaAgenteService } from './guarita-agente.service';
import { GuaritaCapturaService } from './guarita-captura.service';
import { GuaritaOperacoesService } from './guarita-operacoes.service';

/**
 * Cadastro por aproximação (janela de 60 s gravada no banco, vista pelas duas
 * instâncias) e cadastro digitado pelo código impresso.
 */

const OPERADOR: any = { sub: 1, nome: 'Porteiro Zé', id_condominio: 7 };
const DEV = { id: 10, id_condominio: 7, nome: 'Guarita' };

function montar() {
  const m = montarConsole(jest.fn);
  m.db.semear('guarita_Backups', [{ id_condominio: 7, id_device: 10, motivo: 'importacao', total: 0, dados: '[]' }]);
  m.db.semear('moradores', [{ id: 50, id_condominio: 7, nome: 'Ana Souza', bloco: 'B', apartamento: '308', id_user: 500 }]);
  m.db.semear('veiculos', [
    { id: 70, id_condominio: 7, id_morador: 50, placa: 'ABC1D23', cor: 'Prata', marca_modelo: 'Fiat Uno', id_tag: null, ativo: 1 },
    { id: 80, id_condominio: 8, id_morador: 1, placa: 'OUT0000', id_tag: null, ativo: 1 },
  ]);
  return m;
}

const naoCad = (o: Record<string, unknown>) => ({ contador: null, receptor: null, bateria_fraca: false, recebido_em: '2026-11-15T12:00:00Z', ...o });

describe('Guarita — captura', () => {
  it('só lista o que chegou DEPOIS de aberta e deste Guarita', async () => {
    const { ctrl, agente, db } = montar();
    await agente.registrarNaoCadastrado(DEV, naoCad({ comando: 42, tipo: 2, serial_hex: '000001' }));
    // Outro Guarita do condomínio recebeu um também.
    db.semear('facial_Devices', [{ id: 11, id_condominio: 7, nome: 'Guarita 2', tipo: 'guarita', fabricante: 'linear', ativo: 1 }]);
    await new Promise((r) => setTimeout(r, 5));
    await ctrl.abrirCaptura(7, 10, { id_veiculo: 70 }, OPERADOR);
    await new Promise((r) => setTimeout(r, 5));
    await agente.registrarNaoCadastrado(DEV, naoCad({ comando: 42, tipo: 1, serial_hex: '1A2B3C4', contador: 513 }));
    await agente.registrarNaoCadastrado({ id: 11, id_condominio: 7, nome: 'G2' }, naoCad({ comando: 42, tipo: 2, serial_hex: '000009' }));
    await agente.registrarNaoCadastrado(DEV, naoCad({ comando: 46, tipo: 3, serial_hex: '0F086E', receptor: 2 }));

    const lista: any[] = await ctrl.listarCaptura(7, 10, OPERADOR);
    expect(lista.map((c) => c.serial_hex).sort()).toEqual(['0F086E', '1A2B3C4']);
    expect(lista.find((c) => c.serial_hex === '1A2B3C4')).toMatchObject({ tipo: 1, tem_contador: true, recebido_em: expect.any(String) });
  });

  it('duas instâncias enxergam a mesma janela (ela mora no banco)', async () => {
    const { ctrl, db, operacoes } = montar();
    await ctrl.abrirCaptura(7, 10, { id_veiculo: 70 }, OPERADOR);
    const outraAgente = new GuaritaAgenteService(db as any, {} as any);
    const outraCaptura = new GuaritaCapturaService(db as any, outraAgente, operacoes);
    await new Promise((r) => setTimeout(r, 5));
    await outraAgente.registrarNaoCadastrado(DEV, naoCad({ comando: 42, tipo: 2, serial_hex: '000002' }));
    const vistoPelaOutra = await outraCaptura.listar(7, 10);
    expect(vistoPelaOutra.map((c: any) => c.serial_hex)).toEqual(['000002']);
    expect(await ctrl.listarCaptura(7, 10, OPERADOR)).toEqual(vistoPelaOutra);
  });

  it('segunda captura com uma janela de 60 s aberta: 409; depois dela, a nova substitui; a janela nunca vai para o agente', async () => {
    const { ctrl, db, agente } = montar();
    await ctrl.abrirCaptura(7, 10, { id_veiculo: 70 }, OPERADOR);
    await expect(ctrl.abrirCaptura(7, 10, { id_veiculo: 70 }, OPERADOR)).rejects.toThrow(
      'Já existe um cadastro por captura em andamento neste Guarita.',
    );
    db.linhas('guarita_Operacoes')[0].created_at = new Date(Date.now() - 61_000);
    await ctrl.abrirCaptura(7, 10, { id_veiculo: 70 }, OPERADOR);
    const janelas = db.linhas('guarita_Operacoes').filter((o: any) => o.tipo === 'captura');
    expect(janelas.map((j: any) => j.estado)).toEqual(['cancelada', 'pendente']);
    expect((await agente.buscarOperacoes(DEV)).operacoes).toEqual([]);
  });

  it('veículo com tag aguardando aprovação/recusada/conflito: a captura confirmada troca a tag (a antiga é desfeita no Prestare)', async () => {
    const { ctrl, agente, db } = montar();
    db.semear('tags', [{ id: 5, id_condominio: 7, codigo: '985198', tipo: 'rfid', id_device: 10, guarita_estado: 'aguardando_aprovacao', guarita_serial: '0F086E' }]);
    db.linhas('veiculos')[0].id_tag = 5;
    await ctrl.abrirCaptura(7, 10, { id_veiculo: 70 }, OPERADOR);
    await new Promise((r) => setTimeout(r, 5));
    await agente.registrarNaoCadastrado(DEV, naoCad({ comando: 42, tipo: 2, serial_hex: '000007' }));
    await ctrl.confirmarCaptura(7, 10, { tipo: 2, serial_hex: '000007', id_veiculo: 70 }, OPERADOR);
    const antiga = db.linhas('tags').find((t: any) => t.id === 5);
    expect(antiga).toMatchObject({ id_device: null, guarita_estado: null });
    const novaId = db.linhas('veiculos')[0].id_tag;
    expect(db.linhas('tags').find((t: any) => t.id === novaId)).toMatchObject({ codigo: 'G2-000007', guarita_estado: 'pendente' });
    expect(db.linhas('guarita_Operacoes').filter((o: any) => o.tipo === 'apagar')).toHaveLength(0);
  });

  it('confirmar cria a tag, vincula ao veículo e enfileira o cadastro', async () => {
    const { ctrl, agente, db } = montar();
    await ctrl.abrirCaptura(7, 10, { id_veiculo: 70 }, OPERADOR);
    await new Promise((r) => setTimeout(r, 5));
    await agente.registrarNaoCadastrado(DEV, naoCad({ comando: 90, tipo: 1, serial_hex: '1A2B3C4', contador: 513, receptor: 1 }));
    const r: any = await ctrl.confirmarCaptura(7, 10, { tipo: 1, serial_hex: '1A2B3C4', id_veiculo: 70 }, OPERADOR);
    expect(r).toMatchObject({ id_tag: expect.any(Number), estado: 'pendente', id_operacao: expect.any(Number) });
    const tag = db.linhas('tags')[0];
    expect(tag).toMatchObject({ codigo: 'G1-1A2B3C4', tipo: 'rf', id_device: 10, guarita_tipo: 1, guarita_serial: '1A2B3C4', guarita_contador: 513, guarita_estado: 'pendente' });
    expect(db.linhas('veiculos').find((v: any) => v.id === 70).id_tag).toBe(tag.id);
    const cad = db.linhas('guarita_Operacoes').find((o: any) => o.tipo === 'cadastrar');
    expect(cad.frame_hex.slice(0, 12)).toBe('11A2B3C40201');
    // Capturado já usado: não confirma de novo.
    await expect(ctrl.confirmarCaptura(7, 10, { tipo: 1, serial_hex: '1A2B3C4' }, OPERADOR)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('RF que chegou sem contador (46) → 400; serial que não chegou na janela → 400', async () => {
    const { ctrl, agente, db } = montar();
    await ctrl.abrirCaptura(7, 10, { id_veiculo: 70 }, OPERADOR);
    await new Promise((r) => setTimeout(r, 5));
    await agente.registrarNaoCadastrado(DEV, naoCad({ comando: 46, tipo: 1, serial_hex: '1A2B3C4', receptor: 2 }));
    const lista: any[] = await ctrl.listarCaptura(7, 10, OPERADOR);
    expect(lista[0].tem_contador).toBe(false);
    await expect(ctrl.confirmarCaptura(7, 10, { tipo: 1, serial_hex: '1A2B3C4' }, OPERADOR)).rejects.toThrow(
      'Controle remoto só pode ser cadastrado por captura no Guarita.',
    );
    await expect(ctrl.confirmarCaptura(7, 10, { tipo: 2, serial_hex: '00000F' }, OPERADOR)).rejects.toBeInstanceOf(BadRequestException);
    expect(db.linhas('tags')).toHaveLength(0);
  });

  it('veículo de outro condomínio → 404; veículo que já tem tag → 400', async () => {
    const { ctrl, db } = montar();
    await expect(ctrl.abrirCaptura(7, 10, { id_veiculo: 80 }, OPERADOR)).rejects.toBeInstanceOf(NotFoundException);
    db.semear('tags', [{ id: 99, id_condominio: 7, codigo: 'G2-000099', id_device: 10, guarita_tipo: 2, guarita_serial: '000099', guarita_estado: 'ativo' }]);
    db.linhas('veiculos')[0].id_tag = 99;
    await expect(ctrl.abrirCaptura(7, 10, { id_veiculo: 70 }, OPERADOR)).rejects.toThrow('Remova a tag atual deste veículo antes de cadastrar outra.');
  });
});

describe('Guarita — cadastro pelo código impresso', () => {
  it('W: 015 02158 → serial 0F086E, tag criada e cadastro enfileirado', async () => {
    const { ctrl, db } = montar();
    const r: any = await ctrl.cadastrarDigitado(7, 10, { id_veiculo: 70, tipo: 3, codigo_impresso: 'W: 015 02158' }, OPERADOR);
    expect(r.estado).toBe('pendente');
    expect(db.linhas('tags')[0]).toMatchObject({ codigo: 'G3-0F086E', tipo: 'cartao', guarita_serial: '0F086E' });
    expect(db.linhas('guarita_Operacoes').find((o: any) => o.tipo === 'cadastrar').frame_hex.slice(0, 8)).toBe('300F086E');
  });

  it('código inválido → 400 com a mensagem do formato; RF digitado → 400', async () => {
    const { ctrl, db } = montar();
    await expect(ctrl.cadastrarDigitado(7, 10, { id_veiculo: 70, tipo: 2, codigo_impresso: '12345' }, OPERADOR)).rejects.toThrow(
      'Código inválido. Use o formato impresso no cartão: 015 02158.',
    );
    await expect(ctrl.cadastrarDigitado(7, 10, { id_veiculo: 70, tipo: 1, codigo_impresso: '015 02158' }, OPERADOR)).rejects.toThrow(
      'Controle remoto só pode ser cadastrado por captura no Guarita.',
    );
    expect(db.linhas('tags')).toHaveLength(0);
  });

  it('mesmo dispositivo já no Guarita → 400, sem duplicar', async () => {
    const { ctrl, db, operacoes } = montar();
    db.semear('tags', [{ id_condominio: 7, codigo: 'G3-0F086E', id_device: 10, guarita_tipo: 3, guarita_serial: '0F086E', guarita_estado: 'a_vincular' }]);
    await expect(ctrl.cadastrarDigitado(7, 10, { id_veiculo: 70, tipo: 3, codigo_impresso: '015 02158' }, OPERADOR)).rejects.toThrow(/já está cadastrado/);
    expect(db.linhas('tags')).toHaveLength(1);
    expect(operacoes).toBeInstanceOf(GuaritaOperacoesService);
  });
});
