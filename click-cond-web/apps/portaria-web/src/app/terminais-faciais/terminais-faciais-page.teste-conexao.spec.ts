import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { TerminaisFaciaisPageComponent } from './terminais-faciais-page.component';
import { TerminaisFaciaisApi } from './terminais-faciais.service';
import { AreasSociaisApi } from '../areas-sociais/areas-sociais.service';

/**
 * "Testar Conexão" com diagnóstico: a mensagem da API aparece no card do
 * dispositivo testado, com a ação que resolve o motivo; cadastrar um terminal
 * facial já dispara o teste; e o selo do aparelho não diz "Offline" quando o
 * aparelho nem chegou a ser testado.
 */
const facial = {
  id: 7,
  nome: 'Portaria',
  tipo: 'facial',
  sentido: 'auto',
  fabricante: 'intelbras',
  modelo: null,
  ip: '192.168.3.10',
  porta: 80,
  api_user: 'admin',
  ativo: 1,
  agent_online: true,
  device_online: null,
} as any;

const outro = { ...facial, id: 8, nome: 'Garagem', ip: '192.168.3.11' };

function build(extra: Record<string, unknown> = {}) {
  const api = {
    list: jest.fn(() => of([facial, outro])),
    syncPessoas: jest.fn(() => of([])),
    syncStatus: jest.fn(() => of({ synced: 0, pending: 0, error: 0, semFoto: 0, running: false })),
    agentInfo: jest.fn(() => of({ agent_token: 't', download_url: null })),
    agentSaude: jest.fn(() => of(null)),
    health: jest.fn(() => of({ terminais: { total: 2, offline: [], semReporteRecente: [] }, agente: { online: true, lastSeenAt: null }, fantasmas: { ultimaVarreduraEm: null, terminaisVarridos: 0, terminaisComFalha: [], removidosHoje: 0, eventosHoje: [] } })),
    descobertos: jest.fn(() => of({ recebido_em: null, achados: [], avisos: [] })),
    procurarDescobertos: jest.fn(() => of({ ok: true })),
    create: jest.fn((dto: any) => of({ id: 9, ...dto, webhook_token: 'abc999' })),
    update: jest.fn((_id: number, dto: any) => of({ id: 7, ...dto })),
    test: jest.fn(() => of({ online: true, motivo: null, mensagem: 'Conexão OK: o terminal respondeu.' })),
    ...extra,
  };
  TestBed.configureTestingModule({
    imports: [TerminaisFaciaisPageComponent],
    providers: [
      { provide: TerminaisFaciaisApi, useValue: api },
      { provide: AreasSociaisApi, useValue: { listAreas: jest.fn(() => of([])) } },
    ],
  });
  const f = TestBed.createComponent(TerminaisFaciaisPageComponent);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const card = (id: number) => el.querySelector(`[data-terminal="${id}"]`) as HTMLElement;
  const diag = (id: number) => card(id)?.querySelector('[data-diagnostico]') as HTMLElement | null;
  const botao = (raiz: HTMLElement | null, texto: string) =>
    Array.from(raiz?.querySelectorAll('button') ?? []).find((b) => b.textContent?.includes(texto));
  return { f, tela: f.componentInstance, api, el, card, diag, botao };
}

const falha = (motivo: string, mensagem: string, detalhe?: string) =>
  jest.fn(() => of({ online: false, motivo, mensagem, detalhe }));

describe('TerminaisFaciaisPageComponent — diagnóstico do Testar Conexão no card', () => {
  it('sucesso: a mensagem da API aparece no card testado, com role="status", e só nele', () => {
    const { f, tela, card, diag, botao } = build();
    botao(card(7), 'Testar Conexão')?.click();
    f.detectChanges();
    const d = diag(7);
    expect(d?.getAttribute('role')).toBe('status');
    expect(d?.getAttribute('data-diagnostico')).toBe('ok');
    expect(d?.textContent).toContain('Conexão OK: o terminal respondeu.');
    expect(diag(8)).toBeNull();
    expect(tela.statusMap()[7]).toBe(true);
    tela.ngOnDestroy();
  });

  it('falha: mensagem e detalhe da API, marcada como falha', () => {
    const { f, tela, diag } = build({
      test: falha('sem_resposta', 'O terminal não respondeu no endereço cadastrado.', 'ETIMEDOUT 192.168.3.10:80'),
    });
    tela.test(facial);
    f.detectChanges();
    const d = diag(7);
    expect(d?.getAttribute('data-diagnostico')).toBe('falha');
    expect(d?.textContent).toContain('O terminal não respondeu no endereço cadastrado.');
    expect(d?.textContent).toContain('ETIMEDOUT 192.168.3.10:80');
    expect(d?.querySelector('button')).toBeNull();
    expect(tela.statusMap()[7]).toBe(false);
    tela.ngOnDestroy();
  });

  it.each([
    [true, 'Dispositivo online.', 'ok'],
    [false, 'Dispositivo offline.', 'falha'],
  ])('API antiga (só { online: %s }) cai no texto simples', (online, texto, tom) => {
    const { f, tela, diag } = build({ test: jest.fn(() => of({ online })) });
    tela.test(facial);
    f.detectChanges();
    expect(diag(7)?.textContent).toContain(texto);
    expect(diag(7)?.getAttribute('data-diagnostico')).toBe(tom);
    tela.ngOnDestroy();
  });

  it.each([
    ['credencial_invalida', 'Editar credenciais'],
    ['protocolo_inesperado', 'Editar fabricante'],
  ])('%s oferece "%s", que abre a edição desse dispositivo', (motivo, rotulo) => {
    const { f, tela, diag, botao } = build({ test: falha(motivo, 'Falhou.') });
    tela.test(facial);
    f.detectChanges();
    botao(diag(7), rotulo)?.click();
    expect(tela.showModal()).toBe(true);
    expect(tela.editingId()).toBe(7);
    tela.ngOnDestroy();
  });

  it('agente_offline leva à instalação do agente e não marca o aparelho como Offline', () => {
    const { f, tela, card, diag, botao } = build({ test: falha('agente_offline', 'O agente local não está conectado.') });
    expect(tela.instalacaoAberta()).toBe(false);
    tela.test(facial);
    f.detectChanges();
    expect(tela.statusMap()[7]).toBeNull();
    expect(card(7).textContent).toContain('Não testado');
    botao(diag(7), 'Instalar ou reconectar o agente')?.click();
    expect(tela.instalacaoAberta()).toBe(true);
    tela.ngOnDestroy();
  });

  it('marca_sem_http: o aparelho não foi testado, então o selo não vira Offline', () => {
    const { tela } = build({ test: falha('marca_sem_http', 'Esta marca não aceita teste por HTTP.') });
    tela.test(facial);
    expect(tela.statusMap()[7]).toBeNull();
    tela.ngOnDestroy();
  });

  it('erro HTTP do próprio teste: avisa no card, sem marcar o aparelho como Offline', () => {
    const { f, tela, diag } = build({ test: jest.fn(() => throwError(() => ({ status: 0 }))) });
    tela.test(facial);
    f.detectChanges();
    expect(tela.testingId()).toBeNull();
    expect(diag(7)?.getAttribute('data-diagnostico')).toBe('falha');
    expect(diag(7)?.textContent).toContain('Não foi possível concluir o teste');
    expect(tela.statusMap()[7]).toBeNull();
    tela.ngOnDestroy();
  });

  it('novo teste troca o diagnóstico anterior; editar o dispositivo o descarta', () => {
    const test = jest
      .fn()
      .mockReturnValueOnce(of({ online: false, motivo: 'credencial_invalida', mensagem: 'Senha recusada.' }))
      .mockReturnValueOnce(of({ online: true, motivo: null, mensagem: 'Conexão OK.' }));
    const { f, tela, diag } = build({ test });
    tela.test(facial);
    tela.test(facial);
    f.detectChanges();
    expect(diag(7)?.textContent).toContain('Conexão OK.');
    expect(diag(7)?.textContent).not.toContain('Senha recusada.');
    tela.openEdit(facial);
    tela.save();
    f.detectChanges();
    expect(diag(7)).toBeNull();
    tela.ngOnDestroy();
  });
});

describe('TerminaisFaciaisPageComponent — teste automático ao cadastrar terminal facial', () => {
  const preencher = (tela: TerminaisFaciaisPageComponent) =>
    Object.assign(tela.form, { nome: 'Novo', ip: '192.168.3.12', api_user: 'admin', api_password: 'x' });

  it('cadastrar facial dispara o teste do recém-criado, fecha o modal e mostra o resultado no card dele', () => {
    const novo = { ...facial, id: 9, nome: 'Novo' };
    const { f, tela, api, diag } = build({
      list: jest.fn(() => of([facial, novo])),
      test: falha('credencial_invalida', 'Usuário ou senha recusados pelo terminal.'),
    });
    tela.openCreate();
    preencher(tela);
    tela.save();
    f.detectChanges();
    expect(api.test).toHaveBeenCalledTimes(1);
    expect(api.test).toHaveBeenCalledWith(9);
    expect(tela.showModal()).toBe(false);
    expect(diag(9)?.textContent).toContain('Usuário ou senha recusados pelo terminal.');
    expect(diag(7)).toBeNull();
    tela.ngOnDestroy();
  });

  it('erro de rede no teste automático: sem diagnóstico, sem aviso de erro e sem "Offline"', () => {
    const { tela, api } = build({ test: jest.fn(() => throwError(() => ({ status: 0 }))) });
    tela.openCreate();
    preencher(tela);
    tela.save();
    expect(api.test).toHaveBeenCalledWith(9);
    expect(tela.diagnosticos()[9]).toBeUndefined();
    expect(tela.errorMessage()).toBeNull();
    expect(tela.statusMap()[9]).not.toBe(false);
    expect(tela.testingId()).toBeNull();
    expect(tela.showModal()).toBe(false);
    tela.ngOnDestroy();
  });

  it.each(['tag_reader', 'qrcode_reader', 'lpr'])('cadastrar %s não dispara teste', (tipo) => {
    const { tela, api } = build();
    tela.openCreate();
    tela.form.tipo = tipo;
    tela.onTipoChange();
    Object.assign(tela.form, { nome: 'Leitor', ip: '192.168.3.40' });
    tela.save();
    expect(api.create).toHaveBeenCalled();
    expect(api.test).not.toHaveBeenCalled();
    tela.ngOnDestroy();
  });

  it('editar um terminal facial não dispara teste', () => {
    const { tela, api } = build();
    tela.openEdit(facial);
    tela.save();
    expect(api.update).toHaveBeenCalled();
    expect(api.test).not.toHaveBeenCalled();
    tela.ngOnDestroy();
  });
});
