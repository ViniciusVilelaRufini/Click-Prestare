import { TestBed } from '@angular/core/testing';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of, Subject } from 'rxjs';
import { VisitantesPageComponent } from './visitantes-page.component';
import { VisitantesService, Pessoa } from './visitantes.service';
import { ConfirmService } from '../shared/confirm.service';

/**
 * Varredura 24/11, P8: "Liberar Catraca / Portão" da janela de autorização
 * não tinha trava de duplo clique — dois cliques antes da resposta mandavam
 * duas liberações. Enquanto a ação está em andamento, os botões da janela
 * ficam desabilitados (signal, sem zone.js) e voltam se a ação falhar.
 */
describe('VisitantesPageComponent — janela de autorização trava os botões durante a ação (zoneless)', () => {
  afterEach(() => TestBed.resetTestingModule());

  const pessoa = {
    id: 1000004,
    id_pessoa: 2000001,
    nome: 'QA_Trava',
    totalVisitas: 1,
    liberado: 0,
    data_entrada: null,
    data_saida: null,
    id_apartamento: 106,
    auth_status: 'pendente',
    auth_solicitado_em: new Date().toISOString(),
    apartamentosVisitados: [
      { id: 106, label: '106/A', visitanteId: 1000004, liberado: false, auth_status: 'pendente' },
    ],
  } as unknown as Pessoa;

  async function montar() {
    const resposta$ = new Subject<any>();
    const service = {
      listarPessoas: jest.fn(() => of([pessoa])),
      liberar: jest.fn(() => resposta$),
    };
    TestBed.configureTestingModule({
      imports: [VisitantesPageComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: VisitantesService, useValue: service },
        { provide: ActivatedRoute, useValue: { data: of({}), queryParams: of({}) } },
        { provide: ConfirmService, useValue: { ask: jest.fn(() => Promise.resolve(true)) } },
      ],
    });
    const fixture = TestBed.createComponent(VisitantesPageComponent);
    const tela = fixture.componentInstance;
    await fixture.whenStable();
    tela.authModalPessoaId.set(tela.chavePessoa(tela.pessoas()[0]));
    await fixture.whenStable();
    const botoes = () =>
      Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).filter((b) =>
        /Liberar Catraca|Registrar Entrada/.test(b.textContent ?? ''),
      );
    const liberar = () => botoes().find((b) => /Liberar Catraca/.test(b.textContent ?? ''))!;
    return { fixture, tela, service, resposta$, botoes, liberar };
  }

  it('o segundo clique em Liberar não manda outra liberação e os botões ficam desabilitados', async () => {
    const { fixture, service, botoes, liberar } = await montar();
    expect(liberar()).toBeTruthy();
    expect(botoes().every((b) => !b.disabled)).toBe(true);

    liberar().click();
    await fixture.whenStable();
    expect(service.liberar).toHaveBeenCalledTimes(1);
    expect(botoes().length).toBeGreaterThan(0);
    expect(botoes().every((b) => b.disabled)).toBe(true);

    // Mesmo que o clique chegue (o botão desabilitado não dispara, mas a
    // trava também está no método), não sai uma segunda liberação.
    liberar().click();
    fixture.componentInstance.liberarAcessoEFechar(fixture.componentInstance.pessoas()[0]);
    await fixture.whenStable();
    expect(service.liberar).toHaveBeenCalledTimes(1);
  });

  it('falha da liberação: a janela mostra o erro e os botões voltam', async () => {
    const { fixture, tela, resposta$, botoes, liberar } = await montar();
    liberar().click();
    await fixture.whenStable();
    expect(botoes().every((b) => b.disabled)).toBe(true);

    resposta$.error({ status: 500, error: { message: 'Falhou' } });
    await fixture.whenStable();
    expect(tela.acaoModalEmAndamento()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Falha ao liberar acesso: Falhou');
    expect(botoes().every((b) => !b.disabled)).toBe(true);
  });

  it('sucesso: a trava é solta e a janela fecha', async () => {
    const { fixture, tela, resposta$ } = await montar();
    tela.liberarAcessoEFechar(tela.pessoas()[0]);
    expect(tela.acaoModalEmAndamento()).toBe(true);
    resposta$.next({ ok: true });
    resposta$.complete();
    await fixture.whenStable();
    expect(tela.acaoModalEmAndamento()).toBe(false);
    expect(tela.authModalPessoaId()).toBeNull();
  });
});
