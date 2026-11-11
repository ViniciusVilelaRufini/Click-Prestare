import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ClienteDrawerComponent } from './cliente-drawer.component';
import { CrmApi } from '../crm.service';
import { CrmStore } from '../crm.store';
import { ToastService } from '../../shared/toast.service';
import type { Morador } from '../crm.models';

/**
 * Suporte: o síndico cadastrou o morador com o e-mail errado. Só o CRM
 * corrige a conta; a tela pede o e-mail novo e o motivo, e mostra a
 * mensagem da API quando ela recusa (ex.: e-mail de outra conta).
 */
describe('ClienteDrawerComponent — corrigir e-mail de acesso', () => {
  const morador: Morador = {
    id: 50,
    nome: 'Carlos Morador',
    documento: null,
    email: 'carlos@gmial.com',
    telefone: null,
    tipo: 'Proprietário',
    bloco: 'A',
    apartamento: '101',
    id_apartamento: 3,
    id_condominio: 1,
    photo: null,
    face_id: null,
    face_sync_status: null,
  };

  function montar(resposta: any) {
    const api = { corrigirEmailAcessoMorador: jest.fn(() => resposta) };
    const toast = { trigger: jest.fn() };
    const store = {
      clienteSelecionado: signal<any>({ id: 1, nome: 'Cond Teste' }),
      clientes: signal<any[]>([]),
      salvando: signal(false),
      abrirCliente: jest.fn(),
      fecharCliente: jest.fn(),
    };
    TestBed.configureTestingModule({
      imports: [ClienteDrawerComponent],
      providers: [
        provideRouter([]),
        { provide: CrmApi, useValue: api },
        { provide: CrmStore, useValue: store },
        { provide: ToastService, useValue: toast },
      ],
    });
    const comp = TestBed.createComponent(ClienteDrawerComponent).componentInstance;
    comp.moradores.set([morador]);
    return { comp, api, toast };
  }

  it('envia o e-mail novo e o motivo e atualiza a lista', () => {
    const { comp, api, toast } = montar(
      of({ success: true, idMorador: 50, email: 'carlos@gmail.com', contaAtualizada: true }),
    );

    comp.abrirCorrecaoEmail(morador);
    expect(comp.moradorCorrecaoEmail()?.id).toBe(50);
    comp.emailCorrigido = ' Carlos@Gmail.com ';
    comp.motivoCorrecaoEmail = 'Síndico digitou gmial';
    comp.corrigirEmailAcesso();

    expect(api.corrigirEmailAcessoMorador).toHaveBeenCalledWith(1, 50, 'Carlos@Gmail.com', 'Síndico digitou gmial');
    expect(comp.moradores()[0].email).toBe('carlos@gmail.com');
    expect(comp.moradorCorrecaoEmail()).toBeNull();
    expect(toast.trigger).toHaveBeenCalledWith(expect.any(String), 'success');
  });

  it('mostra a mensagem da API no diálogo quando ela recusa', () => {
    const { comp } = montar(
      throwError(() => ({ error: { message: 'Este e-mail já pertence a outra conta.' } })),
    );

    comp.abrirCorrecaoEmail(morador);
    comp.emailCorrigido = 'joao@gmail.com';
    comp.motivoCorrecaoEmail = 'm';
    comp.corrigirEmailAcesso();

    expect(comp.erroCorrecaoEmail()).toBe('Este e-mail já pertence a outra conta.');
    // Diálogo segue aberto e a lista não muda.
    expect(comp.moradorCorrecaoEmail()?.id).toBe(50);
    expect(comp.moradores()[0].email).toBe('carlos@gmial.com');
  });

  it('não chama a API sem motivo', () => {
    const { comp, api } = montar(of({}));

    comp.abrirCorrecaoEmail(morador);
    comp.emailCorrigido = 'carlos@gmail.com';
    comp.motivoCorrecaoEmail = '   ';
    comp.corrigirEmailAcesso();

    expect(api.corrigirEmailAcessoMorador).not.toHaveBeenCalled();
    expect(comp.erroCorrecaoEmail()).toMatch(/motivo/i);
  });
});
