import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { RelatoriosPageComponent } from './relatorios-page.component';
import { RelatoriosApi } from './relatorios.service';

describe('RelatoriosPageComponent — auditoria e eventos', () => {
  const api = {
    getAuditoria: jest.fn(),
    getEventos: jest.fn(),
    exportAuditoria: jest.fn(),
    exportDadosCompletos: jest.fn(),
    downloadReport: jest.fn(),
  };

  function montar() {
    TestBed.configureTestingModule({
      imports: [RelatoriosPageComponent],
      providers: [{ provide: RelatoriosApi, useValue: api }],
    });
    const fixture = TestBed.createComponent(RelatoriosPageComponent);
    fixture.detectChanges();
    return fixture;
  }

  const pagina = (items: any[], total: number, extra: object = {}) => ({ items, total, page: 1, pageSize: 50, ...extra });

  const linhaVisitante = (status: object) => ({
    id: 7, created_at: '2026-11-01T10:00:00Z', acao: 'CREATE', modulo: 'visitantes', descricao: 'Visita',
    detalhes: {
      visitante: { tipo: 'Visitante', nome: 'Fulano' },
      apartamento: { id: 1, label: 'Apto 106 · Bloco A' },
      status: { liberado: true, ...status },
    },
  });

  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());
  afterEach(() => jest.clearAllMocks());

  describe('rótulos', () => {
    it('toda ação gravada pela API tem rótulo e cor próprios', () => {
      const c = montar().componentInstance;
      const neutra = c.getAcaoColor('__desconhecida__');
      for (const acao of [
        'ENTREGA', 'ONLINE', 'OFFLINE', 'FANTASMAS_REMOVIDOS', 'DISPOSITIVO_IP_CORRIGIDO',
        'DISPOSITIVO_MAC_ATUALIZADO', 'DEACTIVATE', 'REACTIVATE', 'EXECUTE', 'EXPORT',
      ]) {
        expect(c.getAcaoLabel(acao)).not.toBe(acao);
        expect(c.getAcaoColor(acao)).not.toBe(neutra);
      }
    });

    it('todo módulo gravado pela API tem rótulo, ignorando caixa', () => {
      const c = montar().componentInstance;
      for (const modulo of [
        'dispositivos', 'facial-health', 'visitas', 'pessoas', 'caminhos-acesso', 'condominios', 'crm',
        'crm-condominio', 'superlogica', 'veiculos', 'vagas', 'funcionarios', 'convites', 'delivery', 'users',
      ]) {
        expect(c.getModuloLabel(modulo)).not.toBe(modulo);
      }
      expect(c.getModuloLabel('AUTH')).toBe('Autenticação');
      expect(c.getModuloLabel('Facial-Health')).toBe(c.getModuloLabel('facial-health'));
      expect(c.getModuloLabel('modulo-novo')).toBe('modulo-novo');
    });

    it('filtro oferece os módulos que existem no log, sem separar os que a API agrupa', () => {
      const valores = montar().componentInstance.modulosDisponiveis.map((m) => m.value);
      for (const v of ['apartamentos', 'areas-sociais', 'veiculos', 'vagas', 'caminhos-acesso', 'auth', 'sistema']) {
        expect(valores).toContain(v);
      }
      for (const v of ['visitas', 'pessoas', 'facial-health', 'dispositivos']) {
        expect(valores).not.toContain(v);
      }
      expect(new Set(valores).size).toBe(valores.length);
    });
  });

  describe('código de acesso do visitante', () => {
    function abrirLinha(status: object) {
      api.getAuditoria.mockReturnValue(of(pagina([linhaVisitante(status)], 1)));
      const fixture = montar();
      fixture.componentInstance.setSubTab('auditoria');
      fixture.componentInstance.toggleDetalhes(7);
      fixture.detectChanges();
      return fixture.nativeElement.textContent as string;
    }

    it('linha antiga: avisa que houve código, sem mostrar o valor', () => {
      const texto = abrirLinha({ codigoAcesso: '918273' });
      expect(texto).not.toContain('918273');
      expect(texto).toContain('Código de acesso emitido');
    });

    it('linha nova: temCodigoAcesso mostra o aviso', () => {
      expect(abrirLinha({ temCodigoAcesso: true })).toContain('Código de acesso emitido');
    });

    it('sem código: não mostra o aviso', () => {
      expect(abrirLinha({ temCodigoAcesso: false })).not.toContain('Código de acesso emitido');
    });

    it('detalhes genéricos (JSON) também não expõem o código', () => {
      const c = montar().componentInstance;
      const json = c.formatarDetalhes({ status: { codigoAcesso: '918273', liberado: true } });
      expect(json).not.toContain('918273');
      expect(json).toContain('liberado');
    });
  });

  describe('exportação', () => {
    it('403 no CSV explica que é exclusivo do síndico', () => {
      api.exportAuditoria.mockReturnValue(throwError(() => ({ status: 403 })));
      const c = montar().componentInstance;
      c.exportarCsv();
      expect(c.errorAudit()).toBe('A exportação do log de auditoria é exclusiva do síndico.');
      expect(c.exportandoCsv()).toBe(false);
    });

    it('outras falhas no CSV mantêm a mensagem genérica', () => {
      api.exportAuditoria.mockReturnValue(throwError(() => ({ status: 500 })));
      const c = montar().componentInstance;
      c.exportarCsv();
      expect(c.errorAudit()).toBe('Falha ao exportar CSV.');
    });

    it('export completo: só atribui ao perfil quando a API responde 403', () => {
      const c = montar().componentInstance;
      api.exportDadosCompletos.mockReturnValue(throwError(() => ({ status: 403 })));
      c.exportarDadosCompletos();
      expect(c.errorAudit()).toBe('A exportação completa dos dados é exclusiva do síndico.');

      api.exportDadosCompletos.mockReturnValue(throwError(() => ({ status: 500 })));
      c.exportarDadosCompletos();
      expect(c.errorAudit()).toBe('Falha ao exportar dados completos.');
    });
  });

  describe('histórico truncado', () => {
    it('mostra aviso quando a API devolve truncado: true', () => {
      api.getEventos.mockReturnValue(of(pagina([], 0, { truncado: true })));
      const fixture = montar();
      fixture.componentInstance.setSubTab('eventos');
      fixture.detectChanges();
      expect(fixture.componentInstance.eventosTruncado()).toBe(true);
      expect(fixture.nativeElement.querySelector('[data-testid="eventos-truncado"]')).not.toBeNull();
    });

    it('sem truncado (ou API antiga) não mostra aviso', () => {
      api.getEventos.mockReturnValue(of(pagina([], 0)));
      const fixture = montar();
      fixture.componentInstance.setSubTab('eventos');
      fixture.detectChanges();
      expect(fixture.componentInstance.eventosTruncado()).toBe(false);
      expect(fixture.nativeElement.querySelector('[data-testid="eventos-truncado"]')).toBeNull();
    });
  });

  describe('período aplicado no Log de Eventos', () => {
    const seletor = '[data-testid="eventos-periodo-padrao"]';

    it('sem datas escolhidas: mostra o período padrão que a API aplicou', () => {
      api.getEventos.mockReturnValue(
        of(pagina([], 0, { periodo: { dataInicio: '2026-10-11', dataFim: '2026-11-10', padrao: true } })),
      );
      const fixture = montar();
      fixture.componentInstance.setSubTab('eventos');
      fixture.detectChanges();
      const aviso = fixture.nativeElement.querySelector(seletor);
      expect(aviso).not.toBeNull();
      expect(aviso.textContent).toContain('11/10/2026');
      expect(aviso.textContent).toContain('10/11/2026');
      expect(aviso.textContent).toContain('últimos 30 dias');
    });

    it('com período escolhido pelo usuário não mostra o texto', () => {
      api.getEventos.mockReturnValue(
        of(pagina([], 0, { periodo: { dataInicio: '2026-09-01', dataFim: '2026-09-30', padrao: false } })),
      );
      const fixture = montar();
      fixture.componentInstance.setSubTab('eventos');
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector(seletor)).toBeNull();
    });

    it('API antiga (sem o campo periodo) não mostra o texto', () => {
      api.getEventos.mockReturnValue(of(pagina([], 0)));
      const fixture = montar();
      fixture.componentInstance.setSubTab('eventos');
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector(seletor)).toBeNull();
    });
  });

  describe('rótulos de login', () => {
    it('LOGIN e LOGIN_FALHA têm rótulo e cor próprios', () => {
      const c = montar().componentInstance;
      const neutra = c.getAcaoColor('__desconhecida__');
      expect(c.getAcaoLabel('LOGIN')).toBe('Login');
      expect(c.getAcaoLabel('LOGIN_FALHA')).toBe('Tentativa de login');
      expect(c.getAcaoColor('LOGIN')).not.toBe(neutra);
      expect(c.getAcaoColor('LOGIN_FALHA')).not.toBe(neutra);
      expect(c.getAcaoColor('LOGIN')).not.toBe(c.getAcaoColor('LOGIN_FALHA'));
    });
  });

  describe('estado entre abas', () => {
    it('trocar de aba zera total, página e linhas expandidas da aba anterior', () => {
      api.getAuditoria.mockReturnValue(of(pagina([{ id: 1, detalhes: {} }], 120)));
      const eventos$ = new Subject<any>();
      api.getEventos.mockReturnValue(eventos$);
      const c = montar().componentInstance;

      c.setSubTab('auditoria');
      c.irParaPagina(2);
      c.toggleDetalhes(1);
      expect(c.total()).toBe(120);

      c.setSubTab('eventos');
      expect(c.total()).toBe(0);
      expect(c.pagina()).toBe(1);
      expect(c.expandidos()).toEqual({});
    });

    it('resposta lenta da aba anterior não sobrescreve o total da aba atual', () => {
      const auditoria$ = new Subject<any>();
      api.getAuditoria.mockReturnValue(auditoria$);
      api.getEventos.mockReturnValue(of(pagina([{ id: 'e1' }], 3)));
      const c = montar().componentInstance;

      c.setSubTab('auditoria');
      c.setSubTab('eventos');
      expect(c.total()).toBe(3);

      auditoria$.next(pagina([{ id: 1 }], 999));
      expect(c.total()).toBe(3);
      expect(c.loadingAudit()).toBe(false);
    });

    it('na mesma aba, só a consulta mais recente vale', () => {
      const primeira$ = new Subject<any>();
      const segunda$ = new Subject<any>();
      api.getAuditoria.mockReturnValueOnce(primeira$).mockReturnValueOnce(segunda$);
      const c = montar().componentInstance;

      c.setSubTab('auditoria');
      c.aplicarFiltros();
      segunda$.next(pagina([{ id: 2 }], 5));
      primeira$.next(pagina([{ id: 1 }], 999));

      expect(c.total()).toBe(5);
      expect(c.auditLogs()).toEqual([{ id: 2 }]);
    });

    it('erro tardio da aba anterior não aparece na aba atual', () => {
      const auditoria$ = new Subject<any>();
      api.getAuditoria.mockReturnValue(auditoria$);
      api.getEventos.mockReturnValue(of(pagina([], 0)));
      const c = montar().componentInstance;

      c.setSubTab('auditoria');
      c.setSubTab('eventos');
      auditoria$.error({ status: 500 });
      expect(c.errorAudit()).toBeNull();
    });
  });
});
