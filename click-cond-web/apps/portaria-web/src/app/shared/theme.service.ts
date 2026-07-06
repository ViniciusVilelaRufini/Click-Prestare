import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly isLight = signal<boolean>(false);

  constructor() {
    this.initializeTheme();
    // Verifica transições automáticas a cada 10 segundos
    setInterval(() => this.checkTimeTransition(), 10000);
  }

  private initializeTheme() {
    const hour = new Date().getHours();
    const currentPhase = (hour >= 18 || hour < 5) ? 'night' : 'day';
    const savedPhase = localStorage.getItem('theme_phase');
    const savedMode = localStorage.getItem('theme_mode');

    if (savedPhase !== currentPhase) {
      // Transição de fase de horário: força o padrão da nova fase
      const shouldBeLight = currentPhase === 'day';
      this.setTheme(shouldBeLight);
      localStorage.setItem('theme_phase', currentPhase);
      localStorage.setItem('theme_mode', shouldBeLight ? 'light' : 'dark');
    } else if (savedMode) {
      // Mesma fase: respeita a escolha manual do usuário
      this.setTheme(savedMode === 'light');
    } else {
      // Padrão inicial
      const shouldBeLight = currentPhase === 'day';
      this.setTheme(shouldBeLight);
      localStorage.setItem('theme_phase', currentPhase);
      localStorage.setItem('theme_mode', shouldBeLight ? 'light' : 'dark');
    }
  }

  private checkTimeTransition() {
    const hour = new Date().getHours();
    const currentPhase = (hour >= 18 || hour < 5) ? 'night' : 'day';
    const savedPhase = localStorage.getItem('theme_phase');

    if (savedPhase !== currentPhase) {
      // Transição automática de fase enquanto o app está aberto
      const shouldBeLight = currentPhase === 'day';
      this.setTheme(shouldBeLight);
      localStorage.setItem('theme_phase', currentPhase);
      localStorage.setItem('theme_mode', shouldBeLight ? 'light' : 'dark');
    }
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
    localStorage.setItem('theme_mode', nextLight ? 'light' : 'dark');
  }
}
