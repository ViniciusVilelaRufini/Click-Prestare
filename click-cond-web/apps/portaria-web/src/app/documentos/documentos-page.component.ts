import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DocumentosApi, DocumentoItem } from './documentos.service';

import { SlideIndicatorDirective } from '../shared/slide-indicator.directive';
@Component({
  selector: 'app-documentos-page',
  standalone: true,
  imports: [CommonModule, FormsModule, SlideIndicatorDirective],
  templateUrl: './documentos-page.component.html',
})
export class DocumentosPageComponent implements OnInit {
  private api = inject(DocumentosApi);

  readonly loading = signal(true);
  readonly isAtaTab = signal(false);
  readonly documentos = signal<DocumentoItem[]>([]);

  // Modal
  readonly modalUpload = signal(false);
  readonly selectedFileName = signal('');
  novoDoc = { nome: '', isAta: false, base64: '' };

  ngOnInit() {
    this.carregar();
  }

  carregar() {
    this.loading.set(true);
    this.api.listDocumentos(this.isAtaTab()).subscribe(res => {
      this.documentos.set(res || []);
      this.loading.set(false);
    });
  }

  mudarAba(isAta: boolean) {
    this.isAtaTab.set(isAta);
    this.carregar();
  }

  abrirModalUpload() {
    this.novoDoc = { nome: '', isAta: this.isAtaTab(), base64: '' };
    this.selectedFileName.set('');
    this.modalUpload.set(true);
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
    this.api.insertDocumento(this.novoDoc.nome, this.novoDoc.isAta, this.novoDoc.base64).subscribe(() => {
      this.modalUpload.set(false);
      this.carregar();
    });
  }

  removerDocumento(id: number) {
    this.api.removeDocumento(id).subscribe(() => {
      this.carregar();
    });
  }
}
