import { Component, inject } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

import { ThemeService } from '../core/theme.service';

@Component({
  selector: 'skyflow-theme-toggle',
  imports: [TranslateModule],
  template: `
    <button
      type="button"
      class="sf-theme-toggle"
      (click)="theme.toggle()"
      [attr.aria-pressed]="theme.mode() === 'dark'"
      [attr.aria-label]="
        (theme.mode() === 'dark'
          ? 'APP.THEME_SWITCH_LIGHT'
          : 'APP.THEME_SWITCH_DARK') | translate
      "
    >
      {{
        (theme.mode() === 'dark'
          ? 'APP.THEME_SWITCH_LIGHT'
          : 'APP.THEME_SWITCH_DARK') | translate
      }}
    </button>
  `,
})
export class ThemeToggleComponent {
  readonly theme = inject(ThemeService);
}
