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
