import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpHeaders, HttpResponse } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
import { RelatoriosPageComponent, nomeDoContentDisposition } from './relatorios-page.component';
import { RelatoriosApi } from './relatorios.service';
import { AuthService } from '../auth/auth.service';

/** JWT só com o payload (a tela só lê o typeAccess; quem confere a assinatura é a API). */
const tokenCom = (typeAccess: string) => `h.${btoa(JSON.stringify({ typeAccess }))}.s`;

describe('RelatoriosPageComponent — auditoria e eventos', () => {
  const api = {
    getAuditoria: jest.fn(),
    getEventos: jest.fn(),
    exportAuditoria: jest.fn(),
    exportDadosCompletos: jest.fn(),
    downloadReport: jest.fn(),
  };

  const auth = {
    token: tokenCom('Sindico') as string | null,
    porteiroInfo: signal<any>({ id_condominio: 1, nome: 'Síndico', turno: 'Síndico' }),
  };

  function montar() {
    TestBed.configureTestingModule({
      imports: [RelatoriosPageComponent],
      providers: [
        { provide: RelatoriosApi, useValue: api },
        { provide: AuthService, useValue: auth },
      ],
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
  afterEach(() => {
    auth.token = tokenCom('Sindico');
    jest.useRealTimers();
  });

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
      const valores = montar().componentInstance.modulosDisponiveis().map((m) => m.value);
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
      expect(c.error()).toBe('A exportação completa dos dados é exclusiva do síndico.');

      api.exportDadosCompletos.mockReturnValue(throwError(() => ({ status: 500 })));
      c.exportarDadosCompletos();
      expect(c.error()).toBe('Falha ao exportar dados completos.');
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
  describe('relatório financeiro: taxas condominiais por unidade', () => {
    const checkbox = (f: any) => f.nativeElement.querySelector('[data-testid="relatorio-incluir-taxas"]');

    it('o interruptor só aparece no financeiro e vem desligado', () => {
      const f = montar();
      expect(checkbox(f)).toBeNull();
      f.componentInstance.setTipo('financeiro');
      f.detectChanges();
      expect(checkbox(f)).not.toBeNull();
      expect(f.componentInstance.incluirTaxasCondominiais()).toBe(false);
    });

    it('desligado: não pede as taxas; ligado: pede', () => {
      api.downloadReport.mockReturnValue(new Subject());
      const c = montar().componentInstance;
      c.setTipo('financeiro');
      c.exportar('pdf');
      expect(api.downloadReport).toHaveBeenLastCalledWith('financeiro', 'pdf', undefined, undefined, false);
      c.incluirTaxasCondominiais.set(true);
      c.exportar('xlsx');
      expect(api.downloadReport).toHaveBeenLastCalledWith('financeiro', 'xlsx', undefined, undefined, true);
    });

    it('nos outros relatórios o interruptor não vale', () => {
      api.downloadReport.mockReturnValue(new Subject());
      const c = montar().componentInstance;
      c.incluirTaxasCondominiais.set(true);
      c.setTipo('visitantes');
      c.exportar('pdf');
      expect(api.downloadReport).toHaveBeenLastCalledWith('visitantes', 'pdf', undefined, undefined, false);
    });

    it('erro do download chega como Blob: lê o JSON e mostra a message da API', async () => {
      const corpo = new Blob([JSON.stringify({ statusCode: 403, message: 'Acesso negado: baixar o relatório financeiro exige síndico.' })], {
        type: 'application/json',
      });
      api.downloadReport.mockReturnValueOnce(throwError(() => ({ status: 403, error: corpo })));
      const c = montar().componentInstance;
      c.exportar('pdf');
      expect(c.error()).toContain('Não foi possível gerar o relatório');
      await new Promise((r) => setTimeout(r, 20));
      expect(c.error()).toBe('Acesso negado: baixar o relatório financeiro exige síndico.');
    });

    it('Blob que não é JSON: fica a mensagem padrão', async () => {
      api.downloadReport.mockReturnValueOnce(throwError(() => ({ status: 502, error: new Blob(['<html>Bad Gateway</html>']) })));
      const c = montar().componentInstance;
      c.exportar('pdf');
      await new Promise((r) => setTimeout(r, 20));
      expect(c.error()).toContain('Não foi possível gerar o relatório');
    });

    it('erro sem corpo JSON: mensagem padrão; com mensagem da API: mostra a da API', () => {
      api.downloadReport.mockReturnValueOnce(throwError(() => ({ status: 500 })));
      const c = montar().componentInstance;
      c.exportar('pdf');
      expect(c.error()).toContain('Não foi possível gerar o relatório');
      api.downloadReport.mockReturnValueOnce(throwError(() => ({ status: 403, error: { message: 'Acesso negado.' } })));
      c.exportar('pdf');
      expect(c.error()).toBe('Acesso negado.');
    });
  });

  describe('documento e telefone mascarados na tela', () => {
    const CPF = '45346648852';

    it('auditoria: card do visitante mostra o documento mascarado', () => {
      const linha = linhaVisitante({});
      (linha.detalhes.visitante as any).documento = CPF;
      api.getAuditoria.mockReturnValue(of(pagina([linha], 1)));
      const fixture = montar();
      fixture.componentInstance.setSubTab('auditoria');
      fixture.componentInstance.toggleDetalhes(7);
      fixture.detectChanges();
      const texto = fixture.nativeElement.textContent as string;
      expect(texto).not.toContain(CPF);
      expect(texto).toContain('***.***.*88-52');
      expect(texto).not.toContain('453.');
    });

    it('auditoria: card do morador mascara documento e telefone', () => {
      api.getAuditoria.mockReturnValue(of(pagina([{
        id: 9, created_at: '2026-11-01T10:00:00Z', acao: 'CREATE', modulo: 'moradores',
        detalhes: {
          morador: { nome: 'Ana', documento: CPF, telefone: '17996608148' },
          apartamento: null, credenciais: {},
        },
      }], 1)));
      const fixture = montar();
      fixture.componentInstance.setSubTab('auditoria');
      fixture.componentInstance.toggleDetalhes(9);
      fixture.detectChanges();
      const texto = fixture.nativeElement.textContent as string;
      expect(texto).not.toContain(CPF);
      expect(texto).not.toContain('17996608148');
      expect(texto).toContain('***.***.*88-52');
      expect(texto).toContain('(**) *****-8148');
      expect(texto).not.toContain('(17)');
    });

    it('auditoria: diff de campos sensíveis também sai mascarado', () => {
      api.getAuditoria.mockReturnValue(of(pagina([{
        id: 10, created_at: '2026-11-01T10:00:00Z', acao: 'UPDATE', modulo: 'moradores',
        detalhes: { contexto: { morador: { nome: 'Ana' } }, changes: { documento: { de: CPF, para: '12345678909' } } },
      }], 1)));
      const fixture = montar();
      fixture.componentInstance.setSubTab('auditoria');
      fixture.componentInstance.toggleDetalhes(10);
      fixture.detectChanges();
      const texto = fixture.nativeElement.textContent as string;
      expect(texto).not.toContain(CPF);
      expect(texto).not.toContain('12345678909');
      expect(texto).toContain('***.***.*88-52');
      expect(texto).toContain('***.***.*89-09');
    });

    it('detalhes genéricos (JSON) mascaram cpf, documento e telefone, inclusive no diff', () => {
      const c = montar().componentInstance;
      const json = c.formatarDetalhes({
        cpf: CPF,
        pessoa: { documento: CPF, doc_identificacao: CPF, telefone: '17996608148', nome: 'Ana' },
        changes: { telefone: { de: '17996608148', para: '11988887777' } },
      });
      expect(json).not.toContain(CPF);
      expect(json).not.toContain('17996608148');
      expect(json).not.toContain('11988887777');
      expect(json).toContain('Ana');
    });

    it('mesmo formato da API: só os 4 últimos dígitos de documento e telefone', () => {
      const c = montar().componentInstance;
      expect(c.mascararDocumento(CPF)).toBe('***.***.*88-52');
      expect(c.mascararDocumento('453.466.488-52')).toBe('***.***.*88-52');
      expect(c.mascararDocumento('12345678000190')).toBe('***0190');
      expect(c.mascararDocumento('MG-12.345.678')).toBe('***5678');
      expect(c.mascararDocumento('Não informado')).toBe('Não informado');
      expect(c.mascararTelefone('(17) 99660-8148')).toBe('(**) *****-8148');
      expect(c.mascararTelefone('5517996608148')).toBe('(**) *****-8148');
      expect(c.mascararTelefone('996608')).toBe('***6608');
      expect(c.mascararTelefone('12')).toBe('***');
    });

    it('valor que já chegou mascarado da API (porteiro) não é remascarado', () => {
      const c = montar().componentInstance;
      expect(c.mascararDocumento('453.***.***-52')).toBe('453.***.***-52');
      expect(c.mascararTelefone('(17) *****-8148')).toBe('(17) *****-8148');
    });

    it('log de eventos: visitante mostra o documento mascarado', () => {
      api.getEventos.mockReturnValue(of(pagina([{
        id: 'visitante-1', tipo: 'Visitante', descricao: 'Entrada', quando: '2026-11-01T10:00:00Z', direcao: 'entrada',
        detalhes: { nome: 'Fulano', documento: CPF, blocoApto: 'Apto 1' },
      }], 1)));
      const fixture = montar();
      fixture.componentInstance.setSubTab('eventos');
      fixture.componentInstance.toggleDetalhes('visitante-1');
      fixture.detectChanges();
      const texto = fixture.nativeElement.textContent as string;
      expect(texto).not.toContain(CPF);
      expect(texto).toContain('***.***.*88-52');
      expect(texto).not.toContain('453.');
    });
  });

  describe('filtros só valem depois de aplicados', () => {
    it('auditoria: data digitada sem aplicar não entra na paginação', () => {
      api.getAuditoria.mockReturnValue(of(pagina([{ id: 1 }], 200)));
      const c = montar().componentInstance;
      c.setSubTab('auditoria');
      c.filtroDataInicio.set('2026-11-01');
      c.aplicarFiltros();
      c.filtroDataInicio.set('2026-11-20');
      c.filtroModulo.set('encomendas');
      c.irParaPagina(2);
      expect(api.getAuditoria).toHaveBeenLastCalledWith('todos', '2026-11-01', undefined, 2, 50);
      c.mudarTamanhoPagina(100);
      expect(api.getAuditoria).toHaveBeenLastCalledWith('todos', '2026-11-01', undefined, 1, 100);
      c.carregarAuditoria();
      expect(api.getAuditoria).toHaveBeenLastCalledWith('todos', '2026-11-01', undefined, 1, 100);
    });

    it('auditoria: Exportar CSV usa o filtro aplicado', () => {
      api.getAuditoria.mockReturnValue(of(pagina([{ id: 1 }], 1)));
      api.exportAuditoria.mockReturnValue(new Subject());
      const c = montar().componentInstance;
      c.setSubTab('auditoria');
      c.filtroModulo.set('encomendas');
      c.aplicarFiltros();
      c.filtroModulo.set('moradores');
      c.filtroDataFim.set('2026-11-30');
      c.exportarCsv();
      expect(api.exportAuditoria).toHaveBeenLastCalledWith('encomendas', undefined, undefined);
    });

    it('eventos: busca e data digitadas sem aplicar não entram na paginação', () => {
      api.getEventos.mockReturnValue(of(pagina([{ id: 'e' }], 200)));
      const c = montar().componentInstance;
      c.setSubTab('eventos');
      c.filtroEventosSearch.set('ana');
      c.aplicarFiltros();
      c.filtroEventosSearch.set('bruno');
      c.filtroEventosDataInicio.set('2026-11-20');
      c.irParaPagina(2);
      expect(api.getEventos).toHaveBeenLastCalledWith(undefined, undefined, 2, 50, 'ana');
    });

    it('limpar filtros zera também o que estava aplicado', () => {
      api.getAuditoria.mockReturnValue(of(pagina([{ id: 1 }], 200)));
      const c = montar().componentInstance;
      c.setSubTab('auditoria');
      c.filtroModulo.set('encomendas');
      c.aplicarFiltros();
      c.limparFiltros();
      c.irParaPagina(2);
      expect(api.getAuditoria).toHaveBeenLastCalledWith('todos', undefined, undefined, 2, 50);
    });

    it('Enter na busca do Log de Eventos aplica os filtros', () => {
      api.getEventos.mockReturnValue(of(pagina([], 0)));
      const fixture = montar();
      fixture.componentInstance.setSubTab('eventos');
      fixture.detectChanges();
      const input: HTMLInputElement = fixture.nativeElement.querySelector('#relatorios-page-buscar-por-nome-descricao');
      fixture.componentInstance.filtroEventosSearch.set('ana');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      expect(api.getEventos).toHaveBeenLastCalledWith(undefined, undefined, 1, 50, 'ana');
    });
  });

  describe('período e estado vazio', () => {
    it('Data Início depois da Data Fim: mensagem e nenhuma requisição', () => {
      api.getAuditoria.mockReturnValue(of(pagina([], 0)));
      const fixture = montar();
      const c = fixture.componentInstance;
      c.setSubTab('auditoria');
      api.getAuditoria.mockClear();
      c.filtroDataInicio.set('2026-11-20');
      c.filtroDataFim.set('2026-11-01');
      c.aplicarFiltros();
      fixture.detectChanges();
      expect(api.getAuditoria).not.toHaveBeenCalled();
      expect(c.erroPeriodo()).toBe('A data de início não pode ser depois da data de fim.');
      expect(fixture.nativeElement.textContent).toContain('A data de início não pode ser depois da data de fim.');
    });

    it('eventos: Data Início depois da Data Fim também bloqueia', () => {
      api.getEventos.mockReturnValue(of(pagina([], 0)));
      const c = montar().componentInstance;
      c.setSubTab('eventos');
      api.getEventos.mockClear();
      c.filtroEventosDataInicio.set('2026-11-20');
      c.filtroEventosDataFim.set('2026-11-01');
      c.aplicarFiltros();
      expect(api.getEventos).not.toHaveBeenCalled();
      expect(c.erroPeriodo()).not.toBeNull();
    });

    it('lista vazia com filtro aplicado: mensagem dos filtros, sem o texto de log novo', () => {
      api.getAuditoria.mockReturnValue(of(pagina([], 0)));
      const fixture = montar();
      const c = fixture.componentInstance;
      c.setSubTab('auditoria');
      c.filtroModulo.set('encomendas');
      c.aplicarFiltros();
      fixture.detectChanges();
      const texto = fixture.nativeElement.textContent as string;
      expect(texto).toContain('Nenhum registro encontrado para os filtros aplicados');
      expect(texto).not.toContain('Os logs serão gravados automaticamente a partir de agora.');
    });

    it('lista vazia sem filtro: texto de log novo', () => {
      api.getAuditoria.mockReturnValue(of(pagina([], 0)));
      const fixture = montar();
      fixture.componentInstance.setSubTab('auditoria');
      fixture.detectChanges();
      const texto = fixture.nativeElement.textContent as string;
      expect(texto).toContain('Os logs serão gravados automaticamente a partir de agora.');
      expect(texto).not.toContain('Nenhum registro encontrado para os filtros aplicados');
    });

    it('eventos vazios com busca aplicada: mensagem dos filtros', () => {
      api.getEventos.mockReturnValue(of(pagina([], 0)));
      const fixture = montar();
      const c = fixture.componentInstance;
      c.setSubTab('eventos');
      c.filtroEventosSearch.set('zzz');
      c.aplicarFiltros();
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Nenhum registro encontrado para os filtros aplicados');
    });

    it('página além do total depois de Atualizar volta para a última página válida', () => {
      api.getAuditoria.mockReturnValue(of(pagina([{ id: 1 }], 120)));
      const c = montar().componentInstance;
      c.setSubTab('auditoria');
      c.irParaPagina(3);
      expect(c.pagina()).toBe(3);
      // Registros sumiram: a página 3 voltou vazia e o total caiu para 50.
      api.getAuditoria.mockReturnValueOnce(of(pagina([], 50))).mockReturnValue(of(pagina([{ id: 2 }], 50)));
      c.carregarAuditoria();
      expect(c.pagina()).toBe(1);
      expect(api.getAuditoria).toHaveBeenLastCalledWith('todos', undefined, undefined, 1, 50);
      expect(c.auditLogs()).toEqual([{ id: 2 }]);
    });

    it('eventos: página além do total também volta', () => {
      api.getEventos.mockReturnValue(of(pagina([{ id: 'a' }], 120)));
      const c = montar().componentInstance;
      c.setSubTab('eventos');
      c.irParaPagina(3);
      api.getEventos.mockReturnValueOnce(of(pagina([], 60))).mockReturnValue(of(pagina([{ id: 'b' }], 60)));
      c.carregarEventos();
      expect(c.pagina()).toBe(2);
      expect(c.eventLogs()).toEqual([{ id: 'b' }]);
    });
  });

  describe('Exportação Completa (.zip)', () => {
    it('o erro aparece na aba Relatórios Gerais, onde fica o botão', () => {
      api.exportDadosCompletos.mockReturnValue(throwError(() => ({ status: 500 })));
      const fixture = montar();
      fixture.componentInstance.exportarDadosCompletos();
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Falha ao exportar dados completos.');
    });
  });

  describe('nome do arquivo exportado', () => {
    it('lê o filename do Content-Disposition', () => {
      expect(nomeDoContentDisposition('attachment; filename="auditoria_1_20261125_223000.csv"')).toBe('auditoria_1_20261125_223000.csv');
      expect(nomeDoContentDisposition("attachment; filename*=UTF-8''auditoria%20x.csv")).toBe('auditoria x.csv');
      expect(nomeDoContentDisposition(null)).toBeNull();
      expect(nomeDoContentDisposition('attachment')).toBeNull();
    });

    it('CSV usa o nome mandado pelo servidor', () => {
      const blob = new Blob(['a;b']);
      api.exportAuditoria.mockReturnValue(of(new HttpResponse({
        body: blob,
        headers: new HttpHeaders({ 'Content-Disposition': 'attachment; filename="auditoria_1_20261125_223000.csv"' }),
      })));
      const c = montar().componentInstance;
      const baixar = jest.spyOn(c as any, 'baixarArquivo').mockImplementation(() => undefined);
      c.exportarCsv();
      expect(baixar).toHaveBeenCalledWith(blob, 'auditoria_1_20261125_223000.csv');
      expect(c.exportandoCsv()).toBe(false);
    });

    it('sem Content-Disposition: data de Brasília (22h30 do dia 25 em SP já é 26 em UTC)', () => {
      jest.useFakeTimers({ now: new Date('2026-11-26T01:30:00Z') });
      const blob = new Blob(['a;b']);
      api.exportAuditoria.mockReturnValue(of(new HttpResponse({ body: blob })));
      const c = montar().componentInstance;
      const baixar = jest.spyOn(c as any, 'baixarArquivo').mockImplementation(() => undefined);
      c.exportarCsv();
      expect(baixar).toHaveBeenCalledWith(blob, 'auditoria_2026-11-25.csv');
    });

    it('zip também usa o nome do servidor quando vem', () => {
      const blob = new Blob(['zip']);
      api.exportDadosCompletos.mockReturnValue(of(new HttpResponse({
        body: blob,
        headers: new HttpHeaders({ 'Content-Disposition': 'attachment; filename="export_condominio_1_20261125_101010.zip"' }),
      })));
      const c = montar().componentInstance;
      const baixar = jest.spyOn(c as any, 'baixarArquivo').mockImplementation(() => undefined);
      c.exportarDadosCompletos();
      expect(baixar).toHaveBeenCalledWith(blob, 'export_condominio_1_20261125_101010.zip');
    });
  });

  describe('fuso de Brasília', () => {
    it('formatarData mostra a hora de São Paulo, não a do navegador', () => {
      const c = montar().componentInstance;
      expect(c.formatarData('2026-11-26T01:30:00Z')).toBe('25/11/2026 22:30');
      expect(c.formatarData('2026-07-01T12:05:00Z')).toBe('01/07/2026 09:05');
      expect(c.formatarData('')).toBe('-');
      expect(c.formatarData('lixo')).toBe('-');
    });
  });

  describe('módulos do filtro de auditoria', () => {
    const novos = [
      'auditoria', 'funcionarios', 'users', 'condominios', 'delivery', 'convites', 'tags', 'consentimentos',
      'guarita', 'credenciais', 'portaria-equipe', 'portaria-remota', 'mudancas', 'relatorios', 'crm-morador',
    ];

    it('síndico: oferece os módulos que o backend grava, inclusive os sigilosos', () => {
      const valores = montar().componentInstance.modulosDisponiveis().map((m) => m.value);
      for (const v of [...novos, 'financeiro', 'auth', 'crm', 'crm-condominio', 'superlogica']) {
        expect(valores).toContain(v);
      }
      expect(new Set(valores).size).toBe(valores.length);
    });

    it('rótulos pedidos', () => {
      const c = montar().componentInstance;
      const rotulo = (v: string) => c.modulosDisponiveis().find((m) => m.value === v)?.label;
      expect(rotulo('auditoria')).toBe('Exportações e auditoria');
      expect(rotulo('users')).toBe('Contas de usuário');
      expect(rotulo('credenciais')).toBe('Credenciais e passes');
      expect(rotulo('portaria-equipe')).toBe('Equipe da portaria');
      expect(rotulo('portaria-remota')).toBe('Portaria remota');
    });

    it('getModuloLabel traduz todos os slugs novos (e wallet)', () => {
      const c = montar().componentInstance;
      for (const v of [...novos, 'wallet']) {
        expect(c.getModuloLabel(v)).not.toBe(v);
      }
      expect(c.getModuloLabel('wallet')).toBe(c.getModuloLabel('credenciais'));
    });

    it('não síndico: esconde os módulos que a API não deixa ler', () => {
      auth.token = tokenCom('Funcionario');
      const valores = montar().componentInstance.modulosDisponiveis().map((m) => m.value);
      for (const v of ['financeiro', 'auth', 'crm', 'crm-condominio', 'superlogica']) {
        expect(valores).not.toContain(v);
      }
      expect(valores).toContain('encomendas');
      expect(valores).toContain('todos');
    });

    it('sem token legível: trata como não síndico', () => {
      auth.token = null;
      const valores = montar().componentInstance.modulosDisponiveis().map((m) => m.value);
      expect(valores).not.toContain('financeiro');
    });
  });

  describe('Log de Eventos: dispositivo e acionamentos', () => {
    function abrirEvento(ev: any) {
      api.getEventos.mockReturnValue(of(pagina([ev], 1)));
      const fixture = montar();
      fixture.componentInstance.setSubTab('eventos');
      fixture.componentInstance.toggleDetalhes(ev.id);
      fixture.detectChanges();
      return fixture;
    }

    it('tipo Dispositivo tem card próprio com status e IP', () => {
      const f = abrirEvento({
        id: 'dispositivo-1', tipo: 'Dispositivo', descricao: 'Portão ficou offline', quando: '2026-11-01T10:00:00Z', direcao: 'offline',
        detalhes: { nome: 'Portão Social', status: 'Offline', ip: '10.0.0.5', dataEntrada: '2026-11-01T10:00:00Z' },
      });
      const card = f.nativeElement.querySelector('[data-testid="evento-dispositivo"]');
      expect(card).not.toBeNull();
      expect(card.textContent).toContain('Offline');
      expect(card.textContent).toContain('10.0.0.5');
    });

    it('selo da direção: manual e falha', () => {
      const f = abrirEvento({ id: 'm1', tipo: 'Acesso Facial', descricao: 'x', quando: '2026-11-01T10:00:00Z', direcao: 'falha' });
      const selo = f.nativeElement.querySelector('[data-testid="evento-direcao"]');
      expect(selo.textContent).toContain('Falha');
      expect(selo.className).toContain('rose');
    });

    it('selo manual é âmbar', () => {
      const f = abrirEvento({ id: 'm2', tipo: 'Acesso Facial', descricao: 'x', quando: '2026-11-01T10:00:00Z', direcao: 'manual' });
      const selo = f.nativeElement.querySelector('[data-testid="evento-direcao"]');
      expect(selo.textContent).toContain('Acionamento manual');
      expect(selo.className).toContain('amber');
    });

    it('foto da pessoa tem alt', () => {
      const f = abrirEvento({
        id: 'f1', tipo: 'Acesso Facial', descricao: 'x', quando: '2026-11-01T10:00:00Z', direcao: 'entrada',
        detalhes: { nome: 'Ana', fotoPessoa: 'https://exemplo/foto.jpg' },
      });
      const img: HTMLImageElement = f.nativeElement.querySelector('img');
      expect(img.getAttribute('alt')).toContain('Ana');
    });
  });

  describe('acessibilidade', () => {
    it('abas são tablist/tab com aria-selected', () => {
      const fixture = montar();
      const lista = fixture.nativeElement.querySelector('[role="tablist"]');
      expect(lista).not.toBeNull();
      const abas = Array.from(lista.querySelectorAll('[role="tab"]')) as HTMLElement[];
      expect(abas.length).toBe(3);
      expect(abas.map((a) => a.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    });

    it('linha da auditoria: botão com aria-expanded só quando há detalhe; tr não é mais role=button', () => {
      api.getAuditoria.mockReturnValue(of(pagina([
        { id: 1, created_at: '2026-11-01T10:00:00Z', acao: 'CREATE', modulo: 'x', detalhes: { a: 1 } },
        { id: 2, created_at: '2026-11-01T10:00:00Z', acao: 'CREATE', modulo: 'x', detalhes: null },
      ], 2)));
      const fixture = montar();
      fixture.componentInstance.setSubTab('auditoria');
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('tr[role="button"]')).toBeNull();
      const botoes = fixture.nativeElement.querySelectorAll('button[aria-expanded]');
      expect(botoes.length).toBe(1);
      expect(botoes[0].getAttribute('aria-expanded')).toBe('false');
      botoes[0].click();
      fixture.detectChanges();
      expect(fixture.componentInstance.expandidos()[1]).toBe(true);
      expect(fixture.nativeElement.querySelector('button[aria-expanded]').getAttribute('aria-expanded')).toBe('true');
    });

    it('linha do Log de Eventos sem detalhe não tem botão de expandir', () => {
      api.getEventos.mockReturnValue(of(pagina([
        { id: 'a', tipo: 'Visitante', descricao: 'x', quando: '2026-11-01T10:00:00Z', detalhes: { nome: 'A' } },
        { id: 'b', tipo: 'Visitante', descricao: 'y', quando: '2026-11-01T10:00:00Z' },
      ], 2)));
      const fixture = montar();
      fixture.componentInstance.setSubTab('eventos');
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('tr[role="button"]')).toBeNull();
      expect(fixture.nativeElement.querySelectorAll('button[aria-expanded]').length).toBe(1);
    });
  });
});
