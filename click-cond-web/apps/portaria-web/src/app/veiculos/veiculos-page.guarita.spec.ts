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
const pagina = (itens: any[], total = itens.length, pag = 1) => of({ itens, total, pagina: pag, por_pagina: 50 });

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
    dispositivos: jest.fn(opts.dispositivos ?? (() => pagina([]))),
    veiculosParaVincular: jest.fn(() => of([] as any[])),
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
    ['recusada', null, 'Recusada pela portaria'],
  ])('%s → "%s"', (estado, erro, texto) => {
    const { el } = build({
      guaritas: [guarita],
      tags: [tagG(1, { guarita_estado: estado, guarita_erro: erro, id_device: 7 })],
    });
    const selo = el.querySelector('[data-guarita-estado]');
    expect(selo?.textContent?.trim()).toBe(texto);
  });

  it('"Gravado no Guarita" e "Ativo nos portões" são selos diferentes', () => {
    const { el } = build({
      guaritas: [guarita],
      veiculos: [carro(100, 1, 'ABC1D23'), carro(102, 2, 'GHI7J89')],
      tags: [tagG(1, { guarita_estado: 'gravado' }), tagG(2, { guarita_estado: 'ativo' })],
    });
    const selos = Array.from(el.querySelectorAll('[data-guarita-estado]')).map((s) => s.textContent?.trim());
    expect(selos).toEqual(['Gravado no Guarita', 'Ativo nos portões']);
    // Só o gravado avisa que ainda não abre o portão.
    const dicas = Array.from(el.querySelectorAll('[data-guarita-dica]')).map((s) => s.textContent?.trim());
    expect(dicas).toEqual(['Ainda não vale nos portões']);
  });

  it('lista do Guarita ausente (rota 404): selo pela tag; tag sem estado, sem selo; nenhum erro', () => {
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
    const { el } = build({ guaritas: [guarita], tags: [tagG(1, { guarita_estado: 'coisa_nova' })] });
    expect(el.querySelector('[data-guarita-estado]')).toBeNull();
  });
});

describe('VeiculosPageComponent — aprovar ou recusar a tag vinculada pelo morador', () => {
  // O morador digitou "015 02158" no app; a tag está aguardando a portaria.
  const tagApp = tagG(1, { codigo: '015 02158', guarita_estado: 'aguardando_aprovacao', id_device: 7 });
  const opts = { guaritas: [guarita], tags: [tagApp] };

  it('só a tag aguardando tem "Aprovar"/"Recusar"', () => {
    const { el } = build(opts);
    expect(botoes(el, 'Aprovar').length).toBe(1);
    expect(botoes(el, 'Recusar').length).toBe(1);
  });

  it('"Aprovar" abre o passo com o código que o morador digitou e o tipo a escolher', () => {
    const { f, el, tela, guaritaApi } = build(opts);
    botoes(el, 'Aprovar')[0].click();
    f.detectChanges();
    const gaveta = el.querySelector('[data-guarita-aprovacao]') as HTMLElement;
    expect(gaveta).not.toBeNull();
    expect(tela.aprovCodigo).toBe('015 02158');
    expect(tela.aprovTipo).toBeNull();
    const opcoes = Array.from(gaveta.querySelectorAll('select[name="aprov_tipo"] option')).map((o) => o.textContent?.trim());
    expect(opcoes).toEqual(['Escolha o tipo', 'TAG ativo', 'TAG passivo', 'Cartão', 'Controle remoto']);
    expect(guaritaApi.aprovar).not.toHaveBeenCalled();
  });

  it('sem tipo escolhido não envia', () => {
    const { tela, guaritaApi } = build(opts);
    tela.aprovarTag(tela.veiculos()[0]);
    tela.confirmarAprovacao();
    expect(guaritaApi.aprovar).not.toHaveBeenCalled();
    expect(tela.erroAprovacao()).toBe('Escolha o tipo do dispositivo.');
  });

  it('código fora do formato impresso é barrado antes de enviar', () => {
    const { tela, guaritaApi } = build({ ...opts, tags: [{ ...tagApp, codigo: 'E2000017221101441890' }] });
    tela.aprovarTag(tela.veiculos()[0]);
    expect(tela.aprovCodigo).toBe('E2000017221101441890');
    tela.aprovTipo = 2;
    tela.confirmarAprovacao();
    expect(guaritaApi.aprovar).not.toHaveBeenCalled();
    expect(tela.erroAprovacao()).toBe('Código inválido. Use o formato impresso no cartão: 015 02158.');
  });

  it('envia { tipo, codigo_impresso } ao Guarita certo, fecha e recarrega', () => {
    const { tela, guaritaApi, api } = build(opts);
    tela.aprovarTag(tela.veiculos()[0]);
    tela.aprovTipo = 3;
    tela.aprovCodigo = ' 015,02158 ';
    tela.confirmarAprovacao();
    expect(guaritaApi.aprovar).toHaveBeenCalledWith(7, 1, { tipo: 3, codigo_impresso: '015,02158' });
    expect(tela.aprovacao()).toBeNull();
    expect(api.listAll).toHaveBeenCalledTimes(2);
  });

  it('código interno "G2-…" não é pré-preenchido', () => {
    const { tela } = build({ ...opts, tags: [{ ...tagApp, codigo: 'G2-0F086E', guarita_tipo: 2 }] });
    tela.aprovarTag(tela.veiculos()[0]);
    expect(tela.aprovCodigo).toBe('');
    expect(tela.aprovTipo).toBe(2);
  });

  it('controle remoto: explica que só entra por captura e "Capturar agora" abre a captura do veículo', () => {
    jest.useFakeTimers();
    const { f, el, tela, guaritaApi } = build(opts);
    tela.aprovarTag(tela.veiculos()[0]);
    tela.aprovTipo = 1;
    f.detectChanges();
    const gaveta = el.querySelector('[data-guarita-aprovacao]') as HTMLElement;
    expect(gaveta.querySelector('[data-aprov-controle]')?.textContent).toContain('só pode ser cadastrado por captura');
    expect(gaveta.querySelector('input[name="aprov_codigo"]')).toBeNull();
    tela.confirmarAprovacao();
    expect(guaritaApi.aprovar).not.toHaveBeenCalled();
    botoes(gaveta, 'Capturar agora')[0].click();
    f.detectChanges();
    expect(el.querySelector('[data-guarita-aprovacao]')).toBeNull();
    expect(el.querySelector('app-guarita-captura')).not.toBeNull();
    expect(guaritaApi.abrirCaptura).toHaveBeenCalledWith(7, 100);
  });

  it('dois cliques em "Aprovar e gravar" = uma chamada', () => {
    const { tela, guaritaApi } = build({ ...opts, guaritaExtra: { aprovar: jest.fn(() => ({ subscribe: () => undefined })) } });
    tela.aprovarTag(tela.veiculos()[0]);
    tela.aprovTipo = 6;
    tela.confirmarAprovacao();
    tela.confirmarAprovacao();
    expect(guaritaApi.aprovar).toHaveBeenCalledTimes(1);
  });

  it('erro 400 da API aparece na gaveta como veio', () => {
    const msg = 'Informe o código impresso na tag (ex.: 015 02158) para gravar no Guarita.';
    const { f, el, tela } = build({
      ...opts,
      guaritaExtra: { aprovar: jest.fn(() => throwError(() => ({ status: 400, error: { message: msg } }))) },
    });
    tela.aprovarTag(tela.veiculos()[0]);
    tela.aprovTipo = 2;
    tela.confirmarAprovacao();
    f.detectChanges();
    expect(el.querySelector('[data-guarita-aprovacao] [role="alert"]')?.textContent?.trim()).toBe(msg);
    expect(tela.aprovacao()).not.toBeNull();
  });

  it('recusar pede confirmação; cancelar não chama a API', async () => {
    const { tela, guaritaApi } = build({ ...opts, confirma: false });
    await tela.recusarTag(tela.veiculos()[0]);
    expect(guaritaApi.recusar).not.toHaveBeenCalled();
  });

  it('recusar diz o que acontece e chama a API', async () => {
    const { tela, guaritaApi, confirm } = build(opts);
    await tela.recusarTag(tela.veiculos()[0]);
    expect(confirm.ask).toHaveBeenCalledWith(expect.objectContaining({
      message: 'A tag não será gravada no Guarita. O morador verá que foi recusada pela portaria.',
    }));
    expect(guaritaApi.recusar).toHaveBeenCalledWith(7, 1);
  });
});

describe('VeiculosPageComponent — tag de Guarita na aba "Tags RFID"', () => {
  const comum = { id: 5, id_condominio: 3, codigo: '777', tipo: 'rfid', descricao: null, ativo: 1 };
  const doGuarita = tagG(1, { guarita_estado: 'ativo', id_device: 7 });

  function abaTags(opts: Parameters<typeof build>[0]) {
    const r = build(opts);
    r.tela.tab.set('tags');
    r.f.detectChanges();
    return r;
  }

  it('tag de Guarita mostra o selo do Guarita e "Remover do Guarita" no lugar de Bloquear/Reativar; tag comum fica igual', () => {
    const { el } = abaTags({ guaritas: [guarita], tags: [doGuarita, comum] });
    const linhas = Array.from(el.querySelectorAll('tbody tr')) as HTMLElement[];
    expect(linhas[0].querySelector('[data-guarita-estado-tag]')?.textContent?.trim()).toBe('Ativo nos portões');
    expect(botoes(linhas[0], 'Remover do Guarita').length).toBe(1);
    expect(botoes(linhas[0], 'Bloquear').length).toBe(0);
    expect(botoes(linhas[0], 'Reativar').length).toBe(0);
    expect(linhas[1].textContent).toContain('Ativa');
    expect(botoes(linhas[1], 'Bloquear').length).toBe(1);
    expect(botoes(linhas[1], 'Remover do Guarita').length).toBe(0);
  });

  it('remover pede confirmação dizendo que deixa de abrir o portão; depois fica "Removendo" sem "Reativar"', async () => {
    const { f, el, tela, api, confirm } = abaTags({ guaritas: [guarita], tags: [doGuarita] });
    api.setTagAtivo.mockImplementation((() => of({ ...doGuarita, ativo: 0 })) as any);
    await tela.removerDoGuarita(tela.tags()[0]);
    expect(confirm.ask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Remover do Guarita' }));
    expect((confirm.ask.mock.calls[0] as any)[0].message).toContain('deixa de abrir o portão');
    expect(api.setTagAtivo).toHaveBeenCalledWith(1, false);
    f.detectChanges();
    const linha = el.querySelector('tbody tr') as HTMLElement;
    expect(linha.querySelector('[data-guarita-estado-tag]')?.textContent?.trim()).toBe('Removendo');
    expect(botoes(linha, 'Remover do Guarita').length).toBe(0);
    expect(botoes(linha, 'Reativar').length).toBe(0);
  });

  it('cancelar não chama a API', async () => {
    const { tela, api } = abaTags({ guaritas: [guarita], tags: [doGuarita], confirma: false });
    await tela.removerDoGuarita(tela.tags()[0]);
    expect(api.setTagAtivo).not.toHaveBeenCalled();
  });

  it('tag aguardando aprovação ainda não está no Guarita: segue como tag comum', () => {
    const { el } = abaTags({ guaritas: [guarita], tags: [tagG(1, { guarita_estado: 'aguardando_aprovacao', id_device: 7 })] });
    const linha = el.querySelector('tbody tr') as HTMLElement;
    expect(botoes(linha, 'Bloquear').length).toBe(1);
    expect(botoes(linha, 'Remover do Guarita').length).toBe(0);
  });

  it('sem Guarita: mesmo com estado na tag, Bloquear/Reativar como hoje', () => {
    const { el } = abaTags({ tags: [doGuarita] });
    const linha = el.querySelector('tbody tr') as HTMLElement;
    expect(botoes(linha, 'Bloquear').length).toBe(1);
    expect(linha.querySelector('[data-guarita-estado-tag]')).toBeNull();
  });
});

describe('VeiculosPageComponent — lista "A vincular" (paginada no servidor)', () => {
  const itens = [
    disp(30, 'a_vincular', { unidade: 101, bloco: 'A', rotulo: 'JOAO SILVA', placa: 'XYZ9K88' }),
    disp(31, 'a_vincular', { guarita_tipo: 1, unidade: null, bloco: null }),
  ];

  it('pede só a página 1 de "a_vincular" (50 por página) e mostra o total do servidor na aba', () => {
    const { f, el, guaritaApi } = build({ guaritas: [guarita], dispositivos: () => pagina(itens, 812) });
    expect(guaritaApi.dispositivos).toHaveBeenCalledTimes(1);
    expect(guaritaApi.dispositivos).toHaveBeenCalledWith(7, { estado: 'a_vincular', busca: '', pagina: 1, por_pagina: 50 });
    const aba = el.querySelector('[data-aba-a-vincular]') as HTMLButtonElement;
    expect(aba.textContent?.replace(/\s+/g, ' ').trim()).toBe('A vincular 812');
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
    // Nenhum <select> por linha.
    expect(el.querySelectorAll('[data-a-vincular] select').length).toBe(0);
    expect(el.querySelector('[data-paginas-a-vincular]')?.textContent).toContain('Página 1 de 17');
    expect(el.textContent).not.toContain('Nova Tag');
  });

  it('próxima página e busca vão para o servidor (busca com espera de 300 ms)', () => {
    jest.useFakeTimers();
    const { tela, guaritaApi } = build({ guaritas: [guarita], dispositivos: () => pagina(itens, 120) });
    tela.paginaVincular(1);
    expect(guaritaApi.dispositivos).toHaveBeenLastCalledWith(7, expect.objectContaining({ pagina: 2 }));
    tela.onBuscaVincular('101');
    tela.onBuscaVincular('101 A');
    jest.advanceTimersByTime(300);
    expect(guaritaApi.dispositivos).toHaveBeenCalledTimes(3);
    expect(guaritaApi.dispositivos).toHaveBeenLastCalledWith(7, { estado: 'a_vincular', busca: '101 A', pagina: 1, por_pagina: 50 });
  });

  it('API que devolve lista pura = página única, sem paginação na tela', () => {
    const { f, el, tela } = build({
      guaritas: [guarita],
      dispositivos: () => of({ itens: itens, total: 2, pagina: 1, por_pagina: 2 }),
    });
    tela.tab.set('a_vincular');
    f.detectChanges();
    expect(el.querySelectorAll('[data-a-vincular]').length).toBe(2);
    expect(el.querySelector('[data-paginas-a-vincular]')).toBeNull();
  });

  it('rota ausente (404): aba vazia, sem erro', () => {
    const { f, el, tela } = build({ guaritas: [guarita], dispositivos: () => throwError(() => ({ status: 404 })) });
    tela.tab.set('a_vincular');
    f.detectChanges();
    expect(el.textContent).toContain('Nada a vincular');
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it('vincular abre a busca de veículo (API nova, até 20) e vincula o escolhido', () => {
    const opcao = { id: 101, placa: 'DEF4G56', morador_nome: 'Ana Souza', apartamento: '101', bloco: 'A' };
    const { f, el, tela, guaritaApi, api } = build({
      guaritas: [guarita],
      dispositivos: () => pagina(itens),
      guaritaExtra: { veiculosParaVincular: jest.fn(() => of([opcao])) },
    });
    tela.abrirVincular(tela.aVincular()[0]);
    f.detectChanges();
    expect(guaritaApi.veiculosParaVincular).toHaveBeenCalledWith(7, '');
    const opcoes = el.querySelectorAll('[data-guarita-vincular] [data-opcao-vincular]');
    expect(opcoes.length).toBe(1);
    expect(opcoes[0].textContent).toContain('DEF4G56');
    (opcoes[0] as HTMLButtonElement).click();
    expect(guaritaApi.vincular).toHaveBeenCalledWith(7, 30, 101);
    f.detectChanges();
    expect(el.querySelector('[data-guarita-vincular]')).toBeNull();
    expect(api.listAll).toHaveBeenCalledTimes(2);
  });

  it('sem a busca na API (404): procura nos veículos já carregados, só os sem tag', () => {
    jest.useFakeTimers();
    const { tela, guaritaApi } = build({
      guaritas: [guarita],
      dispositivos: () => pagina(itens),
      guaritaExtra: { veiculosParaVincular: jest.fn(() => throwError(() => ({ status: 404 }))) },
    });
    tela.abrirVincular(tela.aVincular()[0]);
    // carro 100 tem tag; só o 101 (sem tag) aparece.
    expect(tela.opcoesVincular().map((o) => o.id)).toEqual([101]);
    tela.onBuscaVeiculoVincular('zzz');
    jest.advanceTimersByTime(300);
    expect(tela.opcoesVincular()).toEqual([]);
    expect(guaritaApi.veiculosParaVincular).toHaveBeenCalledTimes(1);
  });

  it('erro ao vincular aparece na gaveta como veio', () => {
    const { f, el, tela } = build({
      guaritas: [guarita],
      dispositivos: () => pagina(itens),
      guaritaExtra: {
        veiculosParaVincular: jest.fn(() => of([{ id: 101, placa: 'DEF4G56' }])),
        vincular: jest.fn(() => throwError(() => ({ status: 400, error: { message: 'Este veículo já tem uma tag.' } }))),
      },
    });
    tela.abrirVincular(tela.aVincular()[0]);
    tela.escolherVeiculoParaVincular(tela.opcoesVincular()[0]);
    f.detectChanges();
    expect(el.querySelector('[data-guarita-vincular] [role="alert"]')?.textContent?.trim()).toBe('Este veículo já tem uma tag.');
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
