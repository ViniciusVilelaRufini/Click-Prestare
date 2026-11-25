import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { VisitantesPageComponent } from './visitantes-page.component';
import { VisitantesService, Pessoa, VisitanteDetalhes } from './visitantes.service';
import { ConfirmService } from '../shared/confirm.service';
import { RealtimeService } from '../shared/realtime.service';
import { ApartamentosApi } from '../apartamentos/apartamentos.service';
import { rotuloStatusVisita } from './rotulo-status-visita.util';

/**
 * Varredura do console web 25/11/2026 (logado como síndico, produção):
 * W1 detalhe x lista com status diferentes; W3 "·" solto; W4 modal sem
 * role=dialog; W5 números sem dizer o que contam; W7 recorrente com janela de 4 h.
 */
describe('VisitantesPageComponent — varredura web 25/11', () => {
  let fixture: ComponentFixture<VisitantesPageComponent>;
  let service: any;

  afterEach(() => TestBed.resetTestingModule());

  const h = (horas: number) => new Date(Date.now() + horas * 3600_000).toISOString();
  const min = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

  let seq = 0;
  function pessoa(extra: Partial<Pessoa> & Record<string, unknown>): Pessoa {
    seq++;
    return {
      id: 1000 + seq,
      id_pessoa: 5000 + seq,
      nome: `QA_${seq}`,
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
      liberado: 0,
      totalVisitas: 1,
      visitasAnteriores: 0,
      apartamentosVisitados: [],
      id_apartamento: 106,
      apartamentoAtual: null,
      data_entrada: null,
      data_saida: null,
      ...extra,
    } as unknown as Pessoa;
  }

  const detalhe = (over: Partial<VisitanteDetalhes['visitante']> = {}): VisitanteDetalhes =>
    ({
      visitante: {
        id: 1,
        nome: 'Fulano Detalhe',
        doc_identificacao: null,
        foto_pessoa: null,
        foto_documento: null,
        is_visitante: 1,
        is_prestador: 0,
        id_apartamento: 106,
        blocoAptoAtual: '106/A',
        face_id: null,
        face_sync_status: null,
        condominio: null,
        criadoPor: null,
        data_hora_inicio: '2026-11-15T10:00:00Z',
        data_hora_termino: '2026-11-15T14:00:00Z',
        codigo_acesso: null,
        data_entrada: null,
        data_saida: null,
        tag_rfid: null,
        created_at: '2026-11-15T10:00:00Z',
        ...over,
      },
      stats: {
        totalEntradas: 7,
        totalSaidas: 7,
        totalNegados: 0,
        primeiraVisita: null,
        ultimaVisita: null,
        acessosFaciais: 0,
        acessosPin: 14,
        tempoMedioMs: null,
        permanenciaCount: 0,
        apartamentosVisitados: [{ id: 106, blocoApto: '106/A', visitas: 13 }],
      },
      timeline: [],
    }) as unknown as VisitanteDetalhes;

  async function montar(lista: Pessoa[], det: VisitanteDetalhes = detalhe()) {
    service = {
      listarPessoas: jest.fn(() => of(lista)),
      detalhes: jest.fn(() => of(det)),
      create: jest.fn(() => of({ id: 1 })),
      novaVisitaPessoa: jest.fn(() => of({ ok: true })),
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
        { provide: RealtimeService, useValue: { connect: () => null, disconnect: jest.fn() } },
        { provide: ApartamentosApi, useValue: { list: () => of([]) } },
      ],
    });
    fixture = TestBed.createComponent(VisitantesPageComponent);
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  const texto = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

  describe('W1 — uma regra só para o rótulo do status', () => {
    const casos: [string, Partial<Pessoa> & Record<string, unknown>][] = [
      ['janela e pedido expirados', { pedido_expirado: true, data_hora_inicio: '2026-11-15T10:00:00Z', data_hora_termino: '2026-11-15T14:00:00Z' }],
      ['presente', { liberado: 1, noLocal: true, data_entrada: h(-1) }],
      ['presente há 13 h', { liberado: 1, noLocal: true, data_entrada: h(-13) }],
      ['liberado', { liberado: 1, data_hora_inicio: h(-1), data_hora_termino: h(3) }],
      ['agendado', { liberado: 1, data_hora_inicio: h(2), data_hora_termino: h(5) }],
      ['autorizado pelo morador', { auth_status: 'autorizado', auth_respondido_em: min(-2) }],
      ['negado', { auth_status: 'negado', auth_respondido_em: min(-2) }],
      ['pendente recente', { auth_status: 'pendente', auth_solicitado_em: min(-1) }],
      ['pendente sem resposta', { auth_status: 'pendente', auth_solicitado_em: min(-5) }],
      ['autorização expirada', { autorizacao_expirada: true }],
      ['janela encerrada', { liberado: 1, data_hora_inicio: h(-6), data_hora_termino: h(-2) }],
      ['saiu', { data_entrada: h(-3), data_saida: h(-2) }],
      ['sem visita', { id: null, totalVisitas: 0 }],
    ];

    it('a função dá o MESMO texto que a lista (tabela e celular), caso a caso', async () => {
      const lista = casos.map(([, extra]) => pessoa(extra));
      const tela = await montar(lista);
      const celulasTabela = fixture.nativeElement.querySelectorAll('td[data-status-visita]');
      const celulasCelular = fixture.nativeElement.querySelectorAll('div[data-status-visita]');
      expect(celulasTabela.length).toBe(casos.length);
      expect(celulasCelular.length).toBe(casos.length);
      const exibidas = tela.visitantesPaginados();
      exibidas.forEach((p, i) => {
        const r = rotuloStatusVisita(p as any, Date.now());
        const esperado = r.alerta ? `${r.label} ${r.alerta}` : r.label;
        expect(texto(celulasTabela[i])).toBe(esperado);
        expect(texto(celulasCelular[i])).toBe(esperado);
      });
      // A ordem da lista muda, mas todos os rótulos aparecem.
      const todos = Array.from(celulasTabela as NodeListOf<Element>).map(texto);
      expect(todos).toContain('Pedido expirado');
      expect(todos).toContain('Sem resposta');
      expect(todos).toContain('Janela encerrada');
    });

    it('o detalhe de visita com janela e pedido expirados diz "Pedido expirado" (não "Aguardando entrada")', async () => {
      const p = pessoa({ pedido_expirado: true, data_hora_inicio: '2026-11-15T10:00:00Z', data_hora_termino: '2026-11-15T14:00:00Z' });
      const tela = await montar([p]);
      tela.abrirDetalhes(tela.pessoas()[0]);
      await fixture.whenStable();
      const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
      expect(dialog).toBeTruthy();
      expect(texto(dialog)).not.toMatch(/Aguardando entrada/i);
      expect(texto(dialog.querySelector('[data-status-detalhe="cabecalho"]'))).toBe('Pedido expirado');
      expect(texto(dialog.querySelector('[data-status-detalhe="visita-atual"]'))).toBe('Pedido expirado');
    });

    it('fechar o detalhe esquece a linha', async () => {
      const tela = await montar([pessoa({ liberado: 1, data_hora_inicio: h(-1), data_hora_termino: h(3) })]);
      tela.abrirDetalhes(tela.pessoas()[0]);
      expect(tela.rotuloDetalhe()?.label).toBe('Liberado');
      tela.fecharDetalhes();
      expect(tela.rotuloDetalhe()).toBeNull();
    });
  });

  describe('W3 — separador da sub-linha', () => {
    it('sem nada antes, "Seg, Ter, Qua" aparece sem "·" na frente', async () => {
      const tela = await montar([pessoa({ dias_semana: 'seg,ter,qua', liberado: 1, data_hora_inicio: h(-1), data_hora_termino: h(48) })]);
      expect(tela).toBeTruthy();
      const sub = fixture.nativeElement.querySelector('[data-sublinha-pessoa]') as HTMLElement;
      expect(texto(sub)).toMatch(/Seg/);
      expect(texto(sub).startsWith('·')).toBe(false);
    });

    it('com tag antes, o "·" separa', async () => {
      await montar([pessoa({ tag_rfid: '0010', dias_semana: 'seg,ter,qua', liberado: 1, data_hora_inicio: h(-1), data_hora_termino: h(48) })]);
      const sub = fixture.nativeElement.querySelector('[data-sublinha-pessoa]') as HTMLElement;
      expect(texto(sub)).toMatch(/Tag 0010 ·\s*Seg/);
    });
  });

  describe('W4 — modal de detalhe acessível', () => {
    it('tem role="dialog", aria-modal e aria-labelledby no nome', async () => {
      const tela = await montar([pessoa({ liberado: 1, data_hora_inicio: h(-1), data_hora_termino: h(3) })]);
      tela.abrirDetalhes(tela.pessoas()[0]);
      await fixture.whenStable();
      const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
      expect(dialog.getAttribute('aria-modal')).toBe('true');
      const id = dialog.getAttribute('aria-labelledby')!;
      expect(id).toBeTruthy();
      expect(texto(fixture.nativeElement.querySelector(`#${id}`))).toBe('Fulano Detalhe');
    });
  });

  describe('W5 — o que cada número conta', () => {
    it('textos explicam visitas x passagens', async () => {
      const tela = await montar([pessoa({ liberado: 1, data_hora_inicio: h(-1), data_hora_termino: h(3) })]);
      tela.abrirDetalhes(tela.pessoas()[0]);
      await fixture.whenStable();
      const t = texto(fixture.nativeElement.querySelector('[role="dialog"]'));
      expect(t).toContain('13 registros de visita');
      expect(t).toContain('Método (entradas e saídas)');
      expect(t).toContain('Histórico de entradas, saídas e recusas (0)');
      expect(t).not.toContain('Total de acessos vinculados');
    });
  });

  describe('W7 — acesso recorrente não pode valer só 4 h', () => {
    it('salvar com dias marcados e janela < 24 h é bloqueado com mensagem clara', async () => {
      const tela = await montar([]);
      tela.abrirNovo();
      tela.novo.nome = 'Prestador QA';
      tela.novo.id_apartamento = 106;
      tela.novo.dias_semana = 'seg,ter,qua,qui,sex';
      tela.novo.data_hora_inicio = '2026-11-25T08:00';
      tela.novo.data_hora_termino = '2026-11-25T12:00';
      tela.salvar();
      expect(service.create).not.toHaveBeenCalled();
      expect(tela.erroForm()).toBe(
        'Acesso recorrente: o "Liberado até" precisa cobrir mais de um dia (até quando vale o acesso) — ou deixe em branco para acesso contínuo.',
      );
    });

    it('com dias e término em branco (contínuo) salva', async () => {
      const tela = await montar([]);
      tela.abrirNovo();
      tela.novo.nome = 'Prestador QA';
      tela.novo.id_apartamento = 106;
      tela.aplicarPresetDias('semana');
      tela.salvar();
      expect(service.create).toHaveBeenCalled();
    });

    it('visita sem dias continua aceitando a janela de 4 h', async () => {
      const tela = await montar([]);
      tela.abrirNovo();
      tela.novo.nome = 'Visitante QA';
      tela.novo.id_apartamento = 106;
      tela.salvar();
      expect(service.create).toHaveBeenCalled();
      expect(tela.erroForm()).toBeNull();
    });

    // Padrão FINITO (30 dias), não "sem prazo": em controle de acesso, acesso sem data para acabar
    // só por escolha explícita do operador (campo em branco).
    const diasEntre = (ini: string, fim: string) => (new Date(fim).getTime() - new Date(ini).getTime()) / 86_400_000;

    it('marcar o 1º dia com o término padrão (4 h, não editado) leva o término a 30 dias e mostra a dica', async () => {
      const tela = await montar([]);
      tela.abrirNovo();
      expect(tela.novo.data_hora_termino).toBeTruthy();
      expect(tela.dicaRecorrente()).toBeNull();
      tela.toggleDiaSemana('seg');
      expect(diasEntre(tela.novo.data_hora_inicio, tela.novo.data_hora_termino)).toBeCloseTo(30, 0);
      expect(tela.dicaRecorrente()).toContain('30 dias');
    });

    it('o atalho "Seg a Sex" faz o mesmo', async () => {
      const tela = await montar([]);
      tela.abrirNovo();
      tela.aplicarPresetDias('semana');
      expect(diasEntre(tela.novo.data_hora_inicio, tela.novo.data_hora_termino)).toBeCloseTo(30, 0);
      expect(tela.dicaRecorrente()).toContain('30 dias');
    });

    it('término editado pelo operador não é apagado', async () => {
      const tela = await montar([]);
      tela.abrirNovo();
      tela.novo.data_hora_termino = '2026-12-31T18:00';
      tela.toggleDiaSemana('seg');
      expect(tela.novo.data_hora_termino).toBe('2026-12-31T18:00');
      expect(tela.dicaRecorrente()).toBeNull();
    });
  });
  describe('W13 — Validar PIN só com os 6 dígitos', () => {
    function montarPin() {
      return montar([]).then(async (tela) => {
        service.validarCodigo = jest.fn(() => of({}));
        tela.abrirValidador();
        await fixture.whenStable();
        const buscar = () =>
          Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find((b) =>
            /Buscar/.test(b.textContent ?? ''),
          )!;
        return { tela, buscar };
      });
    }

    it('com 2 dígitos: Buscar desabilitado, Enter não chama a API e mostra a dica', async () => {
      const { tela, buscar } = await montarPin();
      tela.pinCode.set('12');
      await fixture.whenStable();
      expect(buscar().disabled).toBe(true);
      expect(texto(fixture.nativeElement.querySelector('[data-pin-dica]'))).toBe('Digite os 6 dígitos do PIN');
      tela.validarPIN(); // Enter
      expect(service.validarCodigo).not.toHaveBeenCalled();
      expect(tela.validationError()).toBe('Digite os 6 dígitos do PIN');
    });

    it('com a máscara "123-456": Buscar habilitado e a API recebe só os dígitos', async () => {
      const { tela, buscar } = await montarPin();
      tela.pinCode.set('123-456');
      await fixture.whenStable();
      expect(buscar().disabled).toBe(false);
      expect(fixture.nativeElement.querySelector('[data-pin-dica]')).toBeNull();
      tela.validarPIN();
      expect(service.validarCodigo).toHaveBeenCalledWith('123456');
    });

    it('com 7 dígitos também não busca', async () => {
      const { tela } = await montarPin();
      tela.pinCode.set('1234567');
      tela.validarPIN();
      expect(service.validarCodigo).not.toHaveBeenCalled();
    });
  });
});
