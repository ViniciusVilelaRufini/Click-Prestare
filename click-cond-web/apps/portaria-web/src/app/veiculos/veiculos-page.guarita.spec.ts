import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { VeiculosPageComponent } from './veiculos-page.component';
import { VeiculosApi } from '../moradores/veiculos.service';
import { MoradoresApi } from '../moradores/moradores.service';
import { ConfirmService } from '../shared/confirm.service';
import { AuthService } from '../auth/auth.service';
import { GuaritaService } from '../guarita/guarita.service';

/**
 * Veículos num condomínio com Módulo Guarita: selo do estado da tag no
 * Guarita, aprovar/recusar a tag vinculada pelo morador, lista "A vincular" e
 * "Cadastrar controle/tag". Sem Guarita a tela é exatamente a de sempre.
 */
const morador = { id: 10, nome: 'Ana Souza', bloco: 'A', apartamento: '101' };
const tagG = (id: number, extra: Record<string, unknown> = {}) => ({
  id, id_condominio: 3, codigo: `G2-0F086${id}`, tipo: 'tag_ativo', descricao: null, ativo: 1, ...extra,
});
const carro = (id: number, idTag: number | null, placa: string) => ({
  id, id_morador: 10, id_condominio: 3, placa, cor: null, marca_modelo: null, id_tag: idTag, tag: null, morador,
});

const guarita = { id: 7, nome: 'Guarita garagem', tipo: 'guarita', fabricante: 'linear', ip: '192.168.3.30', porta: 9000, ativo: 1 };
const disp = (id: number, estado: string, extra: Record<string, unknown> = {}) => ({
  id, id_device: 7, guarita_tipo: 2, guarita_serial: `0F086${id}`, guarita_estado: estado, guarita_erro: null, ...extra,
});

function build(opts: {
  guaritas?: any[];
  veiculos?: any[];
  tags?: any[];
  dispositivos?: (deviceId: number) => any;
  guaritaExtra?: Record<string, unknown>;
  confirma?: boolean;
} = {}) {
  const api = {
    listAll: jest.fn(() => of(opts.veiculos ?? [carro(100, 1, 'ABC1D23'), carro(101, null, 'DEF4G56')])),
    listTags: jest.fn(() => of(opts.tags ?? [tagG(1)])),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    createTag: jest.fn(),
    setTagAtivo: jest.fn(),
    removeTag: jest.fn(),
  };
  const guaritaApi = {
    listarGuaritas: jest.fn(() => of(opts.guaritas ?? [])),
    dispositivos: jest.fn(opts.dispositivos ?? (() => of([]))),
    aprovar: jest.fn(() => of({ ok: true })),
    recusar: jest.fn(() => of({ ok: true })),
    vincular: jest.fn(() => of({ ok: true })),
    abrirCaptura: jest.fn(() => of({ ok: true })),
    lerCaptura: jest.fn(() => of([])),
    ...opts.guaritaExtra,
  };
  const confirm = { ask: jest.fn(() => Promise.resolve(opts.confirma ?? true)) };
  TestBed.configureTestingModule({
    imports: [VeiculosPageComponent],
    providers: [
      { provide: VeiculosApi, useValue: api },
      { provide: MoradoresApi, useValue: { list: jest.fn(() => of([])) } },
      { provide: ConfirmService, useValue: confirm },
      { provide: AuthService, useValue: { porteiroInfo: () => ({ id_condominio: 3 }) } },
      { provide: GuaritaService, useValue: guaritaApi },
    ],
  });
  const f = TestBed.createComponent(VeiculosPageComponent);
  f.detectChanges();
  return { f, tela: f.componentInstance, api, guaritaApi, confirm, el: f.nativeElement as HTMLElement };
}

function botoes(raiz: Element, texto: string) {
  return Array.from(raiz.querySelectorAll('button')).filter((b) => b.textContent?.trim() === texto) as HTMLButtonElement[];
}

afterEach(() => {
  jest.useRealTimers();
  TestBed.resetTestingModule();
});

describe('VeiculosPageComponent — condomínio sem Módulo Guarita', () => {
  it('a tela é a de sempre: mesmas abas, colunas e ações; nada do Guarita', () => {
    const { el, guaritaApi } = build({ tags: [tagG(1, { guarita_estado: 'ativo' })] });
    const abas = Array.from(el.querySelectorAll('.ps-seg button')).map((b) => b.textContent?.replace(/\s+/g, ' ').trim());
    expect(abas).toEqual(['Veículos 2', 'Tags RFID 1']);
    const colunas = Array.from(el.querySelectorAll('thead th')).map((t) => t.textContent?.trim());
    expect(colunas).toEqual(['Placa', 'Modelo / Cor', 'Morador', 'Tag', 'Ações']);
    // Mesmo que a tag traga um estado de Guarita, sem Guarita não há selo.
    expect(el.querySelector('[data-guarita-estado]')).toBeNull();
    expect(el.textContent).not.toContain('Cadastrar controle/tag');
    expect(el.textContent).not.toContain('A vincular');
    expect(el.textContent).not.toContain('Guarita');
    expect(guaritaApi.dispositivos).not.toHaveBeenCalled();
    // Ações por linha: só editar e remover, como antes.
    const linha = el.querySelector('tbody tr') as HTMLElement;
    expect(linha.querySelectorAll('button').length).toBe(2);
  });
});

describe('VeiculosPageComponent — selo do estado no Guarita', () => {
  it.each([
    ['aguardando_aprovacao', null, 'Aguardando aprovação'],
    ['pendente', null, 'Pendente'],
    ['gravado', null, 'Gravado no Guarita'],
    ['ativo', null, 'Ativo nos portões'],
    ['falhou', 'Memória do Guarita cheia.', 'Falhou: Memória do Guarita cheia.'],
    ['removendo', null, 'Removendo'],
  ])('%s → "%s"', (estado, erro, texto) => {
    const { el } = build({
      guaritas: [guarita],
      dispositivos: () => of([disp(1, estado, { guarita_erro: erro })]),
    });
    const selo = el.querySelector('[data-guarita-estado]');
    expect(selo?.textContent?.trim()).toBe(texto);
  });

  it('"Gravado no Guarita" e "Ativo nos portões" são selos diferentes', () => {
    const { el } = build({
      guaritas: [guarita],
      veiculos: [carro(100, 1, 'ABC1D23'), carro(102, 2, 'GHI7J89')],
      tags: [tagG(1), tagG(2)],
      dispositivos: () => of([disp(1, 'gravado'), disp(2, 'ativo')]),
    });
    const selos = Array.from(el.querySelectorAll('[data-guarita-estado]')).map((s) => s.textContent?.trim());
    expect(selos).toEqual(['Gravado no Guarita', 'Ativo nos portões']);
  });

  it('sem a lista do Guarita (rota 404), usa o estado da própria tag; sem estado, sem selo e sem erro', () => {
    const { el } = build({
      guaritas: [guarita],
      veiculos: [carro(100, 1, 'ABC1D23'), carro(102, 2, 'GHI7J89')],
      tags: [tagG(1, { guarita_estado: 'pendente' }), tagG(2)],
      dispositivos: () => throwError(() => ({ status: 404 })),
    });
    const selos = Array.from(el.querySelectorAll('[data-guarita-estado]')).map((s) => s.textContent?.trim());
    expect(selos).toEqual(['Pendente']);
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it('estado desconhecido não vira selo', () => {
    const { el } = build({ guaritas: [guarita], dispositivos: () => of([disp(1, 'coisa_nova')]) });
    expect(el.querySelector('[data-guarita-estado]')).toBeNull();
  });
});

describe('VeiculosPageComponent — aprovar ou recusar a tag vinculada pelo morador', () => {
  const opts = { guaritas: [guarita], dispositivos: () => of([disp(1, 'aguardando_aprovacao')]) };

  it('só a tag aguardando tem "Aprovar"/"Recusar"', () => {
    const { el } = build(opts);
    expect(botoes(el, 'Aprovar').length).toBe(1);
    expect(botoes(el, 'Recusar').length).toBe(1);
  });

  it('aprovar pede confirmação, chama a API do Guarita certo e recarrega', async () => {
    const { tela, guaritaApi, confirm, api } = build(opts);
    await tela.aprovarTag(tela.veiculos()[0]);
    expect(confirm.ask).toHaveBeenCalled();
    expect(guaritaApi.aprovar).toHaveBeenCalledWith(7, 1);
    expect(api.listAll).toHaveBeenCalledTimes(2);
    expect(guaritaApi.dispositivos).toHaveBeenCalledTimes(2);
  });

  it('cancelar a confirmação não chama a API', async () => {
    const { tela, guaritaApi } = build({ ...opts, confirma: false });
    await tela.aprovarTag(tela.veiculos()[0]);
    await tela.recusarTag(tela.veiculos()[0]);
    expect(guaritaApi.aprovar).not.toHaveBeenCalled();
    expect(guaritaApi.recusar).not.toHaveBeenCalled();
  });

  it('recusar chama a API', async () => {
    const { tela, guaritaApi } = build(opts);
    await tela.recusarTag(tela.veiculos()[0]);
    expect(guaritaApi.recusar).toHaveBeenCalledWith(7, 1);
  });

  it('dois cliques em "Aprovar" = uma chamada', async () => {
    const { tela, guaritaApi } = build({ ...opts, guaritaExtra: { aprovar: jest.fn(() => ({ subscribe: () => undefined })) } });
    const v = tela.veiculos()[0];
    await Promise.all([tela.aprovarTag(v), tela.aprovarTag(v)]);
    expect(guaritaApi.aprovar).toHaveBeenCalledTimes(1);
  });

  it('erro da API aparece como veio', async () => {
    const { f, el, tela } = build({
      ...opts,
      guaritaExtra: { aprovar: jest.fn(() => throwError(() => ({ status: 409, error: { message: 'Esta tag já está em outro veículo.' } }))) },
    });
    await tela.aprovarTag(tela.veiculos()[0]);
    f.detectChanges();
    expect(el.querySelector('[data-erro-guarita]')?.textContent?.trim()).toBe('Esta tag já está em outro veículo.');
  });
});

describe('VeiculosPageComponent — lista "A vincular"', () => {
  const opts = {
    guaritas: [guarita],
    dispositivos: () => of([
      disp(1, 'ativo'),
      disp(30, 'a_vincular', { unidade: 101, bloco: 'A', rotulo: 'JOAO SILVA', placa: 'XYZ9K88' }),
      disp(31, 'a_vincular', { guarita_tipo: 1, unidade: null, bloco: null }),
    ]),
  };

  it('a aba aparece com a contagem e lista o que está só no Guarita', () => {
    const { f, el } = build(opts);
    const aba = el.querySelector('[data-aba-a-vincular]') as HTMLButtonElement;
    expect(aba.textContent?.replace(/\s+/g, ' ').trim()).toBe('A vincular 2');
    aba.click();
    f.detectChanges();
    const linhas = el.querySelectorAll('[data-a-vincular]');
    expect(linhas.length).toBe(2);
    expect(linhas[0].textContent).toContain('0F08630');
    expect(linhas[0].textContent).toContain('TAG ativo');
    expect(linhas[0].textContent).toContain('Unidade 101 · Bloco A');
    expect(linhas[0].textContent).toContain('JOAO SILVA · XYZ9K88');
    expect(linhas[1].textContent).toContain('Controle remoto');
    expect(linhas[1].textContent).toContain('Sem unidade');
    // A aba não tem botão de criar no cabeçalho.
    expect(el.textContent).not.toContain('Nova Tag');
  });

  it('vincular exige escolher o veículo e chama a API com ele', () => {
    const { tela, guaritaApi } = build(opts);
    const d = tela.aVincular()[0];
    tela.vincularDispositivo(d);
    expect(guaritaApi.vincular).not.toHaveBeenCalled();
    expect(tela.erroGuarita()).toContain('Escolha o veículo');
    tela.vinculoEscolhido[d.id] = 101;
    tela.vincularDispositivo(d);
    expect(guaritaApi.vincular).toHaveBeenCalledWith(7, 30, 101);
  });
});

describe('VeiculosPageComponent — "Cadastrar controle/tag"', () => {
  it('cada veículo tem o botão; ele abre a captura daquele veículo', () => {
    jest.useFakeTimers();
    const { f, el, tela, guaritaApi } = build({ guaritas: [guarita] });
    const lista = botoes(el, 'Cadastrar controle/tag');
    expect(lista.length).toBe(2);
    lista[1].click();
    f.detectChanges();
    expect(el.querySelector('app-guarita-captura')).not.toBeNull();
    expect(guaritaApi.abrirCaptura).toHaveBeenCalledWith(7, 101);
    tela.onGuaritaCadastrado();
    f.detectChanges();
    expect(el.querySelector('app-guarita-captura')).toBeNull();
  });
});
