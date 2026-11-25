import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { DashboardPageComponent } from './dashboard-page.component';

/**
 * Varredura do console 25/11 (W13): o Validar PIN aceitava menos de 6 dígitos e consultava a API à
 * toa (404 "Código inválido"). Mesmo comportamento do modal de Visitantes: só os 6 dígitos vão
 * para a API (o hífen da máscara é ignorado).
 */
describe('DashboardPageComponent — Validar PIN exige 6 dígitos', () => {
  function build(): any {
    TestBed.configureTestingModule({
      imports: [DashboardPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const tela: any = TestBed.createComponent(DashboardPageComponent).componentInstance;
    tela.visitantesService.validarCodigo = jest.fn(() => of({ id: 1 }));
    return tela;
  }

  it('com 2 dígitos não chama a API e avisa', () => {
    const tela = build();
    tela.pinCode.set('12');
    tela.validarPIN();
    expect(tela.visitantesService.validarCodigo).not.toHaveBeenCalled();
    expect(tela.validationError()).toBe('Digite os 6 dígitos do PIN');
    expect(tela.pinCompleto()).toBe(false);
  });

  it('com a máscara "123-456" manda só os dígitos', () => {
    const tela = build();
    tela.pinCode.set('123-456');
    expect(tela.pinCompleto()).toBe(true);
    tela.validarPIN();
    expect(tela.visitantesService.validarCodigo).toHaveBeenCalledWith('123456');
  });
});
