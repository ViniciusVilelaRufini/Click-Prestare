/**
 * Critical 2 (Lote B): `salvar()` no modo "Nova Visita para pessoa existente"
 * chamava `this.service.novaVisitaPessoa(novaPara.id_pessoa!, ...)` — sem
 * fallback e com non-null assertion. Com PESSOAS_MIGRATION_ENABLED desligada
 * (ainda não confirmado se está ligada em produção), `listarPessoas` não
 * preenche `id_pessoa`, então a chamada saía com `undefined` e a rota virava
 * `/pessoa/undefined/nova-visita` — o botão "Nova Visita" quebrava.
 *
 * Mesmo dual-mode já coberto para `removerPessoa`/`atualizarPessoa`: usa
 * `id_pessoa ?? id`.
 */
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { VisitantesPageComponent } from './visitantes-page.component';
import { VisitantesService, Pessoa } from './visitantes.service';
import { ConfirmService } from '../shared/confirm.service';

function buildPessoa(overrides: Partial<Pessoa>): Pessoa {
  return {
    id: 10,
    nome: 'Fulano',
    doc_identificacao: null,
    foto_pessoa: null,
    foto_documento: null,
    is_visitante: 1,
    is_prestador: 0,
    face_id: null,
    face_sync_status: null,
    noLocal: false,
    temPinAtivo: false,
    statusLabel: 'Histórico',
    totalVisitas: 1,
    visitasAnteriores: 0,
    apartamentosVisitados: [],
    id_apartamento: 101,
    apartamentoAtual: null,
    ultEntrada: null,
    ultSaida: null,
    data_entrada: null,
    data_saida: null,
    data_hora_inicio: null,
    data_hora_termino: null,
    codigo_acesso: null,
    created_at: new Date().toISOString(),
    ...overrides,
  } as Pessoa;
}

describe('VisitantesPageComponent — salvar() nova visita para pessoa existente (Lote B, Critical 2)', () => {
  let novaVisitaPessoaSpy: jest.Mock;

  function build() {
    novaVisitaPessoaSpy = jest.fn(() => of({} as any));
    const visitantesServiceMock: Partial<VisitantesService> = {
      novaVisitaPessoa: novaVisitaPessoaSpy as any,
      listarPessoas: jest.fn(() => of([])) as any,
    };

    TestBed.configureTestingModule({
      imports: [VisitantesPageComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: VisitantesService, useValue: visitantesServiceMock },
        { provide: ActivatedRoute, useValue: { data: of({}), queryParams: of({}) } },
        { provide: ConfirmService, useValue: { confirm: jest.fn(() => Promise.resolve(true)) } },
      ],
    });

    // Não chama fixture.detectChanges(): ngOnInit dispara carregar()/polling/
    // websocket, tudo fora do escopo deste teste (que exercita só `salvar()`
    // isoladamente, sem montar o ciclo de vida inteiro do componente).
    const fixture = TestBed.createComponent(VisitantesPageComponent);
    return fixture.componentInstance;
  }

  it('caminho legado (sem id_pessoa): usa o fallback novaPara.id, não undefined', () => {
    const component = build();
    const pessoaLegado = buildPessoa({ id: 42, id_pessoa: undefined });
    component.novaVisitaPara.set(pessoaLegado);
    component.novo.id_apartamento = 101;

    component.salvar();

    expect(novaVisitaPessoaSpy).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ id_apartamento: 101 }),
    );
  });

  it('caminho migrado (com id_pessoa): usa id_pessoa, não novaPara.id', () => {
    const component = build();
    const pessoaMigrada = buildPessoa({ id: 999, id_pessoa: 42 });
    component.novaVisitaPara.set(pessoaMigrada);
    component.novo.id_apartamento = 101;

    component.salvar();

    expect(novaVisitaPessoaSpy).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ id_apartamento: 101 }),
    );
  });

  it('identifica visitante recorrente sem classificá-lo como prestador', () => {
    const component = build();

    expect(component.tipoPessoa(buildPessoa({ dias_semana: 'seg,ter,qua' }))).toBe('Visitante recorrente');
    expect(component.tipoPessoa(buildPessoa({ is_prestador: 1, dias_semana: 'seg,ter,qua' }))).toBe('Prestador');
  });
});
