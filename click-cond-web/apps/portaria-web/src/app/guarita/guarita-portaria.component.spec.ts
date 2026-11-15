import { TestBed } from '@angular/core/testing';
import { NEVER, of, throwError } from 'rxjs';
import { GuaritaPortariaComponent } from './guarita-portaria.component';
import { GuaritaService, alertaEhPanico } from './guarita.service';
import { ConfirmService } from '../shared/confirm.service';

const guarita = { id: 7, nome: 'Guarita garagem', tipo: 'guarita', fabricante: 'linear', ip: '192.168.3.30', porta: 9000, ativo: 1 };
const entrada = { id: 1, nome: 'Garagem entrada', tipo_receptor: 1, num_receptor: 1, botao: 1, rele: 1, sentido: 'entrada' };
const saida = { id: 2, nome: 'Garagem saída', tipo_receptor: 1, num_receptor: 2, botao: 1, rele: 2, sentido: 'saida' };
const soHistorico = { id: 3, nome: 'Leitora pedestre', tipo_receptor: 3, num_receptor: 3, botao: null, rele: null, sentido: null };

const panico = { id: 90, id_device: 7, tipo: 'panico', descricao: 'Pânico acionado pelo controle da unidade 101 A', created_at: '2026-11-15T12:00:00Z', visto_em: null };
const porta = { id: 91, id_device: 7, tipo: 'porta_violada', descricao: 'Porta violada no receptor CT 3', created_at: '2026-11-15T12:01:00Z', visto_em: null };

function build(opts: { guaritas?: any[]; extra?: Record<string, unknown>; confirma?: boolean } = {}) {
  const api = {
    listarGuaritas: jest.fn(() => of(opts.guaritas ?? [guarita])),
    portoes: jest.fn(() => of([entrada, saida, soHistorico])),
    alertas: jest.fn(() => of([] as any[])),
    abrirPortao: jest.fn(() => of({ enviado: true })),
    marcarAlertaVisto: jest.fn(() => of({ ok: true })),
    ...opts.extra,
  };
  const confirm = { ask: jest.fn(() => Promise.resolve(opts.confirma ?? true)) };
  TestBed.configureTestingModule({
    imports: [GuaritaPortariaComponent],
    providers: [
      { provide: GuaritaService, useValue: api },
      { provide: ConfirmService, useValue: confirm },
    ],
  });
  const f = TestBed.createComponent(GuaritaPortariaComponent);
  f.detectChanges();
  return { f, tela: f.componentInstance, api, confirm, el: f.nativeElement as HTMLElement };
}

afterEach(() => TestBed.resetTestingModule());

describe('alertaEhPanico', () => {
  it('reconhece pelo tipo ou pela descrição, com ou sem acento', () => {
    expect(alertaEhPanico({ tipo: 'panico', descricao: '' })).toBe(true);
    expect(alertaEhPanico({ tipo: 'alerta', descricao: 'PÂNICO na garagem' })).toBe(true);
    expect(alertaEhPanico({ tipo: 'bateria_fraca', descricao: 'Bateria fraca' })).toBe(false);
  });
});

describe('GuaritaPortariaComponent — sem Guarita', () => {
  it('não desenha nada, fica oculto e não chama mais nada', () => {
    const { el, tela, api } = build({ guaritas: [] });
    expect(el.style.display).toBe('none');
    expect(el.children.length).toBe(0);
    tela.atualizarAlertas();
    expect(api.portoes).not.toHaveBeenCalled();
    expect(api.alertas).not.toHaveBeenCalled();
  });
});

describe('GuaritaPortariaComponent — portões', () => {
  it('um botão por portão com relé; portão só de histórico não tem botão', () => {
    const { el } = build();
    expect(el.style.display).toBe('block');
    const textos = Array.from(el.querySelectorAll('[data-guarita-abrir]')).map((b) => b.textContent?.trim());
    expect(textos).toEqual(['Abrir Garagem entrada', 'Abrir Garagem saída']);
    expect(el.textContent).toContain('Integração não validada em aparelho');
  });

  it('pede confirmação antes; cancelar não chama a API', async () => {
    const { tela, api, confirm } = build({ confirma: false });
    await tela.abrir(tela.portoes()[0]);
    expect(confirm.ask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Abrir portão' }));
    expect(api.abrirPortao).not.toHaveBeenCalled();
  });

  it('confirmado: uma chamada e a tela diz só que o comando foi enviado', async () => {
    const { f, el, tela, api } = build();
    await tela.abrir(tela.portoes()[0]);
    f.detectChanges();
    expect(api.abrirPortao).toHaveBeenCalledTimes(1);
    expect(api.abrirPortao).toHaveBeenCalledWith(7, 1);
    const msg = el.querySelector('[data-guarita-msg]');
    expect(msg?.getAttribute('role')).toBe('status');
    expect(msg?.textContent?.trim()).toBe('Comando de abertura enviado para "Garagem entrada".');
  });

  it('dois cliques (ou dois portões) enquanto abre = uma chamada só; botões travados', async () => {
    const { f, el, tela, api } = build({ extra: { abrirPortao: jest.fn(() => NEVER) } });
    const [a, b] = tela.portoes();
    await Promise.all([tela.abrir(a), tela.abrir(a), tela.abrir(b)]);
    f.detectChanges();
    expect(api.abrirPortao).toHaveBeenCalledTimes(1);
    const botoes = Array.from(el.querySelectorAll('[data-guarita-abrir]')) as HTMLButtonElement[];
    expect(botoes.every((x) => x.disabled)).toBe(true);
    expect(botoes[0].textContent).toContain('Abrindo');
  });

  it('erro da API (agente offline, Guarita desconectado) aparece como veio', async () => {
    const msg = 'O Guarita está desconectado do agente. Tente de novo quando ele voltar.';
    const { f, el, tela } = build({ extra: { abrirPortao: jest.fn(() => throwError(() => ({ status: 503, error: { message: msg } }))) } });
    await tela.abrir(tela.portoes()[0]);
    f.detectChanges();
    const m = el.querySelector('[data-guarita-msg]');
    expect(m?.getAttribute('role')).toBe('alert');
    expect(m?.textContent?.trim()).toBe(msg);
    // Liberado para tentar de novo.
    expect((el.querySelector('[data-guarita-abrir]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('403 na primeira tentativa: os botões somem e fica a mensagem da API', async () => {
    const msg = 'Abrir portão é só do síndico.';
    const { f, el, tela, api } = build({ extra: { abrirPortao: jest.fn(() => throwError(() => ({ status: 403, error: { message: msg } }))) } });
    await tela.abrir(tela.portoes()[0]);
    f.detectChanges();
    expect(el.querySelector('[data-guarita-abrir]')).toBeNull();
    expect(el.querySelector('[data-guarita-sem-permissao]')?.textContent?.trim()).toBe(msg);
    await tela.abrir(tela.portoes()[1]);
    expect(api.abrirPortao).toHaveBeenCalledTimes(1);
  });

  it('portões que a API não devolve (rota ausente) = nenhum botão, sem erro', () => {
    const { el } = build({ extra: { portoes: jest.fn(() => throwError(() => ({ status: 404 }))) } });
    expect(el.querySelector('[data-guarita-abrir]')).toBeNull();
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(el.textContent).toContain('Nenhum portão com relé');
  });
});

describe('GuaritaPortariaComponent — alertas', () => {
  it('pânico em destaque (alerta) e os demais na lista', () => {
    const { f, el } = build({ extra: { alertas: jest.fn(() => of([porta, panico])) } });
    f.detectChanges();
    const p = el.querySelector('[data-guarita-panico]');
    expect(p?.getAttribute('role')).toBe('alert');
    expect(p?.textContent).toContain('Pânico');
    expect(p?.textContent).toContain('unidade 101 A');
    // O pânico vem antes do painel da garagem.
    const ordem = Array.from(el.querySelectorAll('[data-guarita-panico], [data-guarita-portaria]')).map((x) =>
      x.hasAttribute('data-guarita-panico') ? 'panico' : 'painel',
    );
    expect(ordem).toEqual(['panico', 'painel']);
    const outros = el.querySelectorAll('[data-guarita-alerta]');
    expect(outros.length).toBe(1);
    expect(outros[0].textContent).toContain('Porta violada');
  });

  it('"Marcar como visto" chama a API e tira o alerta da tela', () => {
    const { f, el, tela, api } = build({ extra: { alertas: jest.fn(() => of([porta, panico])) } });
    tela.marcarVisto(panico as any);
    f.detectChanges();
    expect(api.marcarAlertaVisto).toHaveBeenCalledWith(90);
    expect(el.querySelector('[data-guarita-panico]')).toBeNull();
    expect(el.querySelectorAll('[data-guarita-alerta]').length).toBe(1);
  });

  it('atualizarAlertas consulta de novo a cada chamada do painel, sem empilhar pedidos', () => {
    const { tela, api } = build({ extra: { alertas: jest.fn(() => NEVER) } });
    expect(api.alertas).toHaveBeenCalledTimes(1);
    tela.atualizarAlertas();
    expect(api.alertas).toHaveBeenCalledTimes(1);
  });

  it('cada atualização traz os alertas novos', () => {
    const respostas = [[], [panico]];
    const { f, el, tela, api } = build({ extra: { alertas: jest.fn(() => of(respostas.shift() ?? [])) } });
    expect(el.querySelector('[data-guarita-panico]')).toBeNull();
    tela.atualizarAlertas();
    f.detectChanges();
    expect(api.alertas).toHaveBeenCalledTimes(2);
    expect(api.alertas).toHaveBeenCalledWith(true);
    expect(el.querySelector('[data-guarita-panico]')).not.toBeNull();
  });

  it('API sem a rota de alertas (404): para de perguntar, sem erro na tela', () => {
    const { el, tela, api } = build({ extra: { alertas: jest.fn(() => throwError(() => ({ status: 404 }))) } });
    tela.atualizarAlertas();
    tela.atualizarAlertas();
    expect(api.alertas).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });
});
