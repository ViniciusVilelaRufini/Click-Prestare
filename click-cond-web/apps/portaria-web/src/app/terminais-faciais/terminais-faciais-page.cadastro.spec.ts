import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { TerminaisFaciaisPageComponent } from './terminais-faciais-page.component';
import { TerminaisFaciaisApi } from './terminais-faciais.service';
import { AreasSociaisApi } from '../areas-sociais/areas-sociais.service';

/**
 * Cadastro de dispositivo em poucos cliques: o que a varredura achou já vem
 * preenchido, o erro aparece dentro do modal, o sentido padrão acompanha o
 * tipo e o leitor por webhook termina mostrando a URL a configurar.
 */
const achado = {
  mac: 'b4:4c:3b:f4:e3:01',
  ip: '192.168.3.175',
  porta: 80,
  fabricante: 'intelbras',
  modelo: 'SS 3530 MF FACE W',
  numero_serie: 'K3LJ3400209RH',
  dhcp: true,
  validado_em_campo: true,
  classe: 'BSC',
  id_dispositivo: null,
} as any;

const terminal = {
  id: 7,
  nome: 'Leitor garagem',
  tipo: 'tag_reader',
  sentido: 'saida',
  fabricante: 'hid',
  modelo: null,
  ip: '192.168.3.40',
  porta: 80,
  ativo: 1,
  webhook_token: 'tok123',
} as any;

function build(extra: Record<string, unknown> = {}) {
  const api = {
    list: jest.fn(() => of([])),
    syncPessoas: jest.fn(() => of([])),
    syncStatus: jest.fn(() => of({ synced: 0, pending: 0, error: 0, semFoto: 0, running: false })),
    agentInfo: jest.fn(() => of({ agent_token: 't', download_url: null })),
    agentSaude: jest.fn(() => of(null)),
    health: jest.fn(() => of({ terminais: { total: 0, offline: [], semReporteRecente: [] }, agente: { online: true, lastSeenAt: null }, fantasmas: { ultimaVarreduraEm: null, terminaisVarridos: 0, terminaisComFalha: [], removidosHoje: 0, eventosHoje: [] } })),
    descobertos: jest.fn(() => of({ recebido_em: null, achados: [], avisos: [] })),
    procurarDescobertos: jest.fn(() => of({ ok: true })),
    create: jest.fn((dto: any) => of({ id: 9, ...dto, webhook_token: 'abc999' })),
    update: jest.fn((_id: number, dto: any) => of({ id: 7, ...dto })),
    // Cadastrar terminal facial dispara o teste de conexão do recém-criado.
    test: jest.fn(() => of({ online: true })),
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
  return { f, tela: f.componentInstance, api, el: f.nativeElement as HTMLElement };
}

describe('TerminaisFaciaisPageComponent — cadastro a partir do aparelho descoberto', () => {
  it('sugere nome "<marca> <modelo> (.<octeto>)", usuário admin e tipo facial para controle de acesso', () => {
    const { tela } = build();
    tela.abrirCadastroDe(achado);
    expect(tela.form).toMatchObject({
      nome: 'Intelbras SS 3530 MF FACE W (.175)',
      api_user: 'admin',
      api_password: '',
      tipo: 'facial',
      sentido: 'auto',
    });
    tela.ngOnDestroy();
  });

  it('sem modelo o nome fica "<marca> (.<octeto>)"', () => {
    const { tela } = build();
    tela.abrirCadastroDe({ ...achado, fabricante: 'control_id', modelo: null, ip: '192.168.3.99', classe: null });
    expect(tela.form.nome).toBe('Control iD (.99)');
    // Sem classe informada pode ser controle de acesso: continua facial.
    expect(tela.form.tipo).toBe('facial');
    tela.ngOnDestroy();
  });

  it('câmera/gravador abre como LPR, já com sentido entrada', () => {
    const { tela } = build();
    tela.abrirCadastroDe({ ...achado, modelo: 'VIP 5450', ip: '192.168.3.20', classe: 'IPC' });
    expect(tela.form).toMatchObject({ tipo: 'lpr', sentido: 'entrada', fabricante: 'intelbras', api_user: 'admin' });
    tela.ngOnDestroy();
  });

  it('abre com o foco no campo de senha', () => {
    const { f, tela, el } = build();
    tela.abrirCadastroDe(achado);
    f.detectChanges();
    const senha = el.querySelector('input[name="api_password"]');
    expect(senha).not.toBeNull();
    expect(document.activeElement).toBe(senha);
    tela.ngOnDestroy();
  });
});

describe('TerminaisFaciaisPageComponent — erro de validação dentro do modal', () => {
  it('senha faltando: mensagem diz o campo e aparece dentro do modal com role="alert"', () => {
    const { f, tela, el, api } = build();
    tela.abrirCadastroDe(achado);
    tela.save();
    f.detectChanges();
    expect(api.create).not.toHaveBeenCalled();
    const alerta = el.querySelector('.ps-modal [role="alert"]');
    expect(alerta?.textContent).toContain('senha');
    // O aviso do topo fica atrás do modal — não é para lá que o erro vai.
    expect(tela.errorMessage()).toBeNull();
    tela.ngOnDestroy();
  });

  it('cada campo obrigatório tem a sua mensagem', () => {
    const { tela } = build();
    tela.openCreate();
    tela.save();
    expect(tela.modalError()).toContain('nome');
    tela.form.nome = 'Portaria';
    tela.save();
    expect(tela.modalError()).toContain('IP');
    tela.form.ip = '192.168.3.10';
    tela.save();
    expect(tela.modalError()).toContain('usuário');
    tela.ngOnDestroy();
  });

  it('falha da API ao salvar também aparece no modal', () => {
    const { tela } = build({ create: jest.fn(() => throwError(() => ({ error: { message: 'IP inválido.' } }))) });
    tela.openCreate();
    Object.assign(tela.form, { nome: 'Portaria', ip: '999', api_user: 'admin', api_password: 'x' });
    tela.save();
    expect(tela.modalError()).toBe('IP inválido.');
    expect(tela.showModal()).toBe(true);
    tela.ngOnDestroy();
  });

  it('reabrir o modal limpa o erro anterior', () => {
    const { tela } = build();
    tela.openCreate();
    tela.save();
    expect(tela.modalError()).not.toBeNull();
    tela.closeModal();
    tela.openCreate();
    expect(tela.modalError()).toBeNull();
    tela.save();
    tela.openEdit(terminal);
    expect(tela.modalError()).toBeNull();
    tela.save();
    tela.abrirCadastroDe(achado);
    expect(tela.modalError()).toBeNull();
    tela.ngOnDestroy();
  });
});

describe('TerminaisFaciaisPageComponent — sentido padrão por tipo', () => {
  it.each(['tag_reader', 'qrcode_reader', 'lpr'])('cadastro novo de %s pré-seleciona entrada', (tipo) => {
    const { tela } = build();
    tela.openCreate();
    expect(tela.form.sentido).toBe('auto');
    tela.form.tipo = tipo;
    tela.onTipoChange();
    expect(tela.form.sentido).toBe('entrada');
    tela.ngOnDestroy();
  });

  it('voltar para terminal facial devolve o automático que a tela tinha trocado', () => {
    const { tela } = build();
    tela.openCreate();
    tela.form.tipo = 'lpr';
    tela.onTipoChange();
    tela.form.tipo = 'facial';
    tela.onTipoChange();
    expect(tela.form.sentido).toBe('auto');
    tela.ngOnDestroy();
  });

  it('na edição não sobrescreve o sentido escolhido', () => {
    const { tela } = build();
    tela.openEdit({ ...terminal, tipo: 'facial', sentido: 'saida' });
    tela.form.tipo = 'lpr';
    tela.onTipoChange();
    expect(tela.form.sentido).toBe('saida');
    tela.ngOnDestroy();
  });

  it('a ajuda do sentido muda conforme o tipo', () => {
    const { f, tela, el } = build();
    tela.openCreate();
    f.detectChanges();
    expect(el.querySelector('.ps-modal')?.textContent).toContain('última passagem');
    expect(el.querySelector('.ps-modal')?.textContent).not.toContain('assume entrada');
    tela.ngOnDestroy();
  });
});

describe('TerminaisFaciaisPageComponent — textos de ajuda', () => {
  it('não usa nome de coluna do banco', () => {
    const { tela } = build();
    const textos = tela.tiposDispositivo.map((t) => t.hint).join(' ');
    expect(textos).not.toMatch(/coluna|tag_rfid|qrcode_acesso/);
    const tag = tela.tiposDispositivo.find((t) => t.value === 'tag_reader');
    expect(tag?.hint).toContain('morador, no visitante ou no veículo');
    tela.ngOnDestroy();
  });

  it('leitor de tag avisa que as marcas dependem do envio HTTP', async () => {
    const { f, tela, el } = build();
    tela.openCreate();
    f.detectChanges();
    await f.whenStable();
    expect(el.querySelector('[data-nota-marca]')).toBeNull();
    // Troca pelo próprio seletor, como o operador faz.
    const tipo = el.querySelector('select[name="tipo"]') as HTMLSelectElement;
    tipo.value = 'tag_reader';
    tipo.dispatchEvent(new Event('change'));
    f.detectChanges();
    expect(tela.form.tipo).toBe('tag_reader');
    expect(tela.form.sentido).toBe('entrada');
    const nota = el.querySelector('[data-nota-marca]')?.textContent ?? '';
    expect(nota).toContain('HTTP');
    expect(nota).toContain('Hikvision');
    expect(nota).toContain('Wiegand');
    tela.ngOnDestroy();
  });
});

describe('TerminaisFaciaisPageComponent — URL do webhook', () => {
  const clipboard = { writeText: jest.fn() };
  beforeEach(() => {
    clipboard.writeText.mockClear();
    Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
  });

  it('sem token (não é síndico) o botão fica desabilitado com a dica e nada é copiado', () => {
    const semToken = { ...terminal, webhook_token: undefined };
    const { tela, el } = build({ list: jest.fn(() => of([semToken])) });
    const botao = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Copiar URL Webhook'));
    expect(botao?.disabled).toBe(true);
    expect(botao?.getAttribute('title')).toBe('Somente o síndico vê a URL do webhook');
    tela.copyToken(semToken);
    expect(clipboard.writeText).not.toHaveBeenCalled();
    tela.ngOnDestroy();
  });

  it('com token o botão copia a URL completa', () => {
    const { tela, el } = build({ list: jest.fn(() => of([terminal])) });
    const botao = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Copiar URL Webhook'));
    expect(botao?.disabled).toBe(false);
    botao?.click();
    expect(clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/api/facial/webhook/tok123`);
    tela.ngOnDestroy();
  });

  it.each(['tag_reader', 'qrcode_reader', 'lpr'])('salvar %s novo mostra o passo final com a URL e "Concluir" fecha', (tipo) => {
    const { f, tela, el } = build();
    tela.openCreate();
    tela.form.tipo = tipo;
    tela.onTipoChange();
    Object.assign(tela.form, { nome: 'Leitor', ip: '192.168.3.40' });
    tela.save();
    f.detectChanges();
    const url = `${window.location.origin}/api/facial/webhook/abc999`;
    expect(tela.showModal()).toBe(true);
    expect(tela.webhookCriado()?.url).toBe(url);
    const modal = el.querySelector('.ps-modal') as HTMLElement;
    expect((modal.querySelector('input[readonly]') as HTMLInputElement).value).toBe(url);
    expect(modal.textContent).toContain('HTTP POST');
    expect(modal.querySelector('form')).toBeNull();
    tela.copiarWebhookCriado();
    expect(clipboard.writeText).toHaveBeenCalledWith(url);
    const concluir = Array.from(modal.querySelectorAll('button')).find((b) => b.textContent?.includes('Concluir'));
    concluir?.click();
    expect(tela.showModal()).toBe(false);
    expect(tela.webhookCriado()).toBeNull();
    tela.ngOnDestroy();
  });

  it('terminal facial novo fecha direto, sem passo de webhook', () => {
    const { tela } = build();
    tela.openCreate();
    Object.assign(tela.form, { nome: 'Portaria', ip: '192.168.3.10', api_user: 'admin', api_password: 'x' });
    tela.save();
    expect(tela.showModal()).toBe(false);
    expect(tela.webhookCriado()).toBeNull();
    tela.ngOnDestroy();
  });

  it('sem token na resposta fecha direto', () => {
    const { tela } = build({ create: jest.fn((dto: any) => of({ id: 9, ...dto })) });
    tela.openCreate();
    tela.form.tipo = 'tag_reader';
    tela.onTipoChange();
    Object.assign(tela.form, { nome: 'Leitor', ip: '192.168.3.40' });
    tela.save();
    expect(tela.showModal()).toBe(false);
    tela.ngOnDestroy();
  });

  it('editar um leitor não reabre o passo de webhook', () => {
    const { tela, api } = build();
    tela.openEdit(terminal);
    tela.save();
    expect(api.update).toHaveBeenCalled();
    expect(tela.showModal()).toBe(false);
    tela.ngOnDestroy();
  });
});

describe('TerminaisFaciaisPageComponent — credenciais da câmera LPR', () => {
  it('LPR salva sem usuário e senha (a leitura chega por webhook)', () => {
    const { tela, api } = build();
    tela.openCreate();
    tela.form.tipo = 'lpr';
    tela.onTipoChange();
    Object.assign(tela.form, { nome: 'LPR garagem', ip: '192.168.3.60' });
    tela.save();
    expect(tela.modalError()).toBeNull();
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'lpr', sentido: 'entrada' }));
    tela.ngOnDestroy();
  });

  it('terminal facial continua exigindo usuário e senha', () => {
    const { tela, api } = build();
    tela.openCreate();
    Object.assign(tela.form, { nome: 'Portaria', ip: '192.168.3.10', api_user: 'admin' });
    tela.save();
    expect(api.create).not.toHaveBeenCalled();
    expect(tela.modalError()).toContain('senha');
    tela.ngOnDestroy();
  });
});
