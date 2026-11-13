import { TestBed } from '@angular/core/testing';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { VisitantesPageComponent } from './visitantes-page.component';
import { VisitantesService, Pessoa } from './visitantes.service';
import { ConfirmService } from '../shared/confirm.service';

/**
 * Pessoa sem nenhuma visita (a última foi removida): o `id` da linha é o id da
 * PESSOA, e os endpoints de visita (detalhes, check-in, solicitar) o resolvem
 * contra `Visitas` — dois autoincrement independentes, então a ação acertava
 * a visita de outra pessoa. Sem visita, a linha só oferece Nova Visita,
 * Editar e Remover.
 */
describe('VisitantesPageComponent — pessoa sem visita', () => {
  let service: any;

  function build(): VisitantesPageComponent {
    service = {
      listarPessoas: jest.fn(() => of([])),
      detalhes: jest.fn(() => of({})),
      checkIn: jest.fn(() => of({ ok: true })),
      solicitarAutorizacao: jest.fn(() => of({ ok: true })),
      atualizarPessoa: jest.fn(() => of({ ok: true, atualizados: 0 })),
      create: jest.fn(() => of({ id: 1 })),
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

  const semVisita = {
    id: null, // sem visita, a API não manda id de visita
    id_pessoa: 2000050,
    nome: 'QA_Sem_Visita',
    liberado: 0,
    totalVisitas: 0,
    apartamentosVisitados: [],
    data_entrada: null,
    data_saida: null,
  } as unknown as Pessoa;

  it('não tem visita', () => {
    const tela = build();
    expect(tela.temVisita(semVisita)).toBe(false);
    expect(tela.temVisita({ ...semVisita, totalVisitas: 1 } as Pessoa)).toBe(true);
  });

  it('Editar salva a identidade pela Pessoa (não cai no cadastro de pessoa nova)', () => {
    const tela = build();
    tela.abrirEditar(semVisita);
    tela.novo.nome = 'QA_Sem_Visita Novo';
    tela.salvar();
    expect(service.create).not.toHaveBeenCalled();
    expect(service.atualizarPessoa).toHaveBeenCalledWith(2000050, expect.objectContaining({ nome: 'QA_Sem_Visita Novo' }));
  });

  it('a chave da linha é a Pessoa', () => {
    const tela = build();
    expect(tela.chavePessoa(semVisita)).toBe(2000050);
  });

  it('clicar na linha não busca detalhes com o id da Pessoa', () => {
    const tela = build();
    tela.abrirDetalhes(semVisita);
    expect(service.detalhes).not.toHaveBeenCalled();
  });

  it('Registrar Entrada e Solicitar não disparam nada', () => {
    const tela = build();
    tela.registrarEntradaManual(semVisita);
    expect(tela.entradaModalPessoa()).toBeNull();
    tela.abrirSolicitar(semVisita);
    expect(tela.solicitarModalPessoa()).toBeNull();
  });
});
