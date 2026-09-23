import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { ConvitePageComponent } from './convite-page.component';
import { API_BASE } from '../shared/api.config';
import { ThemeService } from '../shared/theme.service';

describe('ConvitePageComponent — token público', () => {
  function build(params: Record<string, string>, query: Record<string, string>) {
    TestBed.configureTestingModule({
      imports: [ConvitePageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap(params),
              queryParamMap: convertToParamMap(query),
            },
          },
        },
        { provide: ThemeService, useValue: { isLight: signal(false) } },
      ],
    });
    return {
      component: TestBed.createComponent(ConvitePageComponent).componentInstance,
      http: TestBed.inject(HttpTestingController),
    };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('aceita o token vindo da query na raiz pública', () => {
    const { component, http } = build({}, { convite: 'token-query' });

    component.ngOnInit();

    const request = http.expectOne(`${API_BASE}/convites/publico/token-query`);
    request.flush({ condominio: 'Edifício Demo', unidade: '101', is_prestador: false });
  });

  it('prioriza o token da rota quando rota e query existem', () => {
    const { component, http } = build({ token: 'token-rota' }, { convite: 'token-query' });

    component.ngOnInit();

    const request = http.expectOne(`${API_BASE}/convites/publico/token-rota`);
    request.flush({ condominio: 'Edifício Demo', unidade: '101', is_prestador: false });
  });
});
