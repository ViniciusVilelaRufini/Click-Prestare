import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { AssembleiasPageComponent } from './assembleias-page.component';
import { AssembleiasApi } from './assembleias.service';
import { AuthService } from '../auth/auth.service';
import { ConfirmService } from '../shared/confirm.service';

/**
 * Assembleias no console:
 *  - o porteiro abria "Painel de Pautas", tomava 403 e a página ficava presa
 *    no spinner; os botões de criar/excluir/encerrar falhavam calados (a API
 *    recusa o porteiro com assertStaff). Agora todo erro aparece e o porteiro
 *    não vê os botões que a API recusa (papel do token, como em comunicados);
 *  - "Finalizar e Gerar ATA" chegava à API sem o PDF: agora pede o arquivo.
 */

/** JWT de mentira (só o payload importa para a tela). */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.assinatura`;
}
const SINDICO = jwt({ sub: 7, nome: 'Síndico', id_condominio: 1, typeAccess: 'Sindico' });
const PORTEIRO = jwt({ sub: 3, nome: 'João', id_condominio: 1, turno: 'Diurno', tipo_sub: 'funcionario_portaria' });

const ASSEMBLEIA = { id: 2, titulo: 'AGO 2026', data: '10/11/2026', hora: '19:30' };
const ENQUETE = { id: 9, titulo: 'Academia', data_inicio: '01/11/2026', data_termino: '30/11/2026', status: 1, opcoes: ['1;Sim;2'] };
const DETALHE = {
  assembleia: ASSEMBLEIA,
  votacoes: [{ id: 10, titulo: 'Contas', data_inicio: '', data_termino: '', status: 1, opcoes: ['1;Aprovar;1'] }],
  meusVotos: [],
};

describe('AssembleiasPageComponent — erros, papel e ATA', () => {
  function render(token: string, extra: Partial<Record<string, any>> = {}) {
    const api: any = {
      listAssembleias: jest.fn(() => of([ASSEMBLEIA])),
      listEnquetes: jest.fn(() => of([ENQUETE])),
      getAssembleia: jest.fn(() => of(DETALHE)),
      finishAssembleia: jest.fn(() => of({ message: 'ok' })),
      removeAssembleia: jest.fn(() => of({})),
      removeVotacao: jest.fn(() => of({})),
      finishVotacao: jest.fn(() => of({})),
      insertAssembleia: jest.fn(() => of({})),
      ...extra,
    };
    TestBed.configureTestingModule({
      imports: [AssembleiasPageComponent],
      providers: [
        { provide: AssembleiasApi, useValue: api },
        { provide: ConfirmService, useValue: { ask: jest.fn(async () => true) } },
        { provide: AuthService, useValue: { porteiroInfo: signal({ nome: 'X', turno: 'Diurno', id_condominio: 1 }), token } },
      ],
    });
    const fixture = TestBed.createComponent(AssembleiasPageComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, api, comp: fixture.componentInstance };
  }

  const botao = (el: HTMLElement, texto: string) =>
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim().includes(texto));

  beforeEach(() => jest.spyOn(window, 'alert').mockImplementation(() => undefined));
  afterEach(() => {
    TestBed.resetTestingModule();
    jest.restoreAllMocks();
  });

  it('painel de pautas com erro: sai do spinner e mostra a mensagem da API', () => {
    const { fixture, el, comp } = render(PORTEIRO, {
      getAssembleia: jest.fn(() => throwError(() => ({ error: { message: 'Sessão sem usuário válido.' } }))),
    });
    comp.verAssembleia(2);
    fixture.detectChanges();
    expect(comp.loading()).toBe(false);
    expect(el.textContent).toContain('Sessão sem usuário válido.');
    expect(botao(el, 'Assembleias Oficiais')).toBeTruthy();
  });

  it('lista com erro: sai do spinner e mostra a mensagem', () => {
    const { fixture, el, comp } = render(SINDICO, {
      listAssembleias: jest.fn(() => throwError(() => ({ message: 'Http failure' }))),
    });
    fixture.detectChanges();
    expect(comp.loading()).toBe(false);
    expect(el.textContent).toContain('Http failure');
  });

  it('enquetes com erro: sai do spinner e mostra a mensagem', () => {
    const { fixture, el, comp } = render(SINDICO, {
      listEnquetes: jest.fn(() => throwError(() => ({ error: { message: 'Falhou enquetes' } }))),
    });
    fixture.detectChanges();
    expect(comp.loading()).toBe(false);
    expect(el.textContent).toContain('Falhou enquetes');
  });

  it('porteiro: só consulta — sem Agendar, Nova Enquete, Excluir, Encerrar, Pauta e Finalizar', () => {
    const { fixture, el, comp } = render(PORTEIRO);
    expect(botao(el, 'Agendar Assembleia')).toBeUndefined();
    expect(botao(el, 'Nova Enquete')).toBeUndefined();
    expect(el.querySelector('button[title="Excluir"]')).toBeNull();
    expect(botao(el, 'Painel de Pautas')).toBeTruthy();

    comp.tab.set('enquetes');
    fixture.detectChanges();
    expect(botao(el, 'Encerrar Imediatamente')).toBeUndefined();
    expect(el.querySelector('button[title="Excluir enquete"]')).toBeNull();

    comp.tab.set('assembleias');
    comp.verAssembleia(2);
    fixture.detectChanges();
    expect(el.textContent).toContain('Contas');
    expect(botao(el, 'Adicionar Pauta')).toBeUndefined();
    expect(botao(el, 'Finalizar e Gerar ATA')).toBeUndefined();
    expect(botao(el, 'Excluir')).toBeUndefined();
  });

  it('síndico: vê os botões de gestão', () => {
    const { fixture, el, comp } = render(SINDICO);
    expect(botao(el, 'Agendar Assembleia')).toBeTruthy();
    expect(botao(el, 'Nova Enquete')).toBeTruthy();
    expect(el.querySelector('button[title="Excluir"]')).toBeTruthy();
    comp.verAssembleia(2);
    fixture.detectChanges();
    expect(botao(el, 'Finalizar e Gerar ATA')).toBeTruthy();
    expect(botao(el, 'Adicionar Pauta')).toBeTruthy();
  });

  it('excluir assembleia com erro: mostra a mensagem', async () => {
    const { fixture, el, comp } = render(SINDICO, {
      removeAssembleia: jest.fn(() => throwError(() => ({ error: { message: 'Acesso negado.' } }))),
    });
    await comp.excluirAssembleia(2);
    fixture.detectChanges();
    expect(el.textContent).toContain('Acesso negado.');
    expect(comp.assembleias()).toHaveLength(1);
  });

  it('encerrar enquete com erro: mostra a mensagem', () => {
    const { fixture, el, comp } = render(SINDICO, {
      finishVotacao: jest.fn(() => throwError(() => ({ error: { message: 'Não encerrou.' } }))),
    });
    comp.encerrarVotacao(9);
    fixture.detectChanges();
    expect(el.textContent).toContain('Não encerrou.');
  });

  it('agendar com erro: o drawer fica aberto e mostra a mensagem dentro dele', () => {
    const { fixture, el, comp } = render(SINDICO, {
      insertAssembleia: jest.fn(() => throwError(() => ({ error: { message: 'Data inválida.' } }))),
    });
    comp.abrirModalAssembleia();
    comp.novaAssembleia.titulo = 'AGE';
    comp.salvarAssembleia();
    fixture.detectChanges();
    expect(comp.modalAssembleia()).toBe(true);
    expect(el.querySelector('.ps-drawer')?.textContent).toContain('Data inválida.');
  });

  describe('Finalizar e Gerar ATA', () => {
    it('não finaliza sem o PDF: abre o drawer pedindo o arquivo', () => {
      const { fixture, el, comp, api } = render(SINDICO);
      comp.verAssembleia(2);
      fixture.detectChanges();
      botao(el, 'Finalizar e Gerar ATA')!.click();
      fixture.detectChanges();
      const drawer = el.querySelector('.ps-drawer') as HTMLElement;
      expect(drawer.textContent).toContain('PDF da ATA');
      expect(drawer.querySelector('input[type="file"]')).toBeTruthy();
      const enviar = botao(drawer, 'Finalizar e publicar ATA') as HTMLButtonElement;
      expect(enviar.disabled).toBe(true);
      comp.confirmarFinalizacao();
      expect(api.finishAssembleia).not.toHaveBeenCalled();
    });

    it('com o PDF: envia o arquivo em `doc`', () => {
      const { fixture, comp, api } = render(SINDICO);
      comp.verAssembleia(2);
      comp.abrirFinalizar(ASSEMBLEIA as any);
      comp.ataBase64 = 'data:application/pdf;base64,JVBERi0=';
      comp.confirmarFinalizacao();
      fixture.detectChanges();
      expect(api.finishAssembleia).toHaveBeenCalledWith(
        expect.objectContaining({ id: 2, titulo: 'AGO 2026', data: '10/11/2026', doc: 'data:application/pdf;base64,JVBERi0=' }),
      );
      expect(comp.modalFinalizar()).toBe(false);
    });

    it('erro da API: drawer continua aberto com a mensagem', () => {
      const { fixture, el, comp } = render(SINDICO, {
        finishAssembleia: jest.fn(() => throwError(() => ({ error: { message: 'Anexe o PDF da ATA.' } }))),
      });
      comp.verAssembleia(2);
      comp.abrirFinalizar(ASSEMBLEIA as any);
      comp.ataBase64 = 'data:application/pdf;base64,JVBERi0=';
      comp.confirmarFinalizacao();
      fixture.detectChanges();
      expect(comp.modalFinalizar()).toBe(true);
      expect(el.querySelector('.ps-drawer')?.textContent).toContain('Anexe o PDF da ATA.');
    });
  });
});
