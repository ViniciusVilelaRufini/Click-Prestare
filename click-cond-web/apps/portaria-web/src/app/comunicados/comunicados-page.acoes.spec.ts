import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ComunicadosPageComponent } from './comunicados-page.component';
import { ComunicadosApi } from './comunicados.service';

/**
 * Editar/Excluir ficavam com opacity-0 até o hover: em tela de toque ficavam
 * invisíveis. Agora os dois botões ficam sempre visíveis.
 */
describe('ComunicadosPageComponent — botões Editar/Excluir', () => {
  it('Editar e Excluir existem e não estão escondidos por opacity-0', () => {
    TestBed.configureTestingModule({
      imports: [ComunicadosPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ComunicadosApi,
          useValue: {
            list: () => of([{ id: 1, titulo: 'Aviso', descricao: 'Texto', created_at: '2026-10-05T14:30:00' }]),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(ComunicadosPageComponent);
    fixture.detectChanges();

    const editar = fixture.nativeElement.querySelector('button[title="Editar"]') as HTMLElement;
    const excluir = fixture.nativeElement.querySelector('button[title="Excluir"]') as HTMLElement;
    expect(editar).toBeTruthy();
    expect(excluir).toBeTruthy();
    for (const b of [editar, excluir]) {
      expect(b.classList.contains('opacity-0')).toBe(false);
      expect(b.className).not.toContain('group-hover:opacity-100');
    }
  });
});
