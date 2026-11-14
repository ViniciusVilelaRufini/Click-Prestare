import { registerLocaleData } from '@angular/common';
import { ɵfindLocaleData } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { OcorrenciasPageComponent } from './ocorrencias-page.component';
import { AcessoOcorrencias, Ocorrencia, OcorrenciasApi } from './ocorrencias.service';
import { ConfirmService } from '../shared/confirm.service';

registerLocaleData(ɵfindLocaleData('en'), 'pt');

/**
 * Ciclos da tela de Ocorrências:
 *  - erro de Registrar e do chat aparece DENTRO da gaveta (o painel da página
 *    fica atrás do scrim);
 *  - ocorrência apagada com o chat aberto: o 404 para a consulta de 1,5 s;
 *  - 409 ao mudar status (lista velha): mostra o motivo e recarrega;
 *  - duplo clique em Registrar, Enviar e Salvar resposta não duplica;
 *  - chamado de Dispositivos que não fecha sozinho (aparelho renomeado ou
 *    removido) pode ser solucionado à mão.
 */
describe('OcorrenciasPageComponent — ciclos', () => {
  const OPERA: AcessoOcorrencias = { operar: true, administrar: false, conversar: true };
  const base: Ocorrencia = {
    id: 5, descricao: 'Vazamento', status: 'Pendente', resposta: null, resposta_at: null,
    tipo: 2, tipoNome: 'Manutenção', created_at: '2026-11-10T10:00:00Z', publica: false,
    criadoPorNome: 'Maria', prazo: null, id_responsavel: null, responsavelNome: null,
  };

  function render(extra: Record<string, any> = {}, ocorrencias: Ocorrencia[] = [base]) {
    const confirm = { ask: jest.fn(async () => true) };
    const api: any = {
      acesso: jest.fn(() => of(OPERA)),
      list: jest.fn(() => of(ocorrencias)),
      categorias: jest.fn(() => of([
        { id: 2, nome: 'Manutenção', prioridade: 2, sla_horas: 48 },
        { id: 9, nome: 'Dispositivos', prioridade: 1, sla_horas: null },
      ])),
      funcionarios: jest.fn(() => of([])),
      listMessages: jest.fn(() => of([])),
      updateStatus: jest.fn(() => of({})),
      create: jest.fn(() => of({})),
      sendMessage: jest.fn(() => of({ id: 1, mensagem: 'oi', usuario: { name: 'X' } })),
      updateResposta: jest.fn(() => of({ resposta: 'ok', resposta_at: null })),
      ...extra,
    };
    TestBed.configureTestingModule({
      imports: [OcorrenciasPageComponent],
      providers: [
        provideRouter([]),
        { provide: OcorrenciasApi, useValue: api },
        { provide: ConfirmService, useValue: confirm },
      ],
    });
    const fixture = TestBed.createComponent(OcorrenciasPageComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, api, comp: fixture.componentInstance, confirm };
  }

  const botao = (el: Element, texto: string) =>
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim().includes(texto));

  afterEach(() => {
    jest.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('erro de Registrar aparece dentro da gaveta, não atrás do scrim', () => {
    const { el, fixture, comp } = render({
      create: jest.fn(() => throwError(() => ({ error: { message: 'Categoria inválida.' } }))),
    });
    comp.alternarForm(true);
    comp.novo = { descricao: 'Barulho', tipo: 2 };
    comp.registrar();
    // showForm é campo comum (na tela quem marca a view é o clique): o teste marca à mão.
    fixture.componentRef.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    const gaveta = el.querySelector('.ps-drawer') as HTMLElement;
    expect(gaveta.textContent).toContain('Categoria inválida.');
    expect(comp.error()).toBeNull();
    comp.ngOnDestroy();
  });

  it('validação de Registrar também aparece na gaveta', () => {
    const { el, fixture, comp } = render();
    comp.alternarForm(true);
    comp.novo = { descricao: '  ', tipo: 2 };
    comp.registrar();
    // showForm é campo comum (na tela quem marca a view é o clique): o teste marca à mão.
    fixture.componentRef.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect((el.querySelector('.ps-drawer') as HTMLElement).textContent).toContain('Descrição e categoria são obrigatórios.');
    comp.ngOnDestroy();
  });

  it('Registrar com a requisição em andamento: o segundo clique não cria outra ocorrência', () => {
    const pendente = new Subject<any>();
    const { el, fixture, comp, api } = render({ create: jest.fn(() => pendente) });
    comp.alternarForm(true);
    comp.novo = { descricao: 'Barulho', tipo: 2 };
    comp.registrar();
    comp.registrar();
    // showForm é campo comum (na tela quem marca a view é o clique): o teste marca à mão.
    fixture.componentRef.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(api.create).toHaveBeenCalledTimes(1);
    expect((botao(el.querySelector('.ps-drawer-foot')!, 'Registrar') as HTMLButtonElement).disabled).toBe(true);
    comp.ngOnDestroy();
  });

  it('chat: Enviar e Salvar resposta não duplicam com a requisição em andamento', () => {
    const msg = new Subject<any>();
    const resp = new Subject<any>();
    const { comp, api } = render({ sendMessage: jest.fn(() => msg), updateResposta: jest.fn(() => resp) });
    comp.abrirChat(base);
    comp.novaMensagemText = 'Já estamos vendo';
    comp.enviarMensagem();
    comp.enviarMensagem();
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    comp.iniciarEdicaoResposta(base);
    comp.tempRespostaText = 'Encanador chamado';
    comp.salvarResposta(base);
    comp.salvarResposta(base);
    expect(api.updateResposta).toHaveBeenCalledTimes(1);
    comp.ngOnDestroy();
  });

  it('erro ao enviar no chat aparece dentro da gaveta do chat', () => {
    const { el, fixture, comp } = render({
      sendMessage: jest.fn(() => throwError(() => ({ error: { message: 'Mensagem inválida.' } }))),
    });
    comp.abrirChat(base);
    comp.novaMensagemText = 'oi';
    comp.enviarMensagem();
    fixture.detectChanges();
    const gaveta = el.querySelector('.ps-drawer[role="dialog"]') as HTMLElement;
    expect(gaveta.textContent).toContain('Mensagem inválida.');
    expect(comp.error()).toBeNull();
    comp.ngOnDestroy();
  });

  it('ocorrência apagada com o chat aberto: o 404 para a consulta de 1,5 s e avisa no chat', () => {
    jest.useFakeTimers();
    const { el, fixture, comp, api } = render();
    comp.abrirChat(base);
    api.listMessages.mockReturnValue(throwError(() => ({ status: 404, error: { message: 'Ocorrência 5 não encontrada' } })));
    jest.advanceTimersByTime(1500);
    expect(comp.chatInterval).toBeNull();
    const chamadas = api.listMessages.mock.calls.length;
    jest.advanceTimersByTime(6000);
    expect(api.listMessages.mock.calls.length).toBe(chamadas);
    fixture.detectChanges();
    expect((el.querySelector('.ps-drawer[role="dialog"]') as HTMLElement).textContent).toContain('não encontrada');
    expect(comp.error()).toBeNull();
    comp.ngOnDestroy();
  });

  it('409 ao mudar status (lista velha): mostra o motivo e recarrega a lista', async () => {
    const { el, fixture, comp, api } = render({
      updateStatus: jest.fn(() => throwError(() => ({ status: 409, error: { message: 'A ocorrência já está Solucionado.' } }))),
    });
    const antes = api.list.mock.calls.length;
    await comp.mudarStatus(base, 'Ciente');
    fixture.detectChanges();
    expect(el.textContent).toContain('A ocorrência já está Solucionado.');
    expect(api.list.mock.calls.length).toBe(antes + 1);
    comp.ngOnDestroy();
  });

  it('mudar status manda o status e o updated_at que a tela mostrava', async () => {
    const vista = { ...base, updated_at: '2026-11-13T10:00:00.000Z' };
    const { comp, api } = render({}, [vista]);
    await comp.mudarStatus(vista, 'Solucionado');
    expect(api.updateStatus).toHaveBeenCalledWith(5, 'Solucionado', { status: 'Pendente', updated_at: '2026-11-13T10:00:00.000Z' });
    comp.ngOnDestroy();
  });

  it('Reabrir pede confirmação de reabertura e envia o pedido de reabrir', async () => {
    const solucionada = { ...base, status: 'Solucionado' as const };
    const { el, comp, api, confirm } = render({}, [solucionada]);
    botao(el, 'Reabrir')!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect((confirm.ask.mock.calls[0] as any[])[0].message).toContain('volta para Pendente');
    expect(api.updateStatus).toHaveBeenCalledWith(5, 'Pendente', { status: 'Solucionado', updated_at: undefined });
    comp.ngOnDestroy();
  });

  it('chamado de Dispositivos aberto pode ser solucionado à mão (aparelho renomeado ou removido); sem Reabrir', async () => {
    const disp = { ...base, id: 6, tipo: 9, tipoNome: 'Dispositivos', criadoPorNome: 'Sistema' };
    const { el, comp, api, confirm } = render({}, [disp, { ...disp, id: 7, status: 'Solucionado' as const }]);
    expect(el.textContent).toContain('Fecha sozinho quando o aparelho voltar');
    expect(botao(el, 'Reabrir')).toBeUndefined();
    const solucionar = Array.from(el.querySelectorAll('button')).filter((b) => b.textContent?.trim() === 'Solucionar');
    expect(solucionar.length).toBe(1);
    await comp.mudarStatus(disp, 'Solucionado');
    expect((confirm.ask.mock.calls[0] as any[])[0].message).toContain('novo chamado');
    expect(api.updateStatus).toHaveBeenCalledWith(6, 'Solucionado', { status: 'Pendente', updated_at: undefined });
    comp.ngOnDestroy();
  });
});
