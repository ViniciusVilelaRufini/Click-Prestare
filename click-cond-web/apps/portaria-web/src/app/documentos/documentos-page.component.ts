import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DocumentosApi, DocumentoItem } from './documentos.service';
import { ConfirmService } from '../shared/confirm.service';
import { AuthService } from '../auth/auth.service';
import { papelDoToken } from '../auth/papel';

import { SlideIndicatorDirective } from '../shared/slide-indicator.directive';

/** Mensagem do servidor quando houver; senão a do cliente; senão a padrão. */
function msgErro(e: any, padrao: string): string {
  const m = e?.error?.message ?? e?.message;
  return (Array.isArray(m) ? m.join(' ') : m) || padrao;
}

@Component({
  selector: 'app-documentos-page',
  standalone: true,
  imports: [CommonModule, FormsModule, SlideIndicatorDirective],
  templateUrl: './documentos-page.component.html',
})
export class DocumentosPageComponent implements OnInit {
  private api = inject(DocumentosApi);
  private confirm = inject(ConfirmService);
  private auth = inject(AuthService);

  readonly loading = signal(true);
  readonly isAtaTab = signal(false);
  readonly documentos = signal<DocumentoItem[]>([]);
  /** Erro da lista ou da exclusão. */
  readonly erro = signal<string | null>(null);

  /**
   * Publicar e excluir são do síndico e do funcionário do app: a API recusa o
   * porteiro de login/senha (assertStaff). Mesmo critério de comunicados —
   * papel do token; a API segue decidindo.
   */
  readonly podeGerir = computed(() => {
    this.auth.porteiroInfo(); // recalcula ao entrar / trocar de condomínio
    const papel = papelDoToken(this.auth.token);
    return papel === 'sindico' || papel === 'funcionario';
  });

  // Modal
  readonly modalUpload = signal(false);
  readonly selectedFileName = signal('');
  readonly salvando = signal(false);
  /** Erro ao publicar, mostrado dentro do drawer. */
  readonly erroUpload = signal<string | null>(null);
  novoDoc = { nome: '', isAta: false, base64: '' };

  ngOnInit() {
    this.carregar();
  }

  carregar() {
    this.loading.set(true);
    this.erro.set(null);
    this.api.listDocumentos(this.isAtaTab()).subscribe({
      next: (res) => {
        this.documentos.set(res || []);
        this.loading.set(false);
      },
      error: (e) => {
        this.documentos.set([]);
        this.loading.set(false);
        this.erro.set(msgErro(e, 'Falha ao carregar os documentos.'));
      },
    });
  }

  mudarAba(isAta: boolean) {
    this.isAtaTab.set(isAta);
    this.carregar();
  }

  abrirModalUpload() {
    this.novoDoc = { nome: '', isAta: this.isAtaTab(), base64: '' };
    this.selectedFileName.set('');
    this.erroUpload.set(null);
    this.modalUpload.set(true);
  }

  /** Fechar no meio do envio escondia o resultado (o erro ou o sucesso). */
  fecharUpload() {
    if (this.salvando()) return;
    this.modalUpload.set(false);
  }

  onFileSelected(event: any) {
    const file = event.target.files?.[0];
    if (file) {
      this.selectedFileName.set(file.name);
      // Simula leitura em base64
      const reader = new FileReader();
      reader.onload = () => {
        this.novoDoc.base64 = reader.result as string;
        if (!this.novoDoc.nome) {
          // Usa o nome do arquivo sem extensão como sugestão
          this.novoDoc.nome = file.name.replace(/\.[^/.]+$/, '');
        }
      };
      reader.readAsDataURL(file);
    }
  }

  salvarDocumento() {
    if (this.salvando()) return;
    this.salvando.set(true);
    this.erroUpload.set(null);
    this.api.insertDocumento(this.novoDoc.nome, this.novoDoc.isAta, this.novoDoc.base64).subscribe({
      next: () => {
        this.salvando.set(false);
        this.modalUpload.set(false);
        this.carregar();
      },
      error: (e) => {
        this.salvando.set(false);
        this.erroUpload.set(msgErro(e, 'Não foi possível publicar o documento.'));
      },
    });
  }

  /**
   * Selo do cartão pela extensão do arquivo (a apuração das pautas, gravada ao
   * finalizar a assembleia, é .txt). Sem extensão reconhecível: PDF, como antes.
   */
  seloArquivo(link: string | null | undefined): string {
    const caminho = String(link ?? '').split(/[?#]/)[0];
    const ext = /\.([a-z0-9]{2,4})$/i.exec(caminho)?.[1]?.toUpperCase();
    return ext && ['PDF', 'TXT', 'CSV', 'DOC', 'DOCX', 'XLS', 'XLSX'].includes(ext) ? ext : 'PDF';
  }

  async removerDocumento(doc: DocumentoItem) {
    const ok = await this.confirm.ask({
      title: 'Excluir documento',
      message: `"${doc.nome}" sai do console e do app dos moradores.`,
      confirmLabel: 'Excluir',
      variant: 'danger',
    });
    if (!ok) return;
    this.erro.set(null);
    this.api.removeDocumento(doc.id).subscribe({
      next: () => this.carregar(),
      error: (e) => this.erro.set(msgErro(e, 'Não foi possível excluir o documento.')),
    });
  }
}
