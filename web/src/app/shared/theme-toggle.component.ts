import { Component, inject, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

import { ThemeService } from '../core/theme.service';

@Component({
  selector: 'skyflow-theme-toggle',
  imports: [TranslateModule],
  template: `
    @if (appearance() === 'icon') {
      <button
        type="button"
        class="sf-theme-toggle sf-theme-toggle--icon"
        (click)="theme.toggle()"
        [attr.aria-pressed]="theme.mode() === 'dark'"
        [attr.aria-label]="
          (theme.mode() === 'dark'
            ? 'APP.THEME_SWITCH_LIGHT'
            : 'APP.THEME_SWITCH_DARK') | translate
        "
      >
        @if (theme.mode() === 'dark') {
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
        } @else {
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        }
      </button>
    } @else {
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
    }
  `,
})
export class ThemeToggleComponent {
  readonly theme = inject(ThemeService);
  /** `icon` — כפתור אייקון בלבד (למשל ב־header דסקטופ) */
  readonly appearance = input<'text' | 'icon'>('text');
}
