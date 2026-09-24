import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { TerminaisFaciaisPageComponent } from './terminais-faciais-page.component';
import { TerminaisFaciaisApi } from './terminais-faciais.service';
import { AreasSociaisApi } from '../areas-sociais/areas-sociais.service';

const achadoIntelbras = { mac: 'b4:4c:3b:f4:e3:01', ip: '192.168.3.175', porta: 80, fabricante: 'intelbras', modelo: 'SS 3530 MF FACE W', numero_serie: 'K3LJ3400209RH', dhcp: true, validado_em_campo: true, id_dispositivo: null };
const achadoCid = { ...achadoIntelbras, mac: 'aa:bb:cc:dd:ee:01', ip: '192.168.3.99', fabricante: 'control_id', modelo: null, numero_serie: null, validado_em_campo: false, id_dispositivo: 4 };

function build(extra: Record<string, unknown> = {}) {
  const api = {
    list: jest.fn(() => of([])),
    syncPessoas: jest.fn(() => of([])),
    syncStatus: jest.fn(() => of({ synced: 0, pending: 0, error: 0, semFoto: 0, running: false })),
    agentInfo: jest.fn(() => of({ agent_token: 't', download_url: null })),
    agentSaude: jest.fn(() => of(null)),
    health: jest.fn(() => of({ terminais: { total: 0, offline: [], semReporteRecente: [] }, agente: { online: true, lastSeenAt: null }, fantasmas: { ultimaVarreduraEm: null, removidosHoje: 0, eventosHoje: [] } })),
    descobertos: jest.fn(() => of({ recebido_em: new Date().toISOString(), achados: [achadoIntelbras, achadoCid], avisos: [{ id_dispositivo: 4, nome: 'facial principal', de: '192.168.3.50', para: '192.168.3.99', em: new Date().toISOString() }] })),
    procurarDescobertos: jest.fn(() => of({ ok: true })),
    ...extra,
  };
  TestBed.configureTestingModule({
    imports: [TerminaisFaciaisPageComponent],
    providers: [{ provide: TerminaisFaciaisApi, useValue: api }, { provide: AreasSociaisApi, useValue: { listAreas: jest.fn(() => of([])) } }],
  });
  const f = TestBed.createComponent(TerminaisFaciaisPageComponent);
  f.detectChanges();
  return { f, tela: f.componentInstance, api };
}

describe('TerminaisFaciaisPageComponent — encontrados na rede', () => {
  it('mostra os achados, o selo de não validado e o aviso de IP corrigido', () => {
    const { f } = build();
    const txt = f.nativeElement.textContent as string;
    expect(txt).toContain('Encontrados na rede');
    expect(txt).toContain('SS 3530 MF FACE W');
    expect(txt).toContain('192.168.3.175');
    expect(txt).toContain('não validado em campo');
    expect(txt).toContain('já cadastrado');
    expect(txt).toContain('de 192.168.3.50 para 192.168.3.99');
  });

  it('Cadastrar abre o formulário preenchido e sem senha', () => {
    const { tela } = build();
    tela.abrirCadastroDe(achadoIntelbras as any);
    expect(tela.showModal()).toBe(true);
    expect(tela.editingId()).toBeNull();
    expect(tela.form).toMatchObject({ fabricante: 'intelbras', modelo: 'SS 3530 MF FACE W', ip: '192.168.3.175', porta: 80, mac: 'b4:4c:3b:f4:e3:01', numero_serie: 'K3LJ3400209RH', api_password: '' });
  });

  it('Procurar na rede chama a API e marca "procurando"', () => {
    const { tela, api } = build();
    tela.procurarNaRede();
    expect(api.procurarDescobertos).toHaveBeenCalled();
    expect(tela.procurando()).toBe(true);
  });
});

describe('TerminaisFaciaisPageComponent — encontrados na rede (revisão final)', () => {
  afterEach(() => jest.useRealTimers());

  it('"Procurando…" desiste após 60 s sem resultado novo e avisa que o agente não respondeu', () => {
    jest.useFakeTimers({ now: new Date('2026-09-24T10:00:00Z') });
    const antigo = new Date('2026-09-24T09:00:00Z').toISOString();
    const { f, tela } = build({ descobertos: jest.fn(() => of({ recebido_em: antigo, achados: [], avisos: [] })) });
    tela.procurarNaRede();
    jest.advanceTimersByTime(59_000);
    expect(tela.procurando()).toBe(true);
    jest.advanceTimersByTime(1_500);
    expect(tela.procurando()).toBe(false);
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('O agente não respondeu. Confira se ele está online.');
    tela.ngOnDestroy();
  });

  it('resultado novo antes do prazo encerra a procura sem a mensagem de falha', () => {
    jest.useFakeTimers({ now: new Date('2026-09-24T10:00:00Z') });
    let recebido = new Date('2026-09-24T09:00:00Z').toISOString();
    const { tela } = build({ descobertos: jest.fn(() => of({ recebido_em: recebido, achados: [], avisos: [] })) });
    tela.procurarNaRede();
    jest.advanceTimersByTime(10_000);
    recebido = new Date().toISOString();
    tela.loadDescobertos();
    expect(tela.procurando()).toBe(false);
    jest.advanceTimersByTime(120_000);
    // Checa o sinal (não o DOM): com o relógio falso avançado, o "há X min"
    // do cabeçalho muda sozinho e o detectChanges do teste acusaria NG0100.
    expect(tela.procuraSemResposta()).toBeNull();
    expect(tela.procurando()).toBe(false);
    tela.ngOnDestroy();
  });

  it('ngOnDestroy cancela o prazo da procura', () => {
    jest.useFakeTimers();
    const { tela } = build();
    tela.procurarNaRede();
    const comPrazo = jest.getTimerCount();
    tela.ngOnDestroy();
    // statusInterval + prazo da procura saem; o callback do prazo não roda mais.
    expect(jest.getTimerCount()).toBe(comPrazo - 2);
    jest.advanceTimersByTime(120_000);
    expect(tela.procurando()).toBe(true);
  });

  it('cabeçalho mostra a última busca ou "Nenhuma busca ainda"', () => {
    const cincoMin = new Date(Date.now() - 5 * 60_000 - 1000).toISOString();
    const { f } = build({ descobertos: jest.fn(() => of({ recebido_em: cincoMin, achados: [], avisos: [] })) });
    expect(f.nativeElement.textContent).toContain('Última busca: há 5 min');
    TestBed.resetTestingModule();
    const vazio = build({ descobertos: jest.fn(() => of({ recebido_em: null, achados: [], avisos: [] })) });
    expect(vazio.f.nativeElement.textContent).toContain('Nenhuma busca ainda');
  });

  // Sem classe (Control iD, Hikvision) fica no meio: pode ser controle de
  // acesso — só o que se declara câmera/gravador vai para o fim.
  it('rótulo por classe e controle de acesso primeiro', () => {
    const camera = { ...achadoIntelbras, mac: 'aa:bb:cc:dd:ee:02', ip: '192.168.3.20', modelo: 'IPC-1', classe: 'IPC' };
    const facial = { ...achadoIntelbras, classe: 'BSC' };
    const asc = { ...achadoIntelbras, mac: 'aa:bb:cc:dd:ee:03', ip: '192.168.3.30', modelo: 'ASC-1', classe: 'ASC1204' };
    const semClasse = { ...achadoCid, classe: null };
    const { f, tela } = build({ descobertos: jest.fn(() => of({ recebido_em: new Date().toISOString(), achados: [camera, semClasse, facial, asc], avisos: [] })) });
    expect(tela.achadosOrdenados().map((a) => a.ip)).toEqual(['192.168.3.175', '192.168.3.30', '192.168.3.99', '192.168.3.20']);
    expect(tela.rotuloClasse('BSC')).toBe('Controle de acesso');
    expect(tela.rotuloClasse('ASC1204')).toBe('Controle de acesso');
    expect(tela.rotuloClasse('IPC')).toBe('Câmera/gravador');
    expect(tela.rotuloClasse(null)).toBeNull();
    const txt = f.nativeElement.textContent as string;
    expect(txt).toContain('Controle de acesso');
    expect(txt).toContain('Câmera/gravador');
  });

  it('aviso de porta corrigida fala de porta', () => {
    const { f } = build({
      descobertos: jest.fn(() => of({ recebido_em: new Date().toISOString(), achados: [], avisos: [{ id_dispositivo: 4, nome: 'facial principal', tipo: 'porta', de: '80', para: '8080', em: new Date().toISOString() }] })),
    });
    const txt = f.nativeElement.textContent as string;
    expect(txt).toContain('Porta do facial principal atualizada de 80 para 8080');
    expect(txt).not.toContain('IP do facial principal');
  });
});
