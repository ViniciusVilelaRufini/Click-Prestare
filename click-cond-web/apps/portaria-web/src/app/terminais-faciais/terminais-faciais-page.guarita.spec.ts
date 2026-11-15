import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { TerminaisFaciaisPageComponent } from './terminais-faciais-page.component';
import { TerminaisFaciaisApi } from './terminais-faciais.service';
import { AreasSociaisApi } from '../areas-sociais/areas-sociais.service';
import { GuaritaService } from '../guarita/guarita.service';

/**
 * Cadastro do Módulo Guarita (Nice/Linear) na tela de aparelhos: nome, IP,
 * porta 9000 e palavra de autorização (segredo, nunca reexibido). O painel do
 * Guarita só existe quando há aparelho do tipo `guarita`.
 */
const facial = {
  id: 3, nome: 'Portaria', tipo: 'facial', sentido: 'auto', fabricante: 'intelbras', modelo: null,
  ip: '192.168.3.10', porta: 80, ativo: 1, webhook_token: 'tok',
} as any;
const guarita = {
  id: 7, nome: 'Guarita garagem', tipo: 'guarita', sentido: 'auto', fabricante: 'linear', modelo: 'MG3000',
  ip: '192.168.3.30', porta: 9000, ativo: 1, api_user: null, api_password: 'enc:v1:segredo-cifrado', webhook_token: 'tok2',
} as any;

const guaritaApi = {
  estado: jest.fn(() => of({})),
  backups: jest.fn(() => of([])),
  portoes: jest.fn(() => of([])),
};

function build(lista: any[] = [], extra: Record<string, unknown> = {}) {
  const api = {
    list: jest.fn(() => of(lista)),
    syncPessoas: jest.fn(() => of([])),
    syncStatus: jest.fn(() => of({ synced: 0, pending: 0, error: 0, semFoto: 0, running: false })),
    agentInfo: jest.fn(() => of({ agent_token: 't', download_url: null })),
    agentSaude: jest.fn(() => of(null)),
    health: jest.fn(() => of({ terminais: { total: 0, offline: [], semReporteRecente: [] }, agente: { online: true, lastSeenAt: null }, fantasmas: { ultimaVarreduraEm: null, terminaisVarridos: 0, terminaisComFalha: [], removidosHoje: 0, eventosHoje: [] } })),
    descobertos: jest.fn(() => of({ recebido_em: null, achados: [], avisos: [] })),
    procurarDescobertos: jest.fn(() => of({ ok: true })),
    create: jest.fn((dto: any) => of({ id: 9, ...dto })),
    update: jest.fn((_id: number, dto: any) => of({ id: 7, ...dto })),
    test: jest.fn(() => of({ online: true })),
    ...extra,
  };
  TestBed.configureTestingModule({
    imports: [TerminaisFaciaisPageComponent],
    providers: [
      { provide: TerminaisFaciaisApi, useValue: api },
      { provide: AreasSociaisApi, useValue: { listAreas: jest.fn(() => of([])) } },
      { provide: GuaritaService, useValue: guaritaApi },
    ],
  });
  const f = TestBed.createComponent(TerminaisFaciaisPageComponent);
  f.detectChanges();
  return { f, tela: f.componentInstance, api, el: f.nativeElement as HTMLElement };
}

function escolherGuarita(f: any, el: HTMLElement) {
  const tipo = el.querySelector('select[name="tipo"]') as HTMLSelectElement;
  tipo.value = 'guarita';
  tipo.dispatchEvent(new Event('change'));
  f.detectChanges();
}

afterEach(() => TestBed.resetTestingModule());

describe('TerminaisFaciaisPageComponent — cadastro do Módulo Guarita', () => {
  it('o tipo "Módulo Guarita (Nice/Linear)" aparece no seletor', async () => {
    const { f, tela, el } = build();
    tela.openCreate();
    f.detectChanges();
    await f.whenStable();
    const opcoes = Array.from(el.querySelectorAll('select[name="tipo"] option')).map((o) => o.textContent?.trim());
    expect(opcoes).toContain('Módulo Guarita (Nice/Linear)');
    tela.ngOnDestroy();
  });

  it('pede nome, IP, porta (padrão 9000) e a palavra de autorização em campo de senha', async () => {
    const { f, tela, el } = build();
    tela.openCreate();
    f.detectChanges();
    await f.whenStable();
    escolherGuarita(f, el);
    expect(tela.form.tipo).toBe('guarita');
    expect(tela.form.fabricante).toBe('linear');
    expect(tela.form.porta).toBe(9000);
    const modal = el.querySelector('.ps-modal') as HTMLElement;
    expect(modal.querySelector('input[name="nome"]')).not.toBeNull();
    expect(modal.querySelector('input[name="ip"]')).not.toBeNull();
    expect(modal.querySelector('input[name="porta"]')).not.toBeNull();
    const palavra = modal.querySelector('input[name="palavra_guarita"]') as HTMLInputElement;
    expect(palavra).not.toBeNull();
    expect(palavra.type).toBe('password');
    expect(palavra.getAttribute('autocomplete')).toBe('new-password');
    // Sem usuário HTTP, sem sentido do aparelho, sem área de lazer, sem confiança.
    expect(modal.querySelector('input[name="api_user"]')).toBeNull();
    expect(modal.querySelector('select[name="sentido"]')).toBeNull();
    expect(modal.querySelector('select[name="id_area_social"]')).toBeNull();
    expect(modal.querySelector('input[name="confianca_minima"]')).toBeNull();
    tela.ngOnDestroy();
  });

  it('voltar para outro tipo devolve a porta 80', () => {
    const { tela } = build();
    tela.openCreate();
    tela.form.tipo = 'guarita';
    tela.onTipoChange();
    expect(tela.form.porta).toBe(9000);
    tela.form.tipo = 'botoeira';
    tela.onTipoChange();
    expect(tela.form.porta).toBe(80);
    tela.ngOnDestroy();
  });

  it('não apaga a porta que o operador digitou', () => {
    const { tela } = build();
    tela.openCreate();
    tela.form.tipo = 'guarita';
    tela.onTipoChange();
    tela.form.porta = 9001;
    tela.form.tipo = 'facial';
    tela.onTipoChange();
    tela.form.tipo = 'guarita';
    tela.onTipoChange();
    expect(tela.form.porta).toBe(9001);
    tela.ngOnDestroy();
  });

  it('salva com tipo guarita, fabricante linear, porta 9000 e a palavra no campo de senha, sem usuário', () => {
    const { tela, api } = build();
    tela.openCreate();
    tela.form.tipo = 'guarita';
    tela.onTipoChange();
    Object.assign(tela.form, { nome: 'Guarita garagem', ip: '192.168.3.30', api_password: 'Portao#1' });
    tela.save();
    expect(tela.modalError()).toBeNull();
    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'guarita', fabricante: 'linear', porta: 9000, api_password: 'Portao#1', api_user: undefined, sentido: 'auto', id_area_social: null }),
    );
    tela.ngOnDestroy();
  });

  it('sem palavra também salva (Guarita sem autorização TCP)', () => {
    const { tela, api } = build();
    tela.openCreate();
    tela.form.tipo = 'guarita';
    tela.onTipoChange();
    Object.assign(tela.form, { nome: 'Guarita', ip: '192.168.3.30' });
    tela.save();
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'guarita', api_password: undefined }));
    tela.ngOnDestroy();
  });

  it.each(['Portão1', 'palavra-longa-demais', 'tab\tx', 'til~'])('palavra inválida (%s) não salva e explica', (palavra) => {
    const { tela, api } = build();
    tela.openCreate();
    tela.form.tipo = 'guarita';
    tela.onTipoChange();
    Object.assign(tela.form, { nome: 'Guarita', ip: '192.168.3.30', api_password: palavra });
    tela.save();
    expect(api.create).not.toHaveBeenCalled();
    expect(tela.modalError()).toBe('Use até 15 caracteres, sem acentos.');
    tela.ngOnDestroy();
  });

  it('segundo Guarita recusado (400): a mensagem da API aparece no modal como veio', () => {
    const msg = 'Este condomínio já tem um Módulo Guarita.';
    const { tela } = build([], { create: jest.fn(() => throwError(() => ({ status: 400, error: { message: msg } }))) });
    tela.openCreate();
    tela.form.tipo = 'guarita';
    tela.onTipoChange();
    Object.assign(tela.form, { nome: 'Guarita 2', ip: '192.168.3.31' });
    tela.save();
    expect(tela.modalError()).toBe(msg);
    tela.ngOnDestroy();
  });

  it('exclusão recusada (409): a mensagem da API aparece como veio', () => {
    const msg = 'O Guarita ainda tem dispositivos gravados pelo Prestare.';
    const conf = jest.spyOn(window, 'confirm').mockReturnValue(true);
    const { tela } = build([guarita], { remove: jest.fn(() => throwError(() => ({ status: 409, error: { message: msg } }))) });
    tela.remove(guarita);
    expect(tela.errorMessage()).toBe(msg);
    conf.mockRestore();
    tela.ngOnDestroy();
  });

  it('editar diz se há palavra gravada (tem_palavra), e fechar o modal limpa a palavra digitada', async () => {
    const { f, tela, el } = build([{ ...guarita, tem_palavra: true }]);
    tela.openEdit({ ...guarita, tem_palavra: true });
    f.detectChanges();
    await f.whenStable();
    expect(el.querySelector('[data-nota-palavra]')?.textContent).toContain('Há uma palavra gravada.');
    tela.form.api_password = 'NovaPalavra';
    tela.closeModal();
    expect(tela.form.api_password).toBe('');
    tela.openEdit({ ...guarita, tem_palavra: false });
    f.detectChanges();
    expect(el.querySelector('[data-nota-palavra]')?.textContent).toContain('Nenhuma palavra gravada.');
    tela.ngOnDestroy();
  });

  it('a palavra nunca vai para o log do navegador', () => {
    const espioes = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => undefined));
    const { tela } = build();
    tela.openCreate();
    tela.form.tipo = 'guarita';
    tela.onTipoChange();
    Object.assign(tela.form, { nome: 'Guarita', ip: '192.168.3.30', api_password: 'PalavraSecreta9' });
    tela.save();
    for (const e of espioes) {
      const tudo = JSON.stringify(e.mock.calls);
      expect(tudo).not.toContain('PalavraSecreta9');
      e.mockRestore();
    }
    tela.ngOnDestroy();
  });

  it('editar: a palavra (mesmo cifrada) nunca é reexibida; em branco mantém a atual', async () => {
    const { f, tela, el, api } = build([guarita]);
    tela.openEdit(guarita);
    f.detectChanges();
    await f.whenStable();
    expect(tela.form.api_password).toBe('');
    const palavra = el.querySelector('.ps-modal input[name="palavra_guarita"]') as HTMLInputElement;
    expect(palavra.value).toBe('');
    expect(el.querySelector('.ps-modal')?.textContent).not.toContain('enc:v1');
    expect(el.querySelector('[data-nota-palavra]')?.textContent).toContain('Em branco mantém a palavra atual');
    tela.save();
    expect(api.update).toHaveBeenCalledWith(7, expect.objectContaining({ api_password: undefined, porta: 9000 }));
    tela.ngOnDestroy();
  });
});

describe('TerminaisFaciaisPageComponent — painel do Guarita só com Guarita', () => {
  it('sem aparelho do tipo guarita: nenhum painel do Guarita e nenhuma chamada ao Guarita', () => {
    guaritaApi.estado.mockClear();
    const { el, tela } = build([facial]);
    expect(el.querySelector('app-guarita-config')).toBeNull();
    expect(el.textContent).not.toContain('Guarita');
    expect(guaritaApi.estado).not.toHaveBeenCalled();
    tela.ngOnDestroy();
  });

  it('com Guarita: o cartão diz "Módulo Guarita", sem Web GUI/webhook, e o painel aparece', () => {
    const { el, tela } = build([facial, guarita]);
    const cartao = el.querySelector('[data-terminal="7"]') as HTMLElement;
    expect(cartao.textContent).toContain('Módulo Guarita');
    expect(cartao.textContent).not.toContain('Acessar Web GUI');
    expect(cartao.textContent).not.toContain('Copiar URL Webhook');
    // O facial continua com os botões de sempre.
    const outro = el.querySelector('[data-terminal="3"]') as HTMLElement;
    expect(outro.textContent).toContain('Acessar Web GUI');
    expect(outro.textContent).toContain('Copiar URL Webhook');
    expect(el.querySelectorAll('app-guarita-config').length).toBe(1);
    expect(el.textContent).toContain('Integração não validada em aparelho');
    tela.ngOnDestroy();
  });

  it('Guarita desativado não ganha painel', () => {
    const { el, tela } = build([{ ...guarita, ativo: 0 }]);
    expect(el.querySelector('app-guarita-config')).toBeNull();
    tela.ngOnDestroy();
  });
});
