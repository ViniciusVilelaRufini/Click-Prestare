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

  it('assembleia: segundo clique enquanto salva não envia de novo; o botão fica desabilitado', () => {
    const resposta = new Subject<any>();
    const insertAssembleia = jest.fn(() => resposta);
    const { fixture, comp } = render({ insertAssembleia });
    comp.novaAssembleia = { ...comp.novaAssembleia, titulo: 'AGO', data: '2026-11-20' };
    comp.modalAssembleia.set(true);
    fixture.detectChanges();

    comp.salvarAssembleia();
    comp.salvarAssembleia();
    fixture.detectChanges();
    expect(insertAssembleia).toHaveBeenCalledTimes(1);
    const botao = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.textContent?.includes('Salvando'));
    expect(botao?.disabled).toBe(true);

    resposta.next({});
    resposta.complete();
    expect(comp.salvandoAssembleia()).toBe(false);
  });

  it('assembleia: erro destrava para tentar de novo', () => {
    const insertAssembleia = jest.fn(() => throwError(() => ({ error: { message: 'Data inválida: use DD/MM/AAAA.' } })));
    const { comp } = render({ insertAssembleia });
    comp.novaAssembleia = { ...comp.novaAssembleia, titulo: 'AGO', data: '2026-11-20' };
    comp.salvarAssembleia();
    expect(comp.salvandoAssembleia()).toBe(false);
    expect(comp.erroAssembleia()).toBe('Data inválida: use DD/MM/AAAA.');
    comp.salvarAssembleia();
    expect(insertAssembleia).toHaveBeenCalledTimes(2);
  });

  it('enquete: segundo clique enquanto salva não envia de novo; erro destrava', () => {
    const resposta = new Subject<any>();
    const insertVotacao = jest.fn(() => resposta);
    const { comp } = render({ insertVotacao });
    comp.abrirModalEnquete();
    comp.novaVotacao.titulo = 'Pintura';
    comp.salvarVotacao();
    comp.salvarVotacao();
    expect(insertVotacao).toHaveBeenCalledTimes(1);
    expect(comp.salvandoVotacao()).toBe(true);
    resposta.error({ error: { message: 'Informe pelo menos duas opções diferentes.' } });
    expect(comp.salvandoVotacao()).toBe(false);
    expect(comp.erroModal()).toBe('Informe pelo menos duas opções diferentes.');
  });
});
