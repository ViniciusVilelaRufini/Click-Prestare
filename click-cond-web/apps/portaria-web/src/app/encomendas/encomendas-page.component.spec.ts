import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { EncomendasPageComponent } from './encomendas-page.component';
import { EncomendasApi } from './encomendas.service';
import { ApartamentosApi } from '../apartamentos/apartamentos.service';
import { ConfirmService } from '../shared/confirm.service';

describe('EncomendasPageComponent printable labels', () => {
  function build() {
    TestBed.configureTestingModule({
      imports: [EncomendasPageComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: EncomendasApi, useValue: { list: jest.fn(() => of([])) } },
        { provide: ApartamentosApi, useValue: { list: jest.fn(() => of([])) } },
        { provide: ConfirmService, useValue: { ask: jest.fn(() => Promise.resolve(true)) } },
        { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
      ],
    });

    return TestBed.createComponent(EncomendasPageComponent).componentInstance;
  }

  it('escapes untrusted encomenda fields in printable markup', () => {
    const component = build();
    const markup = (component as any).buildPrintLabel({
      id: 1,
      descricao: '<img src=x onerror=alert(1)>',
      destinatario_apto: '101',
      destinatario_bloco: null,
      recebido_de: 'Correios',
      recebido_em: '2026-09-22T12:00:00.000Z',
    });

    expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(markup).not.toContain('<img src=x');
  });

  it('does not interpolate an untrusted identifier into the individual print document', () => {
    const component = build();
    const printDocument = { write: jest.fn(), close: jest.fn() };
    jest.spyOn(window, 'open').mockReturnValue({ document: printDocument } as any);

    component.imprimir({
      id: '"><img src=x onerror=alert(1)>' as any,
      descricao: 'Caixa',
      destinatario_apto: '101',
      destinatario_bloco: null,
      recebido_de: 'Correios',
      recebido_em: '2026-09-22T12:00:00.000Z',
    });

    expect(printDocument.write).toHaveBeenCalledTimes(1);
    expect(printDocument.write.mock.calls[0][0]).not.toContain('<img src=x');
  });
});
