import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { VeiculosPageComponent } from './veiculos-page.component';
import { VeiculosApi } from '../moradores/veiculos.service';
import { MoradoresApi } from '../moradores/moradores.service';
import { ConfirmService } from '../shared/confirm.service';
import { AuthService } from '../auth/auth.service';

/** Remover veículo que a API recusa: antes nada acontecia na tela; agora o erro aparece. */
const carro = {
  id: 100, id_morador: 10, id_condominio: 3, placa: 'ABC1D23', cor: null, marca_modelo: 'Civic',
  id_tag: null, tag: null, morador: { id: 10, nome: 'Ana Souza', bloco: 'A', apartamento: '101' },
};

function build(remove: () => any) {
  const api = {
    listAll: jest.fn(() => of([carro])),
    listTags: jest.fn(() => of([])),
    remove: jest.fn(remove),
  };
  TestBed.configureTestingModule({
    imports: [VeiculosPageComponent],
    providers: [
      { provide: VeiculosApi, useValue: api },
      { provide: MoradoresApi, useValue: { list: jest.fn(() => of([])) } },
      { provide: ConfirmService, useValue: { ask: jest.fn(() => Promise.resolve(true)) } },
      { provide: AuthService, useValue: { porteiroInfo: () => ({ id_condominio: 3 }) } },
    ],
  });
  const f = TestBed.createComponent(VeiculosPageComponent);
  f.detectChanges();
  return { f, tela: f.componentInstance, api, el: f.nativeElement as HTMLElement };
}

describe('VeiculosPageComponent — remover veículo', () => {
  it('erro da API aparece na aba Veículos', async () => {
    const { f, tela, el } = build(() => throwError(() => ({ error: { message: 'Veículo vinculado a uma vaga ativa.' } })));
    await tela.removerVeiculo(carro as any);
    f.detectChanges();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Veículo vinculado a uma vaga ativa.');
  });

  it('sucesso recarrega a lista', async () => {
    const { tela, api } = build(() => of({ ok: true }));
    await tela.removerVeiculo(carro as any);
    expect(api.listAll).toHaveBeenCalledTimes(2);
  });
});
