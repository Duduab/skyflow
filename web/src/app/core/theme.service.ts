import { Injectable, signal } from '@angular/core';

export type SkyflowTheme = 'dark' | 'light';

const STORAGE_KEY = 'skyflow-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly mode = signal<SkyflowTheme>('light');

  constructor() {
    const stored = localStorage.getItem(STORAGE_KEY) as SkyflowTheme | null;
    const initial =
      stored && ['dark', 'light'].includes(stored) ? stored : 'light';
    this.apply(initial);
  }

  setTheme(theme: SkyflowTheme): void {
    this.apply(theme);
  }

  toggle(): void {
    this.apply(this.mode() === 'dark' ? 'light' : 'dark');
  }

  private apply(theme: SkyflowTheme): void {
    localStorage.setItem(STORAGE_KEY, theme);
    document.documentElement.classList.toggle('theme-light', theme === 'light');
    document.documentElement.dataset['theme'] = theme;
    this.mode.set(theme);
  }
}
