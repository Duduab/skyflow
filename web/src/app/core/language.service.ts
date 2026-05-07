import { Injectable, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

export type SkyflowLang = 'he' | 'ar' | 'en';

const STORAGE_KEY = 'skyflow-lang';

@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly translate = inject(TranslateService);

  readonly current = signal<SkyflowLang>('he');

  constructor() {
    const stored = localStorage.getItem(STORAGE_KEY) as SkyflowLang | null;
    const initial =
      stored && ['he', 'ar', 'en'].includes(stored) ? stored : 'he';
    this.apply(initial);
  }

  setLanguage(lang: SkyflowLang): void {
    localStorage.setItem(STORAGE_KEY, lang);
    this.apply(lang);
  }

  private apply(lang: SkyflowLang): void {
    this.translate.use(lang).subscribe(() => {
      document.documentElement.lang = lang;
      document.documentElement.dir = lang !== 'en' ? 'rtl' : 'ltr';
      this.current.set(lang);
    });
  }
}
