import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RelatoriosApi } from './relatorios.service';

@Component({
  selector: 'app-relatorios-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './relatorios-page.component.html',
})
export class RelatoriosPageComponent {
  private api = inject(RelatoriosApi);

  readonly tipo = signal<'visitantes' | 'encomendas' | 'ocorrencias' | 'financeiro'>('visitantes');
  readonly dataInicio = signal<string>('');
  readonly dataFim = signal<string>('');
  readonly loading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  setTipo(t: 'visitantes' | 'encomendas' | 'ocorrencias' | 'financeiro') {
    this.tipo.set(t);
  }

  exportar(formato: 'pdf' | 'xlsx') {
    this.loading.set(true);
    this.error.set(null);

    this.api.downloadReport(
      this.tipo(),
      formato,
      this.dataInicio() || undefined,
      this.dataFim() || undefined
    ).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const extension = formato;
        const formattedDate = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
        a.download = `relatorio_${this.tipo()}_${formattedDate}.${extension}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        this.loading.set(false);
      },
      error: (err) => {
        console.error(err);
        this.error.set('Não foi possível gerar o relatório. Verifique os filtros e tente novamente.');
        this.loading.set(false);
      },
    });
  }
}
