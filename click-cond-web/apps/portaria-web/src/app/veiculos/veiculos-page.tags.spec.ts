import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { VeiculosPageComponent } from './veiculos-page.component';
import { VeiculosApi } from '../moradores/veiculos.service';
import { MoradoresApi } from '../moradores/moradores.service';
import { ConfirmService } from '../shared/confirm.service';
import { AuthService } from '../auth/auth.service';

/**
 * Tag na tela Veículos: digitar/capturar o código no formulário do veículo,
 * erro da API dentro do formulário e gestão das tags (bloquear, reativar,
 * excluir), incluindo as bloqueadas.
 */
const tagAtiva = { id: 1, id_condominio: 3, codigo: '12345', tipo: 'rfid', descricao: null, ativo: 1 };
const tagBloqueada = { id: 2, id_condominio: 3, codigo: 'ABC9', tipo: 'rfid', descricao: 'Perdida', ativo: 0 };
const tagSolta = { id: 5, id_condominio: 3, codigo: '777', tipo: 'rfid', descricao: null, ativo: 1 };

const morador = { id: 10, nome: 'Ana Souza', bloco: 'A', apartamento: '101' };
const carroComTag = {
  id: 100, id_morador: 10, id_condominio: 3, placa: 'ABC1D23', cor: null, marca_modelo: 'Civic',
  id_tag: 1, tag: tagAtiva, morador,
};
const carroTagBloqueada = {
  id: 101, id_morador: 10, id_condominio: 3, placa: 'XYZ9K88', cor: null, marca_modelo: null,
  id_tag: 2, tag: tagBloqueada, morador,
};
const carroSemTag = {
  id: 102, id_morador: 10, id_condominio: 3, placa: 'DEF4G56', cor: null, marca_modelo: null,
  id_tag: null, tag: null, morador,
};

function build(extra: Record<string, unknown> = {}, confirma = true) {
  const api = {
    listAll: jest.fn(() => of([carroComTag, carroTagBloqueada, carroSemTag])),
    listTags: jest.fn(() => of([tagAtiva, tagBloqueada, tagSolta])),
    create: jest.fn((_idMorador: number, dto: any) => of({ id: 200, ...dto })),
    update: jest.fn((id: number, dto: any) => of({ id, ...dto })),
    remove: jest.fn(() => of({ ok: true })),
    createTag: jest.fn((dto: any) => of({ id: 9, id_condominio: 3, tipo: 'rfid', descricao: null, ativo: 1, ...dto })),
    setTagAtivo: jest.fn((id: number, ativo: boolean) => of({ ...(id === 2 ? tagBloqueada : tagAtiva), id, ativo: ativo ? 1 : 0 })),
    removeTag: jest.fn(() => of({ ok: true })),
    ...extra,
  };
  const confirm = { ask: jest.fn(() => Promise.resolve(confirma)) };
  TestBed.configureTestingModule({
    imports: [VeiculosPageComponent],
    providers: [
      { provide: VeiculosApi, useValue: api },
      { provide: MoradoresApi, useValue: { list: jest.fn(() => of([])) } },
      { provide: ConfirmService, useValue: confirm },
      { provide: AuthService, useValue: { porteiroInfo: () => ({ id_condominio: 3 }) } },
    ],
  });
  const f = TestBed.createComponent(VeiculosPageComponent);
  f.detectChanges();
  return { f, tela: f.componentInstance, api, confirm, el: f.nativeElement as HTMLElement };
}

function botao(el: HTMLElement, texto: string, raiz: Element = el) {
  return Array.from(raiz.querySelectorAll('button')).find((b) => b.textContent?.trim() === texto) as
    | HTMLButtonElement
    | undefined;
}

describe('VeiculosPageComponent — código da tag no formulário do veículo', () => {
  it('carrega as tags incluindo as bloqueadas', () => {
    const { api } = build();
    expect(api.listTags).toHaveBeenCalledWith(false, true);
  });

  it('mostra o campo de código com a dica dos formatos e o botão de captura pelo leitor', () => {
    const { f, tela, el } = build();
    tela.abrirNovoVeiculo();
    f.detectChanges();
    const drawer = el.querySelector('.ps-drawer') as HTMLElement;
    expect(drawer.querySelector('input[name="codigo_tag"]')).not.toBeNull();
    expect(drawer.textContent).toContain('Aceita o número impresso (decimal), hexadecimal ou facility,número');
    expect(drawer.querySelector('app-enroll-capture')).not.toBeNull();
    // O select de tags existentes continua.
    expect(drawer.querySelector('select#veiculos-page-tag-rfid-vinculada')).not.toBeNull();
  });

  it('código digitado: cria a tag e vincula o veículo a ela', () => {
    const { tela, api } = build();
    tela.abrirEditarVeiculo(carroSemTag as any);
    tela.codigoTag = ' 188,24910 ';
    tela.salvarVeiculo();
    expect(api.createTag).toHaveBeenCalledWith({ codigo: '188,24910', tipo: 'rfid' });
    expect(api.update).toHaveBeenCalledWith(102, expect.objectContaining({ placa: 'DEF4G56', id_tag: 9 }));
    expect(tela.modalVeiculo()).toBe(false);
  });

  it('sem código digitado não cria tag e usa a do select', () => {
    const { tela, api } = build();
    tela.abrirEditarVeiculo(carroSemTag as any);
    tela.novoVeiculo.id_tag = 5;
    tela.salvarVeiculo();
    expect(api.createTag).not.toHaveBeenCalled();
    expect(api.update).toHaveBeenCalledWith(102, expect.objectContaining({ id_tag: 5 }));
  });

  it('valida placa e morador antes de criar a tag', () => {
    const { tela, api } = build();
    tela.abrirNovoVeiculo();
    tela.novoVeiculo.placa = 'AAA1B22';
    tela.codigoTag = '123';
    tela.salvarVeiculo();
    expect(api.createTag).not.toHaveBeenCalled();
    expect(tela.erroVeiculo()).toContain('morador');
  });

  it('a captura pelo leitor preenche o campo de código', () => {
    const { tela, api } = build();
    tela.abrirNovoVeiculo();
    tela.onTagCapturada(' 00AB12 ');
    expect(tela.codigoTag).toBe('00AB12');
    expect(api.createTag).not.toHaveBeenCalled();
  });

  it('reabrir o formulário limpa o código e o erro anteriores', () => {
    const { tela } = build();
    tela.abrirNovoVeiculo();
    tela.codigoTag = '123';
    tela.erroVeiculo.set('x');
    tela.fecharModalVeiculo();
    tela.abrirEditarVeiculo(carroComTag as any);
    expect(tela.codigoTag).toBe('');
    expect(tela.erroVeiculo()).toBeNull();
  });

  it('o select não oferece tag bloqueada, exceto a que o veículo já usa', () => {
    const { tela } = build();
    tela.abrirEditarVeiculo(carroSemTag as any);
    expect(tela.tagsParaSelecao().map((t) => t.id)).toEqual([1, 5]);
    tela.abrirEditarVeiculo(carroTagBloqueada as any);
    expect(tela.tagsParaSelecao().map((t) => t.id)).toEqual([1, 2, 5]);
  });
});

describe('VeiculosPageComponent — erro da API dentro do formulário', () => {
  it('código inválido: a mensagem da API aparece no formulário com role="alert" e o veículo não é salvo', () => {
    const msg = 'Código de tag inválido: use apenas letras e números (espaços, ":" e "-" são ignorados).';
    const { f, tela, el, api } = build({
      createTag: jest.fn(() => throwError(() => ({ error: { message: msg } }))),
    });
    tela.abrirEditarVeiculo(carroSemTag as any);
    tela.codigoTag = '@@';
    tela.salvarVeiculo();
    f.detectChanges();
    expect(api.update).not.toHaveBeenCalled();
    expect(tela.modalVeiculo()).toBe(true);
    expect(tela.salvandoVeiculo()).toBe(false);
    expect(el.querySelector('.ps-drawer [role="alert"]')?.textContent).toContain(msg);
  });

  it('tag já vinculada a outro veículo: mensagem no formulário, que continua aberto', () => {
    const msg = 'Esta tag já está vinculada a outro veículo.';
    const { f, tela, el } = build({
      update: jest.fn(() => throwError(() => ({ error: { message: msg } }))),
    });
    tela.abrirEditarVeiculo(carroSemTag as any);
    tela.novoVeiculo.id_tag = 1;
    tela.salvarVeiculo();
    f.detectChanges();
    expect(tela.modalVeiculo()).toBe(true);
    expect(el.querySelector('.ps-drawer [role="alert"]')?.textContent).toContain(msg);
  });

  it('mensagem em lista (class-validator) é juntada em texto', () => {
    const { tela } = build({
      update: jest.fn(() => throwError(() => ({ error: { message: ['Placa inválida.', 'Cor longa.'] } }))),
    });
    tela.abrirEditarVeiculo(carroSemTag as any);
    tela.salvarVeiculo();
    expect(tela.erroVeiculo()).toBe('Placa inválida. Cor longa.');
  });

  it('cadastro de tag avulsa também mostra o erro com role="alert"', () => {
    const { f, tela, el } = build({
      createTag: jest.fn(() => throwError(() => ({ error: { message: 'Informe o código da tag.' } }))),
    });
    tela.abrirNovaTag();
    tela.novaTag.codigo = '-';
    tela.salvarTag();
    f.detectChanges();
    expect(el.querySelector('.ps-drawer [role="alert"]')?.textContent).toContain('Informe o código da tag.');
  });
});

describe('VeiculosPageComponent — gestão de tags', () => {
  function abaTags(extra: Record<string, unknown> = {}, confirma = true) {
    const r = build(extra, confirma);
    r.tela.tab.set('tags');
    r.f.detectChanges();
    return r;
  }
  const linhaDe = (el: HTMLElement, codigo: string) =>
    Array.from(el.querySelectorAll('tbody tr')).find((tr) => tr.textContent?.includes(codigo)) as HTMLElement;

  it('lista código, veículo vinculado e situação, inclusive das bloqueadas', () => {
    const { el } = abaTags();
    const ativa = linhaDe(el, '12345');
    expect(ativa.textContent).toContain('ABC1D23');
    expect(ativa.textContent).toContain('Ana Souza');
    expect(ativa.textContent).toContain('Ativa');
    const bloqueada = linhaDe(el, 'ABC9');
    expect(bloqueada.textContent).toContain('XYZ9K88');
    expect(bloqueada.textContent).toContain('Bloqueada');
    expect(linhaDe(el, '777').textContent).toContain('Sem veículo');
  });

  it('ações por situação: ativa pode bloquear, bloqueada pode reativar, ambas excluir', () => {
    const { el } = abaTags();
    const ativa = linhaDe(el, '12345');
    expect(botao(el, 'Bloquear', ativa)).toBeDefined();
    expect(botao(el, 'Reativar', ativa)).toBeUndefined();
    expect(botao(el, 'Excluir', ativa)).toBeDefined();
    const bloqueada = linhaDe(el, 'ABC9');
    expect(botao(el, 'Reativar', bloqueada)).toBeDefined();
    expect(botao(el, 'Bloquear', bloqueada)).toBeUndefined();
    expect(botao(el, 'Excluir', bloqueada)).toBeDefined();
  });

  it('bloquear chama a API com ativo=false e a linha passa a Bloqueada', () => {
    const { f, el, api } = abaTags();
    botao(el, 'Bloquear', linhaDe(el, '12345'))?.click();
    f.detectChanges();
    expect(api.setTagAtivo).toHaveBeenCalledWith(1, false);
    expect(linhaDe(el, '12345').textContent).toContain('Bloqueada');
  });

  it('reativar chama a API com ativo=true', () => {
    const { f, el, api } = abaTags();
    botao(el, 'Reativar', linhaDe(el, 'ABC9'))?.click();
    f.detectChanges();
    expect(api.setTagAtivo).toHaveBeenCalledWith(2, true);
    expect(linhaDe(el, 'ABC9').textContent).toContain('Ativa');
  });

  it('excluir pede confirmação dizendo que o veículo ficará sem tag', async () => {
    const { tela, api, confirm } = abaTags();
    await tela.excluirTag(tagAtiva as any);
    const pedido = (confirm.ask.mock.calls as any[][])[0][0];
    expect(pedido.message).toContain('ABC1D23');
    expect(pedido.message).toContain('ficará sem tag');
    expect(pedido.variant).toBe('danger');
    expect(api.removeTag).toHaveBeenCalledWith(1);
    // Recarrega: o veículo perdeu o vínculo.
    expect(api.listAll).toHaveBeenCalledTimes(2);
  });

  it('excluir tag sem veículo não fala de veículo, mas ainda confirma', async () => {
    const { tela, confirm } = abaTags();
    await tela.excluirTag(tagSolta as any);
    const pedido = (confirm.ask.mock.calls as any[][])[0][0];
    expect(pedido.message).not.toContain('ficará sem tag');
    expect(pedido.message).toContain('777');
  });

  it('cancelar a confirmação não exclui', async () => {
    const { tela, api } = abaTags({}, false);
    await tela.excluirTag(tagAtiva as any);
    expect(api.removeTag).not.toHaveBeenCalled();
  });

  it('falha em bloquear/excluir aparece com role="alert"', async () => {
    const { f, tela, el } = abaTags({
      setTagAtivo: jest.fn(() => throwError(() => ({ error: { message: 'Tag 1 não encontrada' } }))),
      removeTag: jest.fn(() => throwError(() => ({ status: 500 }))),
    });
    tela.definirTagAtiva(tagAtiva as any, false);
    f.detectChanges();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Tag 1 não encontrada');
    expect(tela.tagEmAcao()).toBeNull();
    await tela.excluirTag(tagAtiva as any);
    f.detectChanges();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Falha ao excluir a tag.');
  });

  it('estado vazio', () => {
    const { el } = abaTags({ listTags: jest.fn(() => of([])) });
    expect(el.textContent).toContain('Nenhuma tag cadastrada');
  });

  it('estado de erro ao carregar, com tentar novamente', () => {
    const listTags = jest
      .fn()
      .mockReturnValueOnce(throwError(() => ({ status: 500 })))
      .mockReturnValue(of([tagAtiva]));
    const { f, el } = abaTags({ listTags });
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Não foi possível carregar as tags');
    expect(el.textContent).not.toContain('Nenhuma tag cadastrada');
    botao(el, 'Tentar novamente')?.click();
    f.detectChanges();
    expect(linhaDe(el, '12345')).toBeDefined();
  });

  it('estado de carregando', () => {
    const { f, tela, el } = abaTags();
    tela.loading.set(true);
    f.detectChanges();
    expect(el.querySelector('.animate-spin')).not.toBeNull();
    expect(el.querySelector('tbody')).toBeNull();
  });
});

describe('VeiculosPageComponent — tag bloqueada na listagem de veículos', () => {
  it('marca "Bloqueada" só no veículo cuja tag está bloqueada', () => {
    const { el } = build();
    const linha = (placa: string) =>
      Array.from(el.querySelectorAll('tbody tr')).find((tr) => tr.textContent?.includes(placa)) as HTMLElement;
    expect(linha('XYZ9K88').textContent).toContain('ABC9');
    expect(linha('XYZ9K88').textContent).toContain('Bloqueada');
    expect(linha('ABC1D23').textContent).not.toContain('Bloqueada');
    expect(linha('DEF4G56').textContent).toContain('Sem tag');
  });

  it('se a lista de tags não carregou, usa a tag que veio no próprio veículo', () => {
    const { tela } = build({ listTags: jest.fn(() => throwError(() => ({ status: 500 }))) });
    expect(tela.tagBloqueada(carroTagBloqueada as any)).toBe(true);
    expect(tela.tagBloqueada(carroComTag as any)).toBe(false);
    expect(tela.tagLabel(carroTagBloqueada as any)).toBe('ABC9');
  });
});
