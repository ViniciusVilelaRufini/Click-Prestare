import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { of, throwError } from 'rxjs';
import { MoradoresPageComponent } from './moradores-page.component';
import { MoradoresApi } from './moradores.service';
import { VeiculosApi } from './veiculos.service';
import { ApartamentosApi } from '../apartamentos/apartamentos.service';
import { ConfirmService } from '../shared/confirm.service';
import { AuthService } from '../auth/auth.service';
import { ToastService } from '../shared/toast.service';

/** "Enviar Acesso": menor não recebe credencial de app, e a recusa da API aparece com o texto dela. */
function build(sendCredentials: jest.Mock) {
  const toast = { success: jest.fn(), error: jest.fn(), warning: jest.fn() };
  const confirm = { ask: jest.fn(() => Promise.resolve(true)) };
  TestBed.configureTestingModule({
    imports: [MoradoresPageComponent],
    providers: [
      { provide: MoradoresApi, useValue: { sendCredentials, list: jest.fn(() => of([])) } },
      { provide: VeiculosApi, useValue: {} },
      { provide: ApartamentosApi, useValue: { list: jest.fn(() => of([])) } },
      { provide: ConfirmService, useValue: confirm },
      { provide: AuthService, useValue: { porteiroInfo: () => ({ id_condominio: 1 }) } },
      { provide: ToastService, useValue: toast },
      { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
    ],
  });
  const tela = TestBed.createComponent(MoradoresPageComponent).componentInstance;
  return { tela, toast, confirm };
}

const morador = (extra: any = {}) => ({ id: 5, nome: 'Bia', email: 'bia@x.com', data_nascimento: null, ...extra }) as any;

describe('MoradoresPageComponent — Enviar Acesso', () => {
  it('menor de 18 pela data do cadastro: avisa e não chama a API', async () => {
    const send = jest.fn(() => of({ ok: true }));
    const { tela, toast, confirm } = build(send);
    const dez = new Date();
    dez.setFullYear(dez.getFullYear() - 10);

    await tela.sendCredentials(morador({ data_nascimento: dez.toISOString() }));

    expect(send).not.toHaveBeenCalled();
    expect(confirm.ask).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('menor de 18 anos'));
  });

  it('recusa da API aparece com a mensagem dela', async () => {
    const send = jest.fn(() => throwError(() => ({ error: { message: 'Este morador é menor de 18 anos e não recebe acesso ao app.' } })));
    const { tela, toast } = build(send);

    await tela.sendCredentials(morador());

    expect(toast.error).toHaveBeenCalledWith('Este morador é menor de 18 anos e não recebe acesso ao app.');
  });
});
