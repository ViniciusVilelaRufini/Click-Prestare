import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CrmStore } from '../crm.store';

/**
 * Aba Configurações: tabela de preços dos planos + status dos gateways de
 * integração + log de webhooks. Todo o estado vem do CrmStore.
 */
@Component({
  selector: 'crm-configuracoes',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './crm-configuracoes.component.html',
})
export class CrmConfiguracoesComponent {
  readonly store = inject(CrmStore);
}
