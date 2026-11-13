import { registerLocaleData } from '@angular/common';
import { ɵfindLocaleData } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { OcorrenciasPageComponent } from './ocorrencias-page.component';
import { AcessoOcorrencias, Ocorrencia, OcorrenciasApi } from './ocorrencias.service';
import { ConfirmService } from '../shared/confirm.service';

registerLocaleData(ɵfindLocaleData('en'), 'pt');

/**
 * O porteiro via todos os botões da ocorrência e quase todos falhavam em
 * silêncio. Agora a tela mostra o que a API (GET ocorrencias/acesso) diz que
 * a sessão pode fazer, e todo erro aparece com a mensagem do servidor.
 * Também: chamado de "Dispositivos" fecha sozinho (sem Solucionar/Reabrir),
 * categorias são só leitura ("Definido pela Prestare") e o responsável
 * desativado aparece no select como "Nome (inativo)".
 */
describe('OcorrenciasPageComponent — ações conforme o acesso', () => {
  const PORTEIRO: AcessoOcorrencias = { operar: true, administrar: false, conversar: true };
  const SINDICO: AcessoOcorrencias = { operar: true, administrar: true, conversar: true };
  const SEM_PERMISSAO: AcessoOcorrencias = { operar: false, administrar: false, conversar: false };

  const base: Ocorrencia = {
    id: 5, descricao: 'Vazamento no 3º andar', status: 'Pendente', resposta: null, resposta_at: null,
    tipo: 2, tipoNome: 'Manutenção', created_at: '2026-11-10T10:00:00Z', publica: false,
    criadoPorNome: 'Maria', prazo: null, id_responsavel: null, responsavelNome: null,
  };

  function render(acesso: AcessoOcorrencias, ocorrencias: Ocorrencia[] = [base], extra: Partial<Record<string, any>> = {}) {
    const api: any = {
      acesso: jest.fn(() => of(acesso)),
      list: jest.fn(() => of(ocorrencias)),
      categorias: jest.fn(() => of([
        { id: 2, nome: 'Manutenção', prioridade: 2, sla_horas: 48 },
        { id: 9, nome: 'Dispositivos', prioridade: 1, sla_horas: null },
      ])),
      funcionarios: jest.fn(() => of([{ id_user: 31, nome: 'Porteiro A' }])),
      listMessages: jest.fn(() => of([])),
      updateStatus: jest.fn(() => of({})),
      ...extra,
    };
    TestBed.configureTestingModule({
      imports: [OcorrenciasPageComponent],
      providers: [
        provideRouter([]),
        { provide: OcorrenciasApi, useValue: api },
        { provide: ConfirmService, useValue: { ask: jest.fn(async () => true) } },
      ],
    });
    const fixture = TestBed.createComponent(OcorrenciasPageComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, api, comp: fixture.componentInstance };
  }

  const botao = (el: HTMLElement, texto: string) =>
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim().includes(texto));

  afterEach(() => {
    // Os intervalos de 30 s/1,5 s não podem vazar entre os testes.
    TestBed.resetTestingModule();
  });

  it('porteiro: atende (ciente, solucionar, responder, atribuir), mas não remove nem alterna Pública/Privada', () => {
    const { el, comp } = render(PORTEIRO);
    expect(botao(el, 'Marcar como ciente')).toBeTruthy();
    expect(botao(el, 'Solucionar')).toBeTruthy();
    expect(botao(el, 'Responder publicamente')).toBeTruthy();
    expect(el.querySelector('select[aria-label^="Atribuir responsável"]')).toBeTruthy();
    expect(botao(el, 'Remover')).toBeUndefined();
    const tag = Array.from(el.querySelectorAll('.ps-tag')).find((t) => t.textContent?.includes('Privada'))!;
    expect(tag.getAttribute('role')).toBeNull();
    comp.ngOnDestroy();
  });

  it('porteiro: abre o chat e escreve; o balão dele fica do lado da casa, com o nome', () => {
    const mensagens = [
      { id: 1, id_ocorrencia: 5, id_usuario: 100, mensagem: 'Continua vazando', created_at: '2026-11-10T10:00:00Z',
        autor_tipo: 'usuario', usuario: { id: 100, name: 'Maria', login_type: 'email', is_sindico: 0 } },
      { id: 2, id_ocorrencia: 5, id_usuario: null, mensagem: 'Encanador chamado', created_at: '2026-11-10T10:05:00Z',
        autor_tipo: 'portaria', usuario: { id: null, name: 'Portaria · João', login_type: 'portaria', is_sindico: 0 } },
    ];
    const { el, fixture, comp } = render(PORTEIRO, [base], { listMessages: jest.fn(() => of(mensagens)) });
    comp.abrirChat(base);
    fixture.detectChanges();
    expect(el.querySelector('input[name="mensagem"]')).toBeTruthy();
    const baloes = Array.from(el.querySelectorAll('#chat-container > div')) as HTMLElement[];
    const doMorador = baloes.find((b) => b.textContent?.includes('Continua vazando'))!;
    const doPorteiro = baloes.find((b) => b.textContent?.includes('Encanador chamado'))!;
    expect(doPorteiro.textContent).toContain('Portaria · João');
    expect(doPorteiro.classList).toContain('items-end');
    expect(doMorador.classList).toContain('items-start');
    comp.ngOnDestroy();
  });

  it('sessão que atende mas não conversa: lê sem o campo de mensagem', () => {
    const { el, fixture, comp } = render({ operar: true, administrar: false, conversar: false });
    comp.abrirChat(base);
    fixture.detectChanges();
    expect(el.querySelector('input[name="mensagem"]')).toBeNull();
    expect(el.textContent).toContain('só lê a conversa');
    comp.ngOnDestroy();
  });

  it('sem permissão: nenhum botão de atendimento, com a dica', () => {
    const { el, comp } = render(SEM_PERMISSAO);
    expect(botao(el, 'Marcar como ciente')).toBeUndefined();
    expect(botao(el, 'Solucionar')).toBeUndefined();
    expect(botao(el, 'Responder publicamente')).toBeUndefined();
    expect(el.querySelector('select[aria-label^="Atribuir responsável"]')).toBeNull();
    expect(el.textContent).toContain('Sem permissão para atender ocorrências');
    comp.ngOnDestroy();
  });

  it('síndico: tudo, inclusive Remover, Pública/Privada e o chat', () => {
    const { el, fixture, comp } = render(SINDICO);
    expect(botao(el, 'Remover')).toBeTruthy();
    const tag = Array.from(el.querySelectorAll('.ps-tag')).find((t) => t.textContent?.includes('Privada'))!;
    expect(tag.getAttribute('role')).toBe('button');
    comp.abrirChat(base);
    fixture.detectChanges();
    expect(el.querySelector('input[name="mensagem"]')).toBeTruthy();
    comp.ngOnDestroy();
  });

  it('chamado de "Dispositivos": sem Solucionar/Reabrir, com o aviso de que fecha sozinho', () => {
    const disp = { ...base, id: 6, tipo: 9, tipoNome: 'Dispositivos', criadoPorNome: 'Sistema' };
    const { el, comp } = render(SINDICO, [disp, { ...disp, id: 7, status: 'Solucionado' as const }]);
    expect(botao(el, 'Solucionar')).toBeUndefined();
    expect(botao(el, 'Reabrir')).toBeUndefined();
    expect(el.textContent).toContain('Fecha sozinho quando o aparelho voltar');
    comp.ngOnDestroy();
  });

  it('categorias / SLA: só leitura, "Definido pela Prestare"', () => {
    const { el, fixture, comp } = render(SINDICO);
    comp.abrirCategorias();
    fixture.detectChanges();
    const modal = el.querySelector('.ps-modal') as HTMLElement;
    expect(modal.textContent).toContain('Definido pela Prestare');
    expect(modal.textContent).toContain('Manutenção');
    expect(botao(modal, 'Adicionar categoria')).toBeUndefined();
    expect(botao(modal, 'Editar')).toBeUndefined();
    expect(botao(modal, 'Remover')).toBeUndefined();
    expect(modal.querySelector('input')).toBeNull();
    comp.ngOnDestroy();
  });

  it('responsável desativado aparece no select como "Nome (inativo)"', async () => {
    const { el, fixture, comp } = render(SINDICO, [{ ...base, id_responsavel: 44, responsavelNome: 'João' }]);
    await fixture.whenStable();
    fixture.detectChanges();
    const select = el.querySelector('select[aria-label^="Atribuir responsável"]') as HTMLSelectElement;
    const opcoes = Array.from(select.options).map((o) => o.textContent?.trim());
    expect(opcoes).toContain('João (inativo)');
    expect(select.options[select.selectedIndex].textContent?.trim()).toBe('João (inativo)');
    comp.ngOnDestroy();
  });

  it('erro da API ao mudar status aparece com a mensagem do servidor', async () => {
    const { el, fixture, comp } = render(PORTEIRO, [base], {
      updateStatus: jest.fn(() => throwError(() => ({ error: { message: 'Acesso negado: seu perfil não tem permissão para esta área.' } }))),
    });
    await comp.mudarStatus(base, 'Ciente');
    fixture.detectChanges();
    expect(el.textContent).toContain('Acesso negado: seu perfil não tem permissão para esta área.');
    comp.ngOnDestroy();
  });

  it('prioridade: só 1 é Crítica — 0 (categoria sem valor) não pede a confirmação de CRÍTICA', async () => {
    const confirm = { ask: jest.fn(async () => true) };
    const { comp } = render(PORTEIRO);
    (comp as any).confirm = confirm;
    expect(comp.prioridadeLabel(1).label).toBe('Crítica');
    expect(comp.prioridadeLabel(2).label).toBe('Alta');
    expect(comp.prioridadeLabel(0).label).not.toBe('Crítica');
    comp.categorias.set([{ id: 3, nome: 'Outros', prioridade: 0, sla_horas: null }]);
    await comp.mudarStatus({ ...base, tipo: 3 }, 'Ciente');
    expect((confirm.ask.mock.calls[0] as any[])[0].variant).toBe('primary');
    comp.ngOnDestroy();
  });

  it('erro da rota de acesso que não é 404: mostra o erro e não libera o atendimento', () => {
    const { el, fixture, comp } = render(SINDICO, [base], {
      acesso: jest.fn(() => throwError(() => ({ status: 500, error: { message: 'Banco indisponível.' } }))),
    });
    fixture.detectChanges();
    expect(el.textContent).toContain('Banco indisponível.');
    expect(botao(el, 'Solucionar')).toBeUndefined();
    expect(comp.acesso()).toEqual({ operar: false, administrar: false, conversar: false });
    comp.ngOnDestroy();
  });

  it('sem a rota de acesso (API antiga), cai na sessão: porteiro sem Remover', () => {
    const { el, comp } = render(SINDICO, [base], { acesso: jest.fn(() => throwError(() => ({ status: 404 }))) });
    // Sem porteiroInfo no teste a sessão é nula: atende, mas não administra nem conversa.
    expect(botao(el, 'Solucionar')).toBeTruthy();
    expect(botao(el, 'Remover')).toBeUndefined();
    comp.ngOnDestroy();
  });
});
