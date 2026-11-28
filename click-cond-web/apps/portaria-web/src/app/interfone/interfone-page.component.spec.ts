import { TestBed } from '@angular/core/testing';
import { Component, input, signal } from '@angular/core';
import { InterfonePageComponent } from './interfone-page.component';
import { InterfoneStore } from './interfone.store';
import { LigarUnidadeComponent } from './ligar-unidade.component';
import { ChamadasHojeComponent } from './chamadas-hoje.component';

@Component({ selector: 'app-ligar-unidade', standalone: true, template: '<p>ligar</p>' })
class LigarFalso {}

@Component({ selector: 'app-chamadas-hoje', standalone: true, template: '<p>chamadas</p>' })
class ChamadasFalso {
  readonly alturaLivre = input(false);
}

describe('InterfonePageComponent', () => {
  const ativo = signal(false);

  function montar() {
    TestBed.configureTestingModule({
      imports: [InterfonePageComponent],
      providers: [{ provide: InterfoneStore, useValue: { ativo } }],
    });
    TestBed.overrideComponent(InterfonePageComponent, {
      remove: { imports: [LigarUnidadeComponent, ChamadasHojeComponent] },
      add: { imports: [LigarFalso, ChamadasFalso] },
    });
    const f = TestBed.createComponent(InterfonePageComponent);
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }

  it('com o interfone ativo mostra ligar para a unidade e as chamadas de hoje', () => {
    ativo.set(true);
    const el = montar();
    expect(el.querySelector('h1')?.textContent).toContain('Interfone');
    expect(el.querySelector('app-ligar-unidade')).not.toBeNull();
    expect(el.querySelector('app-chamadas-hoje')).not.toBeNull();
    expect(el.querySelector('[data-teste="interfone-inativo"]')).toBeNull();
  });

  it('sem o interfone ativo explica por que não há nada', () => {
    ativo.set(false);
    const el = montar();
    expect(el.querySelector('app-ligar-unidade')).toBeNull();
    expect(el.querySelector('[data-teste="interfone-inativo"]')?.textContent).toContain('não está ativo');
  });
});
