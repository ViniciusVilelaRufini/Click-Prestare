import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { InterfonePageComponent } from './interfone-page.component';
import { InterfoneStore } from './interfone.store';
import { LigarUnidadeComponent } from './ligar-unidade.component';
import { ChamadasHojeComponent } from './chamadas-hoje.component';

@Component({ selector: 'app-ligar-unidade', standalone: true, template: '<p>ligar</p>' })
class LigarFalso {}

@Component({ selector: 'app-chamadas-hoje', standalone: true, template: '<p>chamadas</p>' })
class ChamadasFalso {}

describe('InterfonePageComponent', () => {
  const ativo = signal(false);
  const semChamadas = signal<string | null>(null);
  const somBloqueado = signal(false);
  const ativarSom = jest.fn();

  function montar() {
    TestBed.configureTestingModule({
      imports: [InterfonePageComponent],
      providers: [{ provide: InterfoneStore, useValue: { ativo, semChamadas, somBloqueado, ativarSom } }],
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

  describe('estado do console', () => {
    beforeEach(() => {
      ativo.set(true);
      semChamadas.set(null);
      somBloqueado.set(false);
    });
    const estado = (el: HTMLElement) => el.querySelector('[data-teste="estado-console"]') as HTMLElement;

    it('tudo certo → pronto para receber chamadas', () => {
      expect(estado(montar()).textContent).toContain('Pronto para receber chamadas');
    });

    it('som bloqueado → clicar ativa o som', () => {
      somBloqueado.set(true);
      const e = estado(montar());
      expect(e.textContent).toContain('Som bloqueado');
      e.click();
      expect(ativarSom).toHaveBeenCalled();
    });

    it('sem conexão ou microfone → mostra o motivo', () => {
      semChamadas.set('Sem conexão com a central. Você não vai receber chamadas do interfone.');
      somBloqueado.set(true);
      const e = estado(montar());
      expect(e.textContent).toContain('Sem conexão com a central');
      expect(e.querySelector('.ps-dot-danger')).not.toBeNull();
    });
  });
});
