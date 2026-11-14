import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { TerminaisFaciaisPageComponent } from './terminais-faciais-page.component';
import { TerminaisFaciaisApi } from './terminais-faciais.service';
import { AreasSociaisApi } from '../areas-sociais/areas-sociais.service';
import { ConfirmService } from '../shared/confirm.service';

/**
 * Tirar o espaço de um terminal de área faz o terminal deixar de ser "de
 * reserva": o próximo sync enrola todos os moradores nele. O console pede
 * confirmação antes de gravar.
 */
const terminal = {
  id: 7, nome: 'Facial piscina', tipo: 'facial', sentido: 'auto', fabricante: 'intelbras', modelo: null,
  ip: '192.168.3.40', porta: 80, ativo: 1, api_user: 'admin', id_area_social: 30, controle_acesso_facial: 1,
} as any;

function build(confirma: boolean) {
  const api = {
    list: jest.fn(() => of([])),
    syncPessoas: jest.fn(() => of([])),
    syncStatus: jest.fn(() => of({ synced: 0, pending: 0, error: 0, semFoto: 0, running: false })),
    agentInfo: jest.fn(() => of({ agent_token: 't', download_url: null })),
    agentSaude: jest.fn(() => of(null)),
    health: jest.fn(() => of({ terminais: { total: 0, offline: [], semReporteRecente: [] }, agente: { online: true, lastSeenAt: null }, fantasmas: { ultimaVarreduraEm: null, terminaisVarridos: 0, terminaisComFalha: [], removidosHoje: 0, eventosHoje: [] } })),
    descobertos: jest.fn(() => of({ recebido_em: null, achados: [], avisos: [] })),
    procurarDescobertos: jest.fn(() => of({ ok: true })),
    update: jest.fn((_id: number, dto: any) => of({ id: 7, ...dto })),
  };
  const confirm = { ask: jest.fn(() => Promise.resolve(confirma)) };
  TestBed.configureTestingModule({
    imports: [TerminaisFaciaisPageComponent],
    providers: [
      { provide: TerminaisFaciaisApi, useValue: api },
      { provide: AreasSociaisApi, useValue: { listAreas: jest.fn(() => of([{ id: 30, nome: 'Piscina' }])) } },
      { provide: ConfirmService, useValue: confirm },
    ],
  });
  const f = TestBed.createComponent(TerminaisFaciaisPageComponent);
  f.detectChanges();
  return { tela: f.componentInstance, api, confirm };
}

const esperar = () => new Promise((r) => setTimeout(r, 0));

describe('TerminaisFaciaisPageComponent — remover o espaço do terminal', () => {
  it('pede confirmação avisando que o terminal passa a liberar todos; cancelar não grava', async () => {
    const { tela, api, confirm } = build(false);
    tela.openEdit(terminal);
    tela.form.id_area_social = null;
    tela.save();
    await esperar();
    expect(confirm.ask).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'danger',
      message: 'Sem espaço vinculado, este terminal passa a liberar todos os moradores do condomínio.',
    }));
    expect(api.update).not.toHaveBeenCalled();
    tela.ngOnDestroy();
  });

  it('confirmando, grava sem área', async () => {
    const { tela, api } = build(true);
    tela.openEdit(terminal);
    tela.form.id_area_social = null;
    tela.save();
    await esperar();
    expect(api.update).toHaveBeenCalledWith(7, expect.objectContaining({ id_area_social: null }));
    tela.ngOnDestroy();
  });

  it('mantendo o espaço (ou terminal que já era sem área), não pergunta', () => {
    const { tela, api, confirm } = build(true);
    tela.openEdit(terminal);
    tela.form.nome = 'Facial piscina 2';
    tela.save();
    tela.openEdit({ ...terminal, id_area_social: null });
    tela.save();
    expect(confirm.ask).not.toHaveBeenCalled();
    expect(api.update).toHaveBeenCalledTimes(2);
    tela.ngOnDestroy();
  });
});
