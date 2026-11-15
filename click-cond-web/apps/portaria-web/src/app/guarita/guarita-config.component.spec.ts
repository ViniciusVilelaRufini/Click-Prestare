import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import {
  GuaritaConfigComponent,
  avisoRelogioGuarita,
  conexaoDoGuarita,
} from './guarita-config.component';
import { GuaritaService } from './guarita.service';
import { ConfirmService } from '../shared/confirm.service';

const device = { id: 7, nome: 'Guarita garagem', tipo: 'guarita', fabricante: 'linear', ip: '192.168.3.30', porta: 9000, ativo: 1 };

const estadoOk = {
  conectado: true,
  autorizado: true,
  firmware: 'G.003s',
  total_dispositivos: 312,
  relogio_delta_s: 4,
  ultima_comunicacao: '2026-11-15T12:00:00Z',
  pendentes: 0,
  falhas: 0,
  a_vincular: 3,
  aguardando_aprovacao: 0,
};

const portao = { id: 1, nome: 'Garagem entrada', tipo_receptor: 1, num_receptor: 1, botao: 1, rele: 1, sentido: 'entrada' };
const backup = { id: 11, motivo: 'importacao', total: 312, created_at: '2026-11-15T12:00:00Z' };

function build(extra: Record<string, unknown> = {}, confirma = true) {
  const api = {
    estado: jest.fn(() => of(estadoOk)),
    backups: jest.fn(() => of([backup])),
    portoes: jest.fn(() => of([portao])),
    importar: jest.fn(() => of({ id: 50, tipo: 'importar', estado: 'pendente' })),
    conferir: jest.fn(() => of({ id: 51, tipo: 'conferir', estado: 'pendente' })),
    operacao: jest.fn(() => of({ id: 50, tipo: 'importar', estado: 'ok' })),
    baixarBackup: jest.fn(() => of(new Blob(['[]']))),
    criarPortao: jest.fn((_d: number, dto: any) => of({ id: 2, ...dto })),
    atualizarPortao: jest.fn((_d: number, id: number, dto: any) => of({ id, ...dto })),
    removerPortao: jest.fn(() => of({ ok: true })),
    ...extra,
  };
  const confirm = { ask: jest.fn(() => Promise.resolve(confirma)) };
  TestBed.configureTestingModule({
    imports: [GuaritaConfigComponent],
    providers: [
      { provide: GuaritaService, useValue: api },
      { provide: ConfirmService, useValue: confirm },
    ],
  });
  const f = TestBed.createComponent(GuaritaConfigComponent);
  f.componentRef.setInput('device', device);
  f.detectChanges();
  return { f, tela: f.componentInstance, api, confirm, el: f.nativeElement as HTMLElement };
}

function botao(raiz: Element, texto: string) {
  return Array.from(raiz.querySelectorAll('button')).find((b) => b.textContent?.trim() === texto) as
    | HTMLButtonElement
    | undefined;
}

afterEach(() => {
  jest.useRealTimers();
  TestBed.resetTestingModule();
});

describe('conexaoDoGuarita / avisoRelogioGuarita', () => {
  it('conectado, negado, sem resposta e aguardando o agente', () => {
    expect(conexaoDoGuarita({ conectado: true, autorizado: true })).toBe('conectado');
    expect(conexaoDoGuarita({ conectado: true, autorizado: false })).toBe('negado');
    expect(conexaoDoGuarita({ conectado: false, autorizado: false, erro: 'Palavra de autorização recusada pelo Guarita' })).toBe('negado');
    expect(conexaoDoGuarita({ conectado: false, autorizado: false, erro: 'ECONNREFUSED' })).toBe('sem_resposta');
    expect(conexaoDoGuarita({ conectado: false, ultima_comunicacao: '2026-11-15T12:00:00Z' })).toBe('sem_resposta');
    expect(conexaoDoGuarita({})).toBe('aguardando');
    expect(conexaoDoGuarita(null)).toBeNull();
  });

  it('relógio: avisa só acima de 120 s, nos dois sentidos', () => {
    expect(avisoRelogioGuarita(120)).toBeNull();
    expect(avisoRelogioGuarita(-120)).toBeNull();
    expect(avisoRelogioGuarita(null)).toBeNull();
    expect(avisoRelogioGuarita(121)).toContain('121 s');
    expect(avisoRelogioGuarita(-300)).toContain('300 s');
  });
});

describe('GuaritaConfigComponent — aviso e estado', () => {
  it('mostra o aviso fixo "Integração não validada em aparelho"', () => {
    const { el, tela } = build();
    expect(el.querySelector('[data-guarita-aviso]')?.textContent?.trim()).toBe('Integração não validada em aparelho');
    tela.ngOnDestroy();
  });

  it('conectado: selo, firmware, total e diferença de relógio sem aviso', () => {
    const { el, tela } = build();
    expect(el.querySelector('[data-guarita-conexao]')?.textContent?.trim()).toBe('Conectado');
    const estado = el.querySelector('[data-guarita-estado]')?.textContent ?? '';
    expect(estado).toContain('G.003s');
    expect(estado).toContain('312');
    expect(estado).toContain('4 s');
    expect(el.querySelector('[data-guarita-relogio]')).toBeNull();
    expect(el.textContent).toContain('3 a vincular');
    tela.ngOnDestroy();
  });

  it('negado: selo "Autorização negada" e o motivo que veio da API em alerta', () => {
    const { el, tela } = build({
      estado: jest.fn(() => of({ conectado: false, autorizado: false, erro: 'Palavra de autorização recusada pelo Guarita' })),
    });
    expect(el.querySelector('[data-guarita-conexao]')?.textContent?.trim()).toBe('Autorização negada');
    expect(el.querySelector('[data-guarita-negado]')?.textContent).toContain('Palavra de autorização recusada pelo Guarita');
    tela.ngOnDestroy();
  });

  it('erro com o Guarita conectado (receptores não atualizados) aparece, com "Tentar de novo"', () => {
    const { f, el, tela, api } = build({
      estado: jest.fn(() => of({ ...estadoOk, erro: 'Receptores não atualizados: o Guarita não respondeu.' })),
      atualizarReceptores: jest.fn(() => of({ ok: true })),
    });
    expect(el.querySelector('[data-guarita-conexao]')?.textContent?.trim()).toBe('Conectado');
    const erro = el.querySelector('[data-guarita-erro]') as HTMLElement;
    expect(erro.textContent).toContain('Receptores não atualizados: o Guarita não respondeu.');
    botao(erro, 'Tentar de novo')!.click();
    f.detectChanges();
    expect(api.atualizarReceptores).toHaveBeenCalledWith(7);
    expect(el.querySelector('[data-guarita-msg-receptores]')?.textContent).toContain('Pedido enviado ao agente');
    tela.ngOnDestroy();
  });

  it('"Tentar de novo": rota ausente (404) esconde o botão, sem erro; outro erro aparece como veio', () => {
    const { f, el, tela } = build({
      estado: jest.fn(() => of({ ...estadoOk, erro: 'Receptores não atualizados: falha.' })),
      atualizarReceptores: jest.fn(() => throwError(() => ({ status: 404 }))),
    });
    tela.tentarReceptoresDeNovo();
    f.detectChanges();
    expect(botao(el.querySelector('[data-guarita-erro]')!, 'Tentar de novo')).toBeUndefined();
    expect(el.querySelector('[data-guarita-msg-receptores]')).toBeNull();
    tela.ngOnDestroy();
    TestBed.resetTestingModule();
    const b = build({
      estado: jest.fn(() => of({ ...estadoOk, erro: 'Receptores não atualizados: falha.' })),
      atualizarReceptores: jest.fn(() => throwError(() => ({ status: 503, error: { message: 'O agente está desconectado.' } }))),
    });
    b.tela.tentarReceptoresDeNovo();
    b.f.detectChanges();
    expect(b.el.querySelector('[data-guarita-msg-receptores]')?.textContent?.trim()).toBe('O agente está desconectado.');
    b.tela.ngOnDestroy();
  });

  it('sem resposta: selo neutro', () => {
    const { el, tela } = build({ estado: jest.fn(() => of({ conectado: false, ultima_comunicacao: '2026-11-15T11:00:00Z' })) });
    expect(el.querySelector('[data-guarita-conexao]')?.textContent?.trim()).toBe('Sem resposta');
    tela.ngOnDestroy();
  });

  it('diferença de relógio acima de 120 s mostra o aviso', () => {
    const { el, tela } = build({ estado: jest.fn(() => of({ ...estadoOk, relogio_delta_s: -180 })) });
    expect(el.querySelector('[data-guarita-relogio]')?.textContent).toContain('180 s');
    tela.ngOnDestroy();
  });

  it('API sem a rota de estado (404): texto neutro, nenhum alerta vermelho', () => {
    const { el, tela } = build({ estado: jest.fn(() => throwError(() => ({ status: 404 }))) });
    expect(el.querySelector('[data-guarita-estado-indisponivel]')).not.toBeNull();
    expect(el.querySelector('[role="alert"]')).toBeNull();
    tela.ngOnDestroy();
  });

  it('reconsulta o estado a cada 15 s e para ao sair da tela', () => {
    jest.useFakeTimers();
    const { tela, api } = build();
    expect(api.estado).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(15_000);
    expect(api.estado).toHaveBeenCalledTimes(2);
    tela.ngOnDestroy();
    jest.advanceTimersByTime(60_000);
    expect(api.estado).toHaveBeenCalledTimes(2);
  });
});

describe('GuaritaConfigComponent — importar e conferir', () => {
  it('importar mostra o andamento até concluir e recarrega as cópias', () => {
    jest.useFakeTimers();
    const respostas = [
      { id: 50, tipo: 'importar', estado: 'enviada' },
      { id: 50, tipo: 'importar', estado: 'ok' },
    ];
    const { f, el, tela, api } = build({ operacao: jest.fn(() => of(respostas.shift())) });
    botao(el, 'Importar cadastro')!.click();
    f.detectChanges();
    expect(api.importar).toHaveBeenCalledWith(7);
    expect(el.querySelector('[data-guarita-andamento]')?.textContent).toContain('aguardando o agente');
    expect(botao(el, 'Importar cadastro')!.disabled).toBe(true);
    expect(botao(el, 'Conferir agora')!.disabled).toBe(true);

    jest.advanceTimersByTime(3_000);
    f.detectChanges();
    expect(api.operacao).toHaveBeenCalledWith(7, 50);
    expect(el.querySelector('[data-guarita-andamento]')?.textContent).toContain('lendo o Guarita');

    jest.advanceTimersByTime(3_000);
    f.detectChanges();
    expect(el.querySelector('[data-guarita-andamento]')?.textContent).toContain('Importação concluída.');
    expect(api.backups).toHaveBeenCalledTimes(2);
    expect(botao(el, 'Importar cadastro')!.disabled).toBe(false);
    tela.ngOnDestroy();
  });

  it('dois cliques seguidos = um pedido só', () => {
    const { el, tela, api } = build({ operacao: jest.fn(() => of({ id: 50, tipo: 'importar', estado: 'enviada' })) });
    tela.importar();
    tela.importar();
    tela.conferir();
    expect(api.importar).toHaveBeenCalledTimes(1);
    expect(api.conferir).not.toHaveBeenCalled();
    void el;
    tela.ngOnDestroy();
  });

  it('erro da API (ex.: 409) aparece como veio, em alerta, e libera os botões', () => {
    const { f, el, tela } = build({
      importar: jest.fn(() => throwError(() => ({ status: 409, error: { message: 'Já existe uma importação em andamento.' } }))),
    });
    tela.importar();
    f.detectChanges();
    const msg = el.querySelector('[data-guarita-andamento]');
    expect(msg?.getAttribute('role')).toBe('alert');
    expect(msg?.textContent?.trim()).toBe('Já existe uma importação em andamento.');
    expect(botao(el, 'Importar cadastro')!.disabled).toBe(false);
    tela.ngOnDestroy();
  });

  it('operação que falhou mostra o motivo da API', () => {
    const { f, el, tela } = build({
      importar: jest.fn(() => of({ id: 50, tipo: 'importar', estado: 'falhou', erro: 'O Guarita não respondeu.' })),
    });
    tela.importar();
    f.detectChanges();
    const msg = el.querySelector('[data-guarita-andamento]');
    expect(msg?.getAttribute('role')).toBe('alert');
    expect(msg?.textContent).toContain('A importação falhou: O Guarita não respondeu.');
    tela.ngOnDestroy();
  });

  it('conferência concluída mostra o resumo das diferenças', () => {
    const { f, el, tela, api } = build({
      conferir: jest.fn(() => of({ id: 51, tipo: 'conferir', estado: 'ok', resumo: { so_no_guarita: 2, so_no_prestare: 1, divergente: 4 } })),
    });
    tela.conferir();
    f.detectChanges();
    expect(api.conferir).toHaveBeenCalledWith(7);
    const texto = el.querySelector('[data-guarita-andamento]')?.textContent ?? '';
    expect(texto).toContain('2 só no Guarita');
    expect(texto).toContain('1 só no Prestare');
    expect(texto).toContain('4 com dados diferentes');
    tela.ngOnDestroy();
  });

  it('API sem a rota de andamento (404): para de perguntar, sem erro vermelho', () => {
    jest.useFakeTimers();
    const { f, el, tela, api } = build({ operacao: jest.fn(() => throwError(() => ({ status: 404 }))) });
    tela.importar();
    jest.advanceTimersByTime(3_000);
    f.detectChanges();
    expect(el.querySelector('[data-guarita-andamento]')?.getAttribute('role')).toBe('status');
    expect(el.querySelector('[data-guarita-andamento]')?.textContent).toContain('Pedido enviado ao agente');
    jest.advanceTimersByTime(30_000);
    expect(api.operacao).toHaveBeenCalledTimes(1);
    tela.ngOnDestroy();
  });
});

describe('GuaritaConfigComponent — cópias de segurança', () => {
  it('lista as cópias e baixa o JSON', () => {
    const criar = jest.fn(() => 'blob:copia');
    const revogar = jest.fn();
    Object.assign(URL, { createObjectURL: criar, revokeObjectURL: revogar });
    const clique = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const { el, tela, api } = build();
    const linha = el.querySelector('[data-guarita-backup]') as HTMLElement;
    expect(linha.textContent).toContain('Importação');
    expect(linha.textContent).toContain('312 dispositivo(s)');
    botao(linha, 'Baixar')!.click();
    expect(api.baixarBackup).toHaveBeenCalledWith(7, 11);
    expect(criar).toHaveBeenCalled();
    expect(clique).toHaveBeenCalled();
    expect(revogar).toHaveBeenCalledWith('blob:copia');
    clique.mockRestore();
    tela.ngOnDestroy();
  });

  it('rótulos dos motivos que a API manda; motivo desconhecido tem rótulo genérico', () => {
    const { tela } = build();
    expect(tela.rotuloMotivo('importacao')).toBe('Importação');
    expect(tela.rotuloMotivo('conferencia')).toBe('Conferência');
    expect(tela.rotuloMotivo('remocao')).toBe('Remoção de dispositivo');
    expect(tela.rotuloMotivo('outra_coisa')).toBe('Cópia de segurança');
    tela.ngOnDestroy();
  });

  it('sem cópia ainda: explica quando a primeira é feita', () => {
    const { el, tela } = build({ backups: jest.fn(() => of([])) });
    expect(el.textContent).toContain('Nenhuma cópia ainda');
    tela.ngOnDestroy();
  });
});

describe('GuaritaConfigComponent — portões', () => {
  it('lista o portão com receptor, botão, relé e sentido', () => {
    const { el, tela } = build();
    const linha = el.querySelector('[data-guarita-portao]')?.textContent ?? '';
    expect(linha).toContain('Garagem entrada');
    expect(linha).toContain('RF CAN 1');
    expect(linha).toContain('relé 1');
    expect(linha).toContain('Entrada');
    tela.ngOnDestroy();
  });

  it('novo portão: exige nome e grava receptor, botão, relé e sentido', () => {
    const { f, el, tela, api } = build();
    botao(el, 'Novo portão')!.click();
    f.detectChanges();
    expect(el.querySelector('[data-guarita-form-portao]')).not.toBeNull();
    tela.salvarPortao();
    f.detectChanges();
    expect(api.criarPortao).not.toHaveBeenCalled();
    expect(el.querySelector('[data-guarita-form-portao] [role="alert"]')?.textContent).toContain('nome');
    Object.assign(tela.formPortao, { nome: ' Garagem saída ', tipo_receptor: 2, num_receptor: 3, botao: 2, rele: 4, sentido: 'saida' });
    tela.salvarPortao();
    expect(api.criarPortao).toHaveBeenCalledWith(7, {
      nome: 'Garagem saída', tipo_receptor: 2, num_receptor: 3, botao: 2, rele: 4, sentido: 'saida',
    });
    expect(tela.editandoPortao()).toBeNull();
    expect(api.portoes).toHaveBeenCalledTimes(2);
    tela.ngOnDestroy();
  });

  it('editar portão manda o id e o portão inteiro', () => {
    const { tela, api } = build();
    tela.editarPortao(portao);
    tela.formPortao.rele = null;
    tela.salvarPortao();
    expect(api.atualizarPortao).toHaveBeenCalledWith(7, 1, {
      nome: 'Garagem entrada', tipo_receptor: 1, num_receptor: 1, botao: 1, rele: null, sentido: 'entrada',
    });
    tela.ngOnDestroy();
  });

  it('erro da API ao salvar aparece no formulário como veio', () => {
    const { f, el, tela } = build({
      criarPortao: jest.fn(() => throwError(() => ({ error: { message: 'Já existe um portão neste receptor e relé.' } }))),
    });
    tela.novoPortao();
    tela.formPortao.nome = 'Garagem';
    tela.salvarPortao();
    f.detectChanges();
    expect(el.querySelector('[data-guarita-form-portao] [role="alert"]')?.textContent?.trim()).toBe('Já existe um portão neste receptor e relé.');
    tela.ngOnDestroy();
  });

  it('remover pede confirmação; cancelar não chama a API', async () => {
    const { tela, api, confirm } = build({}, false);
    await tela.removerPortao(portao);
    expect(confirm.ask).toHaveBeenCalled();
    expect(api.removerPortao).not.toHaveBeenCalled();
    tela.ngOnDestroy();
  });

  it('remover confirmado chama a API e recarrega', async () => {
    const { tela, api } = build();
    await tela.removerPortao(portao);
    expect(api.removerPortao).toHaveBeenCalledWith(7, 1);
    expect(api.portoes).toHaveBeenCalledTimes(2);
    tela.ngOnDestroy();
  });
});
