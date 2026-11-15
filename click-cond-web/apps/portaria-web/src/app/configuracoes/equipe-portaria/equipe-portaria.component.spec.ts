import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { EquipePortariaComponent, LoginPortaria } from './equipe-portaria.component';
import { AuthService } from '../../auth/auth.service';
import { ConfirmService } from '../../shared/confirm.service';
import { API_BASE } from '../../shared/api.config';

/**
 * Aba "Equipe da portaria" (rodada 4, raia e): lista os logins de portaria do condomínio e deixa o síndico
 * ativar/desativar e mudar o turno. Criar e excluir continuam pelo app do síndico e pelo cadastro de prestador.
 */
const URL = `${API_BASE}/condominios/1/portaria/equipe`;

const lista = (): LoginPortaria[] => [
  { id: 12, nome: 'Ana', login: 'ana@x.com', email: 'ana@x.com', telefone: '', turno: 'Diurno', ativo: true,
    ultimo_acesso: '2026-11-12T08:30:00.000Z', origem: 'app', prestador: null, email_de_prestador: false, sindico: false, voce: false },
  { id: 13, nome: 'Eletricista', login: 'ele@x.com', email: 'ele@x.com', telefone: '', turno: 'Geral', ativo: false,
    ultimo_acesso: null, origem: 'prestador', prestador: { id: 1, nome: 'Eletricista' }, email_de_prestador: false, sindico: false, voce: false },
  { id: 14, nome: 'Síndico', login: 'sind@x.com', email: 'sind@x.com', telefone: '', turno: 'Síndico', ativo: true,
    ultimo_acesso: null, origem: 'app', prestador: null, email_de_prestador: false, sindico: true, voce: true },
  { id: 15, nome: 'Zé Noite', login: 'jose@x.com', email: 'jose@x.com', telefone: '', turno: 'Noturno', ativo: true,
    ultimo_acesso: null, origem: 'app', prestador: null, email_de_prestador: true, sindico: false, voce: false },
];

describe('EquipePortariaComponent', () => {
  let http: HttpTestingController;
  let ask: jest.Mock;

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  function render() {
    ask = jest.fn(() => Promise.resolve(true));
    TestBed.configureTestingModule({
      imports: [EquipePortariaComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { porteiroInfo: signal({ nome: 'Síndico', turno: 'Síndico', id_condominio: 1 }) } },
        { provide: ConfirmService, useValue: { ask } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(EquipePortariaComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, cmp: fixture.componentInstance };
  }

  function carregar(fixture: { detectChanges(): void }, dados = lista()) {
    http.expectOne({ method: 'GET', url: URL }).flush(dados);
    fixture.detectChanges();
  }

  async function estabilizar(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) {
    await Promise.resolve();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const linha = (el: HTMLElement, id: number) => el.querySelector(`[data-login-portaria="${id}"]`) as HTMLElement;
  const botao = (el: HTMLElement, id: number, acao: string) =>
    linha(el, id)?.querySelector(`button[data-acao="${acao}"]`) as HTMLButtonElement | null;

  it('lista todos os logins com status, turno, origem e marcas', () => {
    const { fixture, el } = render();
    carregar(fixture);
    expect(linha(el, 12).textContent).toContain('Ana');
    expect(linha(el, 12).textContent).toContain('ana@x.com');
    expect(linha(el, 12).textContent).toContain('Diurno');
    expect(linha(el, 12).textContent).toContain('Ativo');
    expect(linha(el, 12).textContent).toContain('12/11/2026');
    expect(linha(el, 13).textContent).toContain('Inativo');
    expect(linha(el, 13).textContent).toContain('Prestador: Eletricista');
    expect(linha(el, 14).textContent).toContain('Você');
    expect(linha(el, 15).textContent).toContain('E-mail de prestador');
  });

  it('erro ao carregar mostra a mensagem da API e o botão de tentar de novo', () => {
    const { fixture, el } = render();
    http.expectOne(URL).flush({ message: 'Acesso negado: ver a equipe da portaria exige síndico.' }, { status: 403, statusText: 'Forbidden' });
    fixture.detectChanges();
    expect(el.textContent).toContain('Acesso negado: ver a equipe da portaria exige síndico.');
    (el.querySelector('button[data-acao="recarregar"]') as HTMLButtonElement).click();
    carregar(fixture);
    expect(linha(el, 12)).toBeTruthy();
  });

  it('desativar pede confirmação, envia PATCH { ativo: false } e atualiza a linha', async () => {
    const { fixture, el } = render();
    carregar(fixture);
    botao(el, 12, 'desativar')!.click();
    await estabilizar(fixture);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0].message).toContain('30 segundos');
    const req = http.expectOne({ method: 'PATCH', url: `${URL}/12` });
    expect(req.request.body).toEqual({ ativo: false });
    req.flush({ id: 12, ativo: false, turno: 'Diurno' });
    fixture.detectChanges();
    expect(linha(el, 12).textContent).toContain('Inativo');
    expect(botao(el, 12, 'ativar')).toBeTruthy();
  });

  it('desistir na confirmação não envia nada', async () => {
    const { fixture, el } = render();
    carregar(fixture);
    ask.mockResolvedValueOnce(false);
    botao(el, 12, 'desativar')!.click();
    await estabilizar(fixture);
    http.expectNone({ method: 'PATCH' });
  });

  it('ativar vai direto e envia { ativo: true }', async () => {
    const { fixture, el } = render();
    carregar(fixture);
    botao(el, 13, 'ativar')!.click();
    await estabilizar(fixture);
    expect(ask).not.toHaveBeenCalled();
    const req = http.expectOne({ method: 'PATCH', url: `${URL}/13` });
    expect(req.request.body).toEqual({ ativo: true });
    req.flush({ id: 13, ativo: true, turno: 'Geral' });
    fixture.detectChanges();
    expect(linha(el, 13).textContent).toContain('Ativo');
  });

  it('a própria linha do síndico não tem o botão de desativar', () => {
    const { fixture, el } = render();
    carregar(fixture);
    expect(botao(el, 14, 'desativar')).toBeNull();
    expect(botao(el, 14, 'turno')).toBeTruthy();
  });

  it('mudar o turno envia PATCH { turno } e mostra o novo valor', async () => {
    const { fixture, el, cmp } = render();
    carregar(fixture);
    botao(el, 12, 'turno')!.click();
    fixture.detectChanges();
    cmp.turnoEditado = 'Noturno';
    (linha(el, 12).querySelector('button[data-acao="salvar-turno"]') as HTMLButtonElement).click();
    const req = http.expectOne({ method: 'PATCH', url: `${URL}/12` });
    expect(req.request.body).toEqual({ turno: 'Noturno' });
    req.flush({ id: 12, ativo: true, turno: 'Noturno' });
    fixture.detectChanges();
    expect(linha(el, 12).textContent).toContain('Noturno');
    expect(linha(el, 12).querySelector('button[data-acao="salvar-turno"]')).toBeNull();
  });

  it('turno vazio não é enviado', () => {
    const { fixture, el, cmp } = render();
    carregar(fixture);
    botao(el, 12, 'turno')!.click();
    fixture.detectChanges();
    cmp.turnoEditado = '   ';
    (linha(el, 12).querySelector('button[data-acao="salvar-turno"]') as HTMLButtonElement).click();
    http.expectNone({ method: 'PATCH' });
    fixture.detectChanges();
    expect(el.textContent).toContain('Informe o turno.');
  });

  it('recusa da API ao alterar mostra a mensagem e mantém a linha como estava', async () => {
    const { fixture, el } = render();
    carregar(fixture);
    botao(el, 12, 'desativar')!.click();
    await estabilizar(fixture);
    http.expectOne({ method: 'PATCH', url: `${URL}/12` }).flush(
      { message: 'Você não pode desativar o seu próprio acesso.' },
      { status: 400, statusText: 'Bad Request' },
    );
    fixture.detectChanges();
    expect(el.textContent).toContain('Você não pode desativar o seu próprio acesso.');
    expect(linha(el, 12).textContent).toContain('Ativo');
  });
});
