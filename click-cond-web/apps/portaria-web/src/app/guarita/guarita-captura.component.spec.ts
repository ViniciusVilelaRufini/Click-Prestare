import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { GuaritaCapturaComponent, ORIENTACAO_CAPTURA } from './guarita-captura.component';
import { GuaritaService } from './guarita.service';

const guarita = { id: 7, nome: 'Guarita garagem', tipo: 'guarita', fabricante: 'linear', ip: '192.168.3.30', porta: 9000 };
const outro = { ...guarita, id: 8, nome: 'Guarita social' };
const veiculo = { id: 100, placa: 'ABC1D23', morador: { nome: 'Ana Souza' } };

const rfComContador = { tipo: 1, serial_hex: '1A2B3C4', tem_contador: true, recebido_em: '2026-11-15T12:00:01Z' };
const rfSemContador = { tipo: 1, serial_hex: '7F00AA1', tem_contador: false, recebido_em: '2026-11-15T12:00:02Z' };
const tag = { tipo: 2, serial_hex: '0F086E', tem_contador: false, recebido_em: '2026-11-15T12:00:03Z' };

function build(extra: Record<string, unknown> = {}, guaritas: any[] = [guarita]) {
  const api = {
    abrirCaptura: jest.fn(() => of({ ok: true })),
    lerCaptura: jest.fn(() => of([] as any[])),
    confirmarCaptura: jest.fn(() => of({ ok: true })),
    cadastrarPorCodigo: jest.fn(() => of({ ok: true })),
    ...extra,
  };
  TestBed.configureTestingModule({
    imports: [GuaritaCapturaComponent],
    providers: [{ provide: GuaritaService, useValue: api }],
  });
  const f = TestBed.createComponent(GuaritaCapturaComponent);
  f.componentRef.setInput('veiculo', veiculo);
  f.componentRef.setInput('guaritas', guaritas);
  const cadastrado = jest.fn();
  f.componentInstance.cadastrado.subscribe(cadastrado);
  f.detectChanges();
  return { f, tela: f.componentInstance, api, cadastrado, el: f.nativeElement as HTMLElement };
}

function botao(raiz: Element, texto: string) {
  return Array.from(raiz.querySelectorAll('button')).find((b) => b.textContent?.trim() === texto) as
    | HTMLButtonElement
    | undefined;
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  TestBed.resetTestingModule();
});

describe('GuaritaCapturaComponent — por aproximação', () => {
  it('com um Guarita, abre a janela na hora e conta 60 s', () => {
    const { f, el, tela, api } = build();
    expect(api.abrirCaptura).toHaveBeenCalledWith(7, 100);
    expect(el.querySelector('[data-guarita-contagem]')?.textContent).toContain('60 s');
    jest.advanceTimersByTime(1_000);
    f.detectChanges();
    expect(el.querySelector('[data-guarita-contagem]')?.textContent).toContain('59 s');
    tela.ngOnDestroy();
  });

  it('pergunta o que chegou a cada 2 s e lista os seriais (dois diferentes: o síndico escolhe)', () => {
    const { f, el, tela, api } = build({ lerCaptura: jest.fn(() => of([rfComContador, tag])) });
    jest.advanceTimersByTime(1_000);
    expect(api.lerCaptura).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1_000);
    expect(api.lerCaptura).toHaveBeenCalledWith(7);
    f.detectChanges();
    const linhas = el.querySelectorAll('[data-guarita-capturado]');
    expect(linhas.length).toBe(2);
    expect(linhas[0].textContent).toContain('Controle remoto');
    expect(linhas[0].textContent).toContain('1A2B3C4');
    expect(linhas[1].textContent).toContain('TAG ativo');
    expect(el.textContent).toContain('escolha o deste veículo');
    tela.ngOnDestroy();
  });

  it('nada chegou em 10 s: mostra a orientação do Cadastro Rápido (antes disso, não)', () => {
    const { f, el, tela } = build();
    jest.advanceTimersByTime(2_000);
    f.detectChanges();
    expect(el.querySelector('[data-guarita-orientacao]')).toBeNull();
    jest.advanceTimersByTime(8_000);
    f.detectChanges();
    expect(el.querySelector('[data-guarita-orientacao]')?.textContent).toContain(ORIENTACAO_CAPTURA);
    expect(ORIENTACAO_CAPTURA).toBe('Peça ao porteiro para entrar em Menu > Cadastro Rápido no Guarita e acione o controle');
    tela.ngOnDestroy();
  });

  it('a janela fecha em 60 s, faz a última leitura e oferece "Capturar de novo"', () => {
    const { f, el, tela, api } = build();
    jest.advanceTimersByTime(60_000);
    f.detectChanges();
    expect(tela.janelaAberta()).toBe(false);
    expect(el.querySelector('[data-guarita-contagem]')).toBeNull();
    const chamadas = api.lerCaptura.mock.calls.length;
    jest.advanceTimersByTime(10_000);
    expect(api.lerCaptura.mock.calls.length).toBe(chamadas);
    botao(el, 'Capturar de novo')!.click();
    expect(api.abrirCaptura).toHaveBeenCalledTimes(2);
    tela.ngOnDestroy();
  });

  it('em rede lenta, a leitura não empilha pedidos', () => {
    const { tela, api } = build({ lerCaptura: jest.fn(() => ({ subscribe: () => undefined })) });
    jest.advanceTimersByTime(10_000);
    expect(api.lerCaptura).toHaveBeenCalledTimes(1);
    tela.ngOnDestroy();
  });

  it('controle remoto sem contador não pode ser confirmado', () => {
    const { f, el, tela, api } = build({ lerCaptura: jest.fn(() => of([rfSemContador])) });
    jest.advanceTimersByTime(2_000);
    f.detectChanges();
    const linha = el.querySelector('[data-guarita-capturado]') as HTMLElement;
    expect(linha.textContent).toContain('sem contador');
    expect(botao(linha, 'Usar este')!.disabled).toBe(true);
    tela.usar(rfSemContador);
    expect(api.confirmarCaptura).not.toHaveBeenCalled();
    tela.ngOnDestroy();
  });

  it('confirmar um serial enfileira o cadastro e avisa a tela de Veículos (um clique = uma chamada)', () => {
    const { f, el, tela, api, cadastrado } = build({ lerCaptura: jest.fn(() => of([rfComContador])) });
    jest.advanceTimersByTime(2_000);
    f.detectChanges();
    const usar = botao(el.querySelector('[data-guarita-capturado]')!, 'Usar este')!;
    expect(usar.disabled).toBe(false);
    api.confirmarCaptura.mockImplementation((() => ({ subscribe: () => undefined })) as any);
    tela.usar(rfComContador);
    tela.usar(rfComContador);
    expect(api.confirmarCaptura).toHaveBeenCalledTimes(1);
    expect(api.confirmarCaptura).toHaveBeenCalledWith(7, { tipo: 1, serial_hex: '1A2B3C4', id_veiculo: 100 });
    void cadastrado;
    tela.ngOnDestroy();
  });

  it('confirmado: emite "cadastrado"', () => {
    const { tela, cadastrado } = build();
    tela.usar(tag);
    expect(cadastrado).toHaveBeenCalledTimes(1);
    tela.ngOnDestroy();
  });

  it('erro da API ao confirmar aparece como veio', () => {
    const { f, el, tela, cadastrado } = build({
      confirmarCaptura: jest.fn(() => throwError(() => ({ status: 400, error: { message: 'Controle remoto só pode ser cadastrado por captura no Guarita.' } }))),
    });
    tela.usar(tag);
    f.detectChanges();
    expect(el.querySelector('[role="alert"]')?.textContent?.trim()).toBe('Controle remoto só pode ser cadastrado por captura no Guarita.');
    expect(cadastrado).not.toHaveBeenCalled();
    tela.ngOnDestroy();
  });

  it('erro ao abrir a janela aparece como veio', () => {
    const { f, el, tela } = build({ abrirCaptura: jest.fn(() => throwError(() => ({ status: 409, error: { message: 'Já existe uma captura aberta neste Guarita.' } }))) });
    f.detectChanges();
    expect(el.querySelector('[role="alert"]')?.textContent?.trim()).toBe('Já existe uma captura aberta neste Guarita.');
    expect(botao(el, 'Começar captura')).toBeDefined();
    tela.ngOnDestroy();
  });

  it('com dois Guaritas não começa sozinho: escolhe o Guarita e começa', () => {
    const { f, el, tela, api } = build({}, [guarita, outro]);
    expect(api.abrirCaptura).not.toHaveBeenCalled();
    tela.trocarGuarita(8);
    f.detectChanges();
    botao(el, 'Começar captura')!.click();
    expect(api.abrirCaptura).toHaveBeenCalledWith(8, 100);
    tela.ngOnDestroy();
  });
});

describe('GuaritaCapturaComponent — código impresso', () => {
  it('TAG ou cartão pelo código impresso; controle remoto não é opção', () => {
    const { f, el, tela, api, cadastrado } = build();
    botao(el, 'Código impresso')!.click();
    f.detectChanges();
    const opcoes = Array.from(el.querySelectorAll('select[name="codigo_tipo"] option')).map((o) => o.textContent?.trim());
    expect(opcoes).toEqual(['TAG ativo', 'Cartão', 'TAG passivo']);
    tela.codigoTipo = 3;
    tela.codigoImpresso = ' 015 02158 ';
    tela.cadastrarPorCodigo();
    expect(api.cadastrarPorCodigo).toHaveBeenCalledWith(7, { id_veiculo: 100, tipo: 3, codigo_impresso: '015 02158' });
    expect(cadastrado).toHaveBeenCalled();
    tela.ngOnDestroy();
  });

  it('código vazio não chama a API', () => {
    const { tela, api } = build();
    tela.trocarModo('codigo');
    tela.cadastrarPorCodigo();
    expect(api.cadastrarPorCodigo).not.toHaveBeenCalled();
    expect(tela.erro()).toContain('código impresso');
    tela.ngOnDestroy();
  });

  it('código inválido: a mensagem da API aparece como veio', () => {
    const msg = 'Código inválido. Use o formato impresso no cartão: 015 02158.';
    const { f, el, tela } = build({ cadastrarPorCodigo: jest.fn(() => throwError(() => ({ status: 400, error: { message: msg } }))) });
    tela.trocarModo('codigo');
    tela.codigoImpresso = 'abc';
    tela.cadastrarPorCodigo();
    f.detectChanges();
    expect(el.querySelector('[role="alert"]')?.textContent?.trim()).toBe(msg);
    tela.ngOnDestroy();
  });

  it('dois cliques em "Cadastrar no Guarita" = uma chamada', () => {
    const { tela, api } = build({ cadastrarPorCodigo: jest.fn(() => ({ subscribe: () => undefined })) });
    tela.trocarModo('codigo');
    tela.codigoImpresso = '015 02158';
    tela.cadastrarPorCodigo();
    tela.cadastrarPorCodigo();
    expect(api.cadastrarPorCodigo).toHaveBeenCalledTimes(1);
    tela.ngOnDestroy();
  });
});
