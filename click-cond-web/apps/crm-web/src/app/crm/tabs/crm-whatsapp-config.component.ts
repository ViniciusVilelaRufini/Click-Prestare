import { Component, EventEmitter, OnInit, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Automacoes, Resposta, WhatsappApi } from '../whatsapp.service';

type Aba = 'respostas' | 'automacoes';
interface Rascunho { id: number | null; atalho: string; titulo: string; texto: string; ordem: number }

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Janela de configuração do WhatsApp: respostas rápidas e respostas automáticas. */
@Component({
  selector: 'app-crm-whatsapp-config',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './crm-whatsapp-config.component.html',
})
export class CrmWhatsappConfigComponent implements OnInit {
  private api = inject(WhatsappApi);
  @Output() fechar = new EventEmitter<void>();
  @Output() respostasMudaram = new EventEmitter<Resposta[]>();

  readonly dias = DIAS;
  aba = signal<Aba>('respostas');
  respostas = signal<Resposta[]>([]);
  rascunho = signal<Rascunho | null>(null);
  auto = signal<Automacoes | null>(null);
  salvando = signal(false);
  erro = signal<string | null>(null);
  ok = signal<string | null>(null);

  ngOnInit() {
    this.api.respostas().subscribe({ next: (r) => this.respostas.set(r), error: () => this.erro.set('Falha ao carregar respostas.') });
    this.api.automacoes().subscribe({ next: (a) => this.auto.set(a), error: () => this.erro.set('Falha ao carregar automações.') });
  }

  nova() {
    this.rascunho.set({ id: null, atalho: '', titulo: '', texto: '', ordem: this.respostas().length + 1 });
  }

  editar(r: Resposta) {
    this.rascunho.set({ ...r });
  }

  salvarResposta() {
    const r = this.rascunho();
    if (!r || this.salvando()) return;
    this.salvando.set(true);
    this.erro.set(null);
    const corpo = { atalho: r.atalho, titulo: r.titulo, texto: r.texto, ordem: r.ordem };
    const req = r.id ? this.api.editarResposta(r.id, corpo) : this.api.criarResposta(corpo);
    req.subscribe({
      next: (salva) => {
        const lista = r.id ? this.respostas().map((x) => (x.id === salva.id ? salva : x)) : [...this.respostas(), salva];
        this.respostas.set(lista);
        this.respostasMudaram.emit(lista);
        this.rascunho.set(null);
        this.salvando.set(false);
      },
      error: (e) => { this.erro.set(e?.error?.message ?? 'Falha ao salvar.'); this.salvando.set(false); },
    });
  }

  excluir(r: Resposta) {
    this.api.excluirResposta(r.id).subscribe({
      next: () => {
        const lista = this.respostas().filter((x) => x.id !== r.id);
        this.respostas.set(lista);
        this.respostasMudaram.emit(lista);
      },
      error: () => this.erro.set('Falha ao excluir.'),
    });
  }

  alternarDia(d: number) {
    const a = this.auto();
    if (!a) return;
    const dias = a.foraHorario.dias.includes(d) ? a.foraHorario.dias.filter((x) => x !== d) : [...a.foraHorario.dias, d].sort();
    this.auto.set({ ...a, foraHorario: { ...a.foraHorario, dias } });
  }

  salvarAutomacoes() {
    const a = this.auto();
    if (!a || this.salvando()) return;
    this.salvando.set(true);
    this.erro.set(null);
    this.api.salvarAutomacoes(a).subscribe({
      next: (salvo) => { this.auto.set(salvo); this.salvando.set(false); this.ok.set('Automações salvas.'); setTimeout(() => this.ok.set(null), 3000); },
      error: () => { this.erro.set('Falha ao salvar automações.'); this.salvando.set(false); },
    });
  }
}
