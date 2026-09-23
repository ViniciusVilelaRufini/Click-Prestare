import { TestBed } from '@angular/core/testing';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { VisitantesPageComponent } from './visitantes-page.component';
import { VisitantesService, Pessoa } from './visitantes.service';
import { ConfirmService } from '../shared/confirm.service';

/**
 * Solicitar autorização numa visita já encerrada agora cria uma visita nova
 * (para não apagar o histórico). O `id` da linha é o da visita principal e
 * muda junto; o modal "Autorização de Acesso" procurava a pessoa por ele e
 * fechava sozinho no primeiro recarregamento. A chave é a PESSOA.
 */
describe('VisitantesPageComponent — modal de autorização segue a pessoa', () => {
  function build(): VisitantesPageComponent {
    TestBed.configureTestingModule({
      imports: [VisitantesPageComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: VisitantesService, useValue: { listarPessoas: jest.fn(() => of([])) } },
        { provide: ActivatedRoute, useValue: { data: of({}), queryParams: of({}) } },
        { provide: ConfirmService, useValue: { confirm: jest.fn(() => Promise.resolve(true)) } },
      ],
    });
    return TestBed.createComponent(VisitantesPageComponent).componentInstance;
  }

  const pessoa = (id: number, id_pessoa?: number) =>
    ({ id, id_pessoa, nome: 'QA_SECURITY_20260923', apartamentosVisitados: [] }) as unknown as Pessoa;

  it('continua aberto quando a visita principal da pessoa muda de id', () => {
    const tela = build();
    tela.pessoas.set([pessoa(1000004, 2000001)]);
    tela.authModalPessoaId.set(tela.chavePessoa(tela.pessoas()[0]));

    tela.pessoas.set([pessoa(1000005, 2000001)]); // recarga após criar a visita nova

    expect(tela.authModalPessoa()?.id).toBe(1000005);
  });

  it('modelo legado (sem id_pessoa) continua pelo id', () => {
    const tela = build();
    tela.pessoas.set([pessoa(42)]);
    tela.authModalPessoaId.set(tela.chavePessoa(tela.pessoas()[0]));
    expect(tela.authModalPessoa()?.id).toBe(42);
  });
});
