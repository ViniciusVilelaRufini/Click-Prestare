import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { ApartamentosPageComponent } from './apartamentos-page.component';
import { ApartamentosApi } from './apartamentos.service';
import { VagasApi, VagasResumo } from './vagas.service';
import { MoradoresApi } from '../moradores/moradores.service';
import { ConfirmService } from '../shared/confirm.service';
import { AuthService } from '../auth/auth.service';

/**
 * Painel de vagas: vaga cedida a visitante mostra até quando vale e, depois do
 * prazo, aparece "vencida" (não ocupa mais a vaga, mas segue na lista com o
 * Revogar). Revogar que falha mostra o erro em vez de sumir em silêncio.
 */
const APTO = { id: 10, apto: '101', bloco: 'A', qtd_vagas: 2 } as any;
const fimValido = new Date(2099, 10, 14, 12, 30).toISOString();
const resumo: VagasResumo = {
  qtd_vagas: 2,
  ocupadas: 1,
  moradores: [{ id: 5, nome: 'Titular', tipo: 'Morador' }],
  vagas: [
    {
      id: 7, tipo_ocupacao: 'visitante', id_morador_titular: 5, id_veiculo: null, id_visitante: 3,
      id_morador_beneficiario: null, placa: null, inicio: null, fim: new Date(2020, 0, 1).toISOString(),
      vencida: true, titular_nome: 'Titular', ocupante_nome: 'Visitante Vencido',
    },
    {
      id: 8, tipo_ocupacao: 'visitante', id_morador_titular: 5, id_veiculo: null, id_visitante: 4,
      id_morador_beneficiario: null, placa: null, inicio: null, fim: fimValido,
      vencida: false, titular_nome: 'Titular', ocupante_nome: 'Visitante Valido',
    },
  ],
};

function build(vagasApi: Record<string, unknown> = {}) {
  const vagas = {
    list: jest.fn(() => of(resumo)),
    revogar: jest.fn(() => of({ ok: true })),
    beneficiarios: jest.fn(() => of({ visitantes: [], inquilinos: [] })),
    ...vagasApi,
  };
  TestBed.configureTestingModule({
    imports: [ApartamentosPageComponent],
    providers: [
      { provide: ApartamentosApi, useValue: { list: jest.fn(() => of([APTO])) } },
      { provide: VagasApi, useValue: vagas },
      { provide: MoradoresApi, useValue: {} },
      { provide: HttpClient, useValue: { get: jest.fn(() => of([])) } },
      { provide: ConfirmService, useValue: { ask: jest.fn(() => Promise.resolve(true)) } },
      { provide: AuthService, useValue: { porteiroInfo: () => ({ id_condominio: 1 }) } },
    ],
  });
  const f = TestBed.createComponent(ApartamentosPageComponent);
  f.detectChanges();
  f.componentInstance.abrirVagas(APTO);
  f.detectChanges();
  return { f, tela: f.componentInstance, vagas, el: f.nativeElement as HTMLElement };
}

function linha(el: HTMLElement, nome: string) {
  return Array.from(el.querySelectorAll('.ps-drawer-body > div')).find((d) => d.textContent?.includes(nome)) as HTMLElement;
}

describe('ApartamentosPageComponent — vagas de visitante com prazo', () => {
  it('vaga dentro do prazo mostra "válida até dd/mm HH:mm"', () => {
    const { el } = build();
    expect(linha(el, 'Visitante Valido').textContent).toContain('válida até 14/11 12:30');
  });

  it('vaga vencida mostra "vencida" e mantém o Revogar', () => {
    const { el } = build();
    const l = linha(el, 'Visitante Vencido');
    expect(l.textContent).toContain('vencida');
    expect(l.querySelector('button[title="Revogar vaga"]')).toBeTruthy();
  });

  it('Revogar que falha mostra a mensagem do servidor', async () => {
    const { f, tela, el } = build({
      revogar: jest.fn(() => throwError(() => ({ error: { message: 'Vaga não encontrada.' } }))),
    });
    await tela.revogarVaga(resumo.vagas[0]);
    f.detectChanges();
    expect(el.textContent).toContain('Vaga não encontrada.');
  });
});
