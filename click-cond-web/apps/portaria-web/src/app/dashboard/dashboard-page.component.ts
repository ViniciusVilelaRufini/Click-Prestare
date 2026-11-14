import { MaskDocPipe } from '../shared/mask-doc.pipe';
import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DashboardApi, DashboardSummary } from './dashboard.service';
import { AuthService } from '../auth/auth.service';
import { VisitantesService, Pessoa } from '../visitantes/visitantes.service';
import { ApartamentosApi, Apartamento } from '../apartamentos/apartamentos.service';
import { ServerClockService } from '../core/server-clock.service';
import { statusVisitante } from '../core/status-visitante.util';
import { NetworkStatusService } from '../core/network-status.service';
import { direcaoLabel as direcaoLabelUtil } from '../shared/direcao-label.util';
import { SlideIndicatorDirective } from '../shared/slide-indicator.directive';

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, MaskDocPipe, SlideIndicatorDirective],
  templateUrl: './dashboard-page.component.html',
  host: {
    '(window:keydown.escape)': 'onEscapePressed()'
  }
})
export class DashboardPageComponent implements OnInit, OnDestroy {
  private api = inject(DashboardApi);
  readonly auth = inject(AuthService);
  private visitantesService = inject(VisitantesService);
  private aptosService = inject(ApartamentosApi);
  private relogio = inject(ServerClockService);
  readonly network = inject(NetworkStatusService);

  readonly data = signal<DashboardSummary | null>(null);
  readonly loading = signal(true);
  readonly agora = signal(new Date());
  readonly eventoSelecionado = signal<any | null>(null);
  readonly filtroEvento = signal<string>('Todos');
  readonly eventosMaximizados = signal(false);
  readonly buscaTexto = signal('');
  readonly filtroDirecao = signal<'todos' | 'entrada' | 'saida'>('todos');
  readonly modoCompacto = signal(false);
  readonly fotoAmpliadaUrl = signal<string | null>(null);
  readonly fotoAmpliadaTitulo = signal<string>('');

  // Estados do Modal de Liberação Rápida
  readonly showLiberarModal = signal(false);
  readonly buscaPessoa = signal('');
  readonly pessoasEncontradas = signal<Pessoa[]>([]);
  readonly pessoaSelecionada = signal<Pessoa | null>(null);
  readonly apartamentos = signal<Apartamento[]>([]);
  readonly carregandoApartamentos = signal(false);
  readonly idApartamentoSelecionado = signal<number | null>(null);
  readonly liberarInicio = signal<string>('');
  readonly liberarTermino = signal<string>('');
  readonly carregandoPessoas = signal(false);

  /** "YYYY-MM-DDTHH:mm" em hora local (formato do input datetime-local). */
  private localDateTime(horas = 0): string {
    const d = new Date(Date.now() + horas * 3600_000);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  readonly liberandoVisitante = signal(false);
  readonly erroLiberar = signal<string | null>(null);
  readonly sucessoLiberar = signal<string | null>(null);

  // Estados do Modal de Validação de PIN
  readonly showValidationModal = signal(false);
  readonly pinCode = signal('');
  readonly validationResult = signal<any | null>(null);
  readonly validationError = signal<string | null>(null);
  readonly validating = signal(false);
  readonly checkingIn = signal(false);

  // Estados do Modal de Dar Baixa Rápida
  readonly showBaixaModal = signal(false);
  readonly buscaPessoaBaixa = signal('');
  readonly pessoasNoLocal = signal<Pessoa[]>([]);
  readonly carregandoBaixa = signal(false);
  readonly registrandoSaida = signal(false);
  readonly erroBaixa = signal<string | null>(null);
  readonly sucessoBaixa = signal<string | null>(null);

  readonly filtradasBaixa = computed(() => {
    const busca = this.buscaPessoaBaixa().toLowerCase().trim();
    const lista = this.pessoasNoLocal();
    if (!busca) return lista;
    return lista.filter(p => 
      p.nome.toLowerCase().includes(busca) || 
      (p.doc_identificacao && p.doc_identificacao.toLowerCase().includes(busca))
    );
  });

  /** Estado vazio da baixa: distingue "ninguém dentro" de "a busca não achou". */
  readonly mensagemVaziaBaixa = computed(() => {
    const busca = this.buscaPessoaBaixa().trim();
    return this.pessoasNoLocal().length === 0 || !busca
      ? 'Ninguém está no condomínio agora.'
      : `Nenhum resultado para "${busca}".`;
  });

  readonly copiaSucessoTexto = signal<string | null>(null);
  private copiaSucessoTimeout?: any;

  copiarTexto(texto: string, label: string) {
    if (!texto) return;
    navigator.clipboard.writeText(texto).then(() => {
      this.copiaSucessoTexto.set(`${label} copiado!`);
      if (this.copiaSucessoTimeout) clearTimeout(this.copiaSucessoTimeout);
      this.copiaSucessoTimeout = setTimeout(() => {
        this.copiaSucessoTexto.set(null);
      }, 2000);
    });
  }

  abrirValidador() {
    this.showValidationModal.set(true);
    this.pinCode.set('');
    this.validationResult.set(null);
    this.validationError.set(null);
    this.validating.set(false);
    this.checkingIn.set(false);
  }

  fecharValidador() {
    this.showValidationModal.set(false);
    this.pinCode.set('');
    this.validationResult.set(null);
    this.validationError.set(null);
  }

  validarPIN() {
    const code = this.pinCode().trim();
    if (!code) return;

    this.validating.set(true);
    this.validationError.set(null);
    this.validationResult.set(null);

    this.visitantesService.validarCodigo(code).subscribe({
      next: (res) => {
        this.validationResult.set(res);
        this.validating.set(false);
      },
      error: (err) => {
        this.validationError.set(err?.error?.message || 'Código inválido ou visita não agendada.');
        this.validating.set(false);
      }
    });
  }

  confirmarEntradaPIN() {
    const res = this.validationResult();
    if (!res || !res.id) return;
    
    this.checkingIn.set(true);
    const isSaida = !!res.data_entrada;
    const obs = isSaida 
      ? this.visitantesService.checkOut(res.id) 
      : this.visitantesService.checkIn(res.id);

    obs.subscribe({
      next: () => {
        this.checkingIn.set(false);
        this.fecharValidador();
        this.load();
      },
      error: (err) => {
        this.validationError.set(err?.error?.message || `Erro ao registrar ${isSaida ? 'saída' : 'entrada'}.`);
        this.checkingIn.set(false);
      }
    });
  }

  iniciais(nome: string): string {
    if (!nome) return '';
    const partes = nome.trim().split(/\s+/);
    if (partes.length === 1) return partes[0].substring(0, 2).toUpperCase();
    return (partes[0].substring(0, 1) + partes[partes.length - 1].substring(0, 1)).toUpperCase();
  }

  carregarApartamentos() {
    this.carregandoApartamentos.set(true);
    this.erroLiberar.set(null);
    this.aptosService.list().subscribe({
      next: (data) => {
        this.apartamentos.set(data);
        this.carregandoApartamentos.set(false);
      },
      error: (e) => {
        this.carregandoApartamentos.set(false);
        this.erroLiberar.set(this.network.getFriendlyErrorMessage(e, 'Falha ao carregar apartamentos'));
      },
    });
  }

  abrirModalLiberar() {
    this.showLiberarModal.set(true);
    this.buscaPessoa.set('');
    this.pessoasEncontradas.set([]);
    this.pessoaSelecionada.set(null);
    this.idApartamentoSelecionado.set(null);
    this.liberarInicio.set(this.localDateTime(0)); // agora
    this.liberarTermino.set(this.localDateTime(4)); // +4h
    this.erroLiberar.set(null);
    this.sucessoLiberar.set(null);

    // Carrega a lista de apartamentos se estiver vazia
    if (this.apartamentos().length === 0) {
      this.carregarApartamentos();
    }
  }

  fecharModalLiberar() {
    this.showLiberarModal.set(false);
    this.buscaPessoa.set('');
    this.pessoasEncontradas.set([]);
    this.pessoaSelecionada.set(null);
    this.idApartamentoSelecionado.set(null);
    this.erroLiberar.set(null);
    this.sucessoLiberar.set(null);
  }

  onPesquisarPessoa() {
    const termo = this.buscaPessoa().trim();
    if (termo.length < 2) {
      this.pessoasEncontradas.set([]);
      return;
    }
    this.carregandoPessoas.set(true);
    this.visitantesService.listarPessoas(termo).subscribe({
      next: (data) => {
        this.pessoasEncontradas.set(data);
        this.carregandoPessoas.set(false);
      },
      error: (e) => {
        this.erroLiberar.set(this.network.getFriendlyErrorMessage(e, 'Falha ao buscar visitantes'));
        this.carregandoPessoas.set(false);
      }
    });
  }

  selecionarPessoa(p: Pessoa) {
    this.pessoaSelecionada.set(p);
    this.erroLiberar.set(null);
    if (p.id_apartamento) {
      this.idApartamentoSelecionado.set(p.id_apartamento);
    } else if (p.apartamentosVisitados && p.apartamentosVisitados.length > 0) {
      this.idApartamentoSelecionado.set(p.apartamentosVisitados[0].id);
    } else {
      this.idApartamentoSelecionado.set(null);
    }
  }

  confirmarLiberacao() {
    const p = this.pessoaSelecionada();
    const idApto = this.idApartamentoSelecionado();

    if (!p) {
      this.erroLiberar.set('Selecione uma pessoa para liberar o acesso.');
      return;
    }

    if (!idApto) {
      this.erroLiberar.set('Selecione o apartamento de destino.');
      return;
    }

    this.liberandoVisitante.set(true);
    this.erroLiberar.set(null);

    // `id` da lista de pessoas é o da VISITA principal; a rota quer o da
    // pessoa. Mesmo critério de chavePessoa() na tela de Visitantes.
    this.visitantesService.novaVisitaPessoa(p.id_pessoa ?? (p.id as number), {
      id_apartamento: idApto,
      data_hora_inicio: this.liberarInicio() || undefined,
      data_hora_termino: this.liberarTermino() || undefined,
    }).subscribe({
      next: (visitanteCriado) => {
        this.visitantesService.liberar(visitanteCriado.id).subscribe({
          next: () => {
            this.liberandoVisitante.set(false);
            this.sucessoLiberar.set(`Acesso de ${p.nome} liberado com sucesso!`);
            this.load();
            setTimeout(() => {
              this.fecharModalLiberar();
            }, 2000);
          },
          error: (e) => {
            this.liberandoVisitante.set(false);
            this.erroLiberar.set(this.network.getFriendlyErrorMessage(e, 'A visita foi cadastrada, mas falhou ao liberar o acesso'));
          }
        });
      },
      error: (e) => {
        this.liberandoVisitante.set(false);
        this.erroLiberar.set(this.network.getFriendlyErrorMessage(e, 'Falha ao criar visita'));
      }
    });
  }

  abrirAmpliarFoto(url: string, titulo: string) {
    this.fotoAmpliadaUrl.set(url);
    this.fotoAmpliadaTitulo.set(titulo);
  }

  fecharAmpliarFoto() {
    this.fotoAmpliadaUrl.set(null);
    this.fotoAmpliadaTitulo.set('');
  }

  readonly eventosFiltrados = computed(() => {
    const summary = this.data();
    if (!summary) return [];
    
    let filtrados = summary.ultimosEventos;
    const filtro = this.filtroEvento();
    const busca = this.buscaTexto().toLowerCase().trim();
    const direcao = this.filtroDirecao();

    // 1. Filtro por tipo de evento
    if (filtro !== 'Todos') {
      if (filtro === 'Visitante') {
        filtrados = filtrados.filter(e => 
          e.tipo === 'Visitante' || 
          e.tipo === 'Prestador' || 
          (e.tipo === 'Acesso Facial' && (e.detalhes?.tipoPessoa === 'visitante' || e.detalhes?.tipoPessoa === 'prestador'))
        );
      } else {
        filtrados = filtrados.filter(e => e.tipo === filtro);
      }
    }

    // 2. Filtro por direção (Entrada/Saída)
    if (direcao !== 'todos') {
      filtrados = filtrados.filter(e => e.direcao === direcao);
    }

    // 3. Filtro de pesquisa de texto
    if (busca) {
      filtrados = filtrados.filter(e => {
        const descricao = e.descricao ? e.descricao.toLowerCase() : '';
        const tipo = e.tipo ? e.tipo.toLowerCase() : '';
        const apto = e.detalhes?.blocoApto ? e.detalhes.blocoApto.toLowerCase() : '';
        const nome = e.detalhes?.nome ? e.detalhes.nome.toLowerCase() : '';
        
        return descricao.includes(busca) || 
               tipo.includes(busca) || 
               apto.includes(busca) || 
               nome.includes(busca);
      });
    }

    return filtrados;
  });

  toggleMaximizacao() {
    this.eventosMaximizados.update(v => !v);
    if (!this.eventosMaximizados()) {
      this.buscaTexto.set('');
      this.filtroDirecao.set('todos');
    }
  }

  limparFiltros() {
    this.buscaTexto.set('');
    this.filtroDirecao.set('todos');
    this.filtroEvento.set('Todos');
  }

  onEscapePressed() {
    if (this.eventosMaximizados()) {
      this.toggleMaximizacao();
    }
    if (this.showLiberarModal()) {
      this.fecharModalLiberar();
    }
    if (this.showValidationModal()) {
      this.fecharValidador();
    }
    if (this.showBaixaModal()) {
      this.fecharModalBaixa();
    }
  }

  abrirModalBaixa() {
    this.showBaixaModal.set(true);
    this.buscaPessoaBaixa.set('');
    this.pessoasNoLocal.set([]);
    this.erroBaixa.set(null);
    this.sucessoBaixa.set(null);
    this.carregandoBaixa.set(true);

    this.visitantesService.listarPessoas().subscribe({
      next: (data) => {
        const noLocalList = data.filter(p => p.noLocal);
        this.pessoasNoLocal.set(noLocalList);
        this.carregandoBaixa.set(false);
      },
      error: (e) => {
        this.erroBaixa.set(this.network.getFriendlyErrorMessage(e, 'Falha ao carregar pessoas no condomínio'));
        this.carregandoBaixa.set(false);
      }
    });
  }

  fecharModalBaixa() {
    this.showBaixaModal.set(false);
    this.buscaPessoaBaixa.set('');
    this.pessoasNoLocal.set([]);
    this.erroBaixa.set(null);
    this.sucessoBaixa.set(null);
  }

  confirmarBaixa(p: Pessoa) {
    if (p.id == null) return; // sem visita não há saída a registrar
    this.registrandoSaida.set(true);
    this.erroBaixa.set(null);
    this.sucessoBaixa.set(null);

    this.visitantesService.checkOut(p.id).subscribe({
      next: () => {
        this.registrandoSaida.set(false);
        this.sucessoBaixa.set(`Saída de ${p.nome} registrada com sucesso!`);
        this.load();
        
        // Remove da lista local para atualização instantânea
        this.pessoasNoLocal.update(lista => lista.filter(x => x.id !== p.id));
        
        setTimeout(() => {
          this.sucessoBaixa.set(null);
        }, 3000);
      },
      error: (e) => {
        this.registrandoSaida.set(false);
        this.erroBaixa.set(this.network.getFriendlyErrorMessage(e, 'Falha ao registrar saída'));
      }
    });
  }

  /** Gráfico "Movimento de hoje"; null enquanto a API não envia o dado. */
  readonly movimento = computed(() => {
    const horas = this.data()?.movimentoHoje;
    if (!horas?.length) return null;
    const LARGURA = 340;
    const ALTURA = 150;
    const UTIL = ALTURA - 34;
    const maximo = Math.max(...horas, 1);
    const largura = LARGURA / horas.length;
    const pico = horas.indexOf(Math.max(...horas));
    return {
      viewBox: `0 0 ${LARGURA} ${ALTURA}`,
      largura: LARGURA,
      base: ALTURA - 18,
      topo: ALTURA - 18 - UTIL,
      maximo,
      total: horas.reduce((s, v) => s + v, 0),
      pico: `${pico}h`,
      rotuloY: ALTURA - 4,
      barras: horas.map((v, h) => {
        const alt = (v / maximo) * UTIL;
        return {
          h,
          v,
          x: h * largura + 1.5,
          y: ALTURA - 18 - alt,
          largura: largura - 3,
          altura: Math.max(alt, 1),
          destaque: v > 0 && h === pico,
          rotulo: h % 6 === 0,
          meio: h * largura + largura / 2,
        };
      }),
    };
  });

  /** Mini-gráficos dos indicadores: últimos 7 dias, um ponto por dia. */
  readonly tendencias = computed(() => {
    const t = this.data()?.tendencia7d;
    if (!t) return null;
    return {
      visitantes: this.serie(t.visitantes),
      encomendas: this.serie(t.encomendas),
      ocorrencias: this.serie(t.ocorrencias),
    };
  });

  private serie(valores: number[]) {
    if (valores.length < 2) return null;
    const L = 120;
    const A = 36;
    const maximo = Math.max(...valores, 1);
    const pts = valores.map((v, i) => [(i * L) / (valores.length - 1), A - 3 - (v / maximo) * (A - 8)]);
    const linha = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    const [ux, uy] = pts[pts.length - 1];
    return {
      linha,
      area: `${linha} L${L} ${A} L0 ${A}Z`,
      x: ux - 1,
      y: uy,
      total: valores.reduce((s, v) => s + v, 0),
    };
  }

  /**
   * Painel "Na portaria agora": quem está no local primeiro; no máximo quatro.
   * "Liberado" é o mesmo da tela de Visitantes (statusVisitante): o
   * `statusLabel` da API diz "Liberado" também com a janela encerrada ou a
   * autorização do morador vencida. Recalcula com o relógio do servidor, então
   * quem tem a janela vencendo sai do painel sem esperar a próxima carga.
   */
  readonly naPortaria = signal<Pessoa[]>([]);
  readonly naPortariaVisiveis = computed(() => {
    const agoraMs = this.agora().getTime();
    return this.naPortaria()
      .filter((p) => p.noLocal || statusVisitante(p, agoraMs) === 'liberado')
      .sort((a, b) => Number(b.noLocal) - Number(a.noLocal))
      .slice(0, 4);
  });
  readonly qtdNoLocal = computed(() => this.naPortaria().filter((p) => p.noLocal).length);

  private carregarNaPortaria() {
    this.visitantesService.listarPessoas().subscribe({
      next: (lista) =>
        this.naPortaria.set(lista.filter((p) => p.noLocal || p.statusLabel === 'Liberado')),
      error: () => {},
    });
  }

  abrirBaixaDe(p: Pessoa) {
    this.abrirModalBaixa();
    this.buscaPessoaBaixa.set(p.nome);
  }

  private clockInterval?: ReturnType<typeof setInterval>;
  private portariaInterval?: ReturnType<typeof setInterval>;
  private refreshInterval?: ReturnType<typeof setInterval>;

  ngOnInit() {
    this.load();
    // Hora do SERVIDOR, não a da máquina. O PC da portaria costuma rodar sem
    // sincronização de horário e mostrava aqui um horário que não batia com o
    // dos eventos gravados pela API. Ver ServerClockService.
    this.agora.set(this.relogio.agora());
    this.clockInterval = setInterval(
      () => this.agora.set(this.relogio.agora()),
      1000,
    );
    // Atualiza eventos do dashboard a cada 4s para refletir acessos faciais
    // e outros eventos em near-real-time
    this.refreshInterval = setInterval(() => this.load(), 4_000);
    // Lista pesada: não acompanha os 4s dos eventos.
    this.carregarNaPortaria();
    this.portariaInterval = setInterval(() => this.carregarNaPortaria(), 30_000);

    // Também recarrega quando a aba volta a ficar visível
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  ngOnDestroy() {
    if (this.portariaInterval) clearInterval(this.portariaInterval);
    clearInterval(this.clockInterval);
    clearInterval(this.refreshInterval);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  private onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      this.load();
    }
  };

  private load() {
    this.api.get().subscribe({
      next: (d) => { this.data.set(d); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  /** Classe do ponto de sinal (ps-dot-*) da tag do evento; '' = ponto neutro. */
  tipoColor(evento: any): string {
    const direcao = evento?.direcao;
    const tipo = typeof evento === 'string' ? evento : (evento?.tipo ?? '');

    if (direcao === 'entrada' || direcao === 'online') {
      return 'ps-dot-ok';
    } else if (direcao === 'saida') {
      return '';
    } else if (direcao === 'negado' || direcao === 'bloqueado' || direcao === 'offline') {
      return 'ps-dot-danger';
    }

    if (tipo === 'Visitante' || tipo === 'Prestador' || tipo === 'Encomenda') {
      return '';
    }
    return 'ps-dot-warn';
  }

  /** Linha de apoio da capa do detalhe, conforme o tipo do evento. */
  subtituloEvento(evento: any): string {
    switch (evento?.tipo) {
      case 'Prestador': return 'Prestador de serviço';
      case 'Visitante': return 'Visitante cadastrado';
      case 'Encomenda': return 'Encomenda / correspondência';
      case 'Ocorrência': return 'Registro de ocorrência';
      case 'Dispositivo': return 'Status do dispositivo';
      case 'Acesso Facial': return evento.detalhes?.reconhecimentoLabel || 'Reconhecido pelo terminal facial';
      default: return '';
    }
  }
  /** Cor da faixa do evento na lista: mesma regra dos pontos de sinal (tipoColor). */
  tomEvento(evento: any): string {
    if (evento?.tipo === 'Encomenda' && !evento?.direcao) return 'var(--brand)';
    const classe = this.tipoColor(evento);
    if (classe === 'ps-dot-ok') return 'var(--signal-ok)';
    if (classe === 'ps-dot-danger') return 'var(--signal-danger)';
    if (classe === 'ps-dot-warn') return 'var(--signal-warn)';
    return 'var(--ink-subtle)';
  }
  /**
   * Selo (badge) do evento na lista/modal de detalhes. Lógica compartilhada
   * com a página de Relatórios em shared/direcao-label.util.ts — ver lá o
   * porquê de dispositivo (Offline/Online) não poder herdar Entrada/Saída.
   */
  direcaoLabel(direcao: string | undefined, tipo: string): string {
    return direcaoLabelUtil(direcao, tipo);
  }

  abrirDetalhes(evento: any) {
    this.eventoSelecionado.set(evento);
  }

  fecharDetalhes() {
    this.eventoSelecionado.set(null);
  }

  formatarDataEvento(quandoStr: string): string {
    const data = new Date(quandoStr);
    const hoje = new Date();
    
    const isHoje = data.getDate() === hoje.getDate() &&
                   data.getMonth() === hoje.getMonth() &&
                   data.getFullYear() === hoje.getFullYear();
                   
    const ontem = new Date();
    ontem.setDate(hoje.getDate() - 1);
    const isOntem = data.getDate() === ontem.getDate() &&
                    data.getMonth() === ontem.getMonth() &&
                    data.getFullYear() === ontem.getFullYear();

    const horas = String(data.getHours()).padStart(2, '0');
    const minutos = String(data.getMinutes()).padStart(2, '0');
    const horaStr = `${horas}:${minutos}`;

    if (isHoje) {
      return `Hoje, ${horaStr}`;
    } else if (isOntem) {
      return `Ontem, ${horaStr}`;
    } else {
      const dia = String(data.getDate()).padStart(2, '0');
      const mes = String(data.getMonth() + 1).padStart(2, '0');
      const ano = data.getFullYear();
      return `${dia}/${mes}/${ano} às ${horaStr}`;
    }
  }

  obterRotaCadastro(tipoPessoa?: string): string {
    switch (tipoPessoa) {
      case 'morador': return '/moradores';
      case 'visitante': return '/visitantes';
      case 'prestador': return '/prestadores';
      case 'funcionario': return '/prestadores/cadastro';
      default: return '';
    }
  }
}
