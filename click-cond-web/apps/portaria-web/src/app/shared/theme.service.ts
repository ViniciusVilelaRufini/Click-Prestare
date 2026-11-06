import { Injectable, signal } from '@angular/core';

const CHAVE_TEMA = 'prestare_theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly isLight = signal<boolean>(false);

  constructor() {
    this.setTheme(this.temaInicialClaro());
  }

  // Mesma regra do script inline de index.html: a escolha salva vence; sem ela, segue o
  // sistema, e o escuro é o padrão.
  private temaInicialClaro(): boolean {
    const salvo = localStorage.getItem(CHAVE_TEMA);
    if (salvo === 'light' || salvo === 'dark') return salvo === 'light';
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ?? false;
  }

  setTheme(light: boolean) {
    this.isLight.set(light);
    if (light) {
      document.body.classList.add('light');
      document.documentElement.classList.add('light');
      document.body.classList.remove('dark');
      document.documentElement.classList.remove('dark');
    } else {
      document.body.classList.remove('light');
      document.documentElement.classList.remove('light');
      document.body.classList.add('dark');
      document.documentElement.classList.add('dark');
    }
  }

  toggleTheme() {
    const nextLight = !this.isLight();
    this.setTheme(nextLight);
    localStorage.setItem(CHAVE_TEMA, nextLight ? 'light' : 'dark');
  }
}
