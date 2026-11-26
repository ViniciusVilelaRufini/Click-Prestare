import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject, of, throwError } from 'rxjs';
import { AssembleiasPageComponent } from './assembleias-page.component';
import { AssembleiasApi } from './assembleias.service';
import { AuthService } from '../auth/auth.service';
import { ConfirmService } from '../shared/confirm.service';
import { ServerClockService } from '../core/server-clock.service';

/**
 * Rodada 4 (correção 1): convocar assembleia e criar enquete avisam os
 * moradores por push. Duplo clique em "Concluir Agendamento" ou "Confirmar
 * Cadastro" criava dois registros e mandava dois avisos: o botão trava
 * enquanto salva.
 */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.assinatura`;
}
const SINDICO = jwt({ sub: 7, nome: 'Síndico', id_condominio: 1, typeAccess: 'Sindico' });

describe('AssembleiasPageComponent — duplo clique em Convocar / Nova enquete', () => {
  function render(api: Record<string, jest.Mock>) {
    TestBed.configureTestingModule({
      imports: [AssembleiasPageComponent],
      providers: [
        {
          provide: AssembleiasApi,
          useValue: { listAssembleias: jest.fn(() => of([])), listEnquetes: jest.fn(() => of([])), ...api },
        },
        { provide: ConfirmService, useValue: { ask: jest.fn(async () => true) } },
        { provide: AuthService, useValue: { porteiroInfo: signal({ nome: 'X', turno: 'Diurno', id_condominio: 1 }), token: SINDICO } },
        { provide: ServerClockService, useValue: { agora: () => new Date('2026-11-13T15:00:00Z') } },
      ],
    });
    const fixture = TestBed.createComponent(AssembleiasPageComponent);
    fixture.detectChanges();
    return { fixture, comp: fixture.componentInstance };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('assembleia: segundo clique enquanto salva não envia de novo; o botão fica desabilitado', async () => {
    const resposta = new Subject<any>();
    const insertAssembleia = jest.fn(() => resposta);
    const { fixture, comp } = render({ insertAssembleia });
    comp.novaAssembleia = { ...comp.novaAssembleia, titulo: 'AGO', data: '2026-11-20', hora: '19:30', local: 'Salão' };
    comp.modalAssembleia.set(true);
    fixture.detectChanges();

    const p1 = comp.salvarAssembleia();
    const p2 = comp.salvarAssembleia();
    await Promise.all([p1, p2]);
    fixture.detectChanges();
    expect(insertAssembleia).toHaveBeenCalledTimes(1);
    const botao = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.textContent?.includes('Salvando'));
    expect(botao?.disabled).toBe(true);

    resposta.next({});
    resposta.complete();
    expect(comp.salvandoAssembleia()).toBe(false);
  });

  it('assembleia: erro destrava para tentar de novo', async () => {
    const insertAssembleia = jest.fn(() => throwError(() => ({ error: { message: 'Data inválida: use DD/MM/AAAA.' } })));
    const { comp } = render({ insertAssembleia });
    comp.novaAssembleia = { ...comp.novaAssembleia, titulo: 'AGO', data: '2026-11-20', hora: '19:30', local: 'Salão' };
    await comp.salvarAssembleia();
    expect(comp.salvandoAssembleia()).toBe(false);
    expect(comp.erroAssembleia()).toBe('Data inválida: use DD/MM/AAAA.');
    await comp.salvarAssembleia();
    expect(insertAssembleia).toHaveBeenCalledTimes(2);
  });

  it('enquete: segundo clique enquanto salva não envia de novo; erro destrava', () => {
    const resposta = new Subject<any>();
    const insertVotacao = jest.fn(() => resposta);
    const { comp } = render({ insertVotacao });
    comp.abrirModalEnquete();
    comp.novaVotacao.titulo = 'Pintura';
    comp.novaVotacao.data_inicio = '20/11/2026';
    comp.novaVotacao.data_termino = '27/11/2026';
        comp.salvarVotacao();
    comp.salvarVotacao();
    expect(insertVotacao).toHaveBeenCalledTimes(1);
    expect(comp.salvandoVotacao()).toBe(true);
    resposta.error({ error: { message: 'Informe pelo menos duas opções diferentes.' } });
    expect(comp.salvandoVotacao()).toBe(false);
    expect(comp.erroModal()).toBe('Informe pelo menos duas opções diferentes.');
  });
});

describe('AssembleiasPageComponent — datas da votacao explicitas', () => {
  afterEach(() => TestBed.resetTestingModule());

  function montar(insertVotacao: jest.Mock) {
    TestBed.configureTestingModule({
      imports: [AssembleiasPageComponent],
      providers: [
        { provide: AssembleiasApi, useValue: { listAssembleias: jest.fn(() => of([])), listEnquetes: jest.fn(() => of([])), insertVotacao } },
        { provide: ConfirmService, useValue: { ask: jest.fn(async () => true) } },
        { provide: AuthService, useValue: { porteiroInfo: signal({ nome: 'X', turno: 'Diurno', id_condominio: 1 }), token: SINDICO } },
        { provide: ServerClockService, useValue: { agora: () => new Date('2026-11-13T15:00:00Z') } },
      ],
    });
    const fixture = TestBed.createComponent(AssembleiasPageComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('enquete/pauta abrem sem datas e nao salvam sem elas', () => {
    const insertVotacao = jest.fn(() => of({}));
    const comp = montar(insertVotacao);
    comp.abrirModalEnquete();
    expect(comp.novaVotacao.data_inicio).toBe('');
    expect(comp.novaVotacao.data_termino).toBe('');
    comp.novaVotacao.titulo = 'X';
    comp.salvarVotacao();
    expect(insertVotacao).not.toHaveBeenCalled();
    expect(comp.erroModal()).toContain('DD/MM/AAAA');
    comp.novaVotacao.data_inicio = '20/11/2026';
    comp.novaVotacao.data_termino = '19/11/2026';
    comp.salvarVotacao();
    expect(insertVotacao).not.toHaveBeenCalled();
    comp.novaVotacao.data_termino = '27/11/2026';
    comp.salvarVotacao();
    expect(insertVotacao).toHaveBeenCalledTimes(1);
  });
});
