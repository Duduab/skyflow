import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import { LanguageService } from './core/language.service';
import { LanguageSwitcherComponent } from './shared/language-switcher.component';
import { ThemeService } from './core/theme.service';
import { BottomNavComponent } from './shared/bottom-nav.component';
import { ThemeToggleComponent } from './shared/theme-toggle.component';

@Component({
  selector: 'skyflow-root',
  imports: [
    RouterOutlet,
    RouterLink,
    TranslateModule,
    LanguageSwitcherComponent,
    ThemeToggleComponent,
    BottomNavComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  /** Eager init for persisted locale + document dir */
  private readonly _i18n = inject(LanguageService);
  private readonly _theme = inject(ThemeService);

  /** Light UI → dark-colored logo; dark UI → light-colored logo (header contrast). */
  readonly headerLogoSrc = computed(() =>
    this._theme.mode() === 'light'
      ? '/assets/logo/dark-mode.png'
      : '/assets/logo/bright-mode.png',
  );
}
