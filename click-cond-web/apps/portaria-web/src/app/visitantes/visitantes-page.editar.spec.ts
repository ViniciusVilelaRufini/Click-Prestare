import { TestBed } from '@angular/core/testing';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { VisitantesPageComponent } from './visitantes-page.component';
import { VisitantesService, Pessoa } from './visitantes.service';
import { ConfirmService } from '../shared/confirm.service';

/**
 * Editar só o nome reenviava TODOS os campos do formulário: `bloqueado: 0`
 * (a API reescrevia `liberado` de todas as visitas), `tag_rfid` (vazia quando
 * a lista não a trazia → apagava a credencial) e `is_prestador` (0 quando a
 * lista não o trazia → o prestador virava visitante). Agora só vai o que o
 * operador mudou.
 */
describe('VisitantesPageComponent — editar envia só o que mudou', () => {
  let service: any;

  function build(): VisitantesPageComponent {
    service = {
      listarPessoas: jest.fn(() => of([])),
      atualizarPessoa: jest.fn(() => of({ ok: true, atualizados: 1 })),
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

  const prestador = {
    id: 1000010,
    id_pessoa: 2000010,
    nome: 'QA_Prestador',
    doc_identificacao: '',
    is_prestador: 1,
    is_visitante: 0,
    tag_rfid: 'BC614E',
    bloqueado: 0,
    dias_semana: 'seg,ter',
    categorias: 'Elétrica',
    foto_pessoa: null,
    foto_documento: null,
    data_hora_inicio: null,
    data_hora_termino: null,
    apartamentosVisitados: [],
  } as unknown as Pessoa;

  it('trocar só o nome não envia bloqueado, tag, tipo, dias nem categorias', () => {
    const tela = build();
    tela.abrirEditar(prestador);
    tela.novo.nome = 'QA_Prestador Novo';
    tela.salvar();
    expect(service.atualizarPessoa).toHaveBeenCalledTimes(1);
    const [id, dto] = service.atualizarPessoa.mock.calls[0];
    expect(id).toBe(2000010);
    expect(dto.nome).toBe('QA_Prestador Novo');
    for (const campo of ['bloqueado', 'tag_rfid', 'is_prestador', 'is_visitante', 'dias_semana', 'categorias']) {
      expect(dto).not.toHaveProperty(campo);
    }
  });

  it('trocar a tag e bloquear envia esses campos', () => {
    const tela = build();
    tela.abrirEditar(prestador);
    tela.novo.tag_rfid = '00AA11';
    tela.novo.bloqueado = 1;
    tela.salvar();
    const [, dto] = service.atualizarPessoa.mock.calls[0];
    expect(dto.tag_rfid).toBe('00AA11');
    expect(dto.bloqueado).toBe(1);
    expect(dto).not.toHaveProperty('is_prestador');
  });

  it('apagar a tag envia null', () => {
    const tela = build();
    tela.abrirEditar(prestador);
    tela.novo.tag_rfid = '  ';
    tela.salvar();
    expect(service.atualizarPessoa.mock.calls[0][1].tag_rfid).toBeNull();
  });
});
