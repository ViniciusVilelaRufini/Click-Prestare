import { TestBed } from '@angular/core/testing';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { VisitantesPageComponent } from './visitantes-page.component';
import { VisitantesService, Pessoa } from './visitantes.service';
import { ConfirmService } from '../shared/confirm.service';

/**
 * "Cadastrar e pedir autorização": cria sem liberar e já pede ao morador; a
 * janela "ao vivo" do pedido abre para a pessoa cadastrada. "Cadastrar e
 * liberar" continua igual.
 */
describe('VisitantesPageComponent — Cadastrar e pedir autorização', () => {
  let service: any;
  const criada: Pessoa = {
    id: 1000300,
    id_pessoa: 2000300,
    nome: 'QA_Pedir',
    totalVisitas: 1,
    auth_status: 'pendente',
    apartamentosVisitados: [{ id: 106, label: '106/A', visitanteId: 1000300, auth_status: 'pendente' }],
  } as unknown as Pessoa;

  function build(): VisitantesPageComponent {
    service = {
      listarPessoas: jest.fn(() => of([criada])),
      create: jest.fn(() => of({ id: 1000300, doc_identificacao: null })),
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
    return TestBed.createComponent(VisitantesPageComponent).componentInstance;
  }

  function preencher(tela: VisitantesPageComponent) {
    tela.abrirNovo();
    tela.novo.nome = 'QA_Pedir';
    tela.novo.id_apartamento = 106;
  }

  it('envia pedir_autorizacao e abre a janela do pedido da pessoa criada', () => {
    const tela = build();
    preencher(tela);
    tela.salvar('pedir');
    expect(service.create.mock.calls[0][0].pedir_autorizacao).toBe(true);
    expect(tela.authModalPessoaId()).toBe(2000300);
  });

  it('Cadastrar e liberar não pede autorização', () => {
    const tela = build();
    preencher(tela);
    tela.salvar();
    expect(service.create.mock.calls[0][0]).not.toHaveProperty('pedir_autorizacao');
    expect(tela.authModalPessoaId()).toBeNull();
  });
});
