import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, forkJoin, of } from 'rxjs';
import {
  ConfigInterfone,
  FacialInterfone,
  InterfoneApi,
  MonitorInterfone,
  RamalUnidade,
} from '../../interfone/interfone.api';
import { ConfirmService } from '../../shared/confirm.service';
import { ToastService } from '../../shared/toast.service';

export type ProblemaRamal = 'duplicado' | 'invalido' | 'pendente' | 'sem_numero' | null;

const RAMAL_VALIDO = /^\d{1,10}$/;

/**
 * Situação de cada ramal com as edições da tela. `duplicado` = o mesmo número em duas unidades; `invalido` = não é
 * só dígitos (1–10); `pendente` = unidade sem ramal e sem sugestão (o número colide e o síndico precisa escolher); `sem_numero` = unidade sem dígitos (ex.: "Cobertura"), só informativo.
 * Só `duplicado` e `invalido` bloqueiam o salvar (ver bloqueiaSalvar): ramal vazio grava vazio e a unidade só não
 * recebe chamadas até ter um número.
 */
export function analisarRamais(itens: RamalUnidade[], edicoes: Record<number, string>): Map<number, ProblemaRamal> {
  const valor = (i: RamalUnidade) => (edicoes[i.id_apartamento] ?? i.ramal ?? '').trim();
  const contagem = new Map<string, number>();
  for (const i of itens) {
    const v = valor(i);
    if (v) contagem.set(v, (contagem.get(v) ?? 0) + 1);
  }
  const res = new Map<number, ProblemaRamal>();
  for (const i of itens) {
    const v = valor(i);
    let p: ProblemaRamal = null;
    if (v && !RAMAL_VALIDO.test(v)) p = 'invalido';
    else if (v && (contagem.get(v) ?? 0) > 1) p = 'duplicado';
    else if (!v && !i.sugestao) p = i.conflito ? 'pendente' : 'sem_numero';
    res.set(i.id_apartamento, p);
  }
  return res;
}

/** Ramal preenchido repetido ou inválido: não dá para gravar. Unidade sem ramal não bloqueia. */
export function bloqueiaSalvar(p: ProblemaRamal): boolean {
  return p === 'duplicado' || p === 'invalido';
}

interface EdicaoFacial {
  habilitado: boolean;
  blocos: string;
  dtmf: string;
}

const MSG_PROBLEMA: Record<Exclude<ProblemaRamal, null>, string> = {
  duplicado: 'Conflito: número repetido',
  invalido: 'Só números (até 10)',
  pendente: 'Conflito: defina o ramal',
  sem_numero: 'Sem número: defina o ramal',
};

/**
 * Aba "Interfone" das Configurações (síndico, só com o módulo contratado): liga/desliga e tempos, faciais que
 * chamam (blocos, DTMF, dados para o instalador, lista telefônica, nova senha), ramais das unidades e monitores IP.
 * Toda alteração vai para o log de auditoria pela API.
 */
@Component({
  selector: 'app-interfone-config',
  standalone: true,
  host: { class: 'block' },
  templateUrl: './interfone-config.component.html',
})
export class InterfoneConfigComponent implements OnInit {
  private readonly api = inject(InterfoneApi);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);

  readonly carregado = signal(false);
  readonly erroCarga = signal<string | null>(null);

  // ===== Módulo =====
  readonly ativo = signal(false);
  readonly toqueApto = signal(30);
  readonly transferir = signal(true);
  readonly toquePortaria = signal(45);
  readonly salvandoConfig = signal(false);
  readonly erroConfig = signal<string | null>(null);

  // ===== Faciais =====
  readonly faciais = signal<FacialInterfone[]>([]);
  readonly edFacial = signal<Record<number, EdicaoFacial>>({});
  readonly salvandoFacial = signal<number | null>(null);
  readonly senhaVisivel = signal<Record<number, boolean>>({});

  // ===== Ramais =====
  readonly ramais = signal<RamalUnidade[]>([]);
  readonly edRamal = signal<Record<number, string>>({});
  readonly salvandoRamais = signal(false);
  readonly erroRamais = signal<string | null>(null);
  readonly problemas = computed(() => analisarRamais(this.ramais(), this.edRamal()));
  /** "N a resolver": só o que impede salvar (ramal preenchido repetido ou inválido). */
  readonly totalProblemas = computed(() => [...this.problemas().values()].filter(bloqueiaSalvar).length);
  /** "M sem ramal" (informativo): unidades que ficam sem receber chamadas. */
  readonly totalSemRamal = computed(() => this.ramais().filter((r) => !this.valorRamal(r).trim()).length);
  readonly mudancasRamais = computed(() => {
    const ed = this.edRamal();
    return this.ramais()
      .filter((r) => r.id_apartamento in ed && (ed[r.id_apartamento].trim() || null) !== (r.ramal ?? null))
      .map((r) => ({ id_apartamento: r.id_apartamento, ramal: ed[r.id_apartamento].trim() || null }));
  });
  readonly podeSalvarRamais = computed(
    () => !this.salvandoRamais() && this.totalProblemas() === 0 && this.mudancasRamais().length > 0,
  );

  // ===== Monitores =====
  readonly monitores = signal<MonitorInterfone[]>([]);
  readonly novoMonitorApto = signal<number | null>(null);
  readonly novoMonitorNome = signal('');
  readonly salvandoMonitor = signal(false);
  readonly senhaMonitorVisivel = signal<Record<number, boolean>>({});

  ngOnInit(): void {
    const comPadrao = <T>(obs: Observable<T>, padrao: T): Observable<T> =>
      obs.pipe(
        catchError(() => {
          this.erroCarga.set('Parte das informações do interfone não carregou. Recarregue a página.');
          return of(padrao);
        }),
      );
    forkJoin({
      config: comPadrao<ConfigInterfone | null>(this.api.config(), null),
      faciais: comPadrao<FacialInterfone[]>(this.api.faciais(), []),
      ramais: comPadrao<RamalUnidade[]>(this.api.ramais(), []),
      monitores: comPadrao<MonitorInterfone[]>(this.api.monitores(), []),
    }).subscribe(({ config, faciais, ramais, monitores }) => {
      if (config) this.aplicarConfig(config);
      this.aplicarFaciais(faciais);
      this.ramais.set(Array.isArray(ramais) ? ramais : []);
      this.monitores.set(Array.isArray(monitores) ? monitores : []);
      this.carregado.set(true);
    });
  }

  // ===================== Módulo =====================

  salvarConfig(): void {
    if (this.salvandoConfig()) return;
    const apto = Number(this.toqueApto());
    const portaria = Number(this.toquePortaria());
    if (!Number.isInteger(apto) || apto < 15 || apto > 60) {
      this.erroConfig.set('O toque no apartamento deve ficar entre 15 e 60 segundos.');
      return;
    }
    if (!Number.isInteger(portaria) || portaria < 15 || portaria > 120) {
      this.erroConfig.set('O toque na portaria deve ficar entre 15 e 120 segundos.');
      return;
    }
    this.erroConfig.set(null);
    this.salvandoConfig.set(true);
    this.api
      .salvarConfig({ ativo: this.ativo(), toque_apto_s: apto, transferir: this.transferir(), toque_portaria_s: portaria })
      .subscribe({
        next: (c) => {
          this.salvandoConfig.set(false);
          if (c) this.aplicarConfig(c);
          this.toast.success('Interfone salvo.');
        },
        error: (e: HttpErrorResponse) => {
          this.salvandoConfig.set(false);
          this.erroConfig.set(mensagem(e) ?? 'Não foi possível salvar o interfone.');
        },
      });
  }

  numero(v: string): number {
    return v === '' ? NaN : Number(v);
  }

  private aplicarConfig(c: ConfigInterfone): void {
    this.ativo.set(!!c.ativo);
    this.toqueApto.set(Number(c.toque_apto_s) || 30);
    this.transferir.set(!!c.transferir);
    this.toquePortaria.set(Number(c.toque_portaria_s) || 45);
  }

  // ===================== Faciais =====================

  private aplicarFaciais(lista: FacialInterfone[]): void {
    const arr = Array.isArray(lista) ? lista : [];
    this.faciais.set(arr);
    const ed: Record<number, EdicaoFacial> = {};
    for (const f of arr) ed[f.id] = this.edicaoDe(f);
    this.edFacial.set(ed);
  }

  private edicaoDe(f: FacialInterfone): EdicaoFacial {
    return { habilitado: !!f.habilitado, blocos: (f.blocos ?? []).join(', '), dtmf: f.dtmf ?? '' };
  }

  editarFacial(id: number, campo: keyof EdicaoFacial, valor: string | boolean): void {
    this.edFacial.update((ed) => ({ ...ed, [id]: { ...ed[id], [campo]: valor } }));
  }

  salvarFacial(f: FacialInterfone): void {
    const ed = this.edFacial()[f.id];
    if (!ed || this.salvandoFacial() !== null) return;
    const blocos = ed.blocos.split(/[,;]/).map((b) => b.trim()).filter(Boolean);
    const dtmf = ed.dtmf.trim();
    if (dtmf && !/^[0-9*#]{1,10}$/.test(dtmf)) {
      this.toast.error('Comando DTMF: só números, * e # (até 10).');
      return;
    }
    this.salvandoFacial.set(f.id);
    this.api.salvarFacial(f.id, { habilitado: ed.habilitado, blocos: blocos.length ? blocos : null, dtmf: dtmf || null }).subscribe({
      next: (novo) => {
        this.salvandoFacial.set(null);
        this.trocarFacial(novo ?? { ...f, habilitado: ed.habilitado, blocos: blocos.length ? blocos : null, dtmf: dtmf || null });
        this.toast.success(`${f.nome}: salvo.`);
      },
      error: (e: HttpErrorResponse) => {
        this.salvandoFacial.set(null);
        this.toast.error(mensagem(e) ?? 'Não foi possível salvar o facial.');
      },
    });
  }

  async novaSenha(f: FacialInterfone): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Gerar nova senha?',
      message: `"${f.nome}" deixa de conectar à central até o instalador colocar a senha nova no aparelho.`,
      confirmLabel: 'Gerar nova senha',
      variant: 'danger',
    });
    if (!ok) return;
    this.api.novaSenhaFacial(f.id).subscribe({
      next: (r) => {
        const senha = typeof r?.senha === 'string' ? r.senha : null;
        if (!senha) {
          this.toast.error('A senha nova não veio. Recarregue a página antes de passar a senha ao instalador.');
          return;
        }
        // Só a senha muda; o facial é o da linha (a resposta não traz id).
        this.faciais.update((l) => l.map((x) => (x.id === f.id ? { ...x, senha } : x)));
        this.senhaVisivel.update((s) => ({ ...s, [f.id]: true }));
        this.toast.success('Senha nova gerada. Passe esta ao instalador.');
        this.copiar(senha);
      },
      error: (e: HttpErrorResponse) => this.toast.error(mensagem(e) ?? 'Não foi possível gerar a senha.'),
    });
  }

  alternarSenha(id: number): void {
    this.senhaVisivel.update((s) => ({ ...s, [id]: !s[id] }));
  }

  alternarSenhaMonitor(id: number): void {
    this.senhaMonitorVisivel.update((s) => ({ ...s, [id]: !s[id] }));
  }

  baixarLista(f: FacialInterfone): void {
    this.api.listaTelefonica(f.id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `lista-telefonica-${f.nome.replace(/[^\w-]+/g, '-').toLowerCase() || f.id}.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      error: () => this.toast.error('Não foi possível baixar a lista telefônica.'),
    });
  }

  copiar(texto: string | number | null | undefined): void {
    const v = String(texto ?? '');
    if (!v) return;
    const clip = (globalThis.navigator as Navigator | undefined)?.clipboard;
    if (!clip?.writeText) {
      this.toast.error('O navegador não deixou copiar. Selecione e copie à mão.');
      return;
    }
    clip.writeText(v).then(
      () => this.toast.success('Copiado.'),
      () => this.toast.error('O navegador não deixou copiar. Selecione e copie à mão.'),
    );
  }

  private trocarFacial(novo: FacialInterfone): void {
    this.faciais.update((l) => l.map((x) => (x.id === novo.id ? novo : x)));
    this.edFacial.update((ed) => ({ ...ed, [novo.id]: this.edicaoDe(novo) }));
  }

  // ===================== Ramais =====================

  valorRamal(r: RamalUnidade): string {
    return this.edRamal()[r.id_apartamento] ?? r.ramal ?? '';
  }

  editarRamal(id: number, valor: string): void {
    this.edRamal.update((ed) => ({ ...ed, [id]: valor }));
    this.erroRamais.set(null);
  }

  problemaDe(r: RamalUnidade): ProblemaRamal {
    return this.problemas().get(r.id_apartamento) ?? null;
  }

  textoProblema(p: ProblemaRamal): string {
    return p ? MSG_PROBLEMA[p] : '';
  }

  bloqueia(p: ProblemaRamal): boolean {
    return bloqueiaSalvar(p);
  }

  aplicarSugestoes(): void {
    const ed = { ...this.edRamal() };
    for (const r of this.ramais()) {
      if (!this.valorRamal(r).trim() && r.sugestao) ed[r.id_apartamento] = r.sugestao;
    }
    this.edRamal.set(ed);
  }

  salvarRamais(): void {
    if (!this.podeSalvarRamais()) return;
    this.salvandoRamais.set(true);
    this.erroRamais.set(null);
    this.api.salvarRamais(this.mudancasRamais()).subscribe({
      next: (lista) => {
        this.salvandoRamais.set(false);
        if (Array.isArray(lista)) this.ramais.set(lista);
        this.edRamal.set({});
        this.toast.success('Ramais salvos.');
      },
      error: (e: HttpErrorResponse) => {
        this.salvandoRamais.set(false);
        this.erroRamais.set(mensagem(e) ?? 'Não foi possível salvar os ramais.');
      },
    });
  }

  // ===================== Monitores =====================

  unidadeDoMonitor(m: MonitorInterfone): string {
    return m.unidade ?? this.ramais().find((r) => r.id_apartamento === m.id_apartamento)?.unidade ?? '';
  }

  adicionarMonitor(): void {
    const apto = this.novoMonitorApto();
    const nome = this.novoMonitorNome().trim();
    if (!apto || !nome || this.salvandoMonitor()) return;
    this.salvandoMonitor.set(true);
    this.api.criarMonitor({ id_apartamento: apto, nome }).subscribe({
      next: (m) => {
        this.salvandoMonitor.set(false);
        if (m) this.monitores.update((l) => [...l, m]);
        this.novoMonitorNome.set('');
        this.novoMonitorApto.set(null);
        this.toast.success('Monitor cadastrado.');
      },
      error: (e: HttpErrorResponse) => {
        this.salvandoMonitor.set(false);
        this.toast.error(mensagem(e) ?? 'Não foi possível cadastrar o monitor.');
      },
    });
  }

  async removerMonitor(m: MonitorInterfone): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Remover monitor?',
      message: `"${m.nome}" deixa de tocar nas chamadas do interfone.`,
      confirmLabel: 'Remover',
      variant: 'danger',
    });
    if (!ok) return;
    this.api.removerMonitor(m.id).subscribe({
      next: () => {
        this.monitores.update((l) => l.filter((x) => x.id !== m.id));
        this.toast.success('Monitor removido.');
      },
      error: (e: HttpErrorResponse) => this.toast.error(mensagem(e) ?? 'Não foi possível remover o monitor.'),
    });
  }
}

function mensagem(e: HttpErrorResponse | null | undefined): string | null {
  const m = e?.error?.message;
  if (typeof m === 'string' && m.trim()) return m;
  if (Array.isArray(m) && m.length) return m.join(' ');
  return null;
}
