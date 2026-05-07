import { Component, inject } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

import { LanguageService, SkyflowLang } from '../core/language.service';

@Component({
  selector: 'skyflow-language-switcher',
  imports: [TranslateModule],
  template: `
    <div class="sf-lang-bar">
      @for (lang of langs; track lang.code) {
        <button
          type="button"
          class="sf-lang-btn"
          [class.is-active]="langSvc.current() === lang.code"
          (click)="langSvc.setLanguage(lang.code)"
        >
          {{ lang.labelKey | translate }}
        </button>
      }
    </div>
  `,
})
export class LanguageSwitcherComponent {
  protected readonly langSvc = inject(LanguageService);

  readonly langs: { code: SkyflowLang; labelKey: string }[] = [
    { code: 'he', labelKey: 'LANG.HE' },
    { code: 'ar', labelKey: 'LANG.AR' },
    { code: 'en', labelKey: 'LANG.EN' },
  ];
}
